/**
 * The donation-account flow, driven through both UIs.
 *
 * The API rules are already pinned server-side; what this proves is that a
 * human can actually see and act on each state — nominate, wait, verified and
 * locked, and the one that matters most: verified then edited, where the trust
 * must be told plainly that donors have stopped seeing the account.
 */
const pw = await import(process.env.PLAYWRIGHT_PATH);
const chromium = pw.chromium ?? pw.default?.chromium;
const { authenticator } = await import(
  '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/superadmin-web/node_modules/otplib/index.js'
);
const { execFileSync } = await import('node:child_process');

const MW = process.env.MW, SW = process.env.SW;
const MA = process.env.MA, SA = process.env.SA, DA = process.env.DA;
const SLUG = 'e2e-test-trust-55121877';

const results = [];
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${id}${detail ? ' — ' + detail : ''}`);
};

const post = async (base, p, b, tok) => (await (await fetch(base + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
  body: JSON.stringify(b),
})).json());

// ── tokens ────────────────────────────────────────────────────────────────
const s1 = await post(MA, '/auth/send-otp', { mobile: '9855121877' });
const v1 = await post(MA, '/auth/verify-otp', { mobile: '9855121877', otp: s1.data.dev_otp });
const t1 = await post(MA, '/auth/select-tenant', { selection_token: v1.data.selection_token, tenant_slug: SLUG });
const MTOK = t1.data.access_token;

const s2 = await post(DA, '/auth/send-otp', { mobile: '9764500001' });
const v2 = await post(DA, '/auth/verify-otp', { mobile: '9764500001', otp: s2.data.dev_otp });
const DTOK = v2.data.access_token;

execFileSync('psql', ['-h', '127.0.0.1', '-p', '5433', '-U', 'jainerp', '-d', 'jainerp', '-tAc',
  `UPDATE public.super_admin_credentials c SET totp_secret_enc=NULL, totp_enrolled_at=NULL,
     recovery_codes_hash='{}', recovery_codes_used=0, failed_attempts=0, locked_until=NULL
   FROM public.global_users u WHERE u.id=c.global_user_id AND u.email='qa-tester@tasqbots.com'`],
  { env: { ...process.env, PGPASSWORD: 'jainerp_dev' }, stdio: ['ignore', 'pipe', 'pipe'] });
const l = await post(SA, '/admin/auth/login', { identifier: 'qa-tester@tasqbots.com', password: 'QaTest@12345' });
const st = await post(SA, '/admin/auth/mfa/setup', { mfa_token: l.data.mfa_token });
const sec = st.data.otpauth_uri.match(/secret=([A-Z0-9]+)/)[1];
const mv = await post(SA, '/admin/auth/mfa/verify', { mfa_token: l.data.mfa_token, type: 'totp', code: authenticator.generate(sec) });
const SATOK = mv.data.access_token;

const devSees = async () => {
  const r = await (await fetch(`${DA}/temples/${SLUG}/payment-details`, {
    headers: { Authorization: `Bearer ${DTOK}` } })).json();
  return !!r.data?.bank_verified;
};
const sql = (db, q) => execFileSync('psql',
  ['-h', '127.0.0.1', '-p', '5433', '-U', 'jainerp', '-d', db, '-tAc', q],
  { env: { ...process.env, PGPASSWORD: 'jainerp_dev' }, encoding: 'utf8' }).trim();
const SCHEMA = 'tenant_04421be9ebb420aba729c625';

// Start from a clean slate: nominated, not verified.
sql('jainerp_pool_1', `UPDATE ${SCHEMA}.accounts SET donation_verified_at=NULL, donation_verified_hash=NULL, donation_verify_note=NULL`);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(25000);
const crashes = [];
page.on('pageerror', e => crashes.push(String(e).slice(0, 140)));

async function mandirSettings() {
  await page.goto(`${MW}/settings?tab=accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  return (await page.textContent('body')) ?? '';
}

try {
  // ── mandir-web login ────────────────────────────────────────────────────
  await page.goto(MW, { waitUntil: 'networkidle' });
  await page.fill('input[type=tel]', '9855121877');
  await page.click('button:has-text("Send OTP")');
  await page.waitForSelector('text=Dev mode — OTP:');
  await page.fill('input[maxlength="6"]', (await page.textContent('.font-mono.font-bold')).trim());
  await page.click('button:has-text("Verify OTP")');
  await page.waitForTimeout(1200);
  if (await page.locator('text=Select your temple').count()) await page.locator('.space-y-2 button').first().click();
  await page.waitForURL(/\/(dashboard|setup)/, { timeout: 20000 });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('jainerp-auth') ?? '{}');
    const ten = raw?.state?.tenant?.id, u = raw?.state?.user?.id;
    if (ten) localStorage.setItem(`jainerp_setup_wizard_offered:${ten}`, '1');
    if (ten && u) localStorage.setItem(`jainerp_tour_done:mandir:${ten}:${u}`, '1');
  });

  // ── 1. pending state is visible to the trust ────────────────────────────
  let body = await mandirSettings();
  rec('trust sees the donation-account card', /Account devotees pay into/i.test(body));
  rec('pending state is explained', /Waiting for JainERP to verify/i.test(body));
  rec('devotee sees no bank account while pending', (await devSees()) === false);
  await page.screenshot({ path: `${process.env.SHOTS}01-pending.png` });

  // ── 2. super admin verifies through the UI ──────────────────────────────
  await page.goto(SW, { waitUntil: 'networkidle' });
  await page.evaluate((s) => localStorage.setItem('jainerp_sa_session', JSON.stringify(s)), {
    access_token: SATOK, refresh_token: '', user: { id: '', name: 'QA', email: 'qa-tester@tasqbots.com', mobile: '' },
  });
  await page.goto(`${SW}/donation-accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const q = (await page.textContent('body')) ?? '';
  rec('queue lists the trust awaiting review',
    /E2E Test Trust/i.test(q) && /awaiting review/i.test(q));
  await page.screenshot({ path: `${process.env.SHOTS}02-queue.png` });

  await page.click('button:has-text("Verify")');
  await page.waitForTimeout(700);
  await page.fill('textarea', 'Cancelled cheque checked');
  await page.locator('.modal-actions button:has-text("Verify")').click();
  await page.waitForTimeout(1800);
  rec('devotee sees the account once verified', (await devSees()) === true);
  await page.screenshot({ path: `${process.env.SHOTS}03-verified.png` });

  // ── 3. the trust sees it locked ─────────────────────────────────────────
  body = await mandirSettings();
  rec('trust sees it verified', /Verified/i.test(body));
  rec('trust is told it is locked', /cannot be changed here/i.test(body));
  const radiosDisabled = await page.locator('input[type=radio]').evaluateAll(
    els => els.length > 0 && els.every(e => e.disabled));
  rec('the account choice is actually disabled, not just captioned', radiosDisabled);
  await page.screenshot({ path: `${process.env.SHOTS}04-locked.png` });

  // ── 4. the case this was built for: edited after approval ───────────────
  sql('jainerp_pool_1', `UPDATE ${SCHEMA}.accounts SET account_no='77777777777777' WHERE is_primary_for_donations`);
  rec('devotee stops seeing it after the account is edited', (await devSees()) === false);
  body = await mandirSettings();
  rec('trust is told the details changed after verification',
    /changed after they were verified/i.test(body));
  await page.screenshot({ path: `${process.env.SHOTS}05-changed.png` });

  await page.goto(`${SW}/donation-accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  rec('it reappears in the review queue, flagged',
    /edited after approval/i.test((await page.textContent('body')) ?? ''));
  await page.screenshot({ path: `${process.env.SHOTS}06-requeued.png` });

  rec('no unhandled client errors', crashes.length === 0, crashes.slice(0, 2).join(' | '));
} catch (e) {
  rec('FATAL', false, String(e).slice(0, 220));
  await page.screenshot({ path: `${process.env.SHOTS}99-fatal.png` }).catch(() => {});
} finally {
  await browser.close();
}

const pass = results.filter(r => r.ok).length;
console.log(`\n  ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
