/**
 * RBAC UI E2E suite — verifies the web app shows only what the logged-in role
 * may access, in lock-step with the server's @Roles guards.
 *
 * Regression for the bug where a cashier could open /settings by URL and the
 * page rendered + fired admin-only calls that 403'd (screenshot: `me` ->
 * FORBIDDEN "Requires role: temple_admin"). The RouteGuard now redirects such
 * navigations to /dashboard, and the sidebar already hides the module.
 *
 *   PLAYWRIGHT_PATH=<abs path> node e2e/full/rbac-ui-suite.mjs
 *
 * Prereq: web on :5173, api on :3106, smoke-portal tenant with the seeded roles.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const pw = require(pwPath);
const chromium = pw.chromium ?? pw.default?.chromium;

const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const ADMIN = '9876512345';
const CASHIER = '9844444444';
const BHOJ = '9833300011';

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${ok ? 'PASS' : 'FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function loginAs(page, mobile) {
  // Selectors mirror the working ui-suite.mjs login flow.
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=tel]');
  await page.fill('input[type=tel]', mobile);
  await page.click('button:has-text("Send OTP")');
  await page.waitForSelector('text=Dev mode — OTP:', { timeout: 12000 });
  const otp = (await page.textContent('.font-mono.font-bold')).trim();
  await page.fill('input[maxlength="6"]', otp);
  await page.click('button:has-text("Verify OTP")');
  await page.waitForTimeout(1500);
  // Tenant picker may appear (one mobile can belong to many mandirs).
  const picker = page.locator('.space-y-2 button, button:has-text("Smoke")');
  if (await picker.count()) { await picker.first().click(); }
  await page.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function run() {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

  // ── CASHIER ──────────────────────────────────────────────────────────────
  {
    const ctx = await browser.newContext(); // fresh storage per role (auth persists)
    const page = await ctx.newPage();
    await loginAs(page, CASHIER);
    const onDash = page.url().includes('/dashboard');
    record('RBAC-UI-01', 'P1', 'cashier lands on dashboard after login', onDash, page.url());

    // Sidebar must NOT contain a Settings link for a cashier
    const sidebarText = await page.textContent('aside, nav, [class*="sidebar" i]').catch(() => '');
    record('RBAC-UI-02', 'P1', 'cashier sidebar hides Settings', !/settings/i.test(sidebarText || ''));

    // Direct navigation to /settings must redirect away (RouteGuard)
    await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const redirected = !page.url().endsWith('/settings');
    record('RBAC-UI-03', 'P1', 'cashier navigating to /settings is redirected (not rendered)', redirected, page.url());

    // And no FORBIDDEN error surfaced (the original bug symptom)
    const bodyAfter = await page.textContent('body').catch(() => '');
    record('RBAC-UI-04', 'P2', 'no FORBIDDEN/temple_admin error shown to cashier',
      !/requires role|forbidden/i.test(bodyAfter || ''));

    // Direct nav to /accounts (accountant-only) also redirects
    await page.goto(`${WEB}/accounts/day-book`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    record('RBAC-UI-05', 'P2', 'cashier navigating to /accounts is redirected',
      !page.url().includes('/accounts'), page.url());

    // A module the cashier DOES have (donations) still renders
    await page.goto(`${WEB}/donations`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    record('RBAC-UI-06', 'P1', 'cashier CAN open an allowed module (/donations)',
      page.url().includes('/donations'), page.url());
    await page.close();
    await ctx.close();
  }

  // ── BHOJANSHALA CASHIER ──────────────────────────────────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, BHOJ);
    await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    record('RBAC-UI-07', 'P1', 'bhojanshala_cashier redirected off /settings',
      !page.url().endsWith('/settings'), page.url());
    await page.goto(`${WEB}/donations`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    record('RBAC-UI-08', 'P2', 'bhojanshala_cashier redirected off /donations (not in scope)',
      !page.url().includes('/donations'), page.url());
    await page.close();
    await ctx.close();
  }

  // ── TEMPLE ADMIN (control) ───────────────────────────────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, ADMIN);
    await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    record('RBAC-UI-09', 'P1', 'temple_admin CAN open /settings',
      page.url().includes('/settings'), page.url());
    const sidebarText = await page.textContent('aside, nav, [class*="sidebar" i]').catch(() => '');
    record('RBAC-UI-10', 'P2', 'temple_admin sidebar shows Settings', /settings/i.test(sidebarText || ''));
    await page.close();
    await ctx.close();
  }

  await browser.close();

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  const p1Failed = failed.filter(r => r.pri === 'P1');
  console.log(`\n=== RBAC-UI SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map(r => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
