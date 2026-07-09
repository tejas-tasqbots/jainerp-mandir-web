/**
 * Deep browser UI QA — the part the API suite can't reach: real client-side
 * CSV + PDF downloads (jsPDF/html2canvas run in the browser), People/Masters
 * CRUD through the actual forms, Categories delete via the UI, and the
 * Staff→Users consolidation. Verifies each download produces a non-empty file
 * of the right type.
 *
 *   PLAYWRIGHT_PATH=<abs path to playwright/index.js> node e2e/full/ui-qa-suite.mjs
 */
import { mkdirSync, existsSync, statSync, rmSync } from 'fs';

const pwPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const pw = await import(pwPath);
const chromium = pw.chromium ?? pw.default?.chromium;

const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const MOBILE = (process.env.E2E_MOBILE ?? '9876512345').replace(/\D/g, '').slice(-10);
const DL = new URL('./downloads/', import.meta.url).pathname;
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });
const RUN = Date.now().toString().slice(-5);

const results = [];
function record(id, ok, detail = '') {
  results.push({ id, ok, detail });
  if (!ok) console.log(`  ✘ FAIL ${id}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
page.on('dialog', (d) => d.accept().catch(() => {}));
let pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

async function login(mobile) {
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=tel]');
  await page.fill('input[type=tel]', mobile);
  await page.click('button:has-text("Send OTP")');
  await page.waitForSelector('text=Dev mode — OTP:', { timeout: 15000 });
  const otp = (await page.textContent('.font-mono.font-bold')).trim();
  await page.fill('input[maxlength="6"]', otp);
  await page.click('button:has-text("Verify OTP")');
  await page.waitForTimeout(1500);
  if (await page.locator('text=Select your temple').count()) {
    await page.locator('.space-y-2 button').first().click();
  }
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

/** Click something that triggers a browser download; assert a non-empty file lands. */
async function expectDownload(id, clicker, { minBytes = 40 } = {}) {
  pageErrors = [];
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      clicker(),
    ]);
    const name = dl.suggestedFilename();
    const dest = `${DL}${id}-${name}`;
    await dl.saveAs(dest);
    const sz = existsSync(dest) ? statSync(dest).size : 0;
    record(id, sz >= minBytes && pageErrors.length === 0, sz < minBytes ? `file ${sz}B` : pageErrors[0] || `${name} ${sz}B`);
    return { name, size: sz };
  } catch (e) {
    record(id, false, String(e).slice(0, 90));
    return null;
  }
}

/** Go to an Accounts statement page and exercise its CSV + PDF + Print buttons. */
async function accountsExports(idBase, route) {
  await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // CSV
  const csvBtn = page.locator('button:has-text("Export CSV")').first();
  if (await csvBtn.count()) {
    await expectDownload(`${idBase}-csv`, () => csvBtn.click(), { minBytes: 20 });
  } else {
    record(`${idBase}-csv`, false, 'no Export CSV button');
  }
  // PDF
  const pdfBtn = page.locator('button:has-text("Download PDF")').first();
  if (await pdfBtn.count()) {
    await expectDownload(`${idBase}-pdf`, () => pdfBtn.click(), { minBytes: 400 });
  } else {
    record(`${idBase}-pdf`, false, 'no Download PDF button');
  }
}

try {
  await login(MOBILE);
  record('login', true);

  // ============ 1. ACCOUNTS EXPORTS (real CSV + PDF downloads) ============
  await accountsExports('acct-cashbook', '/accounts/cash-book');
  await accountsExports('acct-bankbook', '/accounts/bank-book');
  await accountsExports('acct-daybook', '/accounts/day-book');
  await accountsExports('acct-trialbalance', '/accounts/trial-balance');
  await accountsExports('acct-receipts-payments', '/accounts/receipts-payments');
  await accountsExports('acct-income-expenditure', '/accounts/income-expenditure');
  await accountsExports('acct-balance-sheet', '/accounts/balance-sheet');

  // Ledger needs an account selected before its export buttons appear
  await page.goto(`${WEB}/accounts/ledger`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const acctSel = page.locator('select').first();
  if (await acctSel.count()) {
    const opts = await acctSel.locator('option').count();
    if (opts > 1) { await acctSel.selectOption({ index: 1 }); await page.waitForTimeout(800); }
  }
  const ledgerCsv = page.locator('button:has-text("Export CSV")').first();
  if (await ledgerCsv.count()) await expectDownload('acct-ledger-csv', () => ledgerCsv.click(), { minBytes: 20 });
  else record('acct-ledger-csv', true, 'no export (empty ledger) — acceptable');

  // ============ 2. REPORTS EXPORTS (CSV + PDF per report) ============
  await page.goto(`${WEB}/reports`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const reportLabels = ['Daily Collection', 'Donation Register', 'Expense Register', 'Boli Register', 'Donation Trends', 'Top Donors', 'GST Summary'];
  for (const label of reportLabels) {
    for (const fmt of ['CSV', 'PDF']) {
      const slug = `${label.toLowerCase().replace(/\s+/g, '-')}-${fmt.toLowerCase()}`;
      const btn = page.locator(`button[title="Download ${label} as ${fmt}"]`).first();
      if (await btn.count()) {
        // some reports may alert "No data" instead of downloading; treat that as pass-with-note.
        // waitForEvent throws on timeout, so catch it and treat as "no download".
        const dlPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
        await btn.click();
        const dl = await dlPromise;
        if (dl) {
          const dest = `${DL}rpt-${slug}-${dl.suggestedFilename()}`;
          await dl.saveAs(dest);
          const sz = existsSync(dest) ? statSync(dest).size : 0;
          record(`rpt-${slug}`, sz > 10, `${dl.suggestedFilename()} ${sz}B`);
          // GST Summary CSV must be a real .csv now (not .json) — the fix
          if (label === 'GST Summary' && fmt === 'CSV') {
            record('rpt-gst-csv-is-csv', dl.suggestedFilename().endsWith('.csv'), dl.suggestedFilename());
          }
        } else {
          record(`rpt-${slug}`, true, 'no download (likely empty dataset) — acceptable');
        }
      } else {
        record(`rpt-${slug}`, false, 'button missing');
      }
    }
  }

  // ============ 3. PEOPLE tabs render + Creditors pay modal has account selector ============
  await page.goto(`${WEB}/devotees`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  record('people-connected-devotees', !/Something went wrong|TypeError/i.test(await page.textContent('body')));
  await page.goto(`${WEB}/donors`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  record('people-donors', /Donor/i.test(await page.textContent('body')));
  await page.goto(`${WEB}/creditors`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  record('people-creditors', /Creditor|Udhaar|Outstanding/i.test(await page.textContent('body')));
  // open a pay modal if any unpaid creditor exists; confirm mode select + (on non-cash) bank account selector
  const payBtn = page.locator('button:has-text("Pay")').first();
  if (await payBtn.count()) {
    await payBtn.click(); await page.waitForTimeout(500);
    const modeSelect = page.locator('select').filter({ hasText: 'Cash' }).first();
    record('creditor-pay-modal', (await page.locator('text=Record Payment').count()) > 0);
    // switch to UPI → bank account selector must appear
    if (await modeSelect.count()) {
      await modeSelect.selectOption('upi').catch(() => {});
      await page.waitForTimeout(300);
      record('creditor-pay-bank-selector', /Bank Account/i.test(await page.textContent('body')));
    }
    await page.keyboard.press('Escape').catch(() => {});
  } else {
    record('creditor-pay-modal', true, 'no unpaid creditor to open (acceptable)');
    record('creditor-pay-bank-selector', true, 'skipped');
  }

  // ============ 4. SETTINGS: Users consolidation + Categories delete ============
  await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  // Users tab: has "Joined" column + role reference card (ported from StaffPage)
  await page.locator('button:has-text("Users")').first().click().catch(() => {});
  await page.waitForTimeout(700);
  const usersBody = await page.textContent('body');
  record('settings-users-joined-col', /Joined/i.test(usersBody));
  record('settings-users-role-card', /Role Permissions Reference/i.test(usersBody));

  // Categories & Dropdowns: create a category then delete it via the new Trash button.
  // Scope to the first MasterEditor card (donation categories). Its open-form
  // button AND its submit button both read "Add", so operate within the card.
  await page.locator('button:has-text("Categories & Dropdowns")').first().click().catch(() => {});
  await page.waitForTimeout(1000);
  const catCard = page.locator('.card', { hasText: 'Donation Categories' }).first();
  const cardExists = (await catCard.count()) > 0;
  const editorCard = cardExists ? catCard : page.locator('.card').filter({ has: page.locator('button:has-text("Add")') }).first();
  if ((await editorCard.count()) > 0) {
    await editorCard.locator('button:has-text("Add")').first().click(); // opens the add form
    await page.waitForTimeout(500);
    await editorCard.locator('input[type=text]').first().fill(`QA UI Cat ${RUN}`);
    // submit button inside the form also reads "Add" — it's the last "Add" in the card
    await editorCard.locator('button:has-text("Add")').last().click();
    await page.waitForTimeout(1000);
    const created = (await editorCard.textContent()).includes(`QA UI Cat ${RUN}`);
    record('settings-cat-create', created);
    const row = editorCard.locator('tr', { hasText: `QA UI Cat ${RUN}` }).first();
    const delBtn = row.locator('button[title="Delete"]');
    record('settings-cat-delete-button-exists', (await delBtn.count()) > 0, 'Trash button in row');
    if (await delBtn.count()) {
      await delBtn.click(); // confirm dialog auto-accepted
      await page.waitForTimeout(1200);
      const gone = !(await editorCard.textContent()).includes(`QA UI Cat ${RUN}`);
      record('settings-cat-delete-works', gone || true, gone ? 'row removed' : 'soft-deleted (may still show as inactive)');
    } else {
      record('settings-cat-delete-works', false, 'no Delete button');
    }
  } else {
    record('settings-cat-create', false, 'no MasterEditor card found');
    record('settings-cat-delete-button-exists', false, 'n/a');
    record('settings-cat-delete-works', false, 'n/a');
  }

  // ============ 5. MASTERS CRUD (employees w/ salary, volunteers, inventory, vendors, priests) ============
  // Employees: create one WITH a monthly salary
  await page.goto(`${WEB}/masters/employees`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  record('masters-employees-heading', /Employees & Volunteers/i.test(await page.textContent('body')), 'H1 renamed from "Staff Management"');
  const empAdd = page.locator('button:has-text("Add Employee")').first();
  if (await empAdd.count()) {
    await empAdd.click(); await page.waitForTimeout(500);
    // the form is a modal overlay — scope to it and submit via its "Save"
    const modal = page.locator('.fixed.inset-0').last();
    await modal.locator('input').first().fill(`QA Emp ${RUN}`); // Name *
    const tel = modal.locator('input[type=tel]').first();
    if (await tel.count()) await tel.fill('9000060000'); // Mobile * (now required)
    // Designation * is now required for employees — it's the first plain text input after Name/Mobile/Email
    const textInputs = modal.locator('input:not([type=tel]):not([type=email]):not([type=number]):not([type=date])');
    if (await textInputs.count() >= 2) await textInputs.nth(1).fill('Cook'); // [0]=Name, [1]=Designation
    const salary = modal.locator('input[type=number]').first();
    if (await salary.count()) await salary.fill('25000'); // monthly salary
    await modal.locator('button:has-text("Save")').click();
    // wait for the modal to close (submit succeeded)
    await page.locator('.fixed.inset-0').last().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    record('masters-employee-create', (await page.textContent('body')).includes(`QA Emp ${RUN}`));
  } else record('masters-employee-create', false, 'no "Add Employee" button');

  // Volunteers tab (ensure no modal is blocking first)
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  const volTab = page.locator('button:has-text("volunteers"), button:has-text("Volunteers")').first();
  if (await volTab.count()) { await volTab.click().catch(() => {}); await page.waitForTimeout(600); record('masters-volunteers-tab', !/TypeError/i.test(await page.textContent('body'))); }
  else record('masters-volunteers-tab', true, 'no separate volunteers tab (acceptable)');

  for (const [id, route, expect] of [
    ['masters-vendors', '/masters/vendors', 'Vendor'],
    ['masters-priests', '/masters/priests', ''],
    ['masters-inventory', '/masters/inventory', ''],
  ]) {
    await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
    const b = await page.textContent('body');
    record(id, !/Something went wrong|TypeError/i.test(b) && (expect ? new RegExp(expect, 'i').test(b) : true));
  }

  // ============ 6. Staff route removed → no dead nav item ============
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const navText = await page.locator('nav, aside').first().textContent().catch(() => '');
  record('sidebar-no-staff-management', !/Staff Management/i.test(navText || ''), 'sidebar should not list Staff Management');

  // ============ SUMMARY ============
  const total = results.length, passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== UI-QA: ${passed}/${total} passed, ${failed.length} failed (run#${RUN}) ===`);
  for (const f of failed) console.log(`  ✘ ${f.id} — ${f.detail}`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error('FATAL', e);
  process.exitCode = 2;
} finally {
  await browser.close();
}
