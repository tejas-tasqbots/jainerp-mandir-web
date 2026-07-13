/**
 * Functional API E2E — devotee bank/UPI donation-request approval workflow.
 *
 * Drives BOTH live APIs against the smoke-portal tenant (OTP_MOCK bypass):
 *   devotee-api  (:3107) — temple payment details, submit/list/cancel requests,
 *                          notifications, receipt + 80G certificate HTML
 *   mandiradmin-api (:3106) — Donor Payments settings, approval inbox,
 *                          approve → real receipted donation, reject, RBAC,
 *                          temple-80G gate on POST /donations
 *
 *   node e2e/full/donation-requests-suite.mjs
 *
 * Emits one line per case: PASS/FAIL <DR-ID> <title>. Exit 1 if any P1 fails.
 */
const MANDIR = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const DEVOTEE = process.env.E2E_DEVOTEE_API ?? 'http://localhost:3107/api/v1';
const TENANT = 'smoke-portal';
const ADMIN_MOBILE = '9876512345';
const CASHIER_MOBILE = '9844444444';
const BHOJ_MOBILE = '9833300011'; // bhojanshala_cashier — must NOT approve
// Fresh devotee identity per run: the PAN/address validations (DR-03/04) rely
// on the profile starting empty, and submits backfill the profile.
const DEVOTEE_MOBILE = `98111${String(Math.floor(10000 + Math.random() * 89999))}`;

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function http(base, method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return {
    status: res.status, json, text,
    data: json?.data, code: json?.error?.code ?? json?.code,
    ok: res.status >= 200 && res.status < 300,
  };
}
const m = (method, path, opts) => http(MANDIR, method, path, opts);
const d = (method, path, opts) => http(DEVOTEE, method, path, opts);
// List endpoints: the APIs unwrap {rows, meta} → data IS the array (meta separate).
const rowsOf = (r) => (Array.isArray(r.data) ? r.data : r.data?.rows ?? []);

async function mandirLogin(mobile, tenant = TENANT) {
  const send = await m('POST', '/auth/send-otp', { body: { mobile } });
  const otp = send.data?.dev_otp;
  if (!otp) throw new Error(`mandir no dev_otp for ${mobile}: ${JSON.stringify(send.json)}`);
  const ver = await m('POST', '/auth/verify-otp', { body: { mobile, otp } });
  const sel = ver.data?.selection_token;
  const r = await m('POST', '/auth/select-tenant', { body: { selection_token: sel, tenant_slug: tenant } });
  if (!r.data?.access_token) throw new Error(`mandir login failed for ${mobile}: ${JSON.stringify(r.json)}`);
  return r.data.access_token;
}

async function devoteeLogin(mobile) {
  const send = await d('POST', '/auth/send-otp', { body: { mobile } });
  const otp = send.data?.dev_otp;
  if (!otp) throw new Error(`devotee no dev_otp: ${JSON.stringify(send.json)}`);
  const ver = await d('POST', '/auth/verify-otp', {
    body: { mobile, otp, device_id: crypto.randomUUID(), device_name: 'e2e', platform: 'web' },
  });
  const token = ver.data?.access_token;
  if (!token) throw new Error(`devotee login failed: ${JSON.stringify(ver.json)}`);
  return token;
}

/** Tiny valid JPEG data URL, padded to look like a real screenshot. */
function fakeProof(padKb = 40) {
  const pixel =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  return `data:image/jpeg;base64,${pixel}${'A'.repeat(padKb * 1024)}`;
}

async function run() {
  console.log(`\n=== Donation Requests E2E — mandir ${MANDIR} / devotee ${DEVOTEE} (tenant ${TENANT}) ===\n`);

  // ---------- setup: logins ----------
  const ADMIN = await mandirLogin(ADMIN_MOBILE);
  const CASHIER = await mandirLogin(CASHIER_MOBILE);
  let BHOJ = null;
  try { BHOJ = await mandirLogin(BHOJ_MOBILE); } catch { /* optional role */ }
  const DEV = await devoteeLogin(DEVOTEE_MOBILE);

  const tenantRow = await m('GET', '/tenants/me', { token: ADMIN });
  const TENANT_ID = tenantRow.data?.platform ? tenantRow.data?.id ?? null : null;

  // ---------- Donor Payments settings (mandir side) ----------
  const patch = await m('PATCH', '/tenants/me', {
    token: ADMIN,
    body: {
      accept_donor_requests: true,
      upi_id: 'smokeportal@upi',
      upi_qr_cdn_url: null,
      bank_account_name: 'Smoke Portal Trust',
      bank_account_no: '12345678901',
      bank_ifsc: 'SBIN0001234',
      bank_name: 'State Bank of India',
    },
  });
  record('DR-01', 'P1', 'admin saves Donor Payments (UPI + bank + accept toggle)',
    patch.ok && patch.data?.upi_id === 'smokeportal@upi' && patch.data?.accept_donor_requests === true,
    `status=${patch.status}`);

  // ---------- Devotee sees temple payment details ----------
  const pd = await d('GET', `/temples/${TENANT}/payment-details`, { token: DEV });
  record('DR-02', 'P1', 'devotee payment-details returns UPI/bank + 80G-registered flag',
    pd.ok && pd.data?.accept_donor_requests === true && pd.data?.upi_id === 'smokeportal@upi' &&
    pd.data?.bank_account_no === '12345678901' && pd.data?.is_80g_registered === true &&
    !!pd.data?.tenant_id,
    `status=${pd.status} upi=${pd.data?.upi_id} 80g=${pd.data?.is_80g_registered}`);
  const tenantId = pd.data?.tenant_id ?? TENANT_ID;

  // ---------- validation: 80G needs PAN, then full address ----------
  const noPan = await d('POST', '/me/donation-requests', {
    token: DEV,
    body: { tenant_slug: TENANT, amount_paise: 50000, category: 'general', payment_mode: 'upi', is_80g: true, donor_name: 'E2E Devotee' },
  });
  record('DR-03', 'P1', '80G request without PAN → PAN_REQUIRED',
    noPan.status === 400 && noPan.code === 'PAN_REQUIRED', `status=${noPan.status} code=${noPan.code}`);

  const noAddr = await d('POST', '/me/donation-requests', {
    token: DEV,
    body: {
      tenant_slug: TENANT, amount_paise: 50000, category: 'general', payment_mode: 'upi',
      is_80g: true, donor_name: 'E2E Devotee', pan: 'AAAPZ1111C',
    },
  });
  record('DR-04', 'P1', '80G request without postal address → DONOR_DETAILS_REQUIRED',
    noAddr.status === 400 && noAddr.code === 'DONOR_DETAILS_REQUIRED', `status=${noAddr.status} code=${noAddr.code}`);

  // ---------- oversized proof rejected ----------
  const bigProof = await d('POST', '/me/donation-requests', {
    token: DEV,
    body: {
      tenant_slug: TENANT, amount_paise: 50000, category: 'general', payment_mode: 'upi',
      donor_name: 'E2E Devotee', proof_image_base64: fakeProof(700),
    },
  });
  record('DR-05', 'P2', 'oversized proof screenshot rejected',
    bigProof.status === 400 || bigProof.status === 413, `status=${bigProof.status} code=${bigProof.code}`);

  // ---------- valid 80G request with proof ----------
  const submit = await d('POST', '/me/donation-requests', {
    token: DEV,
    body: {
      tenant_slug: TENANT, amount_paise: 75100, category: 'general', payment_mode: 'upi',
      utr_number: `E2E${Date.now()}`.slice(0, 20), paid_at: new Date().toISOString().slice(0, 10),
      is_80g: true, remarks: 'E2E manual donation',
      donor_name: 'E2E Devotee', pan: 'AAAPZ1111C',
      address: '12 Test Marg', city: 'Indore', state: 'MP', pincode: '452001',
      proof_image_base64: fakeProof(40),
    },
  });
  const reqId = submit.data?.id;
  record('DR-06', 'P1', 'devotee submits valid 80G bank-transfer request',
    submit.ok && !!reqId && submit.data?.status === 'pending' && submit.data?.is_80g === true,
    `status=${submit.status} id=${reqId}`);

  // ---------- devotee sees it in their list ----------
  const mine = await d('GET', '/me/donation-requests', { token: DEV });
  const mineRow = rowsOf(mine).find((r) => r.id === reqId);
  record('DR-07', 'P1', 'devotee request list shows pending row with temple + proof flag',
    !!mineRow && mineRow.status === 'pending' && mineRow.has_proof === true && !!mineRow.temple_name,
    `rows=${rowsOf(mine).length}`);

  // ---------- mandir inbox ----------
  const inbox = await m('GET', '/donation-requests?status=pending', { token: CASHIER });
  const inboxRow = (inbox.data ?? []).find((r) => r.id === reqId);
  record('DR-08', 'P1', 'mandir pending inbox lists the request with donor snapshot',
    !!inboxRow && inboxRow.donor_name === 'E2E Devotee' && inboxRow.is_80g === true &&
    !!inboxRow.devotee_mobile && inboxRow.has_proof === true && !!inboxRow.donor_pan_masked,
    `pending=${inbox.json?.meta?.pending}`);

  const count = await m('GET', '/donation-requests/pending-count', { token: CASHIER });
  record('DR-09', 'P2', 'pending-count endpoint counts the queue',
    count.ok && Number(count.data?.pending) >= 1, `pending=${count.data?.pending}`);

  const detail = await m('GET', `/donation-requests/${reqId}`, { token: CASHIER });
  record('DR-10', 'P1', 'request detail includes proof image + full donor address',
    detail.ok && (detail.data?.proof_image_base64 ?? '').startsWith('data:image/jpeg') &&
    detail.data?.donor_address === '12 Test Marg' && detail.data?.donor_pincode === '452001' &&
    !('donor_pan_encrypted' in (detail.data ?? {})),
    `status=${detail.status}`);

  // ---------- RBAC: bhojanshala cashier cannot approve ----------
  if (BHOJ) {
    const forbidden = await m('PATCH', `/donation-requests/${reqId}/approve`, { token: BHOJ });
    record('DR-11', 'P1', 'bhojanshala_cashier blocked from approving', forbidden.status === 403, `status=${forbidden.status}`);
  } else {
    record('DR-11', 'P1', 'bhojanshala_cashier blocked from approving', false, 'bhojanshala login unavailable');
  }

  // ---------- approve → real receipted donation ----------
  const approve = await m('PATCH', `/donation-requests/${reqId}/approve`, { token: CASHIER, body: {} });
  const donationId = approve.data?.donation_id;
  const receiptNo = approve.data?.receipt_number;
  record('DR-12', 'P1', 'cashier approves → donation + gapless receipt number',
    approve.ok && !!donationId && /^DON\/\d{4}-\d{2}\/\d{6}$/.test(receiptNo ?? ''),
    `receipt=${receiptNo}`);

  const donation = await m('GET', `/donations/${donationId}`, { token: CASHIER });
  record('DR-13', 'P1', 'created donation carries mode/UTR/80G from the request',
    donation.ok && donation.data?.payment_mode === 'upi' && donation.data?.is_80g_eligible === true &&
    (donation.data?.utr_number ?? '').startsWith('E2E') && donation.data?.source === 'online',
    `mode=${donation.data?.payment_mode} 80g=${donation.data?.is_80g_eligible}`);

  const receipt = await m('GET', `/donations/${donationId}/receipt`, { token: CASHIER });
  record('DR-14', 'P1', '80G receipt payload complete (full PAN + donor postal address)',
    receipt.ok && receipt.data?.donor?.pan_full === 'AAAPZ1111C' &&
    receipt.data?.donor?.address === '12 Test Marg' && receipt.data?.donor?.pincode === '452001' &&
    receipt.data?.is_80g_eligible === true,
    `pan_full=${receipt.data?.donor?.pan_full ? 'yes' : 'no'} addr=${receipt.data?.donor?.address ?? 'missing'}`);

  const reqAfter = await m('GET', `/donation-requests/${reqId}`, { token: CASHIER });
  record('DR-15', 'P1', 'request closed as approved with receipt no + reviewer',
    reqAfter.data?.status === 'approved' && reqAfter.data?.receipt_no === receiptNo && !!reqAfter.data?.reviewed_at,
    `status=${reqAfter.data?.status}`);

  const again = await m('PATCH', `/donation-requests/${reqId}/approve`, { token: CASHIER });
  record('DR-16', 'P1', 're-approving an approved request blocked', again.status === 400 || again.status === 404, `status=${again.status}`);

  // ---------- devotee side after approval ----------
  const notifs = await d('GET', '/me/notifications?limit=20', { token: DEV });
  const approvedNotif = (notifs.data ?? []).find((n) => n.type === 'donation_approved' && (n.data ?? '').includes(reqId));
  let deepLinkOk = false;
  try {
    const dl = JSON.parse(approvedNotif?.data ?? '{}');
    deepLinkOk = dl.donation_id === donationId && dl.tenant_id === tenantId && dl.receipt_no === receiptNo;
  } catch { /* bad json */ }
  record('DR-17', 'P1', 'devotee gets donation_approved notification with deep-link data',
    !!approvedNotif && deepLinkOk, approvedNotif ? `title=${approvedNotif.title}` : 'notification missing');

  const devReceipt = await d('GET', `/me/receipts/${tenantId}/${donationId}`, { token: DEV });
  record('DR-18', 'P1', 'devotee receipt HTML renders with receipt no + PAN + address + 80G text',
    devReceipt.status === 200 && devReceipt.text.includes(receiptNo) &&
    devReceipt.text.includes('AAAPZ1111C') && devReceipt.text.includes('12 Test Marg') &&
    devReceipt.text.includes('80G'),
    `status=${devReceipt.status} len=${devReceipt.text.length}`);

  const cert = await d('GET', `/me/80g-certificate/${tenantId}`, { token: DEV });
  record('DR-19', 'P1', 'devotee downloads consolidated 80G certificate (both sides qualify)',
    cert.status === 200 && cert.text.includes('80G DONATION CERTIFICATE') &&
    cert.text.includes(receiptNo) && cert.text.includes('AAAPZ1111C'),
    `status=${cert.status}`);

  const txns = await d('GET', '/me/transactions?include_unsynced=true&limit=100', { token: DEV });
  const mirrored = rowsOf(txns).find((t) => t.source_row_id === donationId);
  record('DR-20', 'P2', 'approved donation appears in devotee cross-temple history',
    !!mirrored && Number(mirrored.amount_paise) === 75100, mirrored ? `status=${mirrored.status}` : 'not found');

  // ---------- reject flow ----------
  const submit2 = await d('POST', '/me/donation-requests', {
    token: DEV,
    body: {
      tenant_slug: TENANT, amount_paise: 20000, category: 'general', payment_mode: 'neft',
      utr_number: 'E2EREJECT1', donor_name: 'E2E Devotee',
    },
  });
  const rejId = submit2.data?.id;
  const rejNoReason = await m('PATCH', `/donation-requests/${rejId}/reject`, { token: CASHIER, body: {} });
  record('DR-21', 'P2', 'reject without reason blocked', rejNoReason.status === 400, `status=${rejNoReason.status}`);

  const reject = await m('PATCH', `/donation-requests/${rejId}/reject`, {
    token: CASHIER, body: { reason: 'No matching credit in bank statement' },
  });
  record('DR-22', 'P1', 'cashier rejects with reason', reject.ok && reject.data?.status === 'rejected', `status=${reject.status}`);

  const mine2 = await d('GET', '/me/donation-requests?status=rejected', { token: DEV });
  const rejRow = rowsOf(mine2).find((r) => r.id === rejId);
  const rejNotif = ((await d('GET', '/me/notifications?limit=20', { token: DEV })).data ?? [])
    .find((n) => n.type === 'donation_rejected' && (n.data ?? '').includes(rejId));
  record('DR-23', 'P1', 'devotee sees rejection + reason + notification',
    !!rejRow && rejRow.review_note === 'No matching credit in bank statement' && !!rejNotif,
    rejRow ? 'row+note ok' : 'row missing');

  // ---------- cancel flow ----------
  const submit3 = await d('POST', '/me/donation-requests', {
    token: DEV,
    body: { tenant_slug: TENANT, amount_paise: 10000, category: 'general', payment_mode: 'upi', donor_name: 'E2E Devotee' },
  });
  const cancelId = submit3.data?.id;
  const cancel = await d('POST', `/me/donation-requests/${cancelId}/cancel`, { token: DEV });
  const approveCancelled = await m('PATCH', `/donation-requests/${cancelId}/approve`, { token: CASHIER });
  record('DR-24', 'P1', 'devotee cancels pending request; mandir cannot approve it afterwards',
    cancel.ok && cancel.data?.status === 'cancelled' && (approveCancelled.status === 400 || approveCancelled.status === 404),
    `cancel=${cancel.status} approve=${approveCancelled.status}`);

  // ---------- master toggle off ----------
  await m('PATCH', '/tenants/me', { token: ADMIN, body: { accept_donor_requests: false } });
  const pdOff = await d('GET', `/temples/${TENANT}/payment-details`, { token: DEV });
  const submitOff = await d('POST', '/me/donation-requests', {
    token: DEV,
    body: { tenant_slug: TENANT, amount_paise: 10000, category: 'general', payment_mode: 'upi', donor_name: 'E2E Devotee' },
  });
  record('DR-25', 'P1', 'accept_donor_requests=off hides details + blocks submissions',
    pdOff.data?.accept_donor_requests === false && !pdOff.data?.upi_id &&
    submitOff.status === 400 && submitOff.code === 'DONOR_REQUESTS_DISABLED',
    `pd=${pdOff.data?.accept_donor_requests} submit=${submitOff.code}`);
  await m('PATCH', '/tenants/me', { token: ADMIN, body: { accept_donor_requests: true } });

  // ---------- temple-80G gate (mandir + devotee sides) ----------
  const profBefore = await m('GET', '/tenants/me', { token: ADMIN });
  const reg80g = profBefore.data?.reg_80g_number ?? null;
  await m('PATCH', '/tenants/me', { token: ADMIN, body: { reg_80g_number: null } });

  const pdNo80g = await d('GET', `/temples/${TENANT}/payment-details`, { token: DEV });
  const submitNo80g = await d('POST', '/me/donation-requests', {
    token: DEV,
    body: {
      tenant_slug: TENANT, amount_paise: 15000, category: 'general', payment_mode: 'upi',
      is_80g: true, donor_name: 'E2E Devotee',
    },
  });
  const counter80g = await m('POST', '/donations', {
    token: CASHIER,
    body: {
      donor: { name: 'Gate Test', mobile: '9811100333' },
      category: 'General', amount_paise: 11100, payment_mode: 'cash', is_80g: true, pan: 'AAAPZ2222D',
    },
  });
  record('DR-26', 'P1', 'temple without 80G reg: devotee flag false, 80G intent dropped, counter 80G blocked',
    pdNo80g.data?.is_80g_registered === false &&
    submitNo80g.ok && submitNo80g.data?.is_80g === false &&
    counter80g.status === 400 && counter80g.code === 'EIGHTY_G_NOT_CONFIGURED',
    `flag=${pdNo80g.data?.is_80g_registered} forced=${submitNo80g.data?.is_80g} counter=${counter80g.code}`);

  // cleanup: restore 80G reg + cancel the stray forced-non80G request
  await m('PATCH', '/tenants/me', { token: ADMIN, body: { reg_80g_number: reg80g } });
  if (submitNo80g.data?.id) await d('POST', `/me/donation-requests/${submitNo80g.data.id}/cancel`, { token: DEV });

  // ---------- summary ----------
  const fails = results.filter((r) => !r.ok);
  const p1Fails = fails.filter((r) => r.pri === 'P1');
  console.log(`\n=== ${results.length} cases: ${results.length - fails.length} passed, ${fails.length} failed (${p1Fails.length} P1) ===\n`);
  if (fails.length) fails.forEach((f) => console.log(`  ✘ ${f.id} ${f.title} — ${f.detail}`));
  process.exit(p1Fails.length ? 1 : 0);
}

run().catch((e) => {
  console.error('SUITE ERROR:', e);
  process.exit(1);
});
