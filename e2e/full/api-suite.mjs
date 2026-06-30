/**
 * Functional API E2E suite for the Mandir Admin portal.
 * Drives the live mandiradmin-api (:3106) against the smoke-portal tenant using
 * the OTP_MOCK login bypass. Covers the API-type test cases in Test_Cases.md.
 *
 *   node e2e/full/api-suite.mjs
 *
 * Emits one line per case: PASS/FAIL <TC-ID> <title>. Exit 1 if any P1 fails.
 */
const BASE = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const ADMIN_MOBILE = '9876512345';
const CASHIER_MOBILE = '9844444444';
const TENANT = 'smoke-portal';

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  ${ok ? '✔' : '✘'} ${tag} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json, data: json?.data, code: json?.error?.code ?? json?.code };
}

async function login(mobile) {
  const send = await http('POST', '/auth/send-otp', { body: { mobile } });
  const otp = send.data?.dev_otp;
  if (!otp) throw new Error(`no dev_otp for ${mobile}: ${JSON.stringify(send.json)}`);
  const ver = await http('POST', '/auth/verify-otp', { body: { mobile, otp } });
  const sel = ver.data?.selection_token;
  const tenants = ver.data?.tenants ?? [];
  return { otp, sel, tenants, ver };
}

async function loginFull(mobile, tenant = TENANT) {
  const { sel } = await login(mobile);
  const r = await http('POST', '/auth/select-tenant', { body: { selection_token: sel, tenant_slug: tenant } });
  return r.data?.access_token;
}

// expect helpers
const isOk = (r) => r.status >= 200 && r.status < 300;

async function run() {
  console.log(`\n=== Mandir Admin API E2E — ${BASE} (tenant ${TENANT}) ===\n`);

  // ---------- AUTH ----------
  const send = await http('POST', '/auth/send-otp', { body: { mobile: ADMIN_MOBILE } });
  record('TC-AUTH-01', 'P1', 'send-otp returns dev OTP', isOk(send) && !!send.data?.dev_otp, `otp=${send.data?.dev_otp}`);

  const { sel, tenants, ver } = await login(ADMIN_MOBILE);
  record('TC-AUTH-05', 'P1', 'verify-otp returns selection token + memberships',
    !!sel && tenants.some((t) => t.slug === TENANT && t.roles?.includes('temple_admin')),
    `tenants=${tenants.map((t) => t.slug).join(',')}`);

  const badOtp = await http('POST', '/auth/verify-otp', { body: { mobile: ADMIN_MOBILE, otp: '000000' } });
  record('TC-AUTH-03', 'P1', 'wrong OTP rejected', badOtp.status === 401 && badOtp.code === 'OTP_INVALID', `status=${badOtp.status} code=${badOtp.code}`);

  const noOtp = await http('POST', '/auth/verify-otp', { body: { mobile: '9999900000', otp: '123456' } });
  record('TC-AUTH-04', 'P2', 'verify with no live OTP', noOtp.status === 401 && noOtp.code === 'OTP_INVALID', `code=${noOtp.code}`);

  const selRes = await http('POST', '/auth/select-tenant', { body: { selection_token: sel, tenant_slug: TENANT } });
  const ADMIN = selRes.data?.access_token;
  const REFRESH = selRes.data?.refresh_token;
  record('TC-AUTH-06', 'P1', 'select-tenant issues access token', isOk(selRes) && !!ADMIN, `len=${ADMIN?.length}`);

  // fresh selection token for the wrong-tenant test (each verify consumes one)
  const { sel: sel2 } = await login(ADMIN_MOBILE);
  const wrongTenant = await http('POST', '/auth/select-tenant', { body: { selection_token: sel2, tenant_slug: 'ext-322583' } });
  record('TC-AUTH-07', 'P2', 'select tenant the user is not a member of blocked', wrongTenant.status === 403, `status=${wrongTenant.status} code=${wrongTenant.code}`);

  if (REFRESH) {
    const refr = await http('POST', '/auth/refresh', { body: { refresh_token: REFRESH } });
    record('TC-AUTH-08', 'P2', 'refresh rotates token', isOk(refr) && !!refr.data?.access_token, `status=${refr.status}`);
  }

  const CASHIER = await loginFull(CASHIER_MOBILE);
  record('TC-AUTH-09', 'P1', 'cashier can login (role-scoped session)', !!CASHIER);

  // ---------- DASHBOARD ----------
  const dash = await http('GET', '/dashboard?period=month', { token: ADMIN });
  record('TC-DASH-03', 'P1', 'dashboard payload shape', isOk(dash) && dash.data?.donations && dash.data?.bolis && Array.isArray(dash.data?.quick_actions),
    `don=${dash.data?.donations?.count} bolis_open=${dash.data?.bolis?.open}`);

  // ---------- DONATIONS ----------
  const dlist = await http('GET', '/donations?limit=5', { token: ADMIN });
  record('TC-DON-01', 'P1', 'donation list + aggregate total', isOk(dlist) && Array.isArray(dlist.data) && dlist.json?.meta?.total_amount_paise !== undefined,
    `total_paise=${dlist.json?.meta?.total_amount_paise}`);

  const zeroAmt = await http('POST', '/donations', { token: ADMIN, body: { amount_paise: 0, donor: { name: 'X', mobile: '9000000001' }, category: 'General' } });
  record('TC-DON-03', 'P1', 'positive-amount validation', zeroAmt.status === 400 && zeroAmt.code === 'VALIDATION_ERROR', `code=${zeroAmt.code}`);

  // record a real cash donation (non-80G to avoid PAN requirement)
  const newDon = await http('POST', '/donations', { token: ADMIN, body: { amount_paise: 25100, donor: { name: 'QA AutoDonor', mobile: '9000012399' }, category: 'General', payment_mode: 'cash', is_80g: false } });
  const donId = newDon.data?.id;
  record('TC-DON-02', 'P1', 'record cash donation issues receipt', isOk(newDon) && /\/\d{4}-\d{2}\//.test(newDon.data?.receipt_number ?? ''), `receipt=${newDon.data?.receipt_number}`);

  const pan80g = await http('POST', '/donations', { token: ADMIN, body: { amount_paise: 50000, donor: { name: 'QA NoPan', mobile: '9000012388' }, category: 'General', is_80g: true } });
  record('TC-DON-04', 'P1', '80G without PAN (explicit) blocked', pan80g.status === 400 && pan80g.code === 'PAN_REQUIRED', `code=${pan80g.code}`);

  const anon = await http('POST', '/donations', { token: ADMIN, body: { amount_paise: 11100, is_anonymous: true, category: 'General' } });
  record('TC-DON-06', 'P1', 'anonymous forced non-80G', isOk(anon) && anon.data?.amount_paise === 11100, `synced=${anon.data?.global_synced}`);

  const danpeti = await http('POST', '/donations', { token: ADMIN, body: { amount_paise: 5100, is_anonymous: true, anonymous_category: 'dan_peti', category: 'General' } });
  record('TC-DON-07', 'P2', 'Dan Peti recorded', isOk(danpeti), `id=${danpeti.data?.id ? 'ok' : 'no'}`);

  if (donId) {
    const rcpt = await http('GET', `/donations/${donId}/receipt`, { token: ADMIN });
    record('TC-DON-08', 'P1', 'receipt payload available (drives client print/PDF)', isOk(rcpt) && !!rcpt.data?.receipt_number && !!rcpt.data?.mandir, `tmpl=${rcpt.data?.mandir?.template}`);

    // cashier cannot void
    const cashierVoid = await http('PATCH', `/donations/${donId}/void`, { token: CASHIER, body: { reason: 'test' } });
    record('TC-AUTH-10', 'P1', 'server enforces role: cashier cannot void', cashierVoid.status === 403, `status=${cashierVoid.status}`);
    record('TC-DON-10b', 'P1', 'void is temple_admin-only (server-side)', cashierVoid.status === 403, `status=${cashierVoid.status}`);

    const emptyReason = await http('PATCH', `/donations/${donId}/void`, { token: ADMIN, body: { reason: '' } });
    record('TC-DON-11', 'P2', 'void requires reason', emptyReason.status === 400 && emptyReason.code === 'VALIDATION_ERROR', `code=${emptyReason.code}`);

    const voided = await http('PATCH', `/donations/${donId}/void`, { token: ADMIN, body: { reason: 'QA void test' } });
    record('TC-DON-10', 'P1', 'admin void succeeds + flags voided', isOk(voided) && voided.data?.is_voided === true);

    const doubleVoid = await http('PATCH', `/donations/${donId}/void`, { token: ADMIN, body: { reason: 'again' } });
    record('TC-DON-12', 'P2', 'double void blocked', doubleVoid.status === 400 && doubleVoid.code === 'CONFLICT', `code=${doubleVoid.code}`);
  }

  // ---------- DONORS ----------
  const donors = await http('GET', '/donors?limit=3', { token: ADMIN });
  record('TC-DNR-01', 'P1', 'donor list', isOk(donors) && Array.isArray(donors.data));
  const dupMobile = donors.data?.[0]?.mobile?.replace(/\D/g, '').slice(-10);
  if (dupMobile) {
    const dup = await http('POST', '/donors', { token: ADMIN, body: { name: 'Dup', mobile: dupMobile } });
    record('TC-DNR-03', 'P2', 'duplicate donor mobile rejected', dup.status === 400 && dup.code === 'DUPLICATE', `code=${dup.code}`);
  }
  const did = donors.data?.[0]?.id;
  if (did) {
    const ledger = await http('GET', `/donors/${did}/ledger`, { token: ADMIN });
    record('TC-DNR-04', 'P1', 'donor ledger', isOk(ledger));
  }

  // ---------- BOLI ----------
  const bolis = await http('GET', '/bolis?limit=5', { token: ADMIN });
  record('TC-BOLI-01', 'P1', 'boli list', isOk(bolis) && Array.isArray(bolis.data));
  const badBoli = await http('POST', '/bolis', { token: ADMIN, body: { pledged_amount_paise: 0 } });
  record('TC-BOLI-03', 'P1', 'pledge validation', badBoli.status === 400 && badBoli.code === 'VALIDATION_ERROR', `code=${badBoli.code}`);
  const newBoli = await http('POST', '/bolis', { token: ADMIN, body: { pledged_amount_paise: 100000, description: 'QA Boli auction', donor: { name: 'QA Pledger', mobile: '9000022277' } } });
  const boliId = newBoli.data?.id;
  record('TC-BOLI-02', 'P1', 'create pledge', isOk(newBoli) && !!boliId);
  if (boliId) {
    const part = await http('POST', `/bolis/${boliId}/payments`, { token: ADMIN, body: { amount_paise: 40000, payment_mode: 'cash' } });
    record('TC-BOLI-04', 'P1', 'partial payment → status partially_paid + linked receipt', isOk(part) && part.data?.boli_status === 'partially_paid' && !!part.data?.donation?.receipt_number, `status=${part.data?.boli_status} receipt=${part.data?.donation?.receipt_number}`);
    const full = await http('POST', `/bolis/${boliId}/payments`, { token: ADMIN, body: { amount_paise: 60000, payment_mode: 'cash' } });
    record('TC-BOLI-05', 'P1', 'full payment closes pledge', isOk(full) && full.data?.boli_status === 'paid', `status=${full.data?.boli_status}`);
    const payClosed = await http('POST', `/bolis/${boliId}/payments`, { token: ADMIN, body: { amount_paise: 100, payment_mode: 'cash' } });
    record('TC-BOLI-06', 'P2', 'pay closed pledge blocked', payClosed.status === 400 && payClosed.code === 'CONFLICT', `code=${payClosed.code}`);
  }
  // separate boli to waive
  const waiveBoli = await http('POST', '/bolis', { token: ADMIN, body: { pledged_amount_paise: 50000, description: 'QA waive', donor: { name: 'QA Waive', mobile: '9000022266' } } });
  if (waiveBoli.data?.id) {
    const noReason = await http('POST', `/bolis/${waiveBoli.data.id}/waive`, { token: ADMIN, body: {} });
    const waived = await http('POST', `/bolis/${waiveBoli.data.id}/waive`, { token: ADMIN, body: { reason: 'QA waived' } });
    record('TC-BOLI-07', 'P2', 'waive (admin) with reason', noReason.status === 400 && isOk(waived) && waived.data?.status === 'waived', `noReason=${noReason.code} status=${waived.data?.status}`);
  }

  // ---------- EXPENSES ----------
  const exp = await http('GET', '/expenses?limit=3', { token: ADMIN });
  record('TC-EXP-01', 'P1', 'expense list', isOk(exp) && Array.isArray(exp.data));
  const badExp = await http('POST', '/expenses', { token: ADMIN, body: { amount_paise: 0 } });
  record('TC-EXP-03', 'P1', 'expense validation', badExp.status === 400 && badExp.code === 'VALIDATION_ERROR', `code=${badExp.code}`);
  const newExp = await http('POST', '/expenses', { token: ADMIN, body: { amount_paise: 75000, description: 'QA stationery', category: 'Office', vendor: { name: 'QA Vendor', mobile: '9000033311' }, payment_mode: 'cash' } });
  record('TC-EXP-02', 'P1', 'record expense', isOk(newExp), `id=${newExp.data?.id ? 'ok' : JSON.stringify(newExp.json)?.slice(0,80)}`);
  if (newExp.data?.id) {
    const cashierDel = await http('DELETE', `/expenses/${newExp.data.id}`, { token: CASHIER });
    record('TC-EXP-05', 'P2', 'delete is admin-only', cashierDel.status === 403, `status=${cashierDel.status}`);
  }

  // ---------- DHARAMSHALA ----------
  const avail = await http('GET', '/rooms/availability?from=2026-07-01&to=2026-06-30', { token: ADMIN });
  record('TC-DHRM-02', 'P1', 'availability window validation (to<from)', avail.status === 400 && avail.code === 'VALIDATION_ERROR', `code=${avail.code}`);
  const availOk = await http('GET', '/rooms/availability?from=2026-07-01&to=2026-07-03', { token: ADMIN });
  record('TC-DHRM-01', 'P1', 'rooms availability', isOk(availOk));

  // ---------- PRASAD ----------
  const items = await http('GET', '/prasad/items', { token: ADMIN });
  record('TC-PRAS-01', 'P1', 'prasad items list', isOk(items) && Array.isArray(items.data));
  const stockItem = (items.data ?? []).find((i) => Number(i.stock_qty) >= 0);
  const noPrice = await http('POST', '/prasad/items', { token: ADMIN, body: { name: 'QA NoPrice' } });
  record('TC-PRAS-02', 'P2', 'create item validation', noPrice.status === 400 && noPrice.code === 'VALIDATION_ERROR', `code=${noPrice.code}`);
  if (stockItem) {
    const oos = await http('POST', '/prasad/sales', { token: ADMIN, body: { items: [{ item_id: stockItem.id, qty: Number(stockItem.stock_qty) + 9999 }], payment_mode: 'cash' } });
    record('TC-PRAS-04', 'P1', 'out-of-stock guarded', oos.status === 400 && oos.code === 'OUT_OF_STOCK', `code=${oos.code}`);
  } else {
    record('TC-PRAS-04', 'P1', 'out-of-stock guarded', false, 'no prasad item with stock to test');
  }

  // ---------- BHOJANSHALA ----------
  const badBhoj = await http('POST', '/bhojanshala/sales', { token: ADMIN, body: { tokens: 0, rate_paise: 1000 } });
  record('TC-BHOJ-02', 'P1', 'bhojanshala validation', badBhoj.status === 400 && badBhoj.code === 'VALIDATION_ERROR', `code=${badBhoj.code}`);
  const bhoj = await http('POST', '/bhojanshala/sales', { token: ADMIN, body: { tokens: 10, rate_paise: 2000, payment_mode: 'cash' } });
  const bhojId = bhoj.data?.id;
  record('TC-BHOJ-01', 'P1', 'sell tokens', isOk(bhoj) && !!bhojId);
  if (bhojId) {
    const over = await http('PATCH', `/bhojanshala/sales/${bhojId}/redeem`, { token: ADMIN, body: { tokens_redeemed: 999 } });
    record('TC-BHOJ-04', 'P2', 'redeem over remaining blocked', over.status === 400 && over.code === 'VALIDATION_ERROR', `code=${over.code}`);
    const ok = await http('PATCH', `/bhojanshala/sales/${bhojId}/redeem`, { token: ADMIN, body: { tokens_redeemed: 4 } });
    record('TC-BHOJ-03', 'P1', 'redeem within remaining', isOk(ok));
  }
  // bhojanshala_cashier scope
  let BHOJ_CASHIER = null;
  try { BHOJ_CASHIER = await loginFull('9833300011'); } catch { /* ignore */ }
  if (BHOJ_CASHIER) {
    const scope = await http('POST', '/donations', { token: BHOJ_CASHIER, body: { amount_paise: 100, donor: { name: 'x', mobile: '9000099999' }, category: 'General' } });
    record('TC-BHOJ-05', 'P2', 'bhojanshala_cashier cannot record donations', scope.status === 403, `status=${scope.status}`);
  }

  // ---------- SEVA ----------
  const sevas = await http('GET', '/seva-bookings?limit=3', { token: ADMIN });
  record('TC-SEVA-01', 'P1', 'seva bookings list', isOk(sevas) && Array.isArray(sevas.data));
  const noService = await http('POST', '/seva-bookings', { token: ADMIN, body: { devotee: { name: 'x', mobile: '9000088888' } } });
  record('TC-SEVA-03', 'P2', 'service_id required', noService.status === 400 && noService.code === 'VALIDATION_ERROR', `code=${noService.code}`);

  // ---------- EVENTS ----------
  const events = await http('GET', '/events', { token: ADMIN });
  record('TC-EVT-01', 'P1', 'events list', isOk(events) && Array.isArray(events.data));
  const newEvent = await http('POST', '/events', { token: ADMIN, body: { name: 'QA Test Event', event_type: 'festival', start_date: '2026-08-01' } });
  record('TC-EVT-02', 'P1', 'create event', isOk(newEvent) && !!newEvent.data?.id, `id=${newEvent.data?.id ? 'ok' : 'no'}`);
  if (newEvent.data?.id) {
    const reg = await http('POST', `/events/${newEvent.data.id}/registrations`, { token: ADMIN, body: { name: 'QA Attendee', mobile: '9000077711', attendee_count: 2 } });
    record('TC-EVT-03', 'P2', 'register attendee', isOk(reg), `status=${reg.status}`);
    const cashierDel = await http('DELETE', `/events/${newEvent.data.id}`, { token: CASHIER });
    record('TC-EVT-06', 'P2', 'delete event is admin-only', cashierDel.status === 403, `status=${cashierDel.status}`);
  }

  // ---------- REPORTS ----------
  const daily = await http('GET', '/reports/daily-collection', { token: ADMIN });
  record('TC-RPT-01', 'P1', 'daily collection report', isOk(daily));
  const gst = await http('GET', '/reports/gst-summary', { token: ADMIN });
  record('TC-RPT-04', 'P2', 'GST summary', isOk(gst));
  const top = await http('GET', '/reports/analytics/top-donors?limit=5', { token: ADMIN });
  record('TC-RPT-05', 'P3', 'top donors analytics', isOk(top));

  // ---------- COMPLIANCE ----------
  const certs = await http('GET', '/compliance/80g-certificates', { token: ADMIN });
  record('TC-CMPL-01', 'P1', '80G certificates list', isOk(certs));
  const gen1 = await http('POST', '/compliance/form-10bd/generate', { token: ADMIN, body: {} });
  const gen2 = await http('POST', '/compliance/form-10bd/generate', { token: ADMIN, body: {} });
  record('TC-CMPL-02', 'P2', 'Form 10BD generate idempotent', isOk(gen1) && isOk(gen2) && gen2.data?.new_entries === 0, `first=${gen1.data?.new_entries} second=${gen2.data?.new_entries}`);
  const badQ = await http('GET', '/compliance/tds-report?quarter=9', { token: ADMIN });
  record('TC-CMPL-04', 'P3', 'bad quarter rejected', badQ.status === 400 && badQ.code === 'VALIDATION_ERROR', `code=${badQ.code}`);

  // ---------- ACCOUNTING ----------
  const dayBook = await http('GET', '/accounting/day-book', { token: ADMIN });
  record('TC-ACCT-01', 'P1', 'day book', isOk(dayBook));
  const tb = await http('GET', '/accounting/trial-balance', { token: ADMIN });
  record('TC-ACCT-03', 'P1', 'trial balance', isOk(tb));
  const ie = await http('GET', '/accounting/income-expenditure', { token: ADMIN });
  record('TC-ACCT-04', 'P1', 'income & expenditure', isOk(ie));
  const bs = await http('GET', '/accounting/balance-sheet', { token: ADMIN });
  record('TC-ACCT-06', 'P1', 'balance sheet', isOk(bs));
  const badFy = await http('GET', '/accounting/trial-balance?fy=notayear', { token: ADMIN });
  record('TC-ACCT-07', 'P3', 'bad FY rejected', badFy.status === 400 && badFy.code === 'VALIDATION_ERROR', `code=${badFy.code}`);

  // ---------- DEVOTEE MGMT ----------
  const shortQ = await http('GET', '/devotees/search?q=ab', { token: ADMIN });
  record('TC-DEVT-02', 'P1', 'global search min length', shortQ.status === 400 && shortQ.code === 'VALIDATION_ERROR', `code=${shortQ.code}`);
  const search = await http('GET', '/devotees/search?q=98000', { token: ADMIN });
  record('TC-DEVT-03', 'P1', 'devotee search returns annotated rows', isOk(search) && Array.isArray(search.data), `n=${search.data?.length}`);
  const links = await http('GET', '/devotee-links', { token: ADMIN });
  record('TC-DEVT-01b', 'P1', 'devotee-links list (Connected Devotees data)', isOk(links));

  // ---------- VENDORS / MASTERS / RESOURCES ----------
  const vendors = await http('GET', '/vendors', { token: ADMIN });
  record('TC-MAST-01', 'P1', 'vendors list (generic resource)', isOk(vendors));
  const priests = await http('GET', '/priests', { token: ADMIN });
  record('TC-MAST-02', 'P2', 'priests master', isOk(priests));
  const inv = await http('GET', '/inventory-items', { token: ADMIN });
  record('TC-MAST-04', 'P2', 'inventory items', isOk(inv));
  const lf = await http('GET', '/lost-found', { token: ADMIN });
  record('TC-MAST-05', 'P2', 'lost & found', isOk(lf));
  const clamp = await http('GET', '/rooms?limit=9999', { token: ADMIN });
  record('TC-MAST-09', 'P3', 'pagination clamp ≤200', isOk(clamp) && (clamp.json?.meta?.limit ?? 200) <= 200, `limit=${clamp.json?.meta?.limit}`);
  const unknown = await http('GET', '/nonsense-resource', { token: ADMIN });
  record('TC-MAST-10', 'P3', 'unknown resource → 404', unknown.status === 404 && unknown.code === 'NOT_FOUND', `status=${unknown.status} code=${unknown.code}`);

  // ---------- SETTINGS / STAFF ----------
  const me = await http('GET', '/tenants/me', { token: ADMIN });
  record('TC-SET-02', 'P1', 'profile fetch', isOk(me) && !!me.data?.name, `name=${me.data?.name}`);
  const upd = await http('PATCH', '/tenants/me', { token: ADMIN, body: { custom_receipt_footer: 'QA footer ' + Date.now() } });
  record('TC-SET-03', 'P2', 'update profile', isOk(upd));
  const sub = await http('GET', '/tenants/me/subscription', { token: ADMIN });
  record('TC-SET-04', 'P2', 'subscription/usage', isOk(sub));
  const cashierInvite = await http('POST', '/users/invite', { token: CASHIER, body: { mobile: '9000066611', roles: ['cashier'] } });
  record('TC-SET-06', 'P1', 'staff invite is admin-only', cashierInvite.status === 403, `status=${cashierInvite.status}`);
  const exportData = await http('GET', '/tenants/me/export', { token: ADMIN });
  record('TC-SET-07', 'P2', 'backup export (admin)', isOk(exportData) && Array.isArray(exportData.data?.tables), `tables=${exportData.data?.tables?.length}`);

  // ---------- SUMMARY ----------
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== SUMMARY: ${passed}/${total} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) {
    console.log('Failures:');
    for (const f of failed) console.log(`  ✘ ${f.id} [${f.pri}] ${f.title} — ${f.detail}`);
  }
  // machine-readable line for the report generator
  console.log('\nJSON_RESULTS=' + JSON.stringify(results));
  if (p1Failed.length) process.exitCode = 1;
}

run().catch((e) => { console.error('FATAL', e); process.exitCode = 2; });
