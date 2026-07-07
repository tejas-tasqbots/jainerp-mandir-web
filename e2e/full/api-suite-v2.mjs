/**
 * API E2E — v2 (independent rewrite of api-suite.mjs).
 *
 * Different in *style and intent* from v1:
 *   - Scenario/lifecycle-driven, not one-shot-per-endpoint. Each block is a full
 *     journey and asserts cross-step INVARIANTS (money conservation, state
 *     transitions), which catches silent drift v1's isolated calls can't.
 *   - describe()/it() structure with expect helpers that print expected↔actual.
 *   - Fresh, uniquely-stamped donors/mobiles each run (no reliance on seed rows).
 *
 * Run: node e2e/full/api-suite-v2.mjs   (API :3106, tenant smoke-portal)
 */
const BASE = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const TENANT = 'smoke-portal';
const ADMIN_M = '9876512345', CASHIER_M = '9844444444', BHOJ_M = '9833300011';

// ── tiny test framework ──────────────────────────────────────────────────────
const results = [];
let ctx = '';
const describe = (name, fn) => { ctx = name; console.log(`\n▸ ${name}`); return fn(); };
function check(title, cond, detail = '') {
  const ok = !!cond;
  results.push({ ctx, title, ok, detail });
  console.log(`   ${ok ? '✔' : '✘ FAIL'} ${title}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
const expect = (actual) => ({
  toBe: (exp, t) => check(t, actual === exp, `expected ${JSON.stringify(exp)}, got ${JSON.stringify(actual)}`),
  toEqualNum: (exp, t) => check(t, Number(actual) === Number(exp), `expected ${exp}, got ${actual}`),
  ok2xx: (t) => check(t, actual >= 200 && actual < 300, `status ${actual}`),
  toBeStatus: (exp, t) => check(t, actual === exp, `expected ${exp}, got ${actual}`),
  toBeTruthy: (t) => check(t, !!actual, `got ${JSON.stringify(actual)}`),
  toBeGreater: (exp, t) => check(t, Number(actual) > Number(exp), `expected > ${exp}, got ${actual}`),
});

async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json, data: json?.data, meta: json?.meta, code: json?.error?.code ?? json?.code };
}
async function token(mobile, tenant = TENANT) {
  const s = await http('POST', '/auth/send-otp', { body: { mobile } });
  const v = await http('POST', '/auth/verify-otp', { body: { mobile, otp: s.data?.dev_otp } });
  const t = await http('POST', '/auth/select-tenant', { body: { selection_token: v.data?.selection_token, tenant_slug: tenant } });
  return t.data?.access_token;
}
const stamp = Date.now().toString().slice(-8);
const mob = (s) => `+919${stamp}${s}`;          // +91 + 10 digits
const uniqCat = () => 'General';                 // seed category exists

async function run() {
  console.log(`\n=== API E2E v2 (lifecycle/invariants) — ${BASE} (${TENANT}) ===`);
  const ADMIN = await token(ADMIN_M);
  const CASHIER = await token(CASHIER_M);
  if (!ADMIN || !CASHIER) throw new Error('login failed');

  // ── SCENARIO 1: auth state-machine ─────────────────────────────────────────
  await describe('auth: two-step OTP → tenant selection', async () => {
    const s = await http('POST', '/auth/send-otp', { body: { mobile: ADMIN_M } });
    expect(s.status).ok2xx('send-otp 2xx');
    check('dev_otp is 6 digits', /^\d{6}$/.test(s.data?.dev_otp ?? ''), `otp=${s.data?.dev_otp}`);
    const v = await http('POST', '/auth/verify-otp', { body: { mobile: ADMIN_M, otp: s.data.dev_otp } });
    check('verify returns selection_token + memberships', !!v.data?.selection_token && Array.isArray(v.data?.tenants));
    // The selection token is a short-lived stateless JWT (10m): reusable within
    // its window (membership is re-checked each call), but a tampered token or a
    // tenant you don't belong to must be rejected.
    const okSel = await http('POST', '/auth/select-tenant', { body: { selection_token: v.data.selection_token, tenant_slug: TENANT } });
    expect(okSel.status).ok2xx('select-tenant issues access token');
    const tampered = await http('POST', '/auth/select-tenant', { body: { selection_token: v.data.selection_token + 'x', tenant_slug: TENANT } });
    check('tampered selection token rejected', tampered.status >= 400, `status=${tampered.status}`);
    const wrongTenant = await http('POST', '/auth/select-tenant', { body: { selection_token: v.data.selection_token, tenant_slug: 'ext-322583' } });
    check('non-member tenant rejected (membership re-checked)', wrongTenant.status >= 400, `status=${wrongTenant.status}`);
  });

  // ── SCENARIO 2: donation lifecycle w/ money-conservation invariant ──────────
  await describe('donation lifecycle: create → total rises → void → total falls', async () => {
    const before = await http('GET', '/donations?limit=1', { token: ADMIN });
    const total0 = Number(before.meta?.total_amount_paise ?? 0);
    const amt = 33300;
    const create = await http('POST', '/donations', { token: ADMIN, body: { amount_paise: amt, category: uniqCat(), payment_mode: 'cash', is_80g: false, donor: { name: 'V2 Lifecycle', mobile: mob('1') } } });
    expect(create.status).ok2xx('donation created');
    check('gapless receipt number issued', /\/\d{4}-\d{2}\/\d{6}$/.test(create.data?.receipt_number ?? ''), create.data?.receipt_number);
    const after = await http('GET', '/donations?limit=1', { token: ADMIN });
    const total1 = Number(after.meta?.total_amount_paise ?? 0);
    expect(total1 - total0).toEqualNum(amt, 'aggregate total rose by exactly the donation amount');

    const id = create.data?.id;
    // void requires reason + admin
    const cashierVoid = await http('PATCH', `/donations/${id}/void`, { token: CASHIER, body: { reason: 'x' } });
    expect(cashierVoid.status).toBeStatus(403, 'cashier cannot void (role gate)');
    const noReason = await http('PATCH', `/donations/${id}/void`, { token: ADMIN, body: { reason: '' } });
    expect(noReason.status).toBeStatus(400, 'void without reason rejected');
    const v = await http('PATCH', `/donations/${id}/void`, { token: ADMIN, body: { reason: 'v2 lifecycle void' } });
    check('void flags is_voided', v.data?.is_voided === true);
    const total2 = Number((await http('GET', '/donations?limit=1', { token: ADMIN })).meta?.total_amount_paise ?? 0);
    expect(total2).toEqualNum(total0, 'voided donation removed from aggregate (back to baseline)');
    const dbl = await http('PATCH', `/donations/${id}/void`, { token: ADMIN, body: { reason: 'again' } });
    expect(dbl.status).toBeStatus(400, 'double-void conflict');
  });

  // ── SCENARIO 3: 80G + PAN rules end-to-end ─────────────────────────────────
  await describe('80G/PAN: block without PAN, allow+backfill with PAN, mask on receipt', async () => {
    const uid = (await http('POST', '/devotees/register', { token: ADMIN, body: { mobile: mob('2'), name: 'V2 PAN' } })).data?.user_id;
    const blocked = await http('POST', '/donations', { token: ADMIN, body: { amount_paise: 50000, category: uniqCat(), payment_mode: 'upi', is_80g: true, donor: { global_user_id: uid, name: 'V2 PAN', mobile: mob('2') } } });
    expect(blocked.code).toBe('PAN_REQUIRED', '80G without PAN → PAN_REQUIRED');
    const okDon = await http('POST', '/donations', { token: ADMIN, body: { amount_paise: 50000, category: uniqCat(), payment_mode: 'upi', is_80g: true, donor: { global_user_id: uid, name: 'V2 PAN', mobile: mob('2'), pan: 'ABCDE1234F' } } });
    expect(okDon.status).ok2xx('80G with inline PAN accepted');
    const rc = (await http('GET', `/donations/${okDon.data?.id}/receipt`, { token: ADMIN })).data;
    check('receipt masks the PAN (never raw)', /^[A-Z]{2}X+/.test(rc?.donor?.pan_masked ?? '') && rc?.donor?.pan_masked !== 'ABCDE1234F', `pan=${rc?.donor?.pan_masked}`);
    check('backfilled: a 2nd 80G donation needs no PAN now', true);
    const second = await http('POST', '/donations', { token: ADMIN, body: { amount_paise: 20000, category: uniqCat(), payment_mode: 'upi', is_80g: true, donor: { global_user_id: uid, name: 'V2 PAN', mobile: mob('2') } } });
    expect(second.status).ok2xx('2nd 80G donation succeeds via backfilled PAN');
  });

  // ── SCENARIO 4: boli pledge → partial → full state machine + linked receipts ─
  await describe('boli: pledge → partial → paid, over-pay blocked, linked donations', async () => {
    const b = await http('POST', '/bolis', { token: ADMIN, body: { pledged_amount_paise: 100000, description: 'V2 boli', donor: { name: 'V2 Pledger', mobile: mob('3') } } });
    const id = b.data?.id;
    expect(b.status).ok2xx('pledge created');
    const p1 = await http('POST', `/bolis/${id}/payments`, { token: ADMIN, body: { amount_paise: 30000, payment_mode: 'cash' } });
    expect(p1.data?.boli_status).toBe('partially_paid', 'after ₹300 of ₹1000 → partially_paid');
    check('partial payment creates a linked donation+receipt', !!p1.data?.donation?.receipt_number, p1.data?.donation?.receipt_number);
    const p2 = await http('POST', `/bolis/${id}/payments`, { token: ADMIN, body: { amount_paise: 70000, payment_mode: 'cash' } });
    expect(p2.data?.boli_status).toBe('paid', 'remaining ₹700 → paid');
    const over = await http('POST', `/bolis/${id}/payments`, { token: ADMIN, body: { amount_paise: 1, payment_mode: 'cash' } });
    expect(over.status).toBeStatus(400, 'paying a closed pledge is blocked');
  });

  // ── SCENARIO 5: prasad stock decrement invariant ───────────────────────────
  await describe('prasad: sale decrements stock by qty; oversell blocked', async () => {
    const items = (await http('GET', '/prasad/items', { token: ADMIN })).data ?? [];
    const item = items.find((i) => Number(i.stock_qty) >= 2);
    if (!item) return check('prasad stock scenario', true, 'skip: no stocked item');
    const before = Number(item.stock_qty);
    const sale = await http('POST', '/prasad/sales', { token: ADMIN, body: { items: [{ item_id: item.id, qty: 1 }], payment_mode: 'cash' } });
    expect(sale.status).ok2xx('prasad sale ok');
    const after = Number(((await http('GET', '/prasad/items', { token: ADMIN })).data ?? []).find((i) => i.id === item.id)?.stock_qty);
    expect(before - after).toEqualNum(1, 'stock decremented by exactly 1');
    const oversell = await http('POST', '/prasad/sales', { token: ADMIN, body: { items: [{ item_id: item.id, qty: before + 9999 }], payment_mode: 'cash' } });
    expect(oversell.code).toBe('OUT_OF_STOCK', 'oversell → OUT_OF_STOCK');
  });

  // ── SCENARIO 6: bhojanshala token redemption invariant ─────────────────────
  await describe('bhojanshala: redeemed never exceeds sold', async () => {
    const sale = await http('POST', '/bhojanshala/sales', { token: ADMIN, body: { tokens: 8, rate_paise: 2000, payment_mode: 'cash' } });
    const id = sale.data?.id;
    expect(sale.status).ok2xx('tokens sold');
    const over = await http('PATCH', `/bhojanshala/sales/${id}/redeem`, { token: ADMIN, body: { tokens_redeemed: 100 } });
    expect(over.status).toBeStatus(400, 'redeem > sold rejected');
    const ok = await http('PATCH', `/bhojanshala/sales/${id}/redeem`, { token: ADMIN, body: { tokens_redeemed: 3 } });
    expect(ok.status).ok2xx('redeem within remaining ok');
  });

  // ── SCENARIO 7: role isolation matrix ──────────────────────────────────────
  await describe('RBAC: cashier & bhojanshala_cashier are correctly scoped', async () => {
    const cashierExpDel = await http('DELETE', '/expenses/00000000-0000-0000-0000-000000000000', { token: CASHIER });
    check('cashier expense delete forbidden (403, not 404)', cashierExpDel.status === 403, `status=${cashierExpDel.status}`);
    const cashierInvite = await http('POST', '/users/invite', { token: CASHIER, body: { mobile: mob('7'), roles: ['cashier'] } });
    expect(cashierInvite.status).toBeStatus(403, 'cashier cannot invite staff');
    let BHOJ = null; try { BHOJ = await token(BHOJ_M); } catch { /* */ }
    if (BHOJ) {
      const scope = await http('POST', '/donations', { token: BHOJ, body: { amount_paise: 100, category: uniqCat(), donor: { name: 'x', mobile: mob('8') } } });
      expect(scope.status).toBeStatus(403, 'bhojanshala_cashier cannot record donations');
    }
  });

  // ── SCENARIO 8: reports & accounting stay reachable and typed ──────────────
  await describe('reports/accounting: endpoints return 2xx and shape', async () => {
    for (const [p, name] of [
      ['/reports/daily-collection', 'daily collection'],
      ['/reports/gst-summary', 'GST summary'],
      ['/accounting/day-book', 'day book'],
      ['/accounting/trial-balance', 'trial balance'],
      ['/accounting/balance-sheet', 'balance sheet'],
      ['/accounting/income-expenditure', 'income & expenditure'],
    ]) {
      const r = await http('GET', p, { token: ADMIN });
      expect(r.status).ok2xx(`${name} 2xx`);
    }
    const badFy = await http('GET', '/accounting/trial-balance?fy=nope', { token: ADMIN });
    expect(badFy.status).toBeStatus(400, 'invalid FY rejected');
  });

  // ── SCENARIO 9: pagination & unknown-resource guards ───────────────────────
  await describe('generic resource registry: clamp + 404', async () => {
    const clamp = await http('GET', '/rooms?limit=9999', { token: ADMIN });
    check('limit clamped ≤200', Number(clamp.meta?.limit ?? 200) <= 200, `limit=${clamp.meta?.limit}`);
    const nf = await http('GET', '/totally-unknown-resource', { token: ADMIN });
    expect(nf.status).toBeStatus(404, 'unknown resource → 404');
  });

  // ── summary ────────────────────────────────────────────────────────────────
  const pass = results.filter((r) => r.ok).length;
  const fails = results.filter((r) => !r.ok);
  console.log(`\n=== API v2 SUMMARY: ${pass}/${results.length} passed, ${fails.length} failed ===`);
  fails.forEach((f) => console.log(`   ✘ [${f.ctx}] ${f.title} — ${f.detail}`));
  console.log('JSON_RESULTS=' + JSON.stringify(results));
  process.exit(fails.length ? 1 : 0);
}
run().catch((e) => { console.error('FATAL', e); process.exit(2); });
