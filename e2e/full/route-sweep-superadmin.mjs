/**
 * Super-admin console sweep. Same checks as sweep.mjs, but the login is
 * password + TOTP rather than OTP, so it drives the real MFA screens.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { execFileSync } from 'node:child_process';

const pw = await import(process.env.PLAYWRIGHT_PATH);
const chromium = pw.chromium ?? pw.default?.chromium;
const { authenticator } = await import(
  '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/superadmin-web/node_modules/otplib/index.js'
);

const WEB = process.env.WEB;
const API = process.env.API;
const ROUTES = JSON.parse(process.env.ROUTES);
const SHOTS = `${process.env.SHOTS}superadmin-web/`;
mkdirSync(SHOTS, { recursive: true });

const QA_ID = 'qa-tester@tasqbots.com';
const QA_PASSWORD = 'QaTest@12345';

// Enrolment is one-shot, so clear it first — otherwise the second run of this
// sweep can never obtain a secret it knows.
execFileSync('psql', ['-h', '127.0.0.1', '-p', '5433', '-U', 'jainerp', '-d', 'jainerp', '-tAc',
  `UPDATE public.super_admin_credentials c SET totp_secret_enc=NULL, totp_enrolled_at=NULL,
     recovery_codes_hash='{}', recovery_codes_used=0, failed_attempts=0, locked_until=NULL
   FROM public.global_users u WHERE u.id=c.global_user_id AND u.email='${QA_ID}'`],
  { env: { ...process.env, PGPASSWORD: 'jainerp_dev' }, stdio: ['ignore', 'pipe', 'pipe'] });

const j = async (path, body) => {
  const r = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
};
const login = await j('/admin/auth/login', { identifier: QA_ID, password: QA_PASSWORD });
const mfaToken = login.data?.mfa_token;
if (!mfaToken) throw new Error(`login failed: ${JSON.stringify(login)}`);
const setup = await j('/admin/auth/mfa/setup', { mfa_token: mfaToken });
const secret = setup.data?.otpauth_uri?.match(/secret=([A-Z0-9]+)/)?.[1];
if (!secret) throw new Error(`no secret: ${JSON.stringify(setup)}`);
const verify = await j('/admin/auth/mfa/verify', {
  mfa_token: mfaToken, type: 'totp', code: authenticator.generate(secret),
});
const token = verify.data?.access_token;
if (!token) throw new Error(`mfa verify failed: ${JSON.stringify(verify)}`);

const results = [];
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  if (!ok) console.log(`  ✘ ${id} — ${detail}`);
};

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(25000);
page.on('dialog', (d) => d.accept().catch(() => {}));
let pageErrors = [], serverErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));
page.on('response', (r) => {
  if (/\/api\//.test(r.url()) && r.status() >= 500) serverErrors.push(`${r.status()} ${new URL(r.url()).pathname}`);
});

const KEY_LEAK = /(?:^|\s)((?:nav|settings|common|ui|titles|login|dashboard)\.[a-zA-Z0-9_.]{3,})(?:\s|$)/;

try {
  // Seed the token the way the app stores it, then reload into a live session.
  await page.goto(WEB, { waitUntil: 'networkidle' });
  // superadmin-web stores the whole Session under one key (api/client.ts).
  await page.evaluate((s) => localStorage.setItem('jainerp_sa_session', JSON.stringify(s)), {
    access_token: token,
    refresh_token: verify.data?.refresh_token ?? '',
    user: verify.data?.user ?? { id: '', name: 'QA Tester', email: QA_ID, mobile: '' },
  });

  for (const route of ROUTES) {
    pageErrors = []; serverErrors = [];
    try {
      await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1100);
      const body = (await page.textContent('body')) ?? '';
      const landed = new URL(page.url()).pathname;
      const problems = [];
      if (/Something went wrong|Unexpected Application Error/i.test(body)) problems.push('error boundary');
      if (pageErrors.length) problems.push(`js: ${pageErrors[0]}`);
      if (serverErrors.length) problems.push(`api: ${serverErrors[0]}`);
      if (landed === '/login' && route !== '/login') problems.push('bounced to /login (token not accepted)');
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`h-overflow ${overflow}px`);
      const k = KEY_LEAK.exec(body); if (k) problems.push(`raw i18n key "${k[1]}"`);
      const junk = /(?:^|[\s>₹])(undefined|NaN|\[object Object\])(?:[\s<,.]|$)/.exec(body);
      if (junk) problems.push(`renders "${junk[1]}"`);
      const slug = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
      await page.screenshot({ path: `${SHOTS}${slug}.png` }).catch(() => {});
      rec(`superadmin-web${route}`, problems.length === 0, problems.join('; '));
    } catch (e) {
      rec(`superadmin-web${route}`, false, String(e).slice(0, 120));
    }
  }
} finally {
  await browser.close();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n  superadmin-web: ${pass}/${results.length} routes clean`);
writeFileSync(`${process.env.SHOTS}superadmin-web.json`, JSON.stringify(results, null, 2));
process.exit(0);
