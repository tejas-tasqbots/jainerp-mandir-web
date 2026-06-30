/**
 * API↔UI payload-contract checker for the Mandir Admin portal.
 *
 * For each module it fetches the live API payload and asserts that every field
 * the UI page actually reads is present in the response. This catches the
 * silent class of bug where the API renames/reshapes a field and the UI shows
 * blank / NaN / "—" (the same root cause as the dashboard DEF-01/02).
 *
 *   node e2e/full/contract-suite.mjs
 *
 * The `uiFields` lists below were extracted from the React pages' row accessors.
 */
const BASE = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const ADMIN_MOBILE = '9876512345';
const TENANT = 'smoke-portal';

async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json, data: json?.data, meta: json?.meta };
}
async function login() {
  const send = await http('POST', '/auth/send-otp', { body: { mobile: ADMIN_MOBILE } });
  const ver = await http('POST', '/auth/verify-otp', { body: { mobile: ADMIN_MOBILE, otp: send.data.dev_otp } });
  const sel = await http('POST', '/auth/select-tenant', { body: { selection_token: ver.data.selection_token, tenant_slug: TENANT } });
  return sel.data.access_token;
}

/**
 * Each entry: a page, the endpoint that feeds it, where the row lives
 * (`array` = data is the row array; or a dot-path to the array), and the
 * fields the UI reads off each row. `meta` lists fields the UI reads off
 * the response meta (totals etc).
 */
const CONTRACTS = [
  { page: 'Dashboard', ep: '/dashboard', kind: 'object',
    objFields: ['period', 'donations.total_paise', 'donations.count', 'expenses.total_paise', 'visitors', 'donors', 'employees', 'rooms_available', 'bolis.open', 'bolis.outstanding_paise', 'events.upcoming', 'events.past', 'quick_actions'] },
  { page: 'Dashboard/top-donors', ep: '/reports/analytics/top-donors?limit=5', kind: 'array',
    uiFields: ['name', 'amount_paise'] },
  { page: 'Dashboard/trends', ep: '/reports/analytics/donation-trends?granularity=monthly', kind: 'object',
    objFields: ['points'], arrAt: 'points', arrFields: ['bucket', 'amount_paise'] },
  { page: 'Donations list', ep: '/donations?limit=1', kind: 'array',
    uiFields: ['id', 'invoice_no', 'donor_name', 'donor_mobile', 'category_name', 'amount_paise', 'payment_mode', 'is_80g_eligible', 'is_anonymous', 'is_voided', 'created_at'],
    metaFields: ['total', 'total_amount_paise'] },
  { page: 'Donors list', ep: '/donors?limit=1', kind: 'array',
    uiFields: ['id', 'name', 'mobile', 'cumulative_amount_current_fy_paise'] },
  { page: 'Boli list', ep: '/bolis?limit=1', kind: 'array',
    uiFields: ['id', 'donor_name', 'donor_mobile', 'committed_amount_paise', 'paid_amount_paise', 'outstanding_paise', 'status', 'boli_date', 'is_anonymous'] },
  { page: 'Expenses list', ep: '/expenses?limit=1', kind: 'array',
    uiFields: ['id', 'vendor_name', 'category', 'amount_paise', 'gst_paid_paise', 'tds_amount_paise', 'bill_date', 'created_at'],
    metaFields: ['total', 'total_amount_paise'] },
  { page: 'Seva list', ep: '/seva-bookings?limit=1', kind: 'array',
    uiFields: ['id', 'devotee_name', 'devotee_mobile', 'seva_name', 'amount_paise', 'booking_date', 'status'] },
  { page: 'Events list', ep: '/events', kind: 'array',
    uiFields: ['id', 'name', 'event_type', 'start_date', 'end_date', 'estimated_budget_paise', 'status'] },
  { page: 'Prasad items', ep: '/prasad/items', kind: 'array',
    uiFields: ['id', 'name', 'price_paise', 'stock_qty', 'unit', 'is_available'] },
  { page: 'Prasad sales', ep: '/prasad/sales?limit=1', kind: 'array',
    uiFields: ['id', 'invoice_no', 'total_paise', 'payment_mode', 'created_at'] },
  { page: 'Rooms bookings', ep: '/room-bookings?limit=1', kind: 'array',
    uiFields: ['id', 'guest_name', 'guest_mobile', 'room_number', 'check_in_date', 'check_out_date', 'advance_paise', 'balance_paise', 'status'] },
  { page: 'Hall bookings', ep: '/hall-bookings?limit=1', kind: 'array',
    uiFields: ['hall_name', 'event_name', 'booking_date', 'total_paise', 'advance_paise', 'status'], allowEmpty: true,
    sourceNote: 'service returns b.* + h.name AS hall_name (verified in source; tenant has no halls seeded)' },
  { page: 'Vendors list', ep: '/vendors', kind: 'array',
    uiFields: ['id', 'name'], allowEmpty: true },
  { page: 'Devotee links', ep: '/devotee-links', kind: 'auto' },
  { page: 'Tenant profile', ep: '/tenants/me', kind: 'object',
    objFields: ['name', 'platform', 'trustees'] },
  { page: 'Subscription', ep: '/tenants/me/subscription', kind: 'object',
    objFields: ['subscription', 'invoices'] },
];

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const results = [];
function rec(page, ok, detail) {
  results.push({ page, ok, detail });
  console.log(`  ${ok ? '✔ MATCH' : '✘ MISMATCH'} ${page}${detail ? ' — ' + detail : ''}`);
}

const token = await login();
console.log(`\n=== API↔UI contract check — ${BASE} (tenant ${TENANT}) ===\n`);

for (const c of CONTRACTS) {
  const r = await http('GET', c.ep, { token });
  if (r.status < 200 || r.status >= 300) { rec(c.page, false, `HTTP ${r.status}`); continue; }

  if (c.kind === 'object') {
    const missing = (c.objFields ?? []).filter((f) => getPath(r.data, f) === undefined);
    let arrMissing = [];
    if (c.arrAt) {
      const arr = getPath(r.data, c.arrAt);
      if (Array.isArray(arr) && arr.length) {
        arrMissing = (c.arrFields ?? []).filter((f) => arr[0][f] === undefined);
      }
    }
    const ok = missing.length === 0 && arrMissing.length === 0;
    rec(c.page, ok, ok ? `${(c.objFields ?? []).length} fields ok` : `missing: ${[...missing, ...arrMissing.map((f) => c.arrAt + '[].' + f)].join(', ')}`);
    continue;
  }

  // array kinds
  const arr = r.data;
  if (!Array.isArray(arr)) { rec(c.page, false, `data is not an array (got ${typeof arr})`); continue; }
  if (!arr.length) {
    rec(c.page, !!c.allowEmpty, c.allowEmpty ? `empty (no rows to check)${c.sourceNote ? ' — ' + c.sourceNote : ''}` : 'NO ROWS to validate (seed data needed)');
    continue;
  }
  if (c.kind === 'auto') { rec(c.page, true, `array len ${arr.length} (keys: ${Object.keys(arr[0]).length})`); continue; }
  const row = arr[0];
  const missing = (c.uiFields ?? []).filter((f) => !(f in row));
  const metaMissing = (c.metaFields ?? []).filter((f) => !r.meta || !(f in r.meta));
  const ok = missing.length === 0 && metaMissing.length === 0;
  rec(c.page, ok, ok ? `${c.uiFields.length} row + ${(c.metaFields ?? []).length} meta fields ok`
    : `missing row: [${missing.join(', ')}]${metaMissing.length ? ' meta: [' + metaMissing.join(', ') + ']' : ''}`);
}

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n=== CONTRACT SUMMARY: ${passed}/${results.length} match, ${failed.length} mismatch ===`);
for (const f of failed) console.log(`  ✘ ${f.page} — ${f.detail}`);
if (failed.length) process.exitCode = 1;
