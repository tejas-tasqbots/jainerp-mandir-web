/**
 * The platform console: superadmin-api.
 *
 * Covers tenant lifecycle and the four orthogonal access controls that feed the
 * generated `access_enabled` column, plans and per-tenant custom plans, module
 * entitlements, licensing, billing invoices, the change-request review queue
 * (the screen this pack was started from), and platform users.
 *
 *   node e2e/master/04-superadmin.mjs
 */
import {
  suite, t, skip, expect, FIXTURES,
  saApi, superAdminLogin, psql, psql1, uniq, testMobile,
} from './lib.mjs';

let SA;
/** Tenants this run created, torn down at the end so the fixture DB stays sane. */
const created = [];

await suite('04-superadmin', async () => {
  SA = await superAdminLogin();

  // ═══════════════════════ Tenant listing & lookup ═════════════════════════
  await t('TC-SAT-001', 'P1', 'the tenant list returns the envelope with a total', async () => {
    const r = await saApi('GET', '/admin/tenants?limit=5', { token: SA });
    expect.http2xx(r);
    expect.ok(Array.isArray(r.data), 'data must be an array');
    return `${r.data.length} of ${r.meta?.total ?? '?'}`;
  });

  await t('TC-SAT-002', 'P2', 'junk paging does not 500 the console', async () => {
    const r = await saApi('GET', '/admin/tenants?page=abc&limit=xyz', { token: SA });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-SAT-003', 'P2', 'tenants can be searched by name', async () => {
    const r = await saApi('GET', '/admin/tenants?q=Smoke&limit=5', { token: SA });
    expect.http2xx(r);
    return `${r.data.length} matches`;
  });

  await t('TC-SAT-004', 'P1', 'an unknown tenant id returns 404, not 500', async () => {
    const r = await saApi('GET', '/admin/tenants/00000000-0000-0000-0000-000000000000', { token: SA });
    expect.status(r, 404);
    return `${r.status}`;
  });

  await t('TC-SAT-005', 'P1', 'a malformed tenant id returns 4xx, not 500', async () => {
    const r = await saApi('GET', '/admin/tenants/not-a-uuid', { token: SA });
    expect.rejected(r);
    return `${r.status}`;
  });

  // ═══════════════════════ Provisioning ════════════════════════════════════
  let tenantId, tenantSlug;
  await t('TC-SAT-006', 'P1', 'a pooled tenant can be provisioned', async () => {
    tenantSlug = `qa-master-${uniq()}`;
    const r = await saApi('POST', '/admin/tenants', {
      token: SA,
      body: {
        name: `QA Master ${uniq()}`, slug: tenantSlug, tenancy_tier: 'pooled',
        plan: 'starter', billing_cycle: 'monthly',
        admin_contact: { name: 'QA Admin', mobile: testMobile() },
        address: { city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      },
    });
    expect.http2xx(r);
    tenantId = r.data.id ?? r.data.tenant?.id;
    expect.ok(tenantId, `no tenant id in ${JSON.stringify(r.data).slice(0, 150)}`);
    created.push(tenantId);
    return tenantSlug;
  });

  /** Where a tenant's schema physically lives: a pooled tenant sits in one of
   *  the `jainerp_pool_N` databases, not in the console's own database. */
  const placeOf = (id) => {
    const [row] = psql(`SELECT schema_name, COALESCE(db_name, 'jainerp') FROM public.tenants WHERE id = '${id}'`);
    return { schema: row?.[0], db: row?.[1] };
  };

  await t('TC-SAT-007', 'P1', 'provisioning creates the tenant schema in its pool database', async () => {
    let place = { schema: null };
    for (let i = 0; i < 25; i++) {
      place = placeOf(tenantId);
      if (psql1(`SELECT status FROM public.tenants WHERE id = '${tenantId}'`) === 'active') break;
      await new Promise((r) => setTimeout(r, 400));
    }
    expect.ok(place.schema?.startsWith('tenant_'), `schema_name=${place.schema}`);
    const exists = psql1(
      `SELECT count(*) FROM pg_namespace WHERE nspname = '${place.schema}'`, { db: place.db });
    expect.eq(Number(exists), 1, `schema missing from ${place.db}`);
    return `${place.db}.${place.schema}`;
  });

  await t('TC-SAT-008', 'P1', 'the new tenant schema carries the core tables', async () => {
    const { schema, db } = placeOf(tenantId);
    const want = ['donations', 'donors', 'expenses', 'payments', 'invoice_series', 'kshetra_profile', 'audit_log'];
    const have = psql(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'`, { db },
    ).map((r) => r[0]);
    const missing = want.filter((w) => !have.includes(w));
    expect.eq(missing.length, 0, `missing from ${db}.${schema}: ${missing.join(', ')}`);
    return `${have.length} tables in ${db}`;
  });

  await t('TC-SAT-009', 'P1', 'a duplicate slug is refused', async () => {
    const r = await saApi('POST', '/admin/tenants', {
      token: SA,
      body: {
        name: 'QA Dup', slug: tenantSlug, tenancy_tier: 'pooled', plan: 'starter',
        admin_contact: { name: 'QA', mobile: testMobile() },
      },
    });
    expect.rejected(r, 'slugs must be unique — they address the tenant');
    return `${r.status} ${r.code}`;
  });

  await t('TC-SAT-010', 'P1', 'an unknown tenancy tier is refused', async () => {
    // The old `dedicated_schema` / `dedicated_database` names are rejected —
    // the tiers are exactly `pooled` and `dedicated`.
    for (const tier of ['dedicated_schema', 'dedicated_database', 'shared', '']) {
      const r = await saApi('POST', '/admin/tenants', {
        token: SA,
        body: {
          name: 'QA Tier', slug: `qa-tier-${uniq()}`, tenancy_tier: tier, plan: 'starter',
          admin_contact: { name: 'QA', mobile: testMobile() },
        },
      });
      expect.rejected(r, `tier '${tier}' must be refused`);
    }
    return 'all 4 refused';
  });

  await t('TC-SAT-011', 'P2', 'a slug with unsafe characters is refused', async () => {
    const r = await saApi('POST', '/admin/tenants', {
      token: SA,
      body: {
        name: 'QA Bad Slug', slug: 'bad slug/../x', tenancy_tier: 'pooled', plan: 'starter',
        admin_contact: { name: 'QA', mobile: testMobile() },
      },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  // ═══════════════════════ Access model (migration 029) ════════════════════
  await t('TC-SAA-001', 'P1', 'access_enabled is a generated column, never hand-set', async () => {
    const gen = psql1(
      `SELECT is_generated FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'access_enabled'`,
    );
    expect.eq(gen, 'ALWAYS', 'access_enabled must stay a generated column');
    return gen;
  });

  await t('TC-SAA-002', 'P1', 'suspending a tenant closes access', async () => {
    const r = await saApi('PATCH', `/admin/tenants/${tenantId}/suspend`, {
      token: SA, body: { reason: 'QA suspend' },
    });
    expect.http2xx(r);
    expect.eq(psql1(`SELECT access_enabled FROM public.tenants WHERE id = '${tenantId}'`), 'f');
    return 'access closed';
  });

  await t('TC-SAA-003', 'P1', 'a suspended tenant cannot be logged into', async () => {
    const mobile = psql1(
      `SELECT replace(gu.mobile,'+91','') FROM public.tenant_users tu
         JOIN public.global_users gu ON gu.id = tu.user_id
        WHERE tu.tenant_id = '${tenantId}' LIMIT 1`,
    );
    if (!mobile) return 'no tenant user to test with';
    const { mandirApi } = await import('./lib.mjs');
    const send = await mandirApi('POST', '/auth/send-otp', { body: { mobile } });
    if (!send.data?.dev_otp) return `send-otp already refused: ${send.status}`;
    const ver = await mandirApi('POST', '/auth/verify-otp', {
      body: { mobile, otp: send.data.dev_otp },
    });
    const sel = await mandirApi('POST', '/auth/select-tenant', {
      body: { selection_token: ver.data?.selection_token, tenant_slug: tenantSlug },
    });
    expect.rejected(sel, 'a suspended tenant must not issue a session');
    return `${sel.status} ${sel.code}`;
  });

  await t('TC-SAA-004', 'P1', 'reactivating restores access', async () => {
    const r = await saApi('PATCH', `/admin/tenants/${tenantId}/reactivate`, { token: SA, body: {} });
    expect.http2xx(r);
    expect.eq(psql1(`SELECT access_enabled FROM public.tenants WHERE id = '${tenantId}'`), 't');
    return 'access restored';
  });

  await t('TC-SAA-005', 'P1', 'the activation switch blocks access without changing status', async () => {
    // Four orthogonal controls feed the generated `access_enabled`; activation
    // is the master on/off, and it must not be conflated with lifecycle status.
    const r = await saApi('PATCH', `/admin/tenants/${tenantId}/activation`, {
      token: SA, body: { is_active: false, reason: 'other' },
    });
    expect.http2xx(r);
    const row = psql(`SELECT status, access_enabled FROM public.tenants WHERE id = '${tenantId}'`);
    expect.eq(row[0][0], 'active', 'lifecycle status should stay active');
    expect.eq(row[0][1], 'f', 'access should be closed by activation alone');
    await saApi('PATCH', `/admin/tenants/${tenantId}/activation`, { token: SA, body: { is_active: true } });
    return 'status active, access blocked';
  });

  await t('TC-SAA-005b', 'P2', 'the access-state endpoint reports why access is closed', async () => {
    const r = await saApi('GET', `/admin/tenants/${tenantId}/access`, { token: SA });
    expect.http2xx(r);
    return JSON.stringify(r.data).slice(0, 90);
  });

  await t('TC-SAA-006', 'P2', 'visibility is a separate control from access', async () => {
    const r = await saApi('PATCH', `/admin/tenants/${tenantId}/visibility`, {
      token: SA, body: { listed: false },
    });
    expect.ok(r.status < 500, `server error ${r.status}`);
    expect.eq(
      psql1(`SELECT access_enabled FROM public.tenants WHERE id = '${tenantId}'`), 't',
      'hiding a mandir from discovery must not close its access',
    );
    return `${r.status}`;
  });

  await t('TC-SAA-007', 'P2', 'lifecycle history records the transitions', async () => {
    const r = await saApi('GET', `/admin/tenants/${tenantId}/lifecycle-history`, { token: SA });
    expect.http2xx(r);
    expect.ok(Array.isArray(r.data) && r.data.length > 0, 'suspend/reactivate should be on record');
    return `${r.data.length} entries`;
  });

  // ═══════════════════════ Plans & custom plans ════════════════════════════
  let planId, planName;
  await t('TC-SAP-001', 'P1', 'the plan catalogue lists plans with integer paise pricing', async () => {
    const r = await saApi('GET', '/admin/plans?limit=20', { token: SA });
    expect.http2xx(r);
    for (const p of r.data) {
      expect.paise(p.price_monthly_paise, `${p.name} monthly`);
      expect.paise(p.price_yearly_paise, `${p.name} yearly`);
    }
    return `${r.data.length} plans`;
  });

  await t('TC-SAP-002', 'P1', 'a plan can be created', async () => {
    planName = `qa-plan-${uniq()}`;
    const r = await saApi('POST', '/admin/plans', {
      token: SA,
      body: {
        name: planName, display_name: 'QA Plan', price_monthly_paise: 100000,
        price_yearly_paise: 1000000, max_users: 5, max_devices: 2,
      },
    });
    expect.http2xx(r);
    planId = r.data.id;
    return planName;
  });

  await t('TC-SAP-003', 'P2', 'a duplicate plan name is refused', async () => {
    const r = await saApi('POST', '/admin/plans', {
      token: SA, body: { name: planName, display_name: 'Dup', price_monthly_paise: 1 },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-SAP-004', 'P1', 'a negative plan price is refused', async () => {
    const r = await saApi('POST', '/admin/plans', {
      token: SA,
      body: { name: `qa-neg-${uniq()}`, display_name: 'Neg', price_monthly_paise: -100 },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-SAP-005', 'P1', 'a bespoke deal is a custom_plan, never a one-off plan row', async () => {
    const r = await saApi('PUT', `/admin/tenants/${tenantId}/custom-plan`, {
      token: SA,
      body: { display_name: 'QA Bespoke', price_monthly_paise: 250000, max_users: 9 },
    });
    expect.http2xx(r);
    const cp = psql1(`SELECT custom_plan IS NOT NULL FROM public.tenants WHERE id = '${tenantId}'`);
    expect.eq(cp, 't', 'custom_plan should be set on the tenant row');
    return 'custom_plan set';
  });

  await t('TC-SAP-006', 'P1', 'the effective plan resolves the custom plan over the catalogue', async () => {
    const r = await saApi('GET', `/admin/tenants/${tenantId}/effective-plan`, { token: SA });
    expect.http2xx(r);
    expect.eq(r.data.price_monthly_paise, 250000, 'the bespoke price must win');
    return `₹${r.data.price_monthly_paise / 100}/mo`;
  });

  await t('TC-SAP-007', 'P1', 'a plan that is in use cannot be deleted', async () => {
    const inUse = psql1(
      `SELECT p.id FROM public.plans p JOIN public.subscriptions s ON s.plan_id = p.id LIMIT 1`,
    );
    if (!inUse) return 'no plan currently in use — nothing to protect';
    const r = await saApi('DELETE', `/admin/plans/${inUse}`, { token: SA });
    expect.rejected(r, 'deleting a plan tenants are on would orphan their billing');
    return `${r.status} ${r.code}`;
  });

  await t('TC-SAP-008', 'P2', 'an unused plan can be deleted', async () => {
    const r = await saApi('DELETE', `/admin/plans/${planId}`, { token: SA });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  // ═══════════════════════ Module entitlements (031) ═══════════════════════
  await t('TC-SAM-001', 'P1', 'the module catalogue is served', async () => {
    const r = await saApi('GET', '/admin/modules', { token: SA });
    expect.http2xx(r);
    expect.ok(Array.isArray(r.data) ? r.data.length > 0 : !!r.data, 'no modules listed');
    return `${Array.isArray(r.data) ? r.data.length : '?'} modules`;
  });

  await t('TC-SAM-002', 'P1', 'a tenant’s modules can be read', async () => {
    const r = await saApi('GET', `/admin/tenants/${tenantId}/modules`, { token: SA });
    expect.http2xx(r);
    return `${Array.isArray(r.data) ? r.data.length : Object.keys(r.data ?? {}).length} entries`;
  });

  await t('TC-SAM-003', 'P1', 'granting a module is reflected on the tenant', async () => {
    const cat = await saApi('GET', '/admin/modules', { token: SA });
    // Core modules (dashboard, donations, donors, accounting) are implicit and
    // are rejected if listed — grant only optional ones.
    const CORE = new Set([
      'dashboard', 'donations', 'donors', 'accounting', 'reports',
      'registers', 'masters', 'settings', 'users', 'expenses',
    ]);
    const keys = (Array.isArray(cat.data) ? cat.data : cat.data?.modules ?? [])
      .map((m) => m.key ?? m.name).filter((k) => k && !CORE.has(k)).slice(0, 4);
    expect.ok(keys.length, 'no optional module keys to grant');
    const r = await saApi('PUT', `/admin/tenants/${tenantId}/modules`, {
      token: SA, body: { modules: keys, effective: 'immediate' },
    });
    expect.http2xx(r);
    const back = await saApi('GET', `/admin/tenants/${tenantId}/modules`, { token: SA });
    expect.http2xx(back);
    return `granted ${keys.join(',')}`;
  });

  await t('TC-SAM-003b', 'P1', 'listing a core module as grantable is refused', async () => {
    // Core modules are always enabled; accepting them here would imply they can
    // also be revoked, which the entitlement model does not allow.
    const r = await saApi('PUT', `/admin/tenants/${tenantId}/modules`, {
      token: SA, body: { modules: ['donations'], effective: 'immediate' },
    });
    expect.rejected(r);
    expect.eq(r.code, 'CORE_MODULE');
    return r.code;
  });

  await t('TC-SAM-004', 'P2', 'granting an unknown module key is refused', async () => {
    const r = await saApi('PUT', `/admin/tenants/${tenantId}/modules`, {
      token: SA, body: { modules: ['definitely_not_a_module'], effective: 'immediate' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  // ═══════════════════════ Licensing ═══════════════════════════════════════
  let licenseKey;
  await t('TC-SAL-001', 'P1', 'a licence key can be issued for a tenant', async () => {
    const r = await saApi('POST', `/admin/tenants/${tenantId}/licenses`, {
      token: SA, body: { seats: 1, expires_at: new Date(Date.now() + 365 * 864e5).toISOString() },
    });
    expect.http2xx(r);
    licenseKey = r.data.keyString ?? r.data.key_string ?? r.data.key;
    expect.ok(licenseKey, `no key in ${JSON.stringify(r.data).slice(0, 120)}`);
    // The create response used to disagree with the list on both the field name
    // (license_key vs keyString) and the status ('issued', a value the column
    // never holds).
    expect.eq(r.data.status, 'active', 'reported status must be the stored one');
    return `${licenseKey.slice(0, 12)}… (${r.data.status})`;
  });

  await t('TC-SAL-002', 'P1', 'the issued licence is listed for the tenant', async () => {
    const r = await saApi('GET', `/admin/tenants/${tenantId}/licenses`, { token: SA });
    expect.http2xx(r);
    expect.ok(r.data.some((l) => (l.keyString ?? l.key_string ?? l.key) === licenseKey), 'issued key not listed');
    return `${r.data.length} licence(s)`;
  });

  await t('TC-SAL-003', 'P1', 'a licence can be revoked', async () => {
    const r = await saApi('PATCH', `/admin/licenses/${licenseKey}/revoke`, {
      token: SA, body: { reason: 'QA revoke' },
    });
    expect.http2xx(r);
    const status = psql1(`SELECT status FROM public.license_keys WHERE key_string = '${licenseKey}'`);
    expect.eq(status, 'revoked');
    return status;
  });

  await t('TC-SAL-004', 'P1', 'a revoked licence no longer validates', async () => {
    const { mandirApi } = await import('./lib.mjs');
    const r = await mandirApi('POST', '/license/validate', { body: { key: licenseKey } });
    expect.rejected(r, 'a revoked licence must not activate a desktop install');
    return `${r.status} ${r.code}`;
  });

  // ═══════════════════════ Billing ═════════════════════════════════════════
  // Invoices are raised by the system (subscription/upgrade), never ad hoc —
  // there is no POST /admin/invoices — so these act on a real unpaid one.
  let invoiceId;
  await t('TC-SAB-001', 'P1', 'the invoice list reports integer paise', async () => {
    const r = await saApi('GET', '/admin/invoices?limit=20', { token: SA });
    expect.http2xx(r);
    // superadmin-api serialises camelCase (totalPaise); mandir-api uses
    // snake_case (amount_paise). Pinned because a client reading the wrong
    // casing gets `undefined` and silently renders a blank or NaN total.
    for (const i of r.data) expect.paise(Number(i.totalPaise), `invoice ${i.id}`);
    invoiceId = psql1(
      `SELECT id FROM public.billing_invoices WHERE status <> 'paid' ORDER BY created_at DESC LIMIT 1`);
    return `${r.data.length} invoices`;
  });

  await t('TC-SAB-002', 'P1', 'no invoice carries a negative amount', async () => {
    const neg = psql1(
      `SELECT count(*) FROM public.billing_invoices
        WHERE total_paise < 0 OR subtotal_paise < 0 OR gst_amount_paise < 0`);
    expect.eq(Number(neg), 0, 'negative invoices');
    return '0 negative';
  });

  await t('TC-SAB-003', 'P1', 'an unpaid invoice can be marked paid', async () => {
    if (!invoiceId) return 'no unpaid invoice available';
    const r = await saApi('POST', `/admin/invoices/${invoiceId}/mark-paid`, {
      token: SA, body: { method: 'bank_transfer', reference: `QA-${uniq()}` },
    });
    expect.http2xx(r);
    expect.eq(psql1(`SELECT status FROM public.billing_invoices WHERE id = '${invoiceId}'`), 'paid');
    return 'paid';
  });

  await t('TC-SAB-004', 'P1', 'a paid invoice cannot be marked paid again', async () => {
    if (!invoiceId) return 'no unpaid invoice available';
    const r = await saApi('POST', `/admin/invoices/${invoiceId}/mark-paid`, {
      token: SA, body: { method: 'cash' },
    });
    expect.rejected(r, 'double-marking would double-count revenue');
    return `${r.status} ${r.code}`;
  });

  await t('TC-SAB-004b', 'P1', 'a paid invoice cannot be voided', async () => {
    if (!invoiceId) return 'no unpaid invoice available';
    const r = await saApi('POST', `/admin/invoices/${invoiceId}/void`, {
      token: SA, body: { reason: 'QA' },
    });
    expect.rejected(r, 'voiding settled money must be refused');
    return `${r.status} ${r.code}`;
  });

  await t('TC-SAB-005', 'P2', 'billing history lists the tenant’s invoices', async () => {
    const r = await saApi('GET', `/admin/tenants/${tenantId}/billing-history`, { token: SA });
    expect.http2xx(r);
    return 'ok';
  });

  await t('TC-SAB-006', 'P2', 'an invoice receipt renders', async () => {
    const r = await saApi('GET', `/admin/invoices/${invoiceId}/receipt`, { token: SA });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-SAB-007', 'P1', 'the console API serialises camelCase consistently', async () => {
    // The two APIs differ on purpose, and superadmin-web is written against
    // camelCase. A field that quietly reverts to snake_case reads as `undefined`
    // in the console and renders as a blank cell rather than an error.
    const r = await saApi('GET', '/admin/invoices?limit=1', { token: SA });
    expect.http2xx(r);
    const row = r.data[0];
    if (!row) return 'no invoices to inspect';
    for (const k of ['totalPaise', 'subtotalPaise', 'invoiceNumber', 'tenantId']) {
      expect.has(row, k, 'console payload key');
    }
    const snake = Object.keys(row).filter((k) => k.includes('_'));
    expect.eq(snake.length, 0, `snake_case keys leaked into the console payload: ${snake.join(', ')}`);
    return `${Object.keys(row).length} camelCase keys`;
  });

  // ═══════════════════════ Change requests (the screenshot bug) ════════════
  await t('TC-SACR-001', 'P1', 'the review queue returns rows plus a pending count', async () => {
    const r = await saApi('GET', '/admin/change-requests?status=pending&limit=50', { token: SA });
    expect.http2xx(r);
    expect.ok(Array.isArray(r.data), 'data must be an array — the page calls .map on it');
    expect.has(r.meta ?? {}, 'pending');
    return `${r.data.length} pending of ${r.meta.total} total`;
  });

  await t('TC-SACR-002', 'P1', 'the queue envelope is { data: [...], meta } — not nested', async () => {
    // Regression for DEF-SA-01: the service returned { data, meta }, which the
    // interceptor wrapped again, so the page received data.data and white-screened.
    const r = await saApi('GET', '/admin/change-requests?limit=1', { token: SA });
    expect.ok(!('data' in (r.data?.[0] ?? {})), 'rows must not be double-wrapped');
    return 'flat';
  });

  await t('TC-SACR-003', 'P1', 'approve accepts a plain JSON object body', async () => {
    // The console double-stringified this body, so Express received a bare JSON
    // *string* and body-parser refused it in strict mode:
    //   BAD_REQUEST Unexpected token '"', ""{}"" is not valid JSON
    const id = seedChangeRequest('upi_id', `${uniq()}@ybl`);
    const r = await saApi('PATCH', `/admin/change-requests/${id}/approve`, {
      token: SA, body: { note: 'QA approve' },
    });
    expect.http2xx(r);
    expect.eq(r.data.status, 'approved');
    return 'approved';
  });

  await t('TC-SACR-004', 'P1', 'a double-stringified body is still refused (the original symptom)', async () => {
    const id = seedChangeRequest('upi_id', `${uniq()}@ybl`);
    const r = await saApi('PATCH', `/admin/change-requests/${id}/approve`, {
      token: SA, rawBody: JSON.stringify(JSON.stringify({ note: 'x' })),
    });
    expect.status(r, 400, 'a bare JSON string is not a valid request body');
    expect.ok(/not valid JSON/i.test(r.json?.error?.message ?? ''), r.json?.error?.message);
    return r.json.error.message.slice(0, 60);
  });

  await t('TC-SACR-005', 'P1', 'approving writes the requested value to the profile', async () => {
    const wanted = `${uniq()}@okaxis`;
    const id = seedChangeRequest('upi_id', wanted);
    const r = await saApi('PATCH', `/admin/change-requests/${id}/approve`, { token: SA, body: {} });
    expect.http2xx(r);
    const schema = psql1(`SELECT schema_name FROM public.tenants WHERE slug = '${FIXTURES.tenant}'`);
    expect.eq(psql1(`SELECT upi_id FROM ${schema}.kshetra_profile`), wanted, 'value as written');
    return wanted;
  });

  await t('TC-SACR-006', 'P1', 'a request cannot be approved twice', async () => {
    const id = seedChangeRequest('upi_id', `${uniq()}@ybl`);
    await saApi('PATCH', `/admin/change-requests/${id}/approve`, { token: SA, body: {} });
    const r = await saApi('PATCH', `/admin/change-requests/${id}/approve`, { token: SA, body: {} });
    expect.rejected(r);
    expect.eq(r.code, 'ALREADY_REVIEWED');
    return r.code;
  });

  await t('TC-SACR-007', 'P1', 'rejecting without a reason is refused', async () => {
    const id = seedChangeRequest('upi_id', `${uniq()}@ybl`);
    const r = await saApi('PATCH', `/admin/change-requests/${id}/reject`, { token: SA, body: {} });
    expect.rejected(r, 'the mandir has to be told what to fix');
    expect.eq(r.code, 'VALIDATION_ERROR');
    return r.code;
  });

  await t('TC-SACR-008', 'P1', 'rejecting with a reason records it', async () => {
    const id = seedChangeRequest('upi_id', `${uniq()}@ybl`);
    const r = await saApi('PATCH', `/admin/change-requests/${id}/reject`, {
      token: SA, body: { note: 'Does not match the trust deed' },
    });
    expect.http2xx(r);
    const row = psql(`SELECT status, review_note FROM public.field_change_requests WHERE id = '${id}'`);
    expect.eq(row[0][0], 'rejected');
    expect.ok(row[0][1], 'the reason must be stored for the mandir to read');
    return row[0][1];
  });

  await t('TC-SACR-009', 'P1', 'a field outside the allow-list cannot be applied', async () => {
    // The field name is interpolated into the UPDATE, so the allow-list is the
    // injection defence, not a nicety.
    const id = seedChangeRequest('schema_name', 'public');
    const r = await saApi('PATCH', `/admin/change-requests/${id}/approve`, { token: SA, body: {} });
    expect.rejected(r, 'only allow-listed profile columns may be written');
    return `${r.status} ${r.code}`;
  });

  await t('TC-SACR-010', 'P1', 'an injection-shaped field name is refused', async () => {
    const id = seedChangeRequest("upi_id = 'x', pan", 'boom');
    const r = await saApi('PATCH', `/admin/change-requests/${id}/approve`, { token: SA, body: {} });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-SACR-011', 'P1', 'approving a tenant with no profile row fails loudly', async () => {
    // Regression: the guard tested `res == null`, but TypeORM answers a 0-row
    // UPDATE with `[[], 0]`, so the request was marked approved and audited
    // while nothing was written.
    const ghost = psql1(
      `SELECT t.id FROM public.tenants t
        WHERE t.schema_name = 'tenant_test' LIMIT 1`,
    );
    if (!ghost) return 'no profile-less tenant available to test with';
    const id = seedChangeRequest('upi_id', 'ghost@ybl', ghost);
    const r = await saApi('PATCH', `/admin/change-requests/${id}/approve`, { token: SA, body: {} });
    expect.rejected(r, 'a write that touched no row must not report success');
    expect.eq(psql1(`SELECT status FROM public.field_change_requests WHERE id = '${id}'`), 'pending',
      'the request must stay pending when the apply failed');
    return `${r.status} ${r.code}`;
  });

  await t('TC-SACR-012', 'P2', 'the queue can be filtered to ascetics by either spelling', async () => {
    for (const st of ['sant', 'maharaj']) {
      const r = await saApi(`GET`, `/admin/change-requests?subject_type=${st}&limit=5`, { token: SA });
      expect.http2xx(r, `subject_type=${st}`);
    }
    return 'both spellings accepted';
  });

  await t('TC-SACR-013', 'P1', 'approving is audited', async () => {
    const before = Number(psql1(
      `SELECT count(*) FROM public.audit_events WHERE action = 'field_change_request.approve'`));
    const id = seedChangeRequest('upi_id', `${uniq()}@ybl`);
    await saApi('PATCH', `/admin/change-requests/${id}/approve`, { token: SA, body: {} });
    const after = Number(psql1(
      `SELECT count(*) FROM public.audit_events WHERE action = 'field_change_request.approve'`));
    expect.ok(after > before, 'no audit row for an approval');
    return `${before}→${after}`;
  });

  // ═══════════════════════ Verification gate ═══════════════════════════════
  await t('TC-SAV-001', 'P1', 'a mandir’s sensitive details can be marked verified', async () => {
    const r = await saApi('PATCH', `/admin/tenants/${tenantId}/verify-sensitive`, {
      token: SA, body: { verified: true, note: 'QA verified' },
    });
    expect.http2xx(r);
    const at = psql1(`SELECT sensitive_verified_at FROM public.tenants WHERE id = '${tenantId}'`);
    expect.ok(at, 'sensitive_verified_at should be set');
    return 'verified';
  });

  await t('TC-SAV-002', 'P1', 'verification can be released back to the mandir', async () => {
    const r = await saApi('PATCH', `/admin/tenants/${tenantId}/verify-sensitive`, {
      token: SA, body: { verified: false },
    });
    expect.http2xx(r);
    expect.eq(
      psql1(`SELECT COALESCE(sensitive_verified_at::text, 'NULL') FROM public.tenants WHERE id = '${tenantId}'`),
      'NULL', 'verification timestamp must be cleared');
    return 'released';
  });

  // ═══════════════════════ Platform users ══════════════════════════════════
  await t('TC-SAU-001', 'P1', 'the platform user list is served', async () => {
    const r = await saApi('GET', '/admin/users?limit=10', { token: SA });
    expect.http2xx(r);
    return `${Array.isArray(r.data) ? r.data.length : '?'} users`;
  });

  await t('TC-SAU-002', 'P1', '/admin/me identifies the signed-in operator', async () => {
    const r = await saApi('GET', '/admin/me', { token: SA });
    expect.http2xx(r);
    expect.eq(r.data.email ?? r.data.user?.email, FIXTURES.saEmail);
    return FIXTURES.saEmail;
  });

  await t('TC-SAU-003', 'P1', 'audit events are queryable', async () => {
    const r = await saApi('GET', '/admin/audit-events?limit=10', { token: SA });
    expect.http2xx(r);
    expect.ok(Array.isArray(r.data), 'expected an array');
    return `${r.data.length} events`;
  });

  await t('TC-SAU-004', 'P2', 'password change rejects a wrong current password', async () => {
    const r = await saApi('POST', '/admin/auth/password/change', {
      token: SA, body: { current_password: 'NotThePassword@1', new_password: 'Whatever@12345' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  // ═══════════════════════ Stats & global ledger ═══════════════════════════
  await t('TC-SAS-001', 'P2', 'the pending-subscriptions stat answers', async () => {
    const r = await saApi('GET', '/admin/stats/pending-subscriptions', { token: SA });
    expect.http2xx(r);
    return JSON.stringify(r.data).slice(0, 70);
  });

  await t('TC-SAS-002', 'P1', 'global transaction stats report integer paise', async () => {
    const r = await saApi('GET', '/admin/global-transactions/stats', { token: SA });
    expect.http2xx(r);
    for (const [k, v] of Object.entries(r.data ?? {})) {
      if (k.endsWith('_paise')) expect.paise(Number(v), k);
    }
    return JSON.stringify(r.data).slice(0, 90);
  });

  // ═══════════════════════ Teardown ════════════════════════════════════════
  await t('TC-SAT-099', 'P2', 'tenants created by this run are cleaned up', async () => {
    let removed = 0;
    for (const id of created) {
      const r = await saApi('DELETE', `/admin/tenants/${id}`, { token: SA, body: { reason: 'QA teardown' } });
      if (r.status < 400) removed++;
    }
    return `${removed}/${created.length} removed`;
  });
});

/**
 * Insert a pending change request directly.
 *
 * Raising one through the mandir/sant API needs a *verified* subject and the
 * right role, which would make every review-queue case depend on the whole
 * verification flow passing first. The queue's own behaviour is what is under
 * test here, so the row is seeded straight into the table.
 */
function seedChangeRequest(field, value, subjectId) {
  const tenant = subjectId ?? psql1(`SELECT id FROM public.tenants WHERE slug = '${FIXTURES.tenant}'`);
  const esc = (s) => String(s).replace(/'/g, "''");
  // `uq_fcr_one_pending_per_field` allows exactly one pending request per
  // (subject, field) — correctly, since two pending edits to the same bank
  // account is the ambiguity the queue exists to prevent. Withdraw any leftover
  // from an earlier case before seeding a fresh one.
  psql(
    `UPDATE public.field_change_requests SET status = 'withdrawn'
      WHERE subject_type = 'tenant' AND subject_id = '${tenant}'
        AND field = '${esc(field)}' AND status = 'pending'`,
  );
  return psql1(
    `INSERT INTO public.field_change_requests
       (subject_type, subject_id, subject_label, field, current_value, requested_value, reason, status)
     VALUES ('tenant', '${tenant}', 'QA Subject', '${esc(field)}', 'old', '${esc(value)}', 'QA seed', 'pending')
     RETURNING id`,
  );
}
