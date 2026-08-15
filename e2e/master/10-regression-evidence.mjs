/**
 * Standing evidence that every fix from the 2026-08-08 hardening pass is still
 * in place — across the whole fleet, not just the test tenant.
 *
 * The behavioural suites prove a fix works *here*. This one proves it was
 * applied *everywhere* and has not been quietly reverted:
 *
 *  - schema migrations reached all 400+ tenant schemas in every pool database,
 *    not only the one the other suites happen to use;
 *  - the migrations are genuinely idempotent, so the boot-time runner that
 *    re-executes every file on every deploy cannot damage anything;
 *  - fixes whose failure mode is hard to trigger on demand (a year rollover, a
 *    lock-table exhaustion, a production-only config guard) are asserted at the
 *    source and schema level instead.
 *
 * A case here failing means a regression landed, or a deployment was missed.
 *
 *   node e2e/master/10-regression-evidence.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  suite, t, expect, FIXTURES, psql, psql1, psqlFile, schemaOf, tenantDatabases,
  mandirApi, saApi, devoteeApi, mandirLogin, superAdminLogin,
} from './lib.mjs';

const ROOT = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP';
const APIS = ['mandir-api', 'superadmin-api', 'devotee-api', 'sant-api'];
const PORTALS = ['mandir-web', 'superadmin-web', 'devotee-web', 'sant-web'];
const S = schemaOf(FIXTURES.tenant);

/**
 * Run SQL against a named database. Goes through `psql()` rather than shelling
 * `docker exec` itself — that hard-coded container name aborted this whole
 * suite at SETUP on any box where the docker daemon needs root, which is the
 * same failure `psql()` already grew a TCP fallback for.
 */
function sqlOn(db, sql) {
  return psql(sql, { db }).map((r) => r.join('\t')).join('\n').trim();
}

const src = (app, path) => readFileSync(`${ROOT}/apps/${app}/${path}`, 'utf8');

await suite('10-regression-evidence', async () => {
  const dbs = tenantDatabases();

  // ═══════════ Fleet-wide schema state (migrations 019 / 020 / 021) ═══════
  await t('TC-EV-001', 'P1', 'no INTEGER money column survives in any tenant schema, in any database', async () => {
    // The ~₹2.14 crore ceiling. Spot-checking one tenant would miss a pool the
    // migration failed on — which is exactly what happened first time round,
    // when jainerp_pool_2 (368 schemas) rolled back on lock exhaustion while
    // every small database succeeded.
    const offenders = [];
    let schemas = 0;
    for (const db of dbs) {
      schemas += Number(sqlOn(db, `SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'tenant\\_%'`));
      const n = Number(sqlOn(db,
        `SELECT count(*) FROM information_schema.columns
          WHERE table_schema LIKE 'tenant\\_%' AND column_name LIKE '%\\_paise' AND data_type = 'integer'`));
      if (n) offenders.push(`${db}:${n}`);
    }
    expect.eq(offenders.length, 0, `INTEGER paise columns remain in ${offenders.join(', ')}`);
    return `${schemas} schemas across ${dbs.length} databases, all BIGINT`;
  });

  await t('TC-EV-002', 'P1', 'the Recycle Bin tables carry deleted_at everywhere', async () => {
    const offenders = [];
    for (const db of dbs) {
      const n = Number(sqlOn(db,
        `SELECT count(*) FROM information_schema.tables t
          WHERE t.table_schema LIKE 'tenant\\_%'
            AND t.table_name IN ('lost_found','announcements','guests')
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                             WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
                               AND c.column_name = 'deleted_at')`));
      if (n) offenders.push(`${db}:${n}`);
    }
    expect.eq(offenders.length, 0, `tables still hard-deleting in ${offenders.join(', ')}`);
    return `all ${dbs.length} databases`;
  });

  await t('TC-EV-003', 'P1', 'the money tables the generic delete can reach carry deleted_at everywhere', async () => {
    const offenders = [];
    for (const db of dbs) {
      const n = Number(sqlOn(db,
        `SELECT count(*) FROM information_schema.tables t
          WHERE t.table_schema LIKE 'tenant\\_%'
            AND t.table_name IN ('employee_salary_records','priest_salary_records','tds_records',
                                 'account_opening_balances','annadaan_entries',
                                 'annadaan_sponsorships','inventory_transactions')
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                             WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
                               AND c.column_name = 'deleted_at')`));
      if (n) offenders.push(`${db}:${n}`);
    }
    expect.eq(offenders.length, 0, `payroll/TDS tables still hard-deleting in ${offenders.join(', ')}`);
    return `all ${dbs.length} databases`;
  });

  // ═══════════ Migration hygiene ══════════════════════════════════════════
  await t('TC-EV-004', 'P1', 'the money migrations are idempotent — re-running changes nothing', async () => {
    // DbBootstrapService re-executes every migration file on every boot, so a
    // migration that is not idempotent corrupts the schema on the second deploy.
    // Counted and replayed against the databases that actually HOLD tenant
    // schemas. This used to look only at `jainerp`, where a pooled deployment
    // has none at all — so `before` and `after` were both 0 and the assertion
    // passed without replaying anything the schemas could notice.
    const DBS = tenantDatabases();
    const deletedAtCols = () =>
      DBS.reduce((n, db) => n + Number(psql1(
        `SELECT count(*) FROM information_schema.columns
          WHERE table_schema LIKE 'tenant\\_%' AND column_name = 'deleted_at'`,
        { db },
      ) ?? 0), 0);

    const before = deletedAtCols();
    for (const db of DBS) {
      for (const f of ['019_money_bigint.sql', '020_soft_delete_recyclables.sql', '021_soft_delete_money_tables.sql']) {
        psqlFile(`${ROOT}/apps/superadmin-api/db/tenant-migrations/${f}`, { db });
      }
    }
    const after = deletedAtCols();
    expect.eq(after, before, 'a re-run changed the schema — the migration is not idempotent');
    return `${before} deleted_at columns across ${DBS.length} db(s), unchanged on re-run`;
  });

  await t('TC-EV-005', 'P1', 'migration 019 commits per schema rather than in one transaction', async () => {
    // One transaction over 368 schemas × 65 columns exhausted the shared lock
    // table ("out of shared memory") and rolled the whole thing back, failing
    // on the largest pool while every small database succeeded.
    const sql = readFileSync(`${ROOT}/apps/superadmin-api/db/tenant-migrations/019_money_bigint.sql`, 'utf8');
    expect.ok(/COMMIT;/.test(sql), 'no per-schema COMMIT — this will not scale to a full pool');
    expect.ok(/array_agg\(nspname/.test(sql),
      'the schema list must be materialised into an array: PL/pgSQL cannot COMMIT inside a query-cursor loop');
    return 'per-schema commit, array-materialised loop';
  });

  await t('TC-EV-006', 'P1', 'migration numbering is still collision-free', async () => {
    const dir = `${ROOT}/apps/superadmin-api/db`;
    for (const sub of ['migrations', 'tenant-migrations']) {
      const files = execSync(`ls ${dir}/${sub}/*.sql | xargs -n1 basename`, { encoding: 'utf8' })
        .trim().split('\n');
      const nums = files.map((f) => f.match(/^(\d+)/)?.[1]);
      const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
      expect.eq(dupes.length, 0, `${sub} has duplicate numbers: ${[...new Set(dupes)].join(', ')}`);
    }
    return 'no collisions in either migration set';
  });

  // ═══════════ Fixes asserted at the source ═══════════════════════════════
  await t('TC-EV-007', 'P1', 'the receipt series never rewinds its counter', async () => {
    // The FY-rollover duplicate-numbers bug was a reset-to-1 after seeing 2.
    const s = src('mandir-api', 'src/tenancy/tenant-shared.services.ts');
    expect.ok(/VALUES \(\$1, \$2, \$3, 0\)/.test(s), 'the series row must seed at 0');
    expect.ok(/ON CONFLICT \(type, fy\) DO NOTHING/.test(s),
      'the seed must name the unique constraint, or a concurrent seeder creates a second series');
    expect.ok(!/SET current_no = 1 WHERE/.test(s), 'a counter rewind is back in the series allocator');
    return 'seed-at-0, no rewind';
  });

  await t('TC-EV-008', 'P1', 'no list service still uses the NaN-unsafe paging idiom', async () => {
    // paging.util.ts is excluded: it *quotes* the old idiom in its header to
    // explain what it replaced, and matching that would report the fix as the
    // defect. Comments have caught this scan out twice now.
    const out = execSync(
      `grep -rn "Number(query.page ?? 1)" --include=*.ts ${ROOT}/apps/mandir-api/src ` +
      `| grep -v "common/paging.util.ts" || true`,
      { encoding: 'utf8' }).trim();
    expect.eq(out, '', `NaN-unsafe paging returned:\n${out.slice(0, 300)}`);
    const util = `${ROOT}/apps/mandir-api/src/common/paging.util.ts`;
    expect.ok(existsSync(util), 'paging.util.ts is gone');
    expect.ok(/Number\.isFinite/.test(readFileSync(util, 'utf8')), 'the clamp no longer guards against NaN');
    return 'all list services on paging()';
  });

  await t('TC-EV-009', 'P1', 'the donor FY figure is derived, never cached', async () => {
    const s = src('mandir-api', 'src/donations/donations.service.ts');
    expect.ok(!/cumulative_amount_current_fy_paise\s*=\s*cumulative_amount_current_fy_paise\s*\+/.test(s),
      'the increment is back — the total will drift and never reset at the year rollover');
    expect.ok(!/GREATEST\(cumulative_amount_current_fy_paise/.test(s),
      'the clamped decrement is back — it loses the shortfall permanently');
    const d = src('mandir-api', 'src/donors/donors.service.ts');
    expect.ok(/fyDateRange\(currentFy\(\)\)/.test(d), 'the derivation is no longer FY-scoped');
    return 'derived in list() and getOne()';
  });

  await t('TC-EV-010', 'P1', 'every API parses int8 as a number, before the DataSource opens', async () => {
    for (const api of APIS) {
      const main = src(api, 'src/main.ts');
      expect.ok(/import '\.\/common\/pg-bigint'/.test(main), `${api} no longer imports the int8 parser`);
      const first = main.indexOf("import './common/pg-bigint'");
      const orm = main.indexOf('NestFactory');
      expect.ok(first < orm || orm === -1, `${api} imports the parser after the app is created`);
      expect.ok(/setTypeParser/.test(src(api, 'src/common/pg-bigint.ts')), `${api} parser is a no-op`);
    }
    return '4 APIs';
  });

  await t('TC-EV-011', 'P1', 'the safe-integer cap that makes the int8 parser safe is still in place', async () => {
    const s = src('mandir-api', 'src/common/domain/money.ts');
    expect.ok(/Number\.isSafeInteger/.test(s),
      'requirePositiveInteger no longer caps at the safe-integer boundary — int8 values would round silently');
    return 'isSafeInteger';
  });

  await t('TC-EV-012', 'P1', 'every API still refuses unsafe production configuration', async () => {
    for (const api of APIS) {
      expect.ok(existsSync(`${ROOT}/apps/${api}/src/common/config-guard.ts`), `${api} lost its config guard`);
      expect.ok(/assertProductionConfig\(process\.env/.test(src(api, 'src/main.ts')),
        `${api} no longer calls the guard at boot`);
    }
    return '4 APIs guarded';
  });

  await t('TC-EV-013', 'P1', 'every API still allow-lists CORS origins', async () => {
    for (const api of APIS) {
      expect.ok(existsSync(`${ROOT}/apps/${api}/src/common/cors.util.ts`), `${api} lost cors.util`);
      const main = src(api, 'src/main.ts');
      expect.ok(/enableCors\(corsOptions\(\)\)/.test(main), `${api} is not using the allow-list`);
      expect.ok(!/origin:\s*true/.test(main) && !/origin:\s*'\*'/.test(main),
        `${api} reflects any origin again`);
    }
    return '4 APIs';
  });

  await t('TC-EV-014', 'P1', 'PAN decryption still falls back to the legacy derived key', async () => {
    // Without this, introducing PAN_ENCRYPTION_KEY orphans every PAN already
    // stored under the JWT-derived key.
    for (const api of ['mandir-api', 'devotee-api']) {
      const s = src(api, 'src/common/pan-crypto.ts');
      expect.ok(/legacyDerivedKey/.test(s), `${api} lost the legacy key fallback`);
      expect.ok(/decryptionKeys/.test(s), `${api} no longer tries more than one key on read`);
    }
    return '2 PAN-storing APIs';
  });

  await t('TC-EV-015', 'P1', 'the generic CRUD surface still redacts secret columns', async () => {
    const s = src('mandir-api', 'src/resources/resources.service.ts');
    expect.ok(/function redact/.test(s), 'redact() is gone — SELECT * would serve encrypted columns');
    expect.ok(/SECRET_COLUMN/.test(s), 'the secret-column pattern is gone');
    // The self-recursion that broke every resource the first time round.
    expect.ok(!/return redact\(row\);\s*\n}/.test(s), 'redact() returns itself — infinite recursion');
    const returns = (s.match(/return redact\(/g) ?? []).length;
    expect.ok(returns >= 4, `only ${returns} return paths redact; list, get, create and update all must`);
    return `${returns} redacted return paths`;
  });

  await t('TC-EV-016', 'P1', 'no portal double-stringifies a request body', async () => {
    const hits = [];
    for (const p of PORTALS) {
      const out = execSync(
        `grep -rn "body: JSON.stringify" --include=*.ts --include=*.tsx ${ROOT}/apps/${p}/src || true`,
        { encoding: 'utf8' }).trim();
      if (out) hits.push(`${p}: ${out.split('\n').length}`);
    }
    expect.eq(hits.length, 0, `double-stringified bodies returned in ${hits.join(', ')}`);
    return '4 portals clean';
  });

  await t('TC-EV-017', 'P2', 'the notification cron no longer sweeps every tenant every minute', async () => {
    const s = src('mandir-api', 'src/dispatch/notification-dispatch.service.ts');
    expect.ok(/sweepStale/.test(s), 'the hourly gate on the stale sweep is gone');
    expect.ok(/this\.failing/.test(s), 'repeated per-tenant warnings are no longer dampened');
    return 'hourly sweep, dampened warnings';
  });

  // ═══════════ Live behaviour, end to end ════════════════════════════════
  await t('TC-EV-018', 'P1', 'all four APIs are healthy and serve only under /api/v1', async () => {
    for (const [name, port] of [['mandir', 3106], ['superadmin', 3105], ['devotee', 3107], ['sant', 3108]]) {
      const ok = await fetch(`http://localhost:${port}/api/v1/health`).then((r) => r.ok).catch(() => false);
      expect.ok(ok, `${name}-api is not healthy`);
      const root = await fetch(`http://localhost:${port}/health`).then((r) => r.ok).catch(() => false);
      expect.ok(!root, `${name}-api still answers at the unversioned root`);
    }
    return '4 APIs on /api/v1';
  });

  await t('TC-EV-019', 'P1', 'money still crosses the wire as a number, not a BIGINT string', async () => {
    const token = (await mandirLogin()).token;
    const r = await mandirApi('GET', '/donations?limit=5', { token });
    expect.http2xx(r);
    for (const d of r.data) expect.paise(d.amount_paise, `donation ${d.id}`);
    expect.eq(typeof r.meta.total_amount_paise, 'number', 'the collection total is not a number');
    // Addition, not concatenation — the actual failure mode.
    const sum = r.data.reduce((a, d) => a + d.amount_paise, 0);
    expect.eq(typeof sum, 'number', 'summing amounts produced a string');
    const sa = await saApi('GET', '/admin/invoices?limit=3', { token: await superAdminLogin() });
    for (const i of sa.data ?? []) expect.paise(Number(i.totalPaise), `invoice ${i.id}`);
    return 'mandir + superadmin numeric';
  });

  await t('TC-EV-020', 'P1', 'a large gift still records exactly, past the old ceiling', async () => {
    const token = (await mandirLogin()).token;
    const amount = 500000000000; // ₹500 crore — far past the old INTEGER limit
    const r = await mandirApi('POST', '/donations', {
      token,
      body: { amount_paise: amount, category: 'General', payment_mode: 'cash',
              donor: { name: 'Evidence Big', mobile: '9000020001' } },
    });
    expect.http2xx(r);
    const stored = psql1(`SELECT amount_paise FROM ${S}.donations WHERE id = '${r.data.id}'`);
    expect.eq(Number(stored), amount, 'stored amount does not match');
    await mandirApi('PATCH', `/donations/${r.data.id}/void`, { token, body: { reason: 'evidence' } });
    return `₹${amount / 100} exact`;
  });

  await t('TC-EV-021', 'P1', 'the change-request queue still approves a plain JSON body', async () => {
    // The screenshot this whole pass started from.
    const sa = await superAdminLogin();
    const tenant = psql1(`SELECT id FROM public.tenants WHERE slug = '${FIXTURES.tenant}'`);
    psql(`UPDATE public.field_change_requests SET status = 'withdrawn'
           WHERE subject_type = 'tenant' AND subject_id = '${tenant}'
             AND field = 'upi_id' AND status = 'pending'`);
    const id = psql1(
      `INSERT INTO public.field_change_requests
         (subject_type, subject_id, subject_label, field, current_value, requested_value, status)
       VALUES ('tenant','${tenant}','Evidence','upi_id','a','evidence@ybl','pending') RETURNING id`);
    const ok = await saApi('PATCH', `/admin/change-requests/${id}/approve`, { token: sa, body: { note: 'evidence' } });
    expect.http2xx(ok, 'approve is broken again');
    const bad = await saApi('PATCH', `/admin/change-requests/${id}/reject`, {
      token: sa, rawBody: JSON.stringify(JSON.stringify({ note: 'x' })),
    });
    expect.status(bad, 400, 'a bare JSON string is being accepted as a body');
    return 'approve 2xx, double-stringified body still 400';
  });

  await t('TC-EV-022', 'P1', 'devotee PAN and giving are still scoped to the caller', async () => {
    // Pick a devotee who actually HAS giving — a ledger with no rows passes
    // this vacuously and proves nothing about scoping or PAN exposure.
    const mob = psql1(
      `SELECT replace(gu.mobile,'+91','') FROM public.global_users gu
        WHERE gu.is_devotee = true AND gu.mobile LIKE '+91%' AND gu.is_active = true
          AND EXISTS (SELECT 1 FROM public.global_transactions g WHERE g.global_user_id = gu.id)
        ORDER BY gu.created_at DESC LIMIT 1`)
      ?? psql1(
      `SELECT replace(mobile,'+91','') FROM public.global_users
        WHERE is_devotee = true AND mobile LIKE '+91%' AND is_active = true
        ORDER BY created_at DESC LIMIT 1`);
    const { devoteeLogin } = await import('./lib.mjs');
    const devoteeId = psql1(`SELECT id FROM public.global_users WHERE mobile = '+91${mob}'`);
    const tok = (await devoteeLogin(mob)).token;
    const r = await devoteeApi('GET', '/me/transactions?limit=25', { token: tok });
    expect.http2xx(r);
    const blob = JSON.stringify(r.data);
    expect.ok(!/[A-Z]{5}\d{4}[A-Z]/.test(blob), 'a full PAN appeared in the devotee ledger');
    // Every row returned must belong to the caller.
    const ids = r.data.map((x) => x.id).filter(Boolean);
    if (ids.length) {
      const foreign = psql1(
        `SELECT count(*) FROM public.global_transactions
          WHERE id IN (${ids.map((i) => `'${i}'`).join(',')})
            AND global_user_id IS DISTINCT FROM '${devoteeId}'`);
      expect.eq(Number(foreign), 0, 'the ledger returned another devotee\u2019s giving');
    }
    return `${ids.length} owned rows, no PAN`;
  });
});
