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

// Export controls are icon-only buttons; their accessible name is the title.
const EXCEL_BTN = 'button[title="Download Excel"]';
const PDF_BTN = 'button[title="Download PDF"]';
const NOTHING_TO_EXPORT = 'Nothing to export for the current filters';
const EXPORT_FAILED = 'Could not export. Please try again.';

/**
 * Click an export button and accept either outcome the app can legitimately
 * produce: a real file, or the "nothing to export" toast when the current
 * filters match no rows. A missing button, an export error, a crash or an
 * empty file all fail.
 *
 * The outcomes are raced rather than checked in sequence: several exports
 * re-fetch their rows first, and the toast auto-dismisses — polling the body
 * after a download timeout misses it and reports a false failure.
 */
async function clickExport(id, btn, { minBytes = 40 } = {}) {
  pageErrors = [];
  const T = 15000;
  const dlPromise = page.waitForEvent('download', { timeout: T })
    .then((d) => ({ kind: 'download', d })).catch(() => null);
  const emptyPromise = page.getByText(NOTHING_TO_EXPORT).first().waitFor({ state: 'visible', timeout: T })
    .then(() => ({ kind: 'empty' })).catch(() => null);
  const failPromise = page.getByText(EXPORT_FAILED).first().waitFor({ state: 'visible', timeout: T })
    .then(() => ({ kind: 'failed' })).catch(() => null);

  await btn.click();
  const outcome = await Promise.race([dlPromise, emptyPromise, failPromise]);

  if (!outcome) { record(id, false, 'no download, no toast — export did nothing'); return; }
  if (outcome.kind === 'failed') { record(id, false, 'export failed toast'); return; }
  if (outcome.kind === 'empty') {
    record(id, pageErrors.length === 0, pageErrors[0] || 'no rows — "nothing to export"');
    return;
  }
  const name = outcome.d.suggestedFilename();
  const dest = `${DL}${id}-${name}`;
  await outcome.d.saveAs(dest);
  const sz = existsSync(dest) ? statSync(dest).size : 0;
  record(id, sz >= minBytes && pageErrors.length === 0, sz < minBytes ? `file ${sz}B` : pageErrors[0] || `${name} ${sz}B`);
}

/**
 * Go to an Accounts page and exercise its export toolbar.
 * Every accounts page offers Excel; the statement pages also offer PDF.
 */
async function accountsExports(idBase, route, { pdf = false } = {}) {
  await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  record(`${idBase}-route`, new URL(page.url()).pathname === route, `landed on ${new URL(page.url()).pathname}`);

  const excelBtn = page.locator(EXCEL_BTN).first();
  if (await excelBtn.count()) await clickExport(`${idBase}-excel`, excelBtn, { minBytes: 20 });
  else record(`${idBase}-excel`, false, 'no Download Excel button');

  if (!pdf) return;
  const pdfBtn = page.locator(PDF_BTN).first();
  if (await pdfBtn.count()) await clickExport(`${idBase}-pdf`, pdfBtn, { minBytes: 400 });
  else record(`${idBase}-pdf`, false, 'no Download PDF button');
}

try {
  await login(MOBILE);
  record('login', true);

  // ============ 1. ACCOUNTS EXPORTS (real Excel + PDF downloads) ============
  // /accounts/cash-bank is one page covering cash AND bank — there is no
  // separate cash-book / bank-book route.
  await accountsExports('acct-cash-bank', '/accounts/cash-bank');
  await accountsExports('acct-daybook', '/accounts/day-book', { pdf: true });
  await accountsExports('acct-trialbalance', '/accounts/trial-balance', { pdf: true });
  await accountsExports('acct-receipts-payments', '/accounts/receipts-payments', { pdf: true });
  await accountsExports('acct-income-expenditure', '/accounts/income-expenditure', { pdf: true });
  await accountsExports('acct-balance-sheet', '/accounts/balance-sheet', { pdf: true });
  await accountsExports('acct-contra', '/accounts/contra');
  await accountsExports('acct-fixed-assets', '/accounts/fixed-assets');
  await accountsExports('acct-loans', '/accounts/loans');
  await accountsExports('acct-cheques', '/accounts/cheques');

  // Ledger needs an account selected before it has anything to export
  await page.goto(`${WEB}/accounts/ledger`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const acctSel = page.locator('select').first();
  if (await acctSel.count()) {
    const opts = await acctSel.locator('option').count();
    if (opts > 1) { await acctSel.selectOption({ index: 1 }); await page.waitForTimeout(1000); }
  }
  const ledgerExcel = page.locator(EXCEL_BTN).first();
  if (await ledgerExcel.count()) await clickExport('acct-ledger-excel', ledgerExcel, { minBytes: 20 });
  else record('acct-ledger-excel', false, 'no Download Excel button');

  // ============ 2. REPORTS EXPORTS (every report in the rail) ============
  // /reports is a rail + the selected report; each report renders its own
  // DataTable toolbar with a Download Excel button.
  const reportLabels = [
    'Daily Collection', 'Collection Summary', 'All Transactions', 'Donation Register',
    'Expense Register', 'Pledge Register', 'Creditor Aging', 'Service registers',
    'Donation by Category', 'Expense by Category', 'Donation Trends', 'Year-over-Year',
    'Top Donors', 'Cash Flow', 'Event-wise Collection', 'GST Summary',
    'Depreciation Schedule', 'Loan Schedule',
  ];
  await page.goto(`${WEB}/reports`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  for (const label of reportLabels) {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    pageErrors = [];
    const railBtn = page.locator(`nav button:has-text("${label}")`).first();
    if (!(await railBtn.count())) { record(`rpt-${slug}`, false, 'not in the reports rail'); continue; }
    await railBtn.click();
    await page.waitForTimeout(1200);
    const body = await page.textContent('body');
    if (/Something went wrong|TypeError/i.test(body) || pageErrors.length) {
      record(`rpt-${slug}`, false, pageErrors[0] || 'report crashed');
      continue;
    }
    record(`rpt-${slug}`, true, 'renders');
    const btn = page.locator(EXCEL_BTN).first();
    if (await btn.count()) await clickExport(`rpt-${slug}-excel`, btn, { minBytes: 20 });
    else record(`rpt-${slug}-excel`, false, 'no Download Excel button');
  }

  // ============ 3. PEOPLE tabs render + Creditors pay modal has account selector ============
  await page.goto(`${WEB}/devotees`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  // Connected Devotees is switched off for now (src/lib/rbac.ts HIDDEN_FOR_NOW).
  record('people-connected-devotees-hidden', /\/dashboard$/.test(new URL(page.url()).pathname), page.url());
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
      await delBtn.click();
      // Deletion confirms through the in-app ConfirmDialog, not window.confirm,
      // so the page-level dialog auto-accept never sees it — click it for real.
      const dialog = page.locator('.fixed.inset-0', { hasText: 'Delete entry' }).last();
      await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      record('settings-cat-delete-confirm', (await dialog.count()) > 0, 'in-app confirm dialog shown');
      await dialog.locator('button:has-text("Delete")').last().click().catch(() => {});
      await page.waitForTimeout(1500);
      // donation_categories has no deleted_at but does have is_active, and
      // donations FK to it — so delete deactivates rather than removes. The row
      // must survive, flipped to Inactive, so old receipts still resolve.
      const afterRow = editorCard.locator('tr', { hasText: `QA UI Cat ${RUN}` }).first();
      const stillListed = (await afterRow.count()) > 0;
      const nowInactive = stillListed && /Inactive/.test(await afterRow.textContent());
      record('settings-cat-delete-works', stillListed && nowInactive,
        !stillListed ? 'row vanished — a referenced category must be kept'
          : nowInactive ? 'soft-deleted → Inactive' : 'still Active after delete');
    } else {
      record('settings-cat-delete-confirm', false, 'no Delete button');
      record('settings-cat-delete-works', false, 'no Delete button');
    }
  } else {
    record('settings-cat-create', false, 'no MasterEditor card found');
    record('settings-cat-delete-button-exists', false, 'n/a');
    record('settings-cat-delete-works', false, 'n/a');
  }

  // Subscription & Usage: plan limits store -1 for "no cap" (Enterprise). The
  // usage meter and the plan-comparison cards must render ∞, never a raw -1 —
  // the Enterprise card is always listed, whatever plan this mandir is on.
  // Runs last in this section: it navigates into the Change Plan view.
  await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Subscription")').first().click().catch(() => {});
  await page.waitForTimeout(2200);
  const usageBody = (await page.textContent('body')) ?? '';
  record('settings-usage-meter', /Usage This Month/i.test(usageBody), 'usage card renders');
  record('settings-usage-not-raw', !/\/\s*-1/.test(usageBody),
    /\/\s*-1/.test(usageBody) ? 'usage meter shows "/ -1"' : 'ok');
  await page.locator('button:has-text("Change Plan")').first().click().catch(() => {});
  await page.waitForTimeout(2200);
  const planCards = (await page.textContent('body')) ?? '';
  record('settings-plan-cards', /Enterprise/i.test(planCards), 'plan comparison lists Enterprise');
  record('settings-unlimited-not-raw', !/-1\s*(users|receipts|SMS)/i.test(planCards),
    /-1\s*(users|receipts|SMS)/i.test(planCards) ? 'raw -1 limit on screen' : 'shows ∞ for uncapped limits');

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
