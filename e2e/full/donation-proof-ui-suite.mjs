/**
 * The two screens the report came from, driven for real.
 *
 * The API tests prove the rules hold. What they cannot prove is the thing that
 * was actually wrong: that the trust was looking at TWO copies of one bank
 * account on one tab, and the reviewer was looking at digits with nothing to
 * check them against.
 */
import { execFileSync } from 'node:child_process';

const pw = await import(process.env.PLAYWRIGHT_PATH);
const chromium = pw.chromium ?? pw.default?.chromium;
const { authenticator } = await import(
  '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/superadmin-web/node_modules/otplib/index.js'
);

const MW = process.env.MW, SW = process.env.SW, MA = process.env.MA, SA = process.env.SA;
const SLUG = 'e2e-test-trust-55121877';
const SHOTS = process.env.SHOTS;

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

const sql = (db, q) => execFileSync('psql',
  ['-h', '127.0.0.1', '-p', process.env.PGPORT ?? '5434', '-U', 'jainerp', '-d', db, '-tAc', q],
  { env: { ...process.env, PGPASSWORD: 'jainerp_dev' }, encoding: 'utf8' }).trim();

const SCHEMA = sql('jainerp', `SELECT schema_name FROM public.tenants WHERE slug='${SLUG}'`);

// Start unverified with no proof — the state a trust is actually in when it
// first reaches this screen, and the one the screenshot showed.
sql('jainerp_pool_1', `UPDATE ${SCHEMA}.accounts SET donation_verified_at=NULL, donation_verified_hash=NULL,
  donation_verify_note=NULL, donation_proof_data=NULL, donation_proof_mime=NULL,
  donation_proof_kind=NULL, donation_proof_uploaded_at=NULL`);

sql('jainerp', `UPDATE public.super_admin_credentials c SET totp_secret_enc=NULL, totp_enrolled_at=NULL,
   recovery_codes_hash='{}', recovery_codes_used=0, failed_attempts=0, locked_until=NULL
   FROM public.global_users u WHERE u.id=c.global_user_id AND u.email='qa-tester@tasqbots.com'`);
const l = await post(SA, '/admin/auth/login', { identifier: 'qa-tester@tasqbots.com', password: 'QaTest@12345' });
const st = await post(SA, '/admin/auth/mfa/setup', { mfa_token: l.data.mfa_token });
const sec = st.data.otpauth_uri.match(/secret=([A-Z0-9]+)/)[1];
const mv = await post(SA, '/admin/auth/mfa/verify', { mfa_token: l.data.mfa_token, type: 'totp', code: authenticator.generate(sec) });
const SATOK = mv.data.access_token;

// A real JPEG on disk for the file input to pick up.
const FIXTURE = `${SHOTS}passbook.png`;
execFileSync('bash', ['-c',
  `printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAPElEQVR42u3QMQEAAAgDoJnc6BfhWwezRHJ1qgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBATuBQzXAAFXbGLoAAAAAElFTkSuQmCC' | base64 -d > ${FIXTURE}`]);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
const page = await ctx.newPage();
page.setDefaultTimeout(25000);
const crashes = [];
page.on('pageerror', e => crashes.push(String(e).slice(0, 140)));

try {
  // ── the trust's Settings → Bank & Cash Accounts ─────────────────────────
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

  await page.goto(`${MW}/settings?tab=accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  let body = (await page.textContent('body')) ?? '';
  await page.screenshot({ path: `${SHOTS}10-accounts-tab.png`, fullPage: true });

  // THE defect from the screenshot: one bank account, shown twice, each with
  // its own approval. The second copy was the four "Request change" fields.
  // Matched on the heading and on the input LABELS, not on prose: the proof
  // help text legitimately says "the account holder name, account number and
  // IFSC", and asserting on that phrase failed against copy that was correct.
  const labelCount = await page.locator('label.form-label, .form-label').evaluateAll(
    els => els.filter(e => /account holder name|account number|ifsc|bank name/i.test(e.textContent ?? '')).length);
  rec('the duplicate bank block is gone from Donor Payments',
    !/Bank account \(shown for NEFT/i.test(body) && labelCount === 0,
    `${labelCount} legacy bank field labels`);
  rec('there is no second "Request change" flow for the same account',
    !/Request change/i.test(body.split('Account devotees pay into')[1] ?? body));
  rec('the account still appears once, in the nominated card',
    /Account devotees pay into/i.test(body));
  rec('the UPI field is still here and is the only one',
    (body.match(/UPI ID \(VPA\)/gi) ?? []).length === 1);

  // ── the proof upload ────────────────────────────────────────────────────
  rec('the trust is asked for a passbook page', /Proof this account belongs to the trust/i.test(body));
  rec('the trust is told this is what is blocking them',
    /this is what is holding up your bank transfer option/i.test(body));

  await page.setInputFiles('input[type=file]', FIXTURE);
  await page.waitForTimeout(2500);
  body = (await page.textContent('body')) ?? '';
  rec('the upload is confirmed on screen', /Uploaded/i.test(body));
  rec('the blocking warning clears once uploaded',
    !/this is what is holding up your bank transfer option/i.test(body));
  await page.screenshot({ path: `${SHOTS}11-proof-uploaded.png`, fullPage: true });

  // The preview is already open — uploading shows what was just sent, so the
  // button reads "Hide" at this point. Toggling it twice proves both ways.
  await page.click('button:has-text("Hide")');
  await page.waitForTimeout(600);
  await page.click('button:has-text("View uploaded photo")');
  await page.waitForTimeout(1500);
  const shown = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')].find(i => i.src.startsWith('data:image'));
    // naturalWidth > 0 is the only honest test that the bytes decoded — a
    // broken <img> still has a src and still passes a selector check.
    return img ? { ok: img.naturalWidth > 0, w: img.naturalWidth } : null;
  });
  rec('the uploaded photo actually renders', !!shown?.ok, shown ? `${shown.w}px wide` : 'no data: image');
  await page.screenshot({ path: `${SHOTS}12-proof-preview.png`, fullPage: true });

  // ── the super admin's queue ─────────────────────────────────────────────
  await page.goto(SW, { waitUntil: 'networkidle' });
  await page.evaluate((s) => localStorage.setItem('jainerp_sa_session', JSON.stringify(s)), {
    access_token: SATOK, refresh_token: '', user: { id: '', name: 'QA', email: 'qa-tester@tasqbots.com', mobile: '' },
  });
  await page.goto(`${SW}/donation-accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  body = (await page.textContent('body')) ?? '';
  await page.screenshot({ path: `${SHOTS}13-sa-queue.png`, fullPage: true });

  // "in super admin I can't see this bank details" — they are in the row.
  rec('the queue shows the account number', /\d{6,}/.test(body));
  rec('the queue shows whether proof was uploaded', /Passbook first page/i.test(body));

  await page.click('button:has-text("Review & verify")');
  await page.waitForTimeout(2000);
  body = (await page.textContent('body')) ?? '';
  rec('the review shows the holder name', /Account holder/i.test(body));
  rec('the review shows the account number', /Account number/i.test(body));
  rec('the review shows the IFSC', /IFSC/i.test(body));
  const modalImg = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')].find(i => i.src.startsWith('data:image'));
    return img ? { ok: img.naturalWidth > 0, w: img.naturalWidth } : null;
  });
  rec('the reviewer can see the passbook page itself', !!modalImg?.ok,
    modalImg ? `${modalImg.w}px wide` : 'no image in the modal');
  await page.screenshot({ path: `${SHOTS}14-sa-review.png`, fullPage: true });

  await page.fill('textarea', 'Passbook matches the account number and IFSC');
  await page.locator('.modal-actions button:has-text("Verify")').click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOTS}15-sa-verified.png`, fullPage: true });

  // ── back on the trust's side: verified, and approved exactly once ───────
  await page.goto(`${MW}/settings?tab=accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  body = (await page.textContent('body')) ?? '';
  rec('the trust sees it verified', /Verified/i.test(body));
  rec('there is no second approval still outstanding', !/Request change/i.test(body));
  const radiosDisabled = await page.locator('input[type=radio][name="donation-account"]')
    .evaluateAll(els => els.length > 0 && els.every(e => e.disabled));
  rec('the choice is locked once verified', radiosDisabled);
  await page.screenshot({ path: `${SHOTS}16-trust-verified.png`, fullPage: true });

  rec('no unhandled client errors', crashes.length === 0, crashes.slice(0, 2).join(' | '));
} catch (e) {
  rec('FATAL', false, String(e).slice(0, 240));
  await page.screenshot({ path: `${SHOTS}99-fatal.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const pass = results.filter(r => r.ok).length;
console.log(`\n  ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
