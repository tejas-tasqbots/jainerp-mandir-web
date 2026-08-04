/**
 * Functional API E2E — receipt numbering for ONLINE (Razorpay) donations.
 *
 * A donation taken at the counter has always drawn a gapless, row-locked receipt
 * number from {s}.invoice_series. A donation paid online did not — the webhook
 * recorder inserted the row with invoice_no NULL (GAP-1), so those donations
 * could not be printed or reconciled against the register. This suite drives the
 * real webhook and asserts the online rail now behaves exactly like the counter:
 *
 *   devotee-api     (:3107) — POST /webhooks/razorpay (payment.captured), and the
 *                             devotee's own transaction history + receipt
 *   mandir-api (:3106) — the temple's donation register, where the online
 *                             donation must appear with a number in the series
 *
 * Everything asserts over HTTP — no direct DB access — so it runs against any
 * environment. Nothing is deleted afterwards: a donation is a money record and
 * deleting one would leave the very gap this suite exists to prevent. The rows
 * it creates are ordinary small online donations in the smoke-portal tenant.
 *
 *   node e2e/full/online-donation-receipt-suite.mjs
 *
 * Emits one line per case: PASS/FAIL <ODR-ID> <title>. Exit 1 if any P1 fails.
 */
import { createHmac } from 'crypto';

const MANDIR = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const DEVOTEE = process.env.E2E_DEVOTEE_API ?? 'http://localhost:3107/api/v1';
const TENANT = 'smoke-portal';
const ADMIN_MOBILE = '9876512345';
// Must match RAZORPAY_WEBHOOK_SECRET in devotee-api's env. Empty secret =
// signature check skipped (dev default), so an empty value still works.
const WEBHOOK_SECRET = process.env.E2E_RAZORPAY_WEBHOOK_SECRET ?? 'xxx';
const DEVOTEE_MOBILE = process.env.E2E_DEVOTEE_MOBILE ?? '9812345670';

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function http(base, method, path, { token, body, headers } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body ?? undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, json, text, data: json?.data, code: json?.error?.code ?? json?.code };
}
const m = (method, path, opts) => http(MANDIR, method, path, opts);
const d = (method, path, opts) => http(DEVOTEE, method, path, opts);
const rowsOf = (r) => (Array.isArray(r.data) ? r.data : r.data?.rows ?? []);

async function mandirLogin(mobile, tenant = TENANT) {
  const send = await m('POST', '/auth/send-otp', { body: JSON.stringify({ mobile }) });
  const otp = send.data?.dev_otp;
  if (!otp) throw new Error(`mandir no dev_otp for ${mobile}: ${JSON.stringify(send.json)}`);
  const ver = await m('POST', '/auth/verify-otp', { body: JSON.stringify({ mobile, otp }) });
  const r = await m('POST', '/auth/select-tenant', {
    body: JSON.stringify({ selection_token: ver.data?.selection_token, tenant_slug: tenant }),
  });
  if (!r.data?.access_token) throw new Error(`mandir login failed: ${JSON.stringify(r.json)}`);
  return r.data.access_token;
}

async function devoteeLogin(mobile) {
  const send = await d('POST', '/auth/send-otp', { body: JSON.stringify({ mobile }) });
  const otp = send.data?.dev_otp;
  if (!otp) throw new Error(`devotee no dev_otp: ${JSON.stringify(send.json)}`);
  const ver = await d('POST', '/auth/verify-otp', {
    body: JSON.stringify({ mobile, otp, device_id: crypto.randomUUID(), device_name: 'e2e', platform: 'web' }),
  });
  if (!ver.data?.access_token) throw new Error(`devotee login failed: ${JSON.stringify(ver.json)}`);
  return ver.data.access_token;
}

/** Deliver a signed Razorpay payment.captured event, exactly as Razorpay would. */
async function webhook(paymentId, amountPaise, notes) {
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, amount: amountPaise, notes } } },
  });
  return d('POST', '/webhooks/razorpay', {
    body,
    headers: { 'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(body)).digest('hex') },
  });
}

/** The temple's donation register, newest first — our view of what was recorded. */
async function findDonation(adminToken, invoiceNo) {
  const list = await m('GET', `/donations?q=${encodeURIComponent(invoiceNo)}&limit=50`, { token: adminToken });
  return rowsOf(list).find((r) => r.invoice_no === invoiceNo) ?? null;
}

/** Highest DON/<fy>/NNNNNN currently issued, so we can assert "the next one". */
async function latestDonationNo(adminToken) {
  const list = await m('GET', '/donations?limit=50&sort=invoice:desc', { token: adminToken });
  const nums = rowsOf(list)
    .map((r) => r.invoice_no)
    .filter((n) => typeof n === 'string' && n.startsWith('DON/'))
    .map((n) => Number(n.split('/')[2]))
    .filter((n) => Number.isFinite(n));
  return nums.length ? Math.max(...nums) : 0;
}

async function run() {
  console.log(`\n=== Online donation receipt numbering — mandir ${MANDIR} / devotee ${DEVOTEE} (${TENANT}) ===\n`);

  const ADMIN = await mandirLogin(ADMIN_MOBILE);
  const DEV_TOKEN = await devoteeLogin(DEVOTEE_MOBILE);

  const me = await d('GET', '/me', { token: DEV_TOKEN });
  const devoteeId = me.data?.id;
  const temple = await d('GET', `/temples/${TENANT}`, { token: DEV_TOKEN });
  const tenantId = temple.data?.id;
  record('ODR-00', 'P1', 'fixtures: devotee + visible temple resolved',
    !!devoteeId && !!tenantId, `devotee=${!!devoteeId} tenant=${!!tenantId}`);
  if (!devoteeId || !tenantId) {
    console.log('\nAborting — fixtures unavailable.');
    process.exit(1);
  }

  const notes = { tenant_id: tenantId, devotee_id: devoteeId, category: 'general', remarks: 'E2E online donation' };
  const before = await latestDonationNo(ADMIN);

  // ---------- a captured payment becomes a numbered receipt ----------
  const pid = `pay_e2e_odr_${Date.now()}`;
  const hook = await webhook(pid, 51100, notes);
  record('ODR-01', 'P1', 'webhook accepts a signed payment.captured event',
    hook.status === 200 || hook.status === 201, `status=${hook.status}`);

  const expected = `DON/${fyOfToday()}/${String(before + 1).padStart(6, '0')}`;
  const donation = await findDonation(ADMIN, expected);
  record('ODR-02', 'P1', 'the online donation appears in the temple register with a receipt number',
    !!donation, `expected=${expected} found=${!!donation}`);
  record('ODR-03', 'P1', 'the number is the next in the same series the counter uses',
    donation?.invoice_no === expected, `invoice_no=${donation?.invoice_no}`);
  record('ODR-04', 'P1', 'it is recorded as an online donation for the captured amount',
    donation?.source === 'online' && Number(donation?.amount_paise) === 51100,
    `source=${donation?.source} amount=${donation?.amount_paise}`);

  // ---------- the devotee can actually print it ----------
  const txns = await d('GET', '/me/transactions?limit=50', { token: DEV_TOKEN });
  const mine = rowsOf(txns).find((t) => t.source_row_id === donation?.id);
  record('ODR-05', 'P1', 'the donation shows in the devotee history carrying its receipt number',
    !!mine && mine.receipt_number === expected, `receipt_number=${mine?.receipt_number ?? '(absent)'}`);

  // The number exists so the devotee can print a receipt — assert the rendered
  // receipt actually shows it, not just that the column is populated.
  const receipt = mine
    ? await d('GET', `/me/receipts/${tenantId}/${mine.source_row_id}`, { token: DEV_TOKEN })
    : { status: 0, text: '' };
  record('ODR-06', 'P1', 'the printable receipt renders that number',
    receipt.status === 200 && receipt.text.includes(expected), `status=${receipt.status}`);

  // ---------- replays must not double-count money ----------
  await webhook(pid, 51100, notes);
  const afterReplay = await latestDonationNo(ADMIN);
  record('ODR-07', 'P1', 'a webhook replay does not record a second donation',
    afterReplay === before + 1, `latest=${afterReplay} expected=${before + 1}`);
  record('ODR-08', 'P1', 'a webhook replay does not burn a receipt number',
    afterReplay === before + 1, `latest=${afterReplay}`);

  // ---------- the webhook and the verify callback firing together ----------
  const racePid = `pay_e2e_odr_race_${Date.now()}`;
  await Promise.all([
    webhook(racePid, 22200, notes),
    webhook(racePid, 22200, notes),
    webhook(racePid, 22200, notes),
  ]);
  const afterRace = await latestDonationNo(ADMIN);
  record('ODR-09', 'P1', 'three concurrent deliveries of one payment record exactly one donation',
    afterRace === before + 2, `latest=${afterRace} expected=${before + 2}`);

  // ---------- a rejected payment must leave no hole ----------
  const badPid = `pay_e2e_odr_bad_${Date.now()}`;
  await webhook(badPid, 1000, { tenant_id: tenantId, devotee_id: '00000000-0000-4000-8000-0000000000ff' });
  const afterBad = await latestDonationNo(ADMIN);
  record('ODR-10', 'P1', 'a payment that cannot be recorded consumes no receipt number',
    afterBad === before + 2, `latest=${afterBad} expected=${before + 2}`);

  // ---------- the register as a whole stays consistent ----------
  const page = await m('GET', '/donations?limit=200&source=online', { token: ADMIN });
  const onlineRows = rowsOf(page);
  const unnumbered = onlineRows.filter((r) => !r.invoice_no || !String(r.invoice_no).trim());
  record('ODR-11', 'P1', 'no online donation in the register is left without a receipt number',
    unnumbered.length === 0, `unnumbered=${unnumbered.length}/${onlineRows.length}`);

  const all = rowsOf(await m('GET', '/donations?limit=200', { token: ADMIN }));
  const seen = new Map();
  for (const r of all) if (r.invoice_no) seen.set(r.invoice_no, (seen.get(r.invoice_no) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, c]) => c > 1);
  record('ODR-12', 'P1', 'no receipt number is issued to two donations',
    dupes.length === 0, `duplicates=${dupes.map(([n]) => n).join(',') || 'none'}`);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== ODR SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

/** Indian FY (April-start, IST) — the same one the series numbers by. */
function fyOfToday() {
  const ist = new Date(Date.now() + 330 * 60000);
  const y = ist.getUTCMonth() + 1 >= 4 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
