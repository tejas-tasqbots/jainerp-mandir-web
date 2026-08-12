/**
 * The two things removing the duplicate could have broken silently.
 *
 * 1. A trust that types bank details during REGISTRATION. Those went into the
 *    retired profile columns, so it would have arrived with no donation account
 *    and had to enter the same details a second time to be visible to donors.
 *
 * 2. The devotee receipt's bank block, which read the same retired columns and
 *    would now print blank for every new trust — and, worse, whatever stale
 *    value an old trust happened to still have sitting there.
 */
import { execFileSync } from 'node:child_process';
import { authenticator } from '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/superadmin-web/node_modules/otplib/index.js';

const SA = process.env.SA ?? 'http://localhost:3105/api/v1';
const MA = process.env.MA ?? 'http://localhost:3106/api/v1';
const DA = process.env.DA ?? 'http://localhost:3107/api/v1';

const results = [];
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${id}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries on 429.
 *
 * The auth endpoints are throttled, and this suite logs in three times. Run on
 * its own it passes; run after the others it hit the limiter and died on
 * `Cannot read properties of null` — reporting a product failure whose only
 * cause was how fast the suite itself was going. A suite that fails based on
 * what ran before it is a suite that cannot be believed either way.
 */
const call = async (base, p, { method = 'GET', body, tok } = {}) => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = null; try { j = await r.json(); } catch { /* 204 */ }
    if (r.status === 429 && attempt < 6) { await sleep(5000 * (attempt + 1)); continue; }
    return { status: r.status, body: j };
  }
};
const sql = (db, q) => execFileSync('psql',
  ['-h', '127.0.0.1', '-p', process.env.PGPORT ?? '5434', '-U', 'jainerp', '-d', db, '-tAc', q],
  { env: { ...process.env, PGPASSWORD: 'jainerp_dev' }, encoding: 'utf8' }).trim();

sql('jainerp', `UPDATE public.super_admin_credentials c SET totp_secret_enc=NULL, totp_enrolled_at=NULL,
   recovery_codes_hash='{}', recovery_codes_used=0, failed_attempts=0, locked_until=NULL
   FROM public.global_users u WHERE u.id=c.global_user_id AND u.email='qa-tester@tasqbots.com'`);
const l = await call(SA, '/admin/auth/login', { method: 'POST', body: { identifier: 'qa-tester@tasqbots.com', password: 'QaTest@12345' } });
const st = await call(SA, '/admin/auth/mfa/setup', { method: 'POST', body: { mfa_token: l.body.data.mfa_token } });
const sec = st.body.data.otpauth_uri.match(/secret=([A-Z0-9]+)/)[1];
const mv = await call(SA, '/admin/auth/mfa/verify', { method: 'POST', body: { mfa_token: l.body.data.mfa_token, type: 'totp', code: authenticator.generate(sec) } });
const SATOK = mv.body.data.access_token;

// ── 1. provision a trust the way registration does, with bank details ──────
const stamp = String(Date.now()).slice(-7);
const mobile = `98${stamp.slice(-8).padStart(8, '7')}`;
const plan = (await call(SA, '/admin/plans', { tok: SATOK })).body.data?.[0];
const created = await call(SA, '/admin/tenants', {
  method: 'POST', tok: SATOK,
  body: {
    name: `Bank Seed Trust ${stamp}`,
    slug: `bank-seed-${stamp}`,
    plan: plan.name,
    billing_cycle: 'yearly',
    tenancy_tier: 'pooled',
    admin_contact: { name: 'Seed Admin', mobile, email: null },
    address: { line1: 'A', city: 'Indore', state: 'MP', pincode: '452001' },
    upi_id: `seed${stamp}@sbi`,
    bank_account_name: `Bank Seed Trust ${stamp}`,
    bank_account_no: '50100123456789',
    bank_ifsc: 'hdfc0000123',
    bank_name: 'HDFC Bank',
  },
});
rec('the trust provisions', created.status === 201 || created.status === 200,
  `${created.status} ${created.body?.error?.message ?? ''}`);

const tid = created.body?.data?.id;
const schema = sql('jainerp', `SELECT schema_name FROM public.tenants WHERE id='${tid}'`);
const dbName = sql('jainerp', `SELECT COALESCE(db_name,'jainerp') FROM public.tenants WHERE id='${tid}'`);

const row = sql(dbName, `SELECT COALESCE(name,'')||'|'||COALESCE(account_no,'')||'|'||COALESCE(ifsc,'')||'|'||COALESCE(bank_name,'')
  FROM ${schema}.accounts WHERE is_primary_for_donations`);
rec('registration bank details became a nominated account', row.includes('50100123456789'), row || 'no primary account');
rec('the IFSC was upper-cased on the way in', row.includes('HDFC0000123'), row.split('|')[2]);

const verified = sql(dbName, `SELECT COALESCE(donation_verified_at::text,'null') FROM ${schema}.accounts WHERE is_primary_for_donations`);
rec('it arrives UNVERIFIED', verified === 'null', verified);

// It must show up in the review queue on its own, with proof missing.
const queue = (await call(SA, '/admin/donation-accounts?status=pending', { tok: SATOK })).body.data ?? [];
const q = queue.find(r => r.tenant_id === tid);
rec('it appears in the review queue', !!q);
rec('the queue says proof is missing', q?.has_proof === false);

// And the checklist must ask the trust for the passbook, not for the account.
const s1 = await call(MA, '/auth/send-otp', { method: 'POST', body: { mobile } });
const v1 = await call(MA, '/auth/verify-otp', { method: 'POST', body: { mobile, otp: s1.body.data.dev_otp } });
const t1 = await call(MA, '/auth/select-tenant', { method: 'POST', body: { selection_token: v1.body.data.selection_token, tenant_slug: `bank-seed-${stamp}` } });
const MTOK = t1.body.data.access_token;
const setup = await call(MA, '/tenants/me/setup', { tok: MTOK });
const items = Object.fromEntries((setup.body?.data?.groups ?? []).flatMap(g => g.items ?? []).map(i => [i.key, i]));
rec('the account step is already done for this trust', items.donation_account?.done === true);
rec('the passbook step is what remains', items.donation_account_proof?.done === false);

// The new columns must exist on a schema built from the TEMPLATE, before any
// tenant migration has had a chance to run against it.
const acct = await call(MA, '/tenants/me/donation-account', { tok: MTOK });
rec('a freshly-provisioned schema has the proof columns', acct.status === 200 && 'has_proof' in (acct.body.data ?? {}),
  `${acct.status}`);

// ── 2. the devotee receipt reads the verified account ──────────────────────
const E2E = 'e2e-test-trust-55121877';
const eSchema = sql('jainerp', `SELECT schema_name FROM public.tenants WHERE slug='${E2E}'`);
// Poison the retired profile columns. If anything still reads them, this value
// is what will show up on the receipt.
sql('jainerp_pool_1', `UPDATE ${eSchema}.kshetra_profile SET bank_account_no='DEADBEEF0000', bank_ifsc='DEAD0000000', bank_account_name='Retired Column', bank_name='Retired Bank'`);


// Record a donation from THIS devotee's own mobile. The seeded rows are listed
// for them via global_transactions.global_user_id, but the receipt route
// re-checks the donor's mobile on the tenant row — a fixture mismatch that
// makes every seeded receipt 404 and has nothing to do with the bank block.
const s3 = await call(MA, '/auth/send-otp', { method: 'POST', body: { mobile: '9855121877' } });
const v3 = await call(MA, '/auth/verify-otp', { method: 'POST', body: { mobile: '9855121877', otp: s3.body.data.dev_otp } });
const t3 = await call(MA, '/auth/select-tenant', { method: 'POST', body: { selection_token: v3.body.data.selection_token, tenant_slug: E2E } });
const ETOK = t3.body.data.access_token;
const cat = (await call(MA, '/donation-categories?limit=1', { tok: ETOK })).body.data?.[0];
const made = await call(MA, '/donations', {
  method: 'POST', tok: ETOK,
  body: {
    donor: { name: 'Receipt Check Devotee', mobile: '9764500001' },
    category_id: cat?.id,
    amount_paise: 100000,
    payment_mode: 'cash',
  },
});
rec('a donation exists to receipt', made.status === 201 || made.status === 200,
  `${made.status} ${made.body?.error?.message ?? ''}`);

const s2 = await call(DA, '/auth/send-otp', { method: 'POST', body: { mobile: '9764500001' } });
const v2 = await call(DA, '/auth/verify-otp', { method: 'POST', body: { mobile: '9764500001', otp: s2.body.data.dev_otp } });
const DTOK = v2.body.data.access_token;

const eTenantId = sql('jainerp', `SELECT id FROM public.tenants WHERE slug='${E2E}'`);
const rowId = made.body?.data?.id;

// The receipt endpoint renders HTML, not JSON — so the assertion is on what a
// donor would actually READ, which is the only place the bank block exists.
const html = await (await fetch(`${DA}/me/receipts/${eTenantId}/${rowId}`, {
  headers: { Authorization: `Bearer ${DTOK}` },
})).text();

rec('the receipt renders', html.includes('<') && !html.includes('NOT_FOUND'), html.slice(0, 90));
rec('the receipt does not print the retired profile columns',
  !html.includes('DEADBEEF0000') && !html.includes('DEAD0000000'),
  html.includes('DEADBEEF0000') ? 'retired account number printed' : 'clean');

const eDb = 'jainerp_pool_1';
const live = sql(eDb, `SELECT COALESCE(account_no,'') FROM ${eSchema}.accounts WHERE is_primary_for_donations`);
// Ask the API, not the columns. "Verified" in this product means verified AND
// the digits unchanged since — the fingerprint is the whole point. A raw
// `donation_verified_at IS NOT NULL` is true even for an account that was
// edited after approval, so this expected a bank block the product had
// deliberately withdrawn and called the correct behaviour a failure.
const acctNow = (await call(MA, '/tenants/me/donation-account', { tok: ETOK })).body?.data;
const isVerified = acctNow?.is_verified === true;
if (isVerified) {
  rec('a verified account prints on the receipt', html.includes(live), `looking for ${live}`);
} else {
  rec('an unverified account prints no bank block', !html.includes(live), `must not print ${live}`);
}

// Clean up the throwaway trust so the queue does not fill with test rows.
await call(SA, `/admin/tenants/${tid}`, { method: 'DELETE', tok: SATOK });

const pass = results.filter(r => r.ok).length;
console.log(`\n  ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
