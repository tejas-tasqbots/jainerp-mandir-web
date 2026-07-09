/**
 * QA accounting/creditor/reports E2E suite.
 * Seeds ~10 entries across every money module, then asserts the accounting
 * statements, report/export endpoints, the creditor cash-movement fix, the
 * accounting-basis/depreciation toggles, and Categories & Dropdowns delete.
 *
 *   node e2e/full/qa-accounting-suite.mjs
 *
 * Drives the live mandiradmin-api (:3106) against smoke-portal via mock OTP.
 * Idempotent-ish: uses unique names per run so re-runs just add more data.
 */
const BASE = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const ADMIN_MOBILE = '9876512345';
const TENANT = 'smoke-portal';
const RUN = Date.now().toString().slice(-6); // unique tag per run

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; /* quiet on pass */ }
  else { fail++; fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✘ FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json (e.g. zip) */ }
  return { status: res.status, json, data: json?.data, code: json?.error?.code ?? json?.code };
}
const isOk = (r) => r.status >= 200 && r.status < 300;

async function login(mobile) {
  const send = await http('POST', '/auth/send-otp', { body: { mobile } });
  const otp = send.data?.dev_otp;
  const ver = await http('POST', '/auth/verify-otp', { body: { mobile, otp } });
  const sel = await http('POST', '/auth/select-tenant', { body: { selection_token: ver.data?.selection_token, tenant_slug: TENANT } });
  return sel.data?.access_token;
}

async function run() {
  console.log(`\n=== QA accounting suite — ${BASE} (${TENANT}) run#${RUN} ===`);
  const T = await login(ADMIN_MOBILE);
  ok('login', !!T);
  if (!T) { report(); return; }

  // ---- prerequisite masters: accounts (cash + bank), rooms, halls, services, prasad ----
  const accts = (await http('GET', '/accounts?is_active=true', { token: T })).data || [];
  const cashAcct = accts.find(a => a.type === 'cash' || a.is_default_cash);
  let bankAcct = accts.find(a => a.type === 'bank');
  if (!bankAcct) {
    const mk = await http('POST', '/accounts', { token: T, body: { name: `QA Bank ${RUN}`, type: 'bank' } });
    bankAcct = mk.data;
  }
  ok('has cash + bank account', !!cashAcct && !!bankAcct);

  // 10 rooms, 10 halls, a service, a prasad item
  const rooms = [], halls = [];
  for (let i = 0; i < 10; i++) {
    const r = await http('POST', '/rooms', { token: T, body: { room_number: `QA${RUN}-${i}`, name: `QA Room ${RUN}-${i}`, room_type: 'AC', capacity: 2, tariff_paise: 200000 + i * 1000 } });
    if (r.data?.id) rooms.push(r.data);
    const h = await http('POST', '/halls', { token: T, body: { name: `QA Hall ${RUN}-${i}`, capacity: 100, full_day_rate_paise: 5000000, gst_rate: 18 } });
    if (h.data?.id) halls.push(h.data);
  }
  ok('created 10 rooms', rooms.length === 10, `got ${rooms.length}`);
  ok('created 10 halls', halls.length === 10, `got ${halls.length}`);

  const svc = await http('POST', '/services', { token: T, body: { name: `QA Seva ${RUN}`, price_paise: 25100 } });
  const serviceId = svc.data?.id;
  ok('created seva service', !!serviceId);

  let prasadItem = (await http('GET', '/prasad/items', { token: T })).data?.find(p => Number(p.stock_qty) > 20);
  if (!prasadItem) {
    const mk = await http('POST', '/prasad/items', { token: T, body: { name: `QA Ladoo ${RUN}`, price_paise: 2500, stock_qty: 500 } });
    prasadItem = mk.data;
  }
  ok('has prasad item with stock', !!prasadItem);

  // ---- SEED ~10 each ----
  let seeded = { don: 0, exp: 0, credit: 0, tds: 0, prasad: 0, seva: 0, boli: 0, bhoj: 0, room: 0, hall: 0, contra: 0 };

  for (let i = 0; i < 10; i++) {
    if (isOk(await http('POST', '/donations', { token: T, body: { amount_paise: 11100 + i * 100, donor: { name: `QA Donor ${RUN}-${i}`, mobile: `90000${RUN}`.slice(0, 10) }, category: 'General', payment_mode: i % 2 ? 'upi' : 'cash', payment_account_id: i % 2 ? bankAcct.id : undefined, is_80g: false } }))) seeded.don++;

    // plain expense (cash)
    if (isOk(await http('POST', '/expenses', { token: T, body: { amount_paise: 5000 + i * 100, description: `QA exp ${RUN}-${i}`, category: 'Office', vendor: { name: `QA Vend ${RUN}` }, payment_mode: 'cash' } }))) seeded.exp++;

    // on-credit expense (creates a creditor)
    if (isOk(await http('POST', '/expenses', { token: T, body: { amount_paise: 30000 + i * 100, description: `QA credit exp ${RUN}-${i}`, category: 'Office', vendor: { name: `QA Creditor ${RUN}-${i}` }, vendor_name: `QA Creditor ${RUN}-${i}`, is_on_credit: true } }))) seeded.credit++;

    // TDS expense
    if (isOk(await http('POST', '/expenses', { token: T, body: { amount_paise: 100000 + i * 100, description: `QA tds ${RUN}-${i}`, category: 'Professional', vendor: { name: `QA TDS Vend ${RUN}` }, payment_mode: 'cash', tds_deducted: true, tds_amount_paise: 10000, tds_section: '194J' } }))) seeded.tds++;

    if (isOk(await http('POST', '/prasad/sales', { token: T, body: { items: [{ item_id: prasadItem.id, qty: 1 }], payment_mode: 'cash' } }))) seeded.prasad++;

    if (serviceId && isOk(await http('POST', '/seva-bookings', { token: T, body: { service_id: serviceId, devotee: { name: `QA Sevak ${RUN}-${i}`, mobile: `90001${RUN}`.slice(0, 10) }, amount_paise: 25100, payment_mode: 'cash' } }))) seeded.seva++;

    if (isOk(await http('POST', '/bolis', { token: T, body: { pledged_amount_paise: 100000, description: `QA Boli ${RUN}-${i}`, donor: { name: `QA Pledger ${RUN}-${i}`, mobile: `90002${RUN}`.slice(0, 10) } } }))) seeded.boli++;

    if (isOk(await http('POST', '/bhojanshala/sales', { token: T, body: { tokens: 5, rate_paise: 2000, payment_mode: 'cash' } }))) seeded.bhoj++;

    if (rooms[i] && isOk(await http('POST', '/room-bookings', { token: T, body: { room_id: rooms[i].id, from_date: '2026-07-10', to_date: '2026-07-12', guest: { name: `QA Guest ${RUN}-${i}`, mobile: `90003${RUN}`.slice(0, 10) }, advance_paise: 50000, payment_account_id: cashAcct?.id } }))) seeded.room++;

    if (halls[i] && isOk(await http('POST', '/hall-bookings', { token: T, body: { hall_id: halls[i].id, booker: { name: `QA Booker ${RUN}-${i}`, mobile: `90004${RUN}`.slice(0, 10) }, booking_date: '2026-07-15', session_type: 'full_day', advance_paise: 100000, payment_account_id: cashAcct?.id } }))) seeded.hall++;

    // contra: move cash -> bank
    if (cashAcct && bankAcct && isOk(await http('POST', '/contra-entries', { token: T, body: { from_account_id: cashAcct.id, to_account_id: bankAcct.id, amount_paise: 1000, entry_date: '2026-07-09', description: `QA contra ${RUN}-${i}` } }))) seeded.contra++;
  }
  ok('seeded 10 donations', seeded.don === 10, `got ${seeded.don}`);
  ok('seeded 10 plain expenses', seeded.exp === 10, `got ${seeded.exp}`);
  ok('seeded 10 on-credit expenses', seeded.credit === 10, `got ${seeded.credit}`);
  ok('seeded 10 TDS expenses', seeded.tds === 10, `got ${seeded.tds}`);
  ok('seeded 10 prasad sales', seeded.prasad === 10, `got ${seeded.prasad}`);
  ok('seeded 10 seva bookings', seeded.seva === 10, `got ${seeded.seva}`);
  ok('seeded 10 bolis', seeded.boli === 10, `got ${seeded.boli}`);
  ok('seeded 10 bhojanshala sales', seeded.bhoj === 10, `got ${seeded.bhoj}`);
  ok('seeded 10 room bookings', seeded.room === 10, `got ${seeded.room}`);
  ok('seeded 10 hall bookings', seeded.hall === 10, `got ${seeded.hall}`);
  ok('seeded 10 contra (cash↔bank)', seeded.contra === 10, `got ${seeded.contra}`);

  // ---- ACCOUNTS STATEMENTS: every endpoint returns 200 + sane shape ----
  const fy = '2026-27';
  const acctChecks = [
    ['day-book', `/accounting/day-book?from=2026-04-01&to=2027-03-31`],
    ['cash ledger', `/accounting/ledger?type=cash&from=2026-04-01&to=2027-03-31`],
    ['bank ledger', `/accounting/ledger?type=bank&from=2026-04-01&to=2027-03-31`],
    ['trial-balance', `/accounting/trial-balance?fy=${fy}`],
    ['receipts-payments', `/accounting/receipts-payments?fy=${fy}`],
    ['income-expenditure', `/accounting/income-expenditure?fy=${fy}`],
    ['balance-sheet', `/accounting/balance-sheet?fy=${fy}`],
  ];
  for (const [name, path] of acctChecks) {
    const r = await http('GET', path, { token: T });
    ok(`accounts: ${name} 200`, isOk(r), `status=${r.status} ${JSON.stringify(r.json)?.slice(0, 90)}`);
  }

  // ---- REPORTS: every report endpoint returns 200 ----
  const repChecks = [
    ['daily-collection', `/reports/daily-collection?date=2026-07-09`],
    ['donation-register', `/reports/donation-register?from=2026-04-01&to=2027-03-31`],
    ['expense-register', `/reports/expense-register?from=2026-04-01&to=2027-03-31`],
    ['boli-register', `/bolis/register?fy=${fy}`],
    ['donation-trends', `/reports/analytics/donation-trends?granularity=monthly&fy=${fy}`],
    ['top-donors', `/reports/analytics/top-donors?fy=${fy}&limit=20`],
    ['gst-summary', `/reports/gst-summary?fy=${fy}`],
  ];
  for (const [name, path] of repChecks) {
    const r = await http('GET', path, { token: T });
    ok(`reports: ${name} 200`, isOk(r), `status=${r.status}`);
  }
  // GST summary shape (drives the CSV export that we fixed)
  const gst = await http('GET', `/reports/gst-summary?fy=${fy}`, { token: T });
  ok('gst-summary has output_gst + net_payable', gst.data && gst.data.output_gst !== undefined && gst.data.net_payable_paise !== undefined, JSON.stringify(gst.data)?.slice(0, 100));

  // ---- CREDITOR LIFECYCLE (BUG-C1/C3/C4) ----
  const creditors = (await http('GET', '/creditors?limit=100', { token: T })).data || [];
  const target = creditors.find(c => c.status !== 'paid' && (c.original_amount_paise - c.paid_amount_paise) > 20000);
  ok('have an unpaid creditor to test', !!target);
  if (target) {
    // C4: creditor shows a real vendor name, not "Unknown vendor"
    ok('C4: creditor has real vendor name', target.vendor_name && target.vendor_name !== 'Unknown vendor', `name=${target.vendor_name}`);

    // Unpaid creditors appear on the Balance Sheet only under accrual basis, so
    // set accrual for the liability assertion below.
    await http('PATCH', '/tenants/me', { token: T, body: { accounting_basis: 'accrual' } });

    // capture cash-book closing before payment (cash-book returns the full
    // object with closing_balance_paise; ledger returns only the entry array)
    const cashBefore = (await http('GET', `/accounting/cash-book?account_id=${cashAcct.id}&from=2026-04-01&to=2027-03-31`, { token: T })).data;
    const bsBefore = (await http('GET', `/accounting/balance-sheet?fy=${fy}`, { token: T })).data;

    // C1: pay part of it from CASH via the new pay endpoint
    const payAmt = 10000;
    const pay = await http('POST', `/creditors/${target.id}/pay`, { token: T, body: { amount_paise: payAmt, payment_mode: 'cash', payment_date: '2026-07-09' } });
    ok('C1: pay endpoint 200', isOk(pay), `status=${pay.status} ${JSON.stringify(pay.json)?.slice(0, 90)}`);

    const cashAfter = (await http('GET', `/accounting/cash-book?account_id=${cashAcct.id}&from=2026-04-01&to=2027-03-31`, { token: T })).data;
    const bsAfter = (await http('GET', `/accounting/balance-sheet?fy=${fy}`, { token: T })).data;

    // cash closing must DROP by payAmt (money left cash) — this is the core bug fix
    const cashDelta = Number(cashBefore?.closing_balance_paise ?? 0) - Number(cashAfter?.closing_balance_paise ?? 0);
    ok('C1: cash book decreased by payment', cashDelta === payAmt, `delta=${cashDelta} expected=${payAmt}`);

    // balance sheet: liability drops by payAmt AND cash asset drops by payAmt (stays balanced)
    const liabDelta = Number(bsBefore?.liabilities?.creditors_paise ?? 0) - Number(bsAfter?.liabilities?.creditors_paise ?? 0);
    ok('C1: BS creditor liability decreased by payment', liabDelta === payAmt, `delta=${liabDelta}`);
    const assetDelta = Number(bsBefore?.assets?.cash_and_bank_total_paise ?? 0) - Number(bsAfter?.assets?.cash_and_bank_total_paise ?? 0);
    ok('C1: BS cash asset decreased by payment (books balance)', assetDelta === payAmt, `delta=${assetDelta}`);

    // C3: overpayment rejected
    const over = await http('POST', `/creditors/${target.id}/pay`, { token: T, body: { amount_paise: 999999999, payment_mode: 'cash' } });
    ok('C3: overpayment rejected 400', over.status === 400 && over.code === 'VALIDATION_ERROR', `status=${over.status} code=${over.code}`);

    // non-cash without account rejected
    const noAcct = await http('POST', `/creditors/${target.id}/pay`, { token: T, body: { amount_paise: 1000, payment_mode: 'upi' } });
    ok('non-cash without account rejected', noAcct.status === 400, `status=${noAcct.status}`);

    // restore cash basis (default) so later cash-flow assertions are unaffected
    await http('PATCH', '/tenants/me', { token: T, body: { accounting_basis: 'cash' } });
  }

  // ---- ACCRUAL vs CASH BASIS actually changes the statements ----
  // Seed a fresh UNPAID on-credit expense so accrual > cash by that amount.
  await http('POST', '/expenses', { token: T, body: { amount_paise: 500000, description: `QA accrual ${RUN}`, category: 'AccrualQA', vendor: { name: 'AccrualQA V' }, vendor_name: 'AccrualQA V', is_on_credit: true } });
  await http('PATCH', '/tenants/me', { token: T, body: { accounting_basis: 'accrual' } });
  const ieAcc = (await http('GET', `/accounting/income-expenditure?fy=${fy}`, { token: T })).data;
  const bsAcc = (await http('GET', `/accounting/balance-sheet?fy=${fy}`, { token: T })).data;
  await http('PATCH', '/tenants/me', { token: T, body: { accounting_basis: 'cash' } });
  const ieCash = (await http('GET', `/accounting/income-expenditure?fy=${fy}`, { token: T })).data;
  const bsCash = (await http('GET', `/accounting/balance-sheet?fy=${fy}`, { token: T })).data;
  ok('basis label present', ieAcc?.basis === 'accrual' && ieCash?.basis === 'cash', `${ieAcc?.basis}/${ieCash?.basis}`);
  ok('accrual expenditure > cash (unpaid on-credit counted only in accrual)',
    Number(ieAcc?.totals?.expenditure_paise) - Number(ieCash?.totals?.expenditure_paise) >= 500000,
    `accr=${ieAcc?.totals?.expenditure_paise} cash=${ieCash?.totals?.expenditure_paise}`);
  ok('accrual BS shows payables, cash BS drops them',
    Number(bsAcc?.liabilities?.creditors_paise) > 0 && Number(bsCash?.liabilities?.creditors_paise) === 0,
    `accr=${bsAcc?.liabilities?.creditors_paise} cash=${bsCash?.liabilities?.creditors_paise}`);

  // ---- DEPRECIATION engine: run computes + posts, idempotent, gates BS ----
  const depFy = '2019-20'; // isolated FY so this run is deterministic
  const asset = await http('POST', '/fixed-assets', { token: T, body: { name: `QA Asset ${RUN}`, purchase_date: '2019-05-01', purchase_cost_paise: 1000000, useful_life_years: 10, depreciation_method: 'SLM', depreciation_rate: 10 } });
  ok('create fixed asset', !!asset.data?.id);
  const run1 = await http('POST', '/fixed-assets/depreciation/run', { token: T, body: { fy: depFy } });
  const mine1 = (run1.data?.entries || []).find(e => e.asset === `QA Asset ${RUN}`);
  ok('depreciation run posts SLM charge (10% of 1,000,000 = 100,000)', mine1?.amount_paise === 100000, `got ${mine1?.amount_paise}`);
  const run2 = await http('POST', '/fixed-assets/depreciation/run', { token: T, body: { fy: depFy } });
  const mine2 = (run2.data?.entries || []).find(e => e.asset === `QA Asset ${RUN}`);
  ok('depreciation run idempotent per FY (no re-charge)', !mine2, `re-charged ${mine2?.amount_paise ?? 0}`);
  const ent = await http('GET', `/fixed-assets/depreciation/entries?fy=${depFy}`, { token: T });
  ok('depreciation entries listed', (ent.data || []).some(e => e.asset_name === `QA Asset ${RUN}`));
  const badFy = await http('POST', '/fixed-assets/depreciation/run', { token: T, body: { fy: 'nope' } });
  ok('depreciation run rejects bad fy', badFy.status === 400);
  // enable_depreciation gates gross vs net on the Balance Sheet (for depFy)
  await http('PATCH', '/tenants/me', { token: T, body: { enable_depreciation: true } });
  const bsDepOn = (await http('GET', `/accounting/balance-sheet?fy=${depFy}`, { token: T })).data;
  await http('PATCH', '/tenants/me', { token: T, body: { enable_depreciation: false } });
  const bsDepOff = (await http('GET', `/accounting/balance-sheet?fy=${depFy}`, { token: T })).data;
  ok('depreciation flag: gross (off) > net (on) fixed assets',
    Number(bsDepOff?.assets?.fixed_assets_paise) > Number(bsDepOn?.assets?.fixed_assets_paise),
    `off=${bsDepOff?.assets?.fixed_assets_paise} on=${bsDepOn?.assets?.fixed_assets_paise}`);
  // restore defaults
  await http('PATCH', '/tenants/me', { token: T, body: { accounting_basis: 'cash', enable_depreciation: false } });

  // ---- CATEGORIES & DROPDOWNS DELETE (Part 1) ----
  const cat = await http('POST', '/donation-categories', { token: T, body: { name: `QA Cat ${RUN}` } });
  const catId = cat.data?.id;
  ok('create donation-category', !!catId);
  if (catId) {
    const del = await http('DELETE', `/donation-categories/${catId}`, { token: T });
    ok('DELETE donation-category 200', isOk(del), `status=${del.status}`);
    // soft-delete: it should now be inactive (is_active=false), not error
    const list = (await http('GET', '/donation-categories?include_inactive=true', { token: T })).data || [];
    const still = list.find(c => c.id === catId);
    ok('deleted category is inactive or gone', !still || still.is_active === false, `is_active=${still?.is_active}`);
  }

  report();
}

function report() {
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error('SUITE ERROR', e); process.exit(2); });
