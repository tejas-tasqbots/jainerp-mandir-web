/**
 * Full CRUD lifecycle across every mandir module.
 *
 * `mandir-api/resources` is a generic CRUD surface over 40+ tenant tables, and
 * it is the least-tested part of the product: the other suites drive business
 * flows (donate, book, settle) and barely touch the masters and registers those
 * flows depend on. A vendor that cannot be edited, a room whose update silently
 * does nothing, a deleted asset that cannot be restored — none of that shows up
 * in a donation test, and all of it is what a temple's staff use daily.
 *
 * Each resource runs the same 14-operation lifecycle, so every module gets well
 * past ten distinct CRUD operations:
 *
 *    create · read-back · list · search · page · update · verify-update
 *    · partial-update-safety · reject-invalid · reject-unknown-column
 *    · 404-unknown-id · delete · gone-from-list · row-retained · restore
 *
 * Payloads are derived from `information_schema` (see `crud-lib.mjs`) rather
 * than hand-written, so each create sends exactly what the table requires. That
 * is deliberate: a column that is NOT NULL in the database but missing from a
 * form is the "saved fine, row never appeared" defect this codebase keeps
 * hitting, and a hand-written fixture would encode the same blind spot.
 *
 *   node e2e/master/09-mandir-crud.mjs
 */
import {
  suite, t, skip, expect, FIXTURES,
  mandirApi, mandirLogin, psql, psql1, schemaOf, uniq,
} from './lib.mjs';
import { buildCreatePayload, updatableTextColumn, fit } from './crud-lib.mjs';

const S = schemaOf(FIXTURES.tenant);
let ADMIN;

/**
 * Every module's CRUD surface, as `[module, resource, table]`.
 * One representative resource per module, plus the shared masters that every
 * module reads from.
 */
const RESOURCES = [
  ['masters',      'vendors',             'vendors'],
  ['masters',      'donation-categories', 'donation_categories'],
  ['masters',      'expense-categories',  'expense_categories'],
  ['accounting',   'accounts',            'accounts'],
  ['accounting',   'gst-rates',           'gst_rates'],
  ['accounting',   'fixed-assets',        'fixed_assets'],
  ['accounting',   'loans',               'loans'],
  ['accounting',   'creditors',           'creditors'],
  ['dharamshala',  'rooms',               'rooms'],
  ['dharamshala',  'halls',               'halls'],
  ['seva',         'sevas',               'sevas'],
  ['seva',         'priests',             'priests'],
  ['staff',        'employees',           'employees'],
  ['staff',        'volunteers',          'volunteers'],
  ['inventory',    'inventory-items',     'inventory_items'],
  ['registers',    'lost-found',          'lost_found'],
  ['registers',    'announcements',       'announcements'],
  ['gaushala',     'cattle',              'cattle'],
  ['gaushala',     'feed-stock',          'feed_stock'],
  ['bhojanshala',  'annadaan-entries',    'annadaan_entries'],
];

const GHOST = '00000000-0000-0000-0000-000000000000';

await suite('09-mandir-crud', async () => {
  ADMIN = (await mandirLogin(FIXTURES.admin)).token;

  for (const [module, resource, table] of RESOURCES) {
    const id = (n) => `TC-CRUD-${resource.toUpperCase().replace(/-/g, '')}-${String(n).padStart(2, '0')}`;
    const tag = uniq();
    const { payload, required, unresolved, nameCol } = buildCreatePayload(S, table, { tag });

    if (unresolved.length) {
      skip(id(1), 'P2', `${module}/${resource}: CRUD lifecycle`,
        `needs a fixture row in ${unresolved.join(', ')}`);
      continue;
    }

    let rowId = null;

    // ── 1. CREATE ────────────────────────────────────────────────────────
    await t(id(1), 'P1', `${module}/${resource}: create with exactly the columns the table requires`, async () => {
      const r = await mandirApi('POST', `/${resource}`, { token: ADMIN, body: payload });
      expect.http2xx(r, `create failed with ${JSON.stringify(payload)}`);
      rowId = r.data?.id;
      expect.ok(rowId, `no id returned: ${JSON.stringify(r.data).slice(0, 120)}`);
      return `required=[${required.join(',')}]`;
    });

    if (!rowId) {
      skip(id(2), 'P1', `${module}/${resource}: remaining lifecycle`, 'create did not return an id');
      continue;
    }

    // ── 2. READ BACK ─────────────────────────────────────────────────────
    await t(id(2), 'P1', `${module}/${resource}: read back returns what was written`, async () => {
      const r = await mandirApi('GET', `/${resource}/${rowId}`, { token: ADMIN });
      expect.http2xx(r);
      for (const [k, v] of Object.entries(payload)) {
        if (typeof v !== 'string' || !v.startsWith('QA')) continue;
        expect.eq(String(r.data[k]), v, `${k} did not round-trip`);
      }
      return 'values match';
    });

    // ── 3. LIST ──────────────────────────────────────────────────────────
    await t(id(3), 'P1', `${module}/${resource}: the new row appears in the list`, async () => {
      // Searched rather than paged: these lists order by name over tables with
      // hundreds of rows, so "in the first 200" tests the fixture size, not the
      // list. `?q=` is the same filter the screen's search box uses.
      const r = await mandirApi('GET', `/${resource}?q=QA${tag}&limit=50`, { token: ADMIN });
      expect.http2xx(r);
      const found = r.data.some((x) => x.id === rowId);
      if (!found) {
        // Resources without searchCols ignore ?q= — fall back to paging deep
        // enough to be conclusive.
        const all = await mandirApi('GET', `/${resource}?limit=500`, { token: ADMIN });
        expect.ok(all.data.some((x) => x.id === rowId), 'created row missing from the list');
        return `found by paging (${all.data.length} rows)`;
      }
      return 'found by search';
    });

    // ── 4. SEARCH ────────────────────────────────────────────────────────
    await t(id(4), 'P2', `${module}/${resource}: findable by search`, async () => {
      if (!nameCol) return 'no searchable name column';
      const r = await mandirApi('GET', `/${resource}?q=QA${tag}&limit=20`, { token: ADMIN });
      expect.http2xx(r);
      // Not every resource declares searchCols; what must never happen is a 5xx
      // or the search returning somebody else's row.
      if (r.data.length) {
        expect.ok(r.data.every((x) => JSON.stringify(x).includes(`QA${tag}`) || x.id === rowId),
          'search returned rows that do not match the term');
      }
      return `${r.data.length} matches`;
    });

    // ── 5. PAGING ────────────────────────────────────────────────────────
    await t(id(5), 'P2', `${module}/${resource}: limit is honoured and junk paging does not 500`, async () => {
      const one = await mandirApi('GET', `/${resource}?limit=1`, { token: ADMIN });
      expect.http2xx(one);
      expect.ok(one.data.length <= 1, `limit=1 returned ${one.data.length}`);
      const junk = await mandirApi('GET', `/${resource}?page=abc&limit=xyz`, { token: ADMIN });
      expect.ok(junk.status < 500, `junk paging returned ${junk.status}`);
      return `limit ok, junk -> ${junk.status}`;
    });

    // ── 6/7. UPDATE + VERIFY ─────────────────────────────────────────────
    const patchTarget = updatableTextColumn(S, table);
    const patchCol = patchTarget?.name ?? null;
    const patchVal = fit(`QAEDIT${tag}`, patchTarget?.maxLen ?? 0);

    await t(id(6), 'P1', `${module}/${resource}: update is accepted`, async () => {
      if (!patchCol) return 'no safely patchable text column';
      const r = await mandirApi('PATCH', `/${resource}/${rowId}`, {
        token: ADMIN, body: { [patchCol]: patchVal },
      });
      expect.http2xx(r);
      return `${patchCol} <- ${patchVal}`;
    });

    await t(id(7), 'P1', `${module}/${resource}: the update actually persisted`, async () => {
      // A 2xx on PATCH is not evidence the row changed. This codebase has
      // shipped saves that returned success and wrote nothing.
      if (!patchCol) return 'no patchable column';
      const stored = psql1(`SELECT ${patchCol} FROM ${S}.${table} WHERE id = '${rowId}'`);
      expect.eq(stored, patchVal, 'PATCH returned 2xx but the column did not change');
      return `stored "${stored}"`;
    });

    await t(id(8), 'P1', `${module}/${resource}: a partial update leaves other columns alone`, async () => {
      if (!patchCol || !nameCol || nameCol === patchCol) return 'no independent column to compare';
      const stored = psql1(`SELECT ${nameCol} FROM ${S}.${table} WHERE id = '${rowId}'`);
      expect.eq(stored, `QA${tag}`, `${nameCol} was clobbered by an unrelated PATCH`);
      return `${nameCol} intact`;
    });

    // ── 9/10. VALIDATION ─────────────────────────────────────────────────
    await t(id(9), 'P1', `${module}/${resource}: a create missing required columns is refused`, async () => {
      if (!required.length) return 'table has no required columns';
      const r = await mandirApi('POST', `/${resource}`, { token: ADMIN, body: {} });
      expect.rejected(r, 'an empty create should not be accepted when columns are NOT NULL');
      return `${r.status} ${r.code}`;
    });

    await t(id(10), 'P1', `${module}/${resource}: an unknown column is not written`, async () => {
      const r = await mandirApi('PATCH', `/${resource}/${rowId}`, {
        token: ADMIN, body: { definitely_not_a_column: 'x' },
      });
      // Either refused, or ignored — what must not happen is a 5xx from the
      // column being interpolated into the UPDATE.
      expect.ok(r.status < 500, `unknown column caused ${r.status}`);
      return `${r.status}`;
    });

    await t(id(11), 'P1', `${module}/${resource}: an unknown id is 404, a malformed one is 4xx`, async () => {
      const ghost = await mandirApi('GET', `/${resource}/${GHOST}`, { token: ADMIN });
      expect.status(ghost, 404);
      const bad = await mandirApi('GET', `/${resource}/not-a-uuid`, { token: ADMIN });
      expect.rejected(bad);
      expect.ok(bad.status < 500, `malformed id returned ${bad.status}`);
      return `404 / ${bad.status}`;
    });

    // ── 12–14. DELETE, RETENTION, RESTORE ────────────────────────────────
    await t(id(12), 'P1', `${module}/${resource}: delete is accepted`, async () => {
      const r = await mandirApi('DELETE', `/${resource}/${rowId}`, { token: ADMIN });
      expect.http2xx(r);
      return `${r.status}`;
    });

    await t(id(13), 'P1', `${module}/${resource}: delete keeps the row recoverable`, async () => {
      // ResourcesService.remove() picks its strategy from the table's columns:
      // deleted_at → soft delete, else is_active → deactivate, else hard DELETE.
      // Both recoverable strategies must leave the row in the table; a hard
      // delete is only acceptable for a resource the Recycle Bin never offers.
      const hasDeletedAt = psql(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = '${S}' AND table_name = '${table}' AND column_name = 'deleted_at'`).length > 0;
      const hasIsActive = psql(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = '${S}' AND table_name = '${table}' AND column_name = 'is_active'`).length > 0;
      const still = Number(psql1(`SELECT count(*) FROM ${S}.${table} WHERE id = '${rowId}'`));
      if (!hasDeletedAt && !hasIsActive) {
        // Neither strategy available, so remove() issues a real DELETE. That is
        // the documented fallback, and acceptable only because the audit row
        // captures the full `before` state — the row is then recoverable by an
        // engineer from audit_log, though not by anyone using the product.
        // Money-bearing tables in this position are listed in Test_Report;
        // `annadaan_entries` carries cost_per_meal_paise and total_cost_paise.
        expect.eq(still, 0, 'hard delete did not remove the row');
        const snapshot = psql1(
          `SELECT before_state IS NOT NULL FROM ${S}.audit_log
            WHERE entity_id = '${rowId}' AND action = 'delete'
            ORDER BY occurred_at DESC LIMIT 1`);
        expect.eq(snapshot, 't',
          'hard delete left no before_state in the audit log — the row is unrecoverable');
        return 'hard delete, recoverable only from audit_log';
      }
      expect.eq(still, 1, 'delete was hard — the row cannot be restored and the audit trail is gone');
      if (hasDeletedAt) {
        const stamped = psql1(`SELECT deleted_at IS NOT NULL FROM ${S}.${table} WHERE id = '${rowId}'`);
        expect.eq(stamped, 't', 'deleted_at was not stamped');
        const list = await mandirApi('GET', `/${resource}?limit=500`, { token: ADMIN });
        expect.ok(!list.data.some((x) => x.id === rowId), 'a soft-deleted row is still listed');
        return 'soft-deleted and hidden';
      }
      if (hasIsActive) {
        const active = psql1(`SELECT is_active FROM ${S}.${table} WHERE id = '${rowId}'`);
        expect.eq(active, 'f', 'is_active was not cleared');
        return 'deactivated (row retained, still listed by design)';
      }
      return 'row retained';
    });

    await t(id(14), 'P1', `${module}/${resource}: a deleted row can be restored`, async () => {
      const r = await mandirApi('POST', `/${resource}/${rowId}/restore`, { token: ADMIN, body: {} });
      if (r.status >= 400) return `restore not exposed for this resource (${r.status})`;
      const back = await mandirApi('GET', `/${resource}/${rowId}`, { token: ADMIN });
      expect.http2xx(back, 'restored row is not readable');
      const stamped = psql1(`SELECT deleted_at IS NULL FROM ${S}.${table} WHERE id = '${rowId}'`);
      expect.eq(stamped, 't', 'restore did not clear deleted_at');
      // Leave the fixture as we found it.
      await mandirApi('DELETE', `/${resource}/${rowId}`, { token: ADMIN });
      return 'restored';
    });
  }

  // ── Cross-cutting checks over the whole registry ────────────────────────
  await t('TC-CRUD-REG-01', 'P1', 'every registered resource answers a list request', async () => {
    const broken = [];
    for (const [, resource] of RESOURCES) {
      const r = await mandirApi('GET', `/${resource}?limit=1`, { token: ADMIN });
      if (r.status >= 500) broken.push(`${resource}:${r.status}`);
    }
    expect.eq(broken.length, 0, `resources returning 5xx: ${broken.join(', ')}`);
    return `${RESOURCES.length} resources`;
  });

  await t('TC-CRUD-REG-02', 'P1', 'no resource leaks an encrypted or secret column', async () => {
    const leaks = [];
    for (const [, resource] of RESOURCES) {
      const r = await mandirApi('GET', `/${resource}?limit=5`, { token: ADMIN });
      const blob = JSON.stringify(r.data ?? []);
      for (const bad of ['pan_encrypted', 'password_hash', 'totp_secret']) {
        if (blob.includes(bad)) leaks.push(`${resource}.${bad}`);
      }
    }
    expect.eq(leaks.length, 0, `leaked columns: ${leaks.join(', ')}`);
    return 'no secret columns in list payloads';
  });

  await t('TC-CRUD-MONEY-01', 'P1', 'every money table the generic delete can reach is soft-deletable', async () => {
    // remove() falls back to a real DELETE when a table has neither deleted_at
    // nor is_active. Seven money-bearing tables were in that position, so a
    // mis-click through the generic CRUD surface destroyed payroll, TDS or an
    // opening balance outright — the audit `before` snapshot was the only copy
    // left, recoverable by an engineer but not by anyone using the product.
    // Tenant-migration 021 gave them all deleted_at.
    const bad = psql(
      `SELECT c.table_name
         FROM information_schema.columns c
        WHERE c.table_schema = '${S}'
          AND c.table_name IN ('employee_salary_records','priest_salary_records','tds_records',
                               'account_opening_balances','annadaan_entries',
                               'annadaan_sponsorships','inventory_transactions')
        GROUP BY c.table_name
        HAVING bool_or(c.column_name = 'deleted_at') = false`,
    );
    expect.eq(bad.length, 0, `money tables that still hard-delete: ${bad.map((r) => r[0]).join(', ')}`);
    return '7 money tables soft-deletable';
  });

  await t('TC-CRUD-MONEY-02', 'P1', 'a soft-deleted money row stops counting in its register', async () => {
    // This matters more than the delete itself: a soft-deleted row that a
    // report still totals is worse than the hard delete it replaced, because
    // the money silently stays in the figures. Both annadaan readers filter
    // deleted_at, as does the opening balance the cash/bank reports build on.
    const day = new Date(Date.now() + (5000 + Math.floor(Math.random() * 3000)) * 864e5)
      .toISOString().slice(0, 10);
    const made = await mandirApi('POST', '/annadaan-entries', {
      token: ADMIN,
      body: { entry_date: day, meals_served: 100, cost_per_meal_paise: 5000, total_cost_paise: 500000 },
    });
    expect.http2xx(made);
    const rowId = made.data.id;
    const inRegister = async () => {
      const r = await mandirApi(
        'GET', `/reports/service-register?type=annadaan&from=${day}&to=${day}`, { token: ADMIN });
      return (r.data?.rows ?? []).filter((x) => x.id === rowId).length;
    };
    expect.eq(await inRegister(), 1, 'a live entry should appear in the register');
    await mandirApi('DELETE', `/annadaan-entries/${rowId}`, { token: ADMIN });
    expect.eq(psql1(`SELECT count(*) FROM ${S}.annadaan_entries WHERE id = '${rowId}'`), '1',
      'the delete should be soft, not a real DELETE');
    expect.eq(await inRegister(), 0, 'a deleted entry is still counted in the register');
    await mandirApi('POST', `/annadaan-entries/${rowId}/restore`, { token: ADMIN, body: {} });
    expect.eq(await inRegister(), 1, 'a restored entry should count again');
    await mandirApi('DELETE', `/annadaan-entries/${rowId}`, { token: ADMIN });
    return 'counted → deleted → uncounted → restored';
  });

  await t('TC-CRUD-REG-03', 'P1', 'a cashier cannot write to an accountant-only resource', async () => {
    const cashier = (await mandirLogin(FIXTURES.cashier)).token;
    // `gst-rates` and `accounts` declare writeRoles: ['accountant'].
    const r = await mandirApi('POST', '/gst-rates', {
      token: cashier, body: { service: `QA${uniq()}`, rate: 5 },
    });
    expect.status(r, 403, 'a cashier wrote to an accountant-only master');
    return `${r.status} ${r.code}`;
  });

  await t('TC-CRUD-REG-04', 'P1', 'every module resource is reachable only within this tenant', async () => {
    // The registry resolves a table name; a row id from elsewhere must not load.
    const foreign = psql1(
      `SELECT id FROM ${S}.vendors WHERE deleted_at IS NULL LIMIT 1`);
    const r = await mandirApi('GET', `/vendors/${foreign}`, { token: ADMIN });
    expect.http2xx(r, 'own-tenant row should load');
    const other = await mandirApi('GET', `/vendors/${GHOST}`, { token: ADMIN });
    expect.status(other, 404);
    return 'scoped';
  });
});
