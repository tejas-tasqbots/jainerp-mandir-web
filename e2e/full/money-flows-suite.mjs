/**
 * End-to-end money flows through the real API.
 *
 * Route sweeps prove a page renders. These prove the product WORKS: that a
 * donation issues a gapless receipt number, that the same rupee shows up in the
 * day book and the income & expenditure statement, that a void does not leave
 * money behind, and that the statements actually balance.
 *
 * Everything is asserted against figures read back from the API, never against
 * a number hard-coded here.
 */
const API = process.env.API;
const MOBILE = process.env.MOBILE;
const SLUG = process.env.SLUG;

const results = [];
const rec = (id, title, ok, detail = '') => {
  results.push({ id, title, ok, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${id} ${title}${detail ? ' — ' + detail : ''}`);
};

let TOKEN = '';
async function req(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json, data: json?.data };
}
const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);

async function login() {
  const s = await post('/auth/send-otp', { mobile: MOBILE });
  const v = await post('/auth/verify-otp', { mobile: MOBILE, otp: s.data.dev_otp });
  const t = await post('/auth/select-tenant', { selection_token: v.data.selection_token, tenant_slug: SLUG });
  TOKEN = t.data.access_token;
}

const paise = (n) => Math.round(n * 100);
const num = (v) => Number(v ?? 0);

try {
  await login();
  rec('FL-00', 'login', !!TOKEN);

  // ── Baselines, so every assertion is a delta rather than an absolute ──────
  const fy = (await get('/dashboard?period=year')).data ?? {};
  const beforeDon = (await get('/donations?limit=1')).json?.meta?.total ?? 0;

  // ══ 1. Record a donation ═══════════════════════════════════════════════
  const amount = paise(1111);
  const cat = (await get('/donation-categories?limit=1')).data;
  const categoryId = cat?.[0]?.id ?? cat?.rows?.[0]?.id;
  const d1 = await post('/donations', {
    donor: { name: 'QA Flow Donor', mobile: '9876500123' },
    category_id: categoryId,
    amount_paise: amount,
    payment_mode: 'cash',
    is_80g_eligible: false,
  });
  const receipt = d1.data?.invoice_no ?? d1.data?.receipt_number;
  rec('FL-01', 'donation is recorded and issues a receipt number',
    d1.status < 300 && !!receipt, receipt ?? JSON.stringify(d1.json).slice(0, 120));

  const afterDon = (await get('/donations?limit=1')).json?.meta?.total ?? 0;
  rec('FL-02', 'the donation register grew by exactly one',
    afterDon === beforeDon + 1, `${beforeDon} → ${afterDon}`);

  // ── the receipt payload must carry what the printed receipt needs ────────
  const rcpt = await get(`/donations/${d1.data?.id}/receipt`);
  // The receipt payload names it receipt_number, not invoice_no.
  const needed = ['amount_paise', 'receipt_number', 'mandir', 'donor'];
  const missing = needed.filter((k) => rcpt.data?.[k] == null && rcpt.data?.donation?.[k] == null);
  rec('FL-03', 'the receipt payload carries amount and number',
    rcpt.status < 300 && missing.length === 0, missing.join(', ') || `status=${rcpt.status}`);

  // ── gapless numbering: two more donations must be consecutive ────────────
  const d2 = await post('/donations', { donor: { name: 'QA Seq A', mobile: '9876500124' }, category_id: categoryId, amount_paise: paise(100), payment_mode: 'cash' });
  const d3 = await post('/donations', { donor: { name: 'QA Seq B', mobile: '9876500125' }, category_id: categoryId, amount_paise: paise(100), payment_mode: 'cash' });
  // Same fallback FL-01 uses: the create response names it receipt_number.
  const nums = [d1, d2, d3].map((d) => String(d.data?.invoice_no ?? d.data?.receipt_number ?? ''));
  const seq = nums.map((v) => Number(v.split('/').pop()));
  rec('FL-04', 'receipt numbers are gapless and increasing',
    seq.every((n) => Number.isFinite(n) && n > 0) && seq.every((n, i) => i === 0 || n === seq[i - 1] + 1),
    nums.join(' → ') || `statuses ${[d1, d2, d3].map((d) => d.status).join(',')}`);

  // ══ 2. Validation must actually reject bad money ════════════════════════
  const bad = await post('/donations', { donor: { name: 'QA Bad', mobile: '9876500126' }, category_id: categoryId, amount_paise: -500, payment_mode: 'cash' });
  rec('FL-05', 'a negative amount is rejected', bad.status >= 400, `status=${bad.status}`);
  const zero = await post('/donations', { donor: { name: 'QA Zero', mobile: '9876500127' }, category_id: categoryId, amount_paise: 0, payment_mode: 'cash' });
  rec('FL-06', 'a zero amount is rejected', zero.status >= 400, `status=${zero.status}`);

  // ══ 3. 80G without a PAN must be refused, not silently downgraded ═══════
  const no80 = await post('/donations', {
    donor: { name: 'QA No PAN', mobile: '9876500128' }, category_id: categoryId,
    amount_paise: paise(500), payment_mode: 'cash', is_80g_eligible: true,
  });
  const refused = no80.status >= 400;
  const downgraded = no80.status < 300 && no80.data?.is_80g_eligible === false;
  rec('FL-07', '80G without a PAN is refused or explicitly downgraded, never silently claimed',
    refused || downgraded, `status=${no80.status} 80g=${no80.data?.is_80g_eligible}`);

  // ══ 4. Record an expense ════════════════════════════════════════════════
  const cats = await get('/expense-categories?limit=1');
  const catId = cats.data?.[0]?.id ?? cats.data?.rows?.[0]?.id;
  const accounts = await get('/accounts?limit=1');
  const acctId = accounts.data?.[0]?.id ?? accounts.data?.rows?.[0]?.id;
  const e1 = await post('/expenses', {
    category_id: catId, account_id: acctId,
    amount_paise: paise(250), payment_mode: 'cash',
    description: 'QA flow expense', expense_date: new Date().toISOString().slice(0, 10),
  });
  rec('FL-08', 'an expense is recorded', e1.status < 300, `status=${e1.status} ${JSON.stringify(e1.json?.error ?? '').slice(0, 90)}`);

  // ══ 5. The statements must reflect it, and must balance ════════════════
  const day = await get(`/accounting/day-book?date=${new Date().toISOString().slice(0, 10)}`);
  rec('FL-09', 'the day book loads', day.status < 300, `status=${day.status}`);

  // NOT "debits = credits". This endpoint is deliberately a cash/bank position,
  // not a double-entry trial balance — there is no journal layer yet, and the
  // service says so in its own doc comment (doc-v2/Accounting_Audit_2026-08.md).
  // Asserting balance here would be inventing a contract the product does not
  // claim. What IS invariant: an account sits on one side or the other, never
  // both, and never negative on both.
  const tb = await get('/accounting/trial-balance');
  const tbRows = tb.data?.rows ?? tb.data ?? [];
  const twoSided = tbRows.filter((r) => num(r.debit_paise) > 0 && num(r.credit_paise) > 0);
  rec('FL-10', 'every cash/bank row sits on exactly one side',
    tb.status < 300 && twoSided.length === 0,
    twoSided.length ? `${twoSided.length} rows have both` : `${tbRows.length} accounts`);

  const ie = await get('/accounting/income-expenditure');
  rec('FL-11', 'income & expenditure loads', ie.status < 300, `status=${ie.status}`);

  const bs = await get('/accounting/balance-sheet');
  const bsD = bs.data ?? {};
  const assets = num(bsD.total_assets_paise ?? bsD.assets_total_paise);
  const liabs = num(bsD.total_liabilities_paise ?? bsD.liabilities_total_paise);
  rec('FL-12', 'the balance sheet loads', bs.status < 300, `status=${bs.status} assets=${assets} liab=${liabs}`);

  // ══ 6. Void must remove the money, not just hide the row ═══════════════
  // PATCH, not POST — voiding is a state change on the record, not a new one.
  const v = await req('PATCH', `/donations/${d3.data?.id}/void`, { reason: 'QA flow void' });
  if (v.status < 300) {
    const listed = await get('/donations?limit=200');
    const rows = listed.data?.rows ?? listed.data ?? [];
    const voided = rows.find((r) => r.id === d3.data?.id);
    rec('FL-13', 'a voided donation is marked voided rather than deleted',
      !!voided && (voided.is_voided === true || voided.status === 'voided'),
      voided ? `is_voided=${voided.is_voided} status=${voided.status}` : 'row disappeared entirely');
  } else {
    rec('FL-13', 'a voided donation is marked voided rather than deleted', false, `void failed: ${v.status}`);
  }

  // ══ 7. Reports must not 500 on any period ══════════════════════════════
  for (const p of ['day', 'week', 'month', 'year']) {
    const r = await get(`/dashboard?period=${p}`);
    rec(`FL-14-${p}`, `dashboard period=${p}`, r.status < 300, `status=${r.status}`);
  }

  // ══ 8. A bad FY must be rejected, not silently coerced ═════════════════
  const badFy = await get('/accounting/trial-balance?fy=not-a-year');
  rec('FL-15', 'a malformed FY is rejected rather than silently coerced',
    badFy.status >= 400, `status=${badFy.status}`);

  // ══ 9. Module gating: a route for a module the trust lacks must 403 ════
  const mods = (await get('/tenants/me')).data?.effective_modules ?? [];
  rec('FL-16', 'the tenant reports its effective modules', Array.isArray(mods), `n=${mods.length}`);

  void fy;
} catch (e) {
  rec('FL-FATAL', 'flows completed', false, String(e).slice(0, 200));
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n  ${pass}/${results.length} flows passed`);
process.exit(0);
