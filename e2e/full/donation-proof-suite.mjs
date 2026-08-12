/**
 * The bank-details flow after removing the duplicate and adding the proof.
 *
 * Two defects are being pinned here, both reported from the live screen:
 *
 *  1. The same bank account was captured TWICE on one tab — once as the
 *     nominated account, once as four kshetra_profile fields with their own
 *     field-change-request approval — so a trust had to get one account
 *     approved through two unrelated mechanisms.
 *  2. A reviewer could approve an account with nothing to check it against.
 *     "Verified" meant "somebody read the digits the trust typed in".
 */
import { execFileSync } from 'node:child_process';
import { authenticator } from '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/superadmin-web/node_modules/otplib/index.js';

const MA = process.env.MA ?? 'http://localhost:3106/api/v1';
const SA = process.env.SA ?? 'http://localhost:3105/api/v1';
const SLUG = 'e2e-test-trust-55121877';

const results = [];
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${id}${detail ? ' — ' + detail : ''}`);
};

const call = async (base, p, { method = 'GET', body, tok } = {}) => {
  const r = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* 204 */ }
  return { status: r.status, body: j };
};

const sql = (db, q) => execFileSync('psql',
  ['-h', '127.0.0.1', '-p', process.env.PGPORT ?? '5434', '-U', 'jainerp', '-d', db, '-tAc', q],
  { env: { ...process.env, PGPASSWORD: 'jainerp_dev' }, encoding: 'utf8' }).trim();

// A real 1×1 PNG, so the stored bytes are a decodable image rather than
// arbitrary base64 that happens to pass the character check.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ── tokens ─────────────────────────────────────────────────────────────────
const s = await call(MA, '/auth/send-otp', { method: 'POST', body: { mobile: '9855121877' } });
const v = await call(MA, '/auth/verify-otp', { method: 'POST', body: { mobile: '9855121877', otp: s.body.data.dev_otp } });
const t = await call(MA, '/auth/select-tenant', { method: 'POST', body: { selection_token: v.body.data.selection_token, tenant_slug: SLUG } });
const MTOK = t.body.data.access_token;

sql('jainerp', `UPDATE public.super_admin_credentials c SET totp_secret_enc=NULL, totp_enrolled_at=NULL,
   recovery_codes_hash='{}', recovery_codes_used=0, failed_attempts=0, locked_until=NULL
   FROM public.global_users u WHERE u.id=c.global_user_id AND u.email='qa-tester@tasqbots.com'`);
const l = await call(SA, '/admin/auth/login', { method: 'POST', body: { identifier: 'qa-tester@tasqbots.com', password: 'QaTest@12345' } });
const st = await call(SA, '/admin/auth/mfa/setup', { method: 'POST', body: { mfa_token: l.body.data.mfa_token } });
const sec = st.body.data.otpauth_uri.match(/secret=([A-Z0-9]+)/)[1];
const mv = await call(SA, '/admin/auth/mfa/verify', { method: 'POST', body: { mfa_token: l.body.data.mfa_token, type: 'totp', code: authenticator.generate(sec) } });
const SATOK = mv.body.data.access_token;

const tenantId = sql('jainerp', `SELECT id FROM public.tenants WHERE slug='${SLUG}'`);
const SCHEMA = sql('jainerp', `SELECT schema_name FROM public.tenants WHERE slug='${SLUG}'`);

// Clean slate: nominated, unverified, no proof.
sql('jainerp_pool_1', `UPDATE ${SCHEMA}.accounts SET donation_verified_at=NULL, donation_verified_hash=NULL,
  donation_verify_note=NULL, donation_proof_data=NULL, donation_proof_mime=NULL,
  donation_proof_kind=NULL, donation_proof_uploaded_at=NULL`);

// ── 1. the duplicate is gone ───────────────────────────────────────────────
// The four profile columns must no longer be writable at all. Before this
// change they were both editable here AND locked by SENSITIVE_FIELDS, which is
// how the same account came to need two approvals.
// An old client (mobile, desktop) may still send the dead columns alongside a
// live one. That must keep working and simply ignore them — not 400 the whole
// PATCH, which would break saving the toggle that shares the form.
const before = sql('jainerp_pool_1', `SELECT COALESCE(bank_account_no,'-') FROM ${SCHEMA}.kshetra_profile LIMIT 1`);
const w = await call(MA, '/tenants/me', {
  method: 'PATCH', tok: MTOK,
  body: {
    accept_donor_requests: true,
    bank_account_no: '99999999999999', bank_ifsc: 'HDFC0000999',
    bank_account_name: 'Someone Else', bank_name: 'HDFC',
  },
});
const after = sql('jainerp_pool_1', `SELECT COALESCE(bank_account_no,'-') FROM ${SCHEMA}.kshetra_profile LIMIT 1`);
rec('profile bank fields are ignored, not written', w.status < 400 && before === after,
  `status=${w.status} ${before} → ${after}`);

// The sensitive-field mechanism must have let go of them too, otherwise a
// verified trust gets a hard 400 for sending fields it can no longer change.
// The list rides on the profile itself, under `sensitive`.
const sens = await call(MA, '/tenants/me', { tok: MTOK });
const sensList = sens.body?.data?.sensitive?.fields ?? [];
rec('bank fields dropped from the change-request lock',
  !sensList.some(f => String(f).startsWith('bank_')), sensList.join(','));
rec('upi_id is still protected', sensList.includes('upi_id'));

// ── 2. no approval without evidence ────────────────────────────────────────
let acct = (await call(MA, '/tenants/me/donation-account', { tok: MTOK })).body.data;
rec('the account reports no proof yet', acct?.has_proof === false);

const early = await call(SA, `/admin/tenants/${tenantId}/donation-account/verify`, {
  method: 'PATCH', tok: SATOK, body: { note: 'looks fine to me' },
});
rec('the API refuses to verify with no document', early.status === 400 && early.body?.error?.code === 'NO_PROOF',
  `${early.status} ${early.body?.error?.code ?? ''}`);

const queue = await call(SA, '/admin/donation-accounts?status=pending', { tok: SATOK });
const mine = (queue.body.data ?? []).find(r => r.tenant_slug === SLUG);
rec('the queue shows the trust with proof missing', !!mine && mine.has_proof === false);
rec('the queue still shows the digits to check', !!mine?.account_no && !!mine?.ifsc,
  mine ? `${mine.account_no} ${mine.ifsc}` : 'no row');

// ── 3. bad uploads are refused ─────────────────────────────────────────────
const pdf = await call(MA, '/tenants/me/donation-account/proof', {
  method: 'POST', tok: MTOK, body: { data: PNG_1PX, mime: 'application/pdf', name: 'passbook.pdf' },
});
rec('a PDF is refused', pdf.status === 400, String(pdf.status));

const junk = await call(MA, '/tenants/me/donation-account/proof', {
  method: 'POST', tok: MTOK, body: { data: 'not base64 at all!!', mime: 'image/png' },
});
rec('non-base64 is refused', junk.status === 400, String(junk.status));

const huge = await call(MA, '/tenants/me/donation-account/proof', {
  method: 'POST', tok: MTOK, body: { data: 'A'.repeat(6 * 1024 * 1024), mime: 'image/jpeg' },
});
rec('an oversized image is refused', huge.status === 400, String(huge.status));

// ── 4. the real upload ─────────────────────────────────────────────────────
// Sent WITH the data: prefix a browser FileReader produces, because storing
// that prefix would make every rendered <img src> double-prefixed and broken.
const up = await call(MA, '/tenants/me/donation-account/proof', {
  method: 'POST', tok: MTOK,
  body: { data: `data:image/png;base64,${PNG_1PX}`, mime: 'image/png', name: 'passbook.png', kind: 'passbook' },
});
rec('the upload succeeds', up.status === 201 || up.status === 200, String(up.status));
rec('the account now reports proof on file', up.body?.data?.has_proof === true);
rec('the kind is recorded', up.body?.data?.proof_kind === 'passbook', up.body?.data?.proof_kind);

const stored = sql('jainerp_pool_1', `SELECT LEFT(donation_proof_data, 12) FROM ${SCHEMA}.accounts WHERE is_primary_for_donations`);
rec('the data: prefix was stripped before storing', stored === PNG_1PX.slice(0, 12), stored);

const mine2 = await call(MA, '/tenants/me/donation-account', { tok: MTOK });
rec('the account row does NOT carry the image', !('data' in (mine2.body.data ?? {})) &&
  JSON.stringify(mine2.body.data).length < 800, `${JSON.stringify(mine2.body.data).length} bytes`);

const fetched = await call(MA, '/tenants/me/donation-account/proof', { tok: MTOK });
rec('the trust can read its own proof back', fetched.body?.data?.data === PNG_1PX);

// ── 5. the super admin can see it ──────────────────────────────────────────
const saProof = await call(SA, `/admin/tenants/${tenantId}/donation-account/proof`, { tok: SATOK });
rec('the super admin can open the document', saProof.status === 200 && saProof.body?.data?.data === PNG_1PX,
  String(saProof.status));
rec('the document carries its mime type', saProof.body?.data?.mime === 'image/png', saProof.body?.data?.mime);

const queue2 = await call(SA, '/admin/donation-accounts?status=pending', { tok: SATOK });
const mine3 = (queue2.body.data ?? []).find(r => r.tenant_slug === SLUG);
rec('the queue now shows proof present', mine3?.has_proof === true);
rec('the queue list still does not carry the image',
  JSON.stringify(queue2.body.data).length < 4000, `${JSON.stringify(queue2.body.data).length} bytes`);

// ── 6. approval now works, once ────────────────────────────────────────────
const ok = await call(SA, `/admin/tenants/${tenantId}/donation-account/verify`, {
  method: 'PATCH', tok: SATOK, body: { note: 'Passbook checked against the digits' },
});
rec('verification succeeds with the document present', ok.status === 200, String(ok.status));
acct = (await call(MA, '/tenants/me/donation-account', { tok: MTOK })).body.data;
rec('the trust sees it verified', acct?.is_verified === true);

// And that is the ONLY approval it needs — there is no second pending change
// request sitting on the same four values.
const pendingReqs = await call(MA, '/tenants/me/field-change-requests', { tok: MTOK });
const bankReqs = (pendingReqs.body?.data ?? []).filter(r => String(r.field).startsWith('bank_'));
rec('no second approval is outstanding for the same account', bankReqs.length === 0,
  `${bankReqs.length} bank change requests`);

// ── 7. replacing the photo does not un-verify ──────────────────────────────
const re = await call(MA, '/tenants/me/donation-account/proof', {
  method: 'POST', tok: MTOK, body: { data: PNG_1PX, mime: 'image/jpeg', name: 'clearer.jpg', kind: 'statement' },
});
rec('a clearer scan can be uploaded while verified', re.status === 201 || re.status === 200, String(re.status));
rec('replacing the photo does not un-verify the account', re.body?.data?.is_verified === true);

// ── 8. editing the ACCOUNT still does ──────────────────────────────────────
// A fresh number every run. A fixed one silently became a no-op on the second
// run — the row already held it, so nothing changed, the hash still matched,
// and the assertion failed for a reason that had nothing to do with the rule.
const NEW_NO = String(Date.now()).slice(-12).padStart(14, '9');
sql('jainerp_pool_1', `UPDATE ${SCHEMA}.accounts SET account_no='${NEW_NO}' WHERE is_primary_for_donations`);
acct = (await call(MA, '/tenants/me/donation-account', { tok: MTOK })).body.data;
rec('editing the account number still un-verifies it', acct?.is_verified === false && acct?.changed_since_verification === true);

// ── 9. the checklist reflects the real source ──────────────────────────────
const setup = await call(MA, '/tenants/me/setup', { tok: MTOK });
const items = (setup.body?.data?.groups ?? []).flatMap(g => g.items ?? []);
const byKey = Object.fromEntries(items.map(i => [i.key, i]));
rec('the checklist asks for the nominated account', !!byKey.donation_account);
rec('the checklist asks for the passbook page', !!byKey.donation_account_proof);
rec('the passbook item reads as done', byKey.donation_account_proof?.done === true);
rec('the dead bank_account_name item is gone', !byKey.bank_account_name);
rec('the checklist points at the right tab',
  byKey.donation_account?.route === '/settings?tab=accounts', byKey.donation_account?.route);

const pass = results.filter(r => r.ok).length;
console.log(`\n  ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
