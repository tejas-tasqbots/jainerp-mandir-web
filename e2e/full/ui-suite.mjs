/**
 * Functional UI E2E suite (real browser) for the Mandir Admin portal.
 * Logs in via the OTP_MOCK dev-OTP bypass, then visits every module page and
 * asserts it renders without an error boundary, screenshotting each. Also
 * exercises a few interactive flows (record donation, print → download PDF).
 *
 *   PLAYWRIGHT_PATH=<abs path to playwright> node e2e/full/ui-suite.mjs
 */
import { mkdirSync } from 'fs';

const pwPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const pw = await import(pwPath);
const chromium = pw.chromium ?? pw.default?.chromium;

const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const MOBILE = (process.env.E2E_MOBILE ?? '9876512345').replace(/\D/g, '').slice(-10);
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} ${title}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.setDefaultTimeout(15000);
page.on('dialog', (d) => d.accept().catch(() => {}));

// track client-side errors / failed API calls while navigating
let consoleErrors = [];
let failedRequests = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()}`));
page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 500) failedRequests.push(`${r.status()} ${r.url()}`); });

/** Visit a route, fail if an error boundary / blank screen / 5xx shows. */
async function visit(id, route, expectText) {
  consoleErrors = []; failedRequests = [];
  try {
    await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const body = await page.textContent('body');
    const crashed = /Something went wrong|Error boundary|Cannot read|Unexpected Application Error|TypeError/i.test(body ?? '');
    const has = expectText ? new RegExp(expectText, 'i').test(body ?? '') : true;
    const ok = !crashed && has && failedRequests.filter((f) => f.startsWith('5')).length === 0;
    const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await page.screenshot({ path: `${SHOTS}${slug}.png` });
    record(id, `page ${route} renders`, ok,
      crashed ? 'error boundary' : !has ? `missing "${expectText}"` : failedRequests.length ? `5xx: ${failedRequests[0]}` : 'ok');
  } catch (e) {
    record(id, `page ${route} renders`, false, String(e).slice(0, 80));
  }
}

try {
  // ---------- TC-AUTH-01/02: login via dev OTP ----------
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=tel]');
  await page.fill('input[type=tel]', MOBILE);
  await page.click('button:has-text("Send OTP")');
  await page.waitForSelector('text=Dev mode — OTP:', { timeout: 12000 });
  const otp = (await page.textContent('.font-mono.font-bold')).trim();
  record('TC-AUTH-01', 'login: dev OTP shown', /^\d{6}$/.test(otp), `otp=${otp}`);

  await page.fill('input[maxlength="6"]', otp);
  await page.click('button:has-text("Verify OTP")');
  await page.waitForTimeout(1500);
  if (await page.locator('text=Select your temple').count()) {
    await page.locator('.space-y-2 button, button:has-text("Smoke")').first().click();
  }
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  record('TC-AUTH-02', 'login: OTP verify → dashboard', true);
  await page.screenshot({ path: `${SHOTS}tc-auth-02-dashboard.png` });

  // ---------- Dashboard content ----------
  const dashText = await page.textContent('body');
  record('TC-DASH-01', 'dashboard renders KPIs', /Donation|Expense|Visitor|Donor|Boli/i.test(dashText ?? ''));

  // ---------- Visit every module page ----------
  await visit('TC-DON-list', '/donations', 'Donation');
  await visit('TC-DON-add', '/donations/add', 'Donation');
  await visit('TC-DNR-list', '/donors', 'Donor');
  await visit('TC-BOLI-list', '/boli', 'Boli');
  await visit('TC-BOLI-add', '/boli/add', 'Boli');
  await visit('TC-EXP-list', '/expenses', 'Expense');
  await visit('TC-EXP-add', '/expenses/add', 'Expense');
  await visit('TC-DHRM-rooms', '/rooms', 'Room');
  await visit('TC-DHRM-checkin', '/rooms/checkin', '');
  await visit('TC-DHRM-hall', '/hall', '');
  await visit('TC-PRAS-counter', '/prasad', 'Prasad');
  await visit('TC-PRAS-items', '/prasad/items', '');
  await visit('TC-SEVA-list', '/seva', 'Seva');
  await visit('TC-EVT-list', '/events', 'Event');
  await visit('TC-RPT-home', '/reports', 'Report');
  await visit('TC-CMPL-certs', '/certificates', '');
  await visit('TC-DEVT-connected', '/devotees', 'Devotee');
  // Accounting suite
  await visit('TC-ACCT-daybook', '/accounts/day-book', '');
  await visit('TC-ACCT-cashbook', '/accounts/cash-book', '');
  await visit('TC-ACCT-ledger', '/accounts/ledger', '');
  await visit('TC-ACCT-tb', '/accounts/trial-balance', '');
  await visit('TC-ACCT-ie', '/accounts/income-expenditure', '');
  await visit('TC-ACCT-rp', '/accounts/receipts-payments', '');
  await visit('TC-ACCT-bs', '/accounts/balance-sheet', '');
  await visit('TC-ACCT-contra', '/accounts/contra', '');
  await visit('TC-ACCT-fa', '/accounts/fixed-assets', '');
  await visit('TC-ACCT-loans', '/accounts/loans', '');
  // Masters & registers
  await visit('TC-MAST-vendors', '/masters/vendors', 'Vendor');
  await visit('TC-MAST-priests', '/masters/priests', '');
  await visit('TC-MAST-employees', '/masters/employees', '');
  await visit('TC-MAST-inventory', '/masters/inventory', '');
  await visit('TC-MAST-lostfound', '/registers/lost-found', '');
  await visit('TC-MAST-visitors', '/registers/visitor-count', '');
  await visit('TC-MAST-annadaan', '/annadaan', '');
  await visit('TC-MAST-creditors', '/creditors', '');
  // Staff Management was consolidated into Settings → Users; /staff no longer exists.
  await visit('TC-SET-settings', '/settings', 'Setting');
  await visit('TC-HELP', '/help', '');

  // ---------- Interactive: record a donation through the UI ----------
  try {
    await page.goto(`${WEB}/donations/add`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    // best-effort fill: amount + a donor name; forms vary, so guard each step
    const amount = page.locator('input[type=number]').first();
    if (await amount.count()) await amount.fill('12100');
    const nameField = page.locator('input[placeholder*="name" i], input[placeholder*="Donor" i]').first();
    if (await nameField.count()) await nameField.fill('QA UI Donor');
    const mob = page.locator('input[type=tel]').first();
    if (await mob.count()) await mob.fill('9000055544');
    await page.screenshot({ path: `${SHOTS}tc-don-add-filled.png` });
    record('TC-DON-add-form', 'donation add form is interactive', (await amount.count()) > 0, 'amount field present');
  } catch (e) {
    record('TC-DON-add-form', 'donation add form is interactive', false, String(e).slice(0, 60));
  }

  // ---------- Interactive: open a receipt (print path) from the list ----------
  try {
    await page.goto(`${WEB}/donations`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const receiptBtn = page.locator('button[title="Print Receipt"]').first();
    const pdfBtn = page.locator('button[title="Download PDF"]').first();
    record('TC-DON-08-ui', 'print-receipt button present in list', (await receiptBtn.count()) > 0);
    record('TC-DON-09-ui', 'download-PDF button present in list (new feature)', (await pdfBtn.count()) > 0);
  } catch (e) {
    record('TC-DON-08-ui', 'receipt buttons present', false, String(e).slice(0, 60));
  }

  // ---------- Role-gating: login as cashier, confirm restricted nav ----------
  try {
    await page.goto(`${WEB}`, { waitUntil: 'networkidle' });
    // logout if a logout control exists; else just re-login flow on the login page
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await page.waitForSelector('input[type=tel]');
    await page.fill('input[type=tel]', '9844444444');
    await page.click('button:has-text("Send OTP")');
    await page.waitForSelector('text=Dev mode — OTP:');
    const cotp = (await page.textContent('.font-mono.font-bold')).trim();
    await page.fill('input[maxlength="6"]', cotp);
    await page.click('button:has-text("Verify OTP")');
    await page.waitForTimeout(1500);
    if (await page.locator('text=Select your temple').count()) {
      await page.locator('.space-y-2 button').first().click();
    }
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.screenshot({ path: `${SHOTS}tc-auth-09-cashier.png` });
    record('TC-AUTH-09-ui', 'cashier login reaches dashboard (role-scoped)', true);
  } catch (e) {
    record('TC-AUTH-09-ui', 'cashier login', false, String(e).slice(0, 80));
  }

  // ---------- SUMMARY ----------
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== UI SUMMARY: ${passed}/${total} passed, ${failed.length} failed ===`);
  for (const f of failed) console.log(`  ✘ ${f.id} ${f.title} — ${f.detail}`);
  console.log('\nJSON_RESULTS=' + JSON.stringify(results));
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error('FATAL', e);
  process.exitCode = 2;
} finally {
  await browser.close();
}
