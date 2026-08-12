/**
 * Full-coverage route sweep.
 *
 * Visits EVERY route a portal declares, and fails a route on any of:
 *   - a React error boundary / thrown exception
 *   - a 5xx from the API while the page loaded
 *   - a silent redirect to a different path (a dead route the catch-all ate)
 *   - horizontal overflow at the target viewport
 *   - an untranslated i18n key leaking into the DOM ("some.key.path")
 *   - a raw "undefined"/"NaN"/"[object Object]" rendered as content
 *
 * The last three are the ones ordinary smoke tests miss: the page renders, the
 * suite goes green, and the customer sees NaN.
 */
import { mkdirSync, writeFileSync } from 'fs';

const pw = await import(process.env.PLAYWRIGHT_PATH);
const chromium = pw.chromium ?? pw.default?.chromium;

const APP = process.env.APP;
const WEB = process.env.WEB;
const ROUTES = JSON.parse(process.env.ROUTES);
const LOGIN = process.env.LOGIN ?? 'mandir';       // mandir | devotee | sant | superadmin
const MOBILE = process.env.MOBILE ?? '';
const SLUG = process.env.SLUG ?? '';
const VIEWPORT = LOGIN === 'devotee' ? { width: 390, height: 844 } : { width: 1440, height: 950 };
const SHOTS = `${process.env.SHOTS}${APP}/`;
mkdirSync(SHOTS, { recursive: true });

const results = [];
const rec = (id, title, ok, detail = '') => {
  results.push({ id, title, ok, detail });
  if (!ok) console.log(`  ✘ ${id} ${title} — ${detail}`);
};

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
page.setDefaultTimeout(25000);
page.on('dialog', (d) => d.accept().catch(() => {}));

let pageErrors = [];
let serverErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));
page.on('response', (r) => {
  if (/\/api\//.test(r.url()) && r.status() >= 500) serverErrors.push(`${r.status()} ${new URL(r.url()).pathname}`);
});

async function otpLogin(mobileSel, sendText, verifyText) {
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.waitForSelector(mobileSel, { timeout: 25000 });
  await page.locator(mobileSel).first().fill(MOBILE);
  await page.locator(`button:has-text("${sendText}")`).first().click();
  await page.waitForSelector('text=OTP:', { timeout: 25000 });
  const otp = (await page.textContent('.font-mono.font-bold')).trim();
  await page.locator('input[maxlength="6"]').first().fill(otp);
  await page.locator(`button:has-text("${verifyText}")`).first().click();
  await page.waitForTimeout(1500);
  if (await page.locator('text=Select your temple').count()) {
    await page.locator('.space-y-2 button').first().click();
  }
  await page.waitForTimeout(2500);
}

/** Suppress first-run overlays so they do not sit on top of every route. */
async function suppressFirstRun() {
  await page.evaluate(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('jainerp-auth') ?? '{}');
      const t = raw?.state?.tenant?.id, u = raw?.state?.user?.id;
      if (t) localStorage.setItem(`jainerp_setup_wizard_offered:${t}`, '1');
      if (t && u) localStorage.setItem(`jainerp_tour_done:mandir:${t}:${u}`, '1');
    } catch { /* ignore */ }
  });
}

const KEY_LEAK = /(?:^|\s)((?:setup|setupWizard|tour|nav|settings|common|ui|titles|login|dashboard)\.[a-zA-Z0-9_.]{3,})(?:\s|$)/;

async function visit(route) {
  pageErrors = []; serverErrors = [];
  const id = `${APP}${route}`;
  try {
    await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    // Dismiss any modal that would cover the page.
    const dlg = page.locator('[role="dialog"][aria-modal="true"]');
    if (await dlg.count()) {
      const skip = dlg.locator('button:has-text("Skip"), button:has-text("Close")').first();
      if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(300); }
    }

    const body = (await page.textContent('body')) ?? '';
    const landed = new URL(page.url()).pathname;
    const want = route.split('?')[0];

    const crashed = /Something went wrong|Unexpected Application Error|Error boundary/i.test(body);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const keyLeak = KEY_LEAK.exec(body);
    // "undefined"/"NaN" rendered as visible content. Guard against false hits
    // in code samples by only looking at short standalone tokens.
    const junk = /(?:^|[\s>₹])(undefined|NaN|\[object Object\])(?:[\s<,.]|$)/.exec(body);

    const problems = [];
    if (crashed) problems.push('error boundary');
    if (pageErrors.length) problems.push(`js: ${pageErrors[0]}`);
    if (serverErrors.length) problems.push(`api: ${serverErrors[0]}`);
    if (landed !== want) problems.push(`redirected to ${landed}`);
    if (overflow > 1) problems.push(`h-overflow ${overflow}px`);
    if (keyLeak) problems.push(`raw i18n key "${keyLeak[1]}"`);
    if (junk) problems.push(`renders "${junk[1]}"`);

    const slug = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
    await page.screenshot({ path: `${SHOTS}${slug}.png` }).catch(() => {});
    rec(id, `route ${route}`, problems.length === 0, problems.join('; '));
  } catch (e) {
    rec(id, `route ${route}`, false, String(e).slice(0, 120));
  }
}

try {
  if (LOGIN === 'mandir') { await otpLogin('input[type=tel]', 'Send OTP', 'Verify OTP'); await suppressFirstRun(); }
  else if (LOGIN === 'devotee') await otpLogin('input[inputmode="numeric"]', 'Send', 'Verify');
  else if (LOGIN === 'sant') await otpLogin('input[type=tel], input[inputmode="numeric"]', 'Send', 'Verify');

  for (const r of ROUTES) await visit(r);
} catch (e) {
  rec(`${APP}-FATAL`, 'sweep completed', false, String(e).slice(0, 200));
  await page.screenshot({ path: `${SHOTS}99-fatal.png` }).catch(() => {});
} finally {
  await browser.close();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n  ${APP}: ${pass}/${results.length} routes clean`);
writeFileSync(`${process.env.SHOTS}${APP}.json`, JSON.stringify(results, null, 2));
process.exit(0);
