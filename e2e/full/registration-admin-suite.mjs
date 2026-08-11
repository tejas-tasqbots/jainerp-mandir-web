/**
 * Super-admin operations over the self-serve registration funnel, the payment
 * edge cases, and tenant isolation.
 *
 * The companion to registration-suite.mjs: that one walks the customer's happy
 * path, this one covers everything support and the money actually depend on —
 * re-pricing a negotiated deal, payment links, offline payment, recovering a
 * failed provisioning, duplicate webhooks, superseded orders, and proving one
 * mandir cannot see another's data.
 *
 *   node e2e/full/registration-admin-suite.mjs
 *
 * Requires: superadmin-api :3105, mandir-api :3106, OTP_MOCK=true, no Razorpay
 * keys (mock checkout), and a seeded super admin (`npm run seed` in
 * superadmin-api → admin@tasqbots.com / ChangeMe@123).
 *
 * NOTE: TOTP enrolment is ONE-SHOT. This suite resets it at the start via
 * `resetTotp()` so it can re-enrol; without that the second run cannot log in.
 * That is the same trap documented for the superadmin-web suites.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

/**
 * RFC-6238 TOTP, inline.
 *
 * These runners are deliberately dependency-free plain Node — `otplib` lives in
 * superadmin-api's node_modules, not this app's, and reaching across into
 * another package's tree is exactly the kind of thing that breaks the day
 * somebody runs the suite from a different checkout.
 */
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = A.indexOf(ch);
    if (i < 0) continue;
    bits += i.toString(2).padStart(5, '0');
  }
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

function totp(secret, when = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(when / 1000 / 30)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const code = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

const SA = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';
const M  = process.env.E2E_API    ?? 'http://localhost:3106/api/v1';
const OB = `${SA}/public/onboarding`;
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@tasqbots.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe@123';

const H = (t) => ({ 'Content-Type': 'application/json', ...(t ? { 'x-registration-token': t } : {}) });
const A = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const J = async (r) => { const j = await r.json().catch(() => null); return { s: r.status, d: j?.data, c: j?.error?.code, m: j?.error?.message }; };

/**
 * Retry a call that the per-IP throttle rejected.
 *
 * This suite legitimately drives more registrations and checkouts in a minute
 * than any human would, so it trips the very rate limits it is glad exist. A
 * 429 here is the API behaving correctly — wait for the window and continue,
 * rather than weakening the limit for the sake of the test.
 */
async function unthrottled(fn, tries = 3) {
  for (let i = 1; ; i++) {
    const res = await fn();
    if (res.s !== 429 || i === tries) return res;
    await new Promise((r) => setTimeout(r, 61_000));
  }
}

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, ok });
  console.log(`  ${ok ? '\u2714 PASS' : '\u2718 FAIL'} ${id} [${pri}] ${title}${detail ? ' \u2014 ' + detail : ''}`);
}

/** Clear the one-shot TOTP enrolment so this suite can enrol again. */
function resetTotp() {
  try {
    execFileSync('psql', [
      '-h', process.env.DB_HOST ?? 'localhost',
      '-p', process.env.DB_PORT ?? '5434',
      '-U', process.env.DB_USER ?? 'jainerp',
      '-d', process.env.DB_NAME ?? 'jainerp',
      '-q', '-c', 'update public.super_admin_credentials set totp_secret_enc=null, totp_enrolled_at=null;',
    ], { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD ?? 'jainerp_dev' }, stdio: 'pipe' });
  } catch {
    console.log('  (could not reset TOTP via psql — continuing; a second run may fail to log in)');
  }
}

async function adminToken() {
  const login = await J(await fetch(`${SA}/admin/auth/login`, { method: 'POST', headers: H(), body: JSON.stringify({ identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD }) }));
  if (!login.d?.mfa_token) throw new Error(`super-admin login failed: ${login.m ?? login.s}`);
  const setup = await J(await fetch(`${SA}/admin/auth/mfa/setup`, { method: 'POST', headers: H(), body: JSON.stringify({ mfa_token: login.d.mfa_token }) }));
  if (!setup.d?.otpauth_uri) throw new Error(`MFA setup failed: ${setup.m ?? setup.s}`);
  const secret = new URL(setup.d.otpauth_uri.replace('otpauth://', 'https://')).searchParams.get('secret');
  const ver = await J(await fetch(`${SA}/admin/auth/mfa/verify`, { method: 'POST', headers: H(), body: JSON.stringify({ mfa_token: login.d.mfa_token, type: 'totp', code: totp(secret) }) }));
  if (!ver.d?.access_token) throw new Error(`MFA verify failed: ${ver.m ?? ver.s}`);
  return ver.d.access_token;
}

/** Register → verify mobile → pick a plan. Leaves the registration unpaid. */
async function newRegistration(tag) {
  const run = Date.now().toString().slice(-8);
  const r = await unthrottled(async () => J(await fetch(`${OB}/registrations`, { method: 'POST', headers: H(), body: JSON.stringify({
    trust_name: `E2E ${tag} ${run}`, admin_name: `E2E ${tag}`, admin_mobile: `9${tag}${run}`,
  }) })));
  if (!r.d?.id) throw new Error(`could not create registration: ${r.m ?? r.s}`);
  const id = r.d.id, tok = r.d.claim_token;
  const sent = await unthrottled(async () => J(await fetch(`${OB}/registrations/${id}/send-otp`, { method: 'POST', headers: H(tok) })));
  if (!sent.d?.dev_otp) throw new Error(`no dev_otp for ${id} (OTP_MOCK must be true): HTTP ${sent.s} ${sent.m ?? ''}`);
  const verified = await J(await fetch(`${OB}/registrations/${id}/verify-otp`, { method: 'POST', headers: H(tok), body: JSON.stringify({ otp: sent.d.dev_otp }) }));
  if (!verified.d?.mobile_verified) throw new Error(`mobile not verified for ${id}: HTTP ${verified.s} ${verified.m ?? ''}`);
  const planned = await J(await fetch(`${OB}/registrations/${id}/plan`, { method: 'POST', headers: H(tok), body: JSON.stringify({ plan: 'standard', billing_cycle: 'yearly' }) }));
  if (!planned.d?.plan_name) throw new Error(`plan not selected for ${id}: HTTP ${planned.s} ${planned.m ?? ''}`);
  return { id, tok, mobile: r.d.admin_mobile };
}

/** Pay a registration in mock mode and sign in to the mandir it creates. */
async function payAndLogin(reg) {
  const co = await unthrottled(async () => J(await fetch(`${OB}/registrations/${reg.id}/checkout`, { method: 'POST', headers: H(reg.tok) })));
  if (!co.d?.checkout) throw new Error(`checkout failed for ${reg.id}: ${co.m ?? co.s}`);
  const p = await J(await fetch(`${OB}/registrations/${reg.id}/verify-payment`, { method: 'POST', headers: H(reg.tok), body: JSON.stringify({
    razorpay_order_id: co.d.checkout.razorpay_order_id, razorpay_payment_id: `pay_mock_${Date.now()}`, razorpay_signature: 'mock',
  }) }));
  const mob = reg.mobile.replace('+91', '');
  const so = await (await fetch(`${M}/auth/send-otp`, { method: 'POST', headers: H(), body: JSON.stringify({ mobile: mob, purpose: 'login' }) })).json();
  const vo = await (await fetch(`${M}/auth/verify-otp`, { method: 'POST', headers: H(), body: JSON.stringify({ mobile: mob, otp: so.data.dev_otp }) })).json();
  const sel = await (await fetch(`${M}/auth/select-tenant`, { method: 'POST', headers: H(), body: JSON.stringify({ selection_token: vo.data.selection_token, tenant_slug: p.d.tenant_slug }) })).json();
  return { ...p.d, token: sel.data.access_token };
}

async function main() {
  console.log('\nSuper-admin operations, payment edges & tenant isolation\n');
  resetTotp();
  const T = await adminToken();
  record('SA-01', 'P1', 'Super admin signs in (password + TOTP)', !!T);

  // ---------------- re-pricing a negotiated deal ----------------
  const a = await newRegistration('1');
  const list = await J(await fetch(`${SA}/admin/registrations?status=plan_selected`, { headers: A(T) }));
  record('SA-02', 'P1', 'Registration appears in the console funnel', (list.d ?? []).some((r) => r.id === a.id));

  const revised = await J(await fetch(`${SA}/admin/registrations/${a.id}/quote`, { method: 'PATCH', headers: A(T), body: JSON.stringify({
    subtotal_paise: 500000, discount_paise: 50000, note: 'Negotiated launch price' }) }));
  // net 450000 -> GST 18% = 81000 -> total 531000. GST is charged on the NET.
  record('SA-03', 'P1', 'Re-price recalculates GST on the NET', Number(revised.d?.total_paise) === 531000,
    `gst=${revised.d?.gst_amount_paise} total=${revised.d?.total_paise}`);

  const seen = await J(await fetch(`${OB}/registrations/${a.id}/status`, { headers: H(a.tok) }));
  record('SA-04', 'P1', 'The applicant sees the revised price and its reason',
    Number(seen.d?.quote?.total_paise) === 531000 && seen.d?.quote?.note === 'Negotiated launch price');

  const link = await J(await fetch(`${SA}/admin/registrations/${a.id}/payment-link`, { method: 'POST', headers: A(T), body: JSON.stringify({ channel: ['whatsapp'] }) }));
  record('SA-05', 'P1', 'Payment link is created for the revised amount',
    !!link.d?.short_url && Number(link.d?.amount_paise) === 531000);

  const mp = await J(await fetch(`${SA}/admin/registrations/${a.id}/mark-paid`, { method: 'POST', headers: A(T), body: JSON.stringify({
    payment_method: 'neft', payment_ref: 'UTR12345678', note: 'Cleared by bank' }) }));
  record('SA-06', 'P1', 'Offline (NEFT) payment onboards the trust', mp.d?.status === 'active' && !!mp.d?.tenant_id);

  const inv = await (await fetch(`${OB}/registrations/${a.id}/invoice?token=${encodeURIComponent(a.tok)}`)).text();
  record('SA-07', 'P1', 'Invoice shows the discount AND why it was given',
    inv.includes('Less: Discount') && inv.includes('Negotiated launch price'));
  record('SA-08', 'P1', 'Invoice shows NEFT + the UTR reference', inv.includes('NEFT') && inv.includes('UTR12345678'));
  record('SA-09', 'P1', 'Invoice total matches the negotiated amount', inv.includes('5,310.00'));

  const late = await J(await fetch(`${SA}/admin/registrations/${a.id}/quote`, { method: 'PATCH', headers: A(T), body: JSON.stringify({ subtotal_paise: 1 }) }));
  record('SA-10', 'P1', 'A PAID registration cannot be re-priced', late.s === 409 && late.c === 'ALREADY_PAID');

  // ---------------- re-pricing an existing tenant's unpaid invoice ----------------
  await J(await fetch(`${SA}/admin/tenants/${mp.d.tenant_id}/plan`, { method: 'PATCH', headers: A(T), body: JSON.stringify({ plan: 'enterprise', effective: 'immediate' }) }));
  const invoices = await J(await fetch(`${SA}/admin/tenants/${mp.d.tenant_id}/invoices?status=unpaid`, { headers: A(T) }));
  const unpaid = (invoices.d ?? [])[0];
  record('SA-11', 'P1', 'A plan upgrade raises an unpaid invoice', !!unpaid, unpaid?.invoiceNumber);
  if (unpaid) {
    const rp = await J(await fetch(`${SA}/admin/invoices/${unpaid.id}`, { method: 'PATCH', headers: A(T), body: JSON.stringify({
      subtotal_paise: 1000000, discount_paise: 100000, discount_note: 'Loyalty discount' }) }));
    record('SA-12', 'P1', 'An unpaid tenant invoice can be re-priced', Number(rp.d?.total_paise) === 1062000, `total=${rp.d?.total_paise}`);
    const done = await J(await fetch(`${SA}/admin/invoices/${unpaid.id}/mark-paid`, { method: 'POST', headers: A(T), body: JSON.stringify({ payment_method: 'cheque', payment_ref: 'CHQ-99' }) }));
    record('SA-13', 'P1', 'It can then be marked paid', done.d?.status === 'paid');
    const again = await J(await fetch(`${SA}/admin/invoices/${unpaid.id}`, { method: 'PATCH', headers: A(T), body: JSON.stringify({ subtotal_paise: 1 }) }));
    record('SA-14', 'P1', 'A PAID invoice cannot be re-priced', again.s === 409 && again.c === 'NOT_UNPAID');
  }

  // ---------------- custom request queue ----------------
  const cr = await J(await fetch(`${OB}/custom-requests`, { method: 'POST', headers: H(), body: JSON.stringify({
    trust_name: `Multi Trust ${Date.now()}`, contact_name: 'Multi Admin', mobile: '9800000009',
    num_mandirs: 5, needs_separate_dbs: true, modules: ['dharamshala', 'gaushala'],
    special_requirements: 'We have 5 Mandirs and require a centralized system.' }) }));
  const crList = await J(await fetch(`${SA}/admin/custom-requests?status=new`, { headers: A(T) }));
  const mineCr = (crList.d ?? []).find((r) => r.reference === cr.d?.reference);
  record('SA-15', 'P1', 'Custom request lands in the console queue', !!mineCr, cr.d?.reference);
  record('SA-16', 'P1', 'with scale + modules captured, and NO tenant created',
    mineCr?.num_mandirs === 5 && mineCr?.needs_separate_dbs === true && (mineCr?.modules ?? []).length === 2 && !mineCr?.tenant_id);
  const upd = await J(await fetch(`${SA}/admin/custom-requests/${mineCr.id}`, { method: 'PATCH', headers: A(T), body: JSON.stringify({
    status: 'contacted', internal_notes: 'Called', follow_up_at: '2026-08-20T00:00:00.000Z' }) }));
  record('SA-17', 'P2', 'It moves through the follow-up pipeline', upd.d?.status === 'contacted');

  const over = await J(await fetch(`${SA}/admin/registrations?limit=99999`, { headers: A(T) }));
  record('SA-18', 'P2', 'An oversized page limit is rejected', over.s === 400);

  // ---------------- payment edges ----------------
  const b = await newRegistration('2');
  await unthrottled(async () => J(await fetch(`${OB}/registrations/${b.id}/checkout`, { method: 'POST', headers: H(b.tok) })));
  const cancelled = await J(await fetch(`${OB}/registrations/${b.id}/payment-failed`, { method: 'POST', headers: H(b.tok), body: JSON.stringify({ outcome: 'cancelled' }) }));
  record('PAY-01', 'P1', 'Cancelling checkout marks payment_failed', cancelled.d?.status === 'payment_failed');
  record('PAY-02', 'P1', 'and says plainly that no money was taken', /not been charged/i.test(cancelled.d?.message || ''));

  const retry = await unthrottled(async () => J(await fetch(`${OB}/registrations/${b.id}/checkout`, { method: 'POST', headers: H(b.tok) })));
  record('PAY-03', 'P1', 'Payment can be retried after a cancellation', retry.s === 200 && !!retry.d?.checkout?.razorpay_order_id, `HTTP ${retry.s} ${retry.c ?? ''} ${retry.m ?? ''}`.trim());
  if (!retry.d?.checkout) throw new Error(`checkout retry failed: HTTP ${retry.s} ${retry.c ?? ''} ${retry.m ?? ''}`);
  const paid = await J(await fetch(`${OB}/registrations/${b.id}/verify-payment`, { method: 'POST', headers: H(b.tok), body: JSON.stringify({
    razorpay_order_id: retry.d.checkout.razorpay_order_id, razorpay_payment_id: `pay_retry_${Date.now()}`, razorpay_signature: 'mock' }) }));
  record('PAY-04', 'P1', 'The retry onboards normally', paid.d?.status === 'active');
  const lateCancel = await J(await fetch(`${OB}/registrations/${b.id}/payment-failed`, { method: 'POST', headers: H(b.tok), body: JSON.stringify({ outcome: 'cancelled' }) }));
  record('PAY-05', 'P1', 'A late cancel cannot downgrade a PAID registration', lateCancel.d?.status === 'active');

  // Webhook-only onboarding (browser never came back), then a duplicate delivery.
  const c = await newRegistration('3');
  const co = await unthrottled(async () => J(await fetch(`${OB}/registrations/${c.id}/checkout`, { method: 'POST', headers: H(c.tok) })));
  const hook = { event: 'payment.captured', payload: { payment: { entity: {
    id: `pay_wh_${Date.now()}`, order_id: co.d.checkout.razorpay_order_id, method: 'upi', amount: co.d.checkout.amount_paise } } } };
  const w1 = await fetch(`${SA}/webhooks/razorpay`, { method: 'POST', headers: H(), body: JSON.stringify(hook) });
  await new Promise((r) => setTimeout(r, 2500));
  const afterW1 = await J(await fetch(`${OB}/registrations/${c.id}/status`, { headers: H(c.tok) }));
  record('PAY-06', 'P1', 'The webhook alone onboards when the browser never returns',
    afterW1.d?.status === 'active' && !!afterW1.d?.tenant_id, afterW1.d?.tenant_slug);
  const w2 = await fetch(`${SA}/webhooks/razorpay`, { method: 'POST', headers: H(), body: JSON.stringify(hook) });
  await new Promise((r) => setTimeout(r, 2000));
  const afterW2 = await J(await fetch(`${OB}/registrations/${c.id}/status`, { headers: H(c.tok) }));
  record('PAY-07', 'P1', 'A DUPLICATE webhook creates no second tenant', afterW2.d?.tenant_id === afterW1.d?.tenant_id);
  record('PAY-08', 'P1', 'Both webhook deliveries are acked', w1.status === 200 && w2.status === 200);

  // A payment against an order superseded by a re-price.
  const d = await newRegistration('4');
  const oldCo = await unthrottled(async () => J(await fetch(`${OB}/registrations/${d.id}/checkout`, { method: 'POST', headers: H(d.tok) })));
  await J(await fetch(`${SA}/admin/registrations/${d.id}/quote`, { method: 'PATCH', headers: A(T), body: JSON.stringify({ subtotal_paise: 200000, note: 'Revised' }) }));
  await fetch(`${SA}/webhooks/razorpay`, { method: 'POST', headers: H(), body: JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: {
    id: `pay_old_${Date.now()}`, order_id: oldCo.d.checkout.razorpay_order_id, method: 'card', amount: oldCo.d.checkout.amount_paise } } } }) });
  await new Promise((r) => setTimeout(r, 2000));
  const afterOld = await J(await fetch(`${OB}/registrations/${d.id}/status`, { headers: H(d.tok) }));
  record('PAY-09', 'P1', 'Money on a SUPERSEDED order is still attributed', afterOld.d?.status === 'paid');
  record('PAY-10', 'P1', 'but is NOT auto-provisioned when it differs from the quote', !afterOld.d?.tenant_id);

  // ---------------- tenant isolation ----------------
  const t1 = await payAndLogin(await newRegistration('5'));
  await new Promise((r) => setTimeout(r, 1200));
  const t2 = await payAndLogin(await newRegistration('6'));
  record('ISO-01', 'P1', 'Two mandirs onboard independently', t1.tenant_id !== t2.tenant_id);

  await J(await fetch(`${M}/donations`, { method: 'POST', headers: A(t1.token), body: JSON.stringify({
    donor: { name: 'Isolation Donor', mobile: '9800000001' }, amount_paise: 100000, payment_mode: 'cash',
    donation_date: new Date().toISOString().slice(0, 10), category: 'general' }) }));
  const l1 = await J(await fetch(`${M}/donations?limit=50`, { headers: A(t1.token) }));
  const l2 = await J(await fetch(`${M}/donations?limit=50`, { headers: A(t2.token) }));
  record('ISO-02', 'P1', 'Mandir A sees its own donation', JSON.stringify(l1.d ?? []).includes('Isolation Donor'));
  record('ISO-03', 'P1', "Mandir B CANNOT see mandir A's donation", !JSON.stringify(l2.d ?? []).includes('Isolation Donor'));
  const cross = await fetch(`${M}/tenants/me/invoices/${t1.invoice_id}/receipt`, { headers: A(t2.token) });
  record('ISO-04', 'P1', "Mandir B cannot fetch mandir A's subscription invoice", cross.status === 404 || cross.status === 403, `HTTP ${cross.status}`);

  const failed = results.filter((r) => !r.ok);
  const p1 = failed.filter((r) => r.pri === 'P1');
  console.log(`\n  ${results.length - failed.length}/${results.length} passed` + (failed.length ? ` \u2014 ${failed.length} failed (${p1.length} P1)` : ''));
  process.exit(p1.length ? 1 : 0);
}

main().catch((e) => { console.error('\n  SUITE ERROR:', e.message); process.exit(1); });
