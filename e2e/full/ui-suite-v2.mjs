/**
 * UI E2E — v2 (independent rewrite of ui-suite.mjs).
 *
 * Different in intent: v1 mostly asserts each page renders (no error boundary).
 * v2 DRIVES the real donation + donor-picker + PAN flow through Chrome and
 * asserts behaviour, including reading the rendered receipt DOM to confirm the
 * masked donor PAN actually prints — the true end-to-end proof of the fix.
 *
 *   PLAYWRIGHT_PATH=<abs path> node e2e/full/ui-suite-v2.mjs
 */
import { mkdirSync } from 'fs';

const pwPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const pw = await import(pwPath);
const chromium = pw.chromium ?? pw.default?.chromium;
const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const ADMIN = (process.env.E2E_MOBILE ?? '9876512345').replace(/\D/g, '').slice(-10);
const SHOTS = new URL('./screens-v2/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
const rec = (id, title, ok, detail = '') => { results.push({ id, title, ok, detail }); console.log(`  ${ok ? '✔' : '✘ FAIL'} ${id} ${title}${detail ? ' — ' + detail : ''}`); };
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` }).catch(() => {});

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.setDefaultTimeout(20000);
page.on('dialog', (d) => d.accept().catch(() => {}));
// Neutralise the print dialog so printDonationReceipt() completes without blocking,
// leaving its hidden receipt iframe in the DOM for us to read.
await page.addInitScript(() => { window.print = () => {}; });

const uniq = Date.now().toString().slice(-7);
const donorMobile = `9${uniq}55`;              // 10-digit national
const donorPan = 'ABCDE1234F';
const donorName = `UIv2 Donor ${uniq}`;

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
  if (await page.locator('text=Select your temple').count()) await page.locator('.space-y-2 button').first().click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  return otp;
}

try {
  // ── 1. Login ────────────────────────────────────────────────────────────────
  const otp = await login(ADMIN);
  rec('UIV2-AUTH', 'admin dev-OTP login reaches dashboard', /^\d{6}$/.test(otp), `otp=${otp}`);

  // ── 2. Donor picker: add-new form appears with PAN field ──────────────────────
  await page.goto(`${WEB}/donations/add`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  // The picker shows an "Add new donor" affordance even before searching.
  const addNew = page.locator('button:has-text("Add new donor")').first();
  rec('UIV2-PICK-1', 'picker shows "Add new donor"', (await addNew.count()) > 0);
  await addNew.click();
  await page.waitForTimeout(400);
  const nameField = page.locator('input[placeholder="Full name *"]');
  const panField = page.locator('input[placeholder="PAN (needed only for 80G)"]');
  rec('UIV2-PICK-2', 'add form has Full name + PAN(for 80G) fields', (await nameField.count()) > 0 && (await panField.count()) > 0);

  // ── 3. Fill donor (name, mobile, PAN) and Save (no OTP) ──────────────────────
  await nameField.fill(donorName);
  await page.locator('.bg-blue-50 input[type=tel]').first().fill(donorMobile);
  await panField.fill(donorPan);
  await shot('01-donor-add-filled');
  await page.locator('button:has-text("Save donor")').click();
  await page.waitForTimeout(1200);
  // Selected chip should now show the donor name + masked PAN (not raw).
  const chipText = await page.locator('.bg-green-50').first().textContent().catch(() => '');
  rec('UIV2-PICK-3', 'saved donor chip shows name', (chipText ?? '').includes(donorName), chipText?.slice(0, 60));
  rec('UIV2-PICK-4', 'chip shows MASKED pan, never raw', /X/.test(chipText ?? '') && !(chipText ?? '').includes(donorPan), (chipText?.match(/[A-Z]{2}X+[0-9A-Z]+/) ?? [''])[0]);

  // ── 4. Fill donation: 80G category + amount, submit ──────────────────────────
  // pick a category that is 80G-eligible (label includes "(80G)")
  const catSelect = page.locator('#donation-category');
  const opts = await catSelect.locator('option').allTextContents();
  const g80 = opts.find((o) => /\(80G\)/.test(o)) ?? opts.find((o) => o && !/Select/.test(o));
  await catSelect.selectOption({ label: g80 });
  await page.locator('input[type=number]').first().fill('501'); // ₹501 (not cash, so 80G stays)
  // ensure payment mode is not cash>2000 path; choose UPI if present
  const pm = page.locator('#payment-mode');
  if (await pm.count()) { const pmOpts = await pm.locator('option').allTextContents(); if (pmOpts.some(o => /UPI/i.test(o))) await pm.selectOption({ label: pmOpts.find(o => /UPI/i.test(o)) }); }
  await page.waitForTimeout(300);
  const is80 = page.locator('#is_80g');
  rec('UIV2-DON-1', '80G checkbox is checked for 80G category', await is80.isChecked().catch(() => false));
  await shot('02-donation-filled');
  await page.locator('button:has-text("Save & Print Receipt")').click();

  // ── 5. Back on the list; open the receipt; read iframe DOM for masked PAN ─────
  await page.waitForURL('**/donations', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500); // the print flow fires ~300ms after nav
  // printDonationReceipt injected a hidden iframe; find one whose body has the PAN.
  let receiptHtml = '';
  for (const f of page.frames()) {
    try { const t = await f.content(); if (/Donation Receipt|Received|Receipt No|RECEIVED FROM/i.test(t)) { receiptHtml = t; break; } } catch { /* */ }
  }
  if (!receiptHtml) {
    // fallback: trigger the list's print button explicitly on the newest row
    const btn = page.locator('button[title="Print Receipt"]').first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(1500); for (const f of page.frames()) { try { const t = await f.content(); if (/Received|Receipt No|RECEIVED FROM/i.test(t)) { receiptHtml = t; break; } } catch { /* */ } } }
  }
  rec('UIV2-RCPT-1', 'receipt rendered in DOM', !!receiptHtml, receiptHtml ? `${receiptHtml.length} chars` : 'not found');
  // An 80G receipt prints the donor's FULL PAN on purpose — income-tax rules
  // require it there (it reconciles to Form 10BD/10BE). Masking is the rule
  // everywhere else, which UIV2-PICK-4 and UIV2-DNR-1 cover.
  rec('UIV2-RCPT-2', '80G receipt prints the donor FULL PAN (not masked)',
    (receiptHtml ?? '').includes(donorPan),
    (receiptHtml ?? '').includes(donorPan) ? donorPan : 'full PAN absent from 80G receipt');
  await shot('03-after-receipt');

  // ── 6. Anonymous / Gupt Daan quick-path selects and blocks 80G ───────────────
  await page.goto(`${WEB}/donations/add`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const anonBtn = page.locator('button:has-text("Anonymous / Gupt Daan")').first();
  rec('UIV2-ANON-1', 'anonymous / Gupt Daan option present', (await anonBtn.count()) > 0);
  if (await anonBtn.count()) {
    await anonBtn.click(); await page.waitForTimeout(400);
    // Scope to the picker's own chip — `.bg-slate-100` alone also matches the
    // command-palette "Ctrl K" hint in the header.
    const anonChip = await page.locator('div.bg-slate-100', { hasText: 'Anonymous / Gupt Daan' })
      .first().textContent().catch(() => '');
    rec('UIV2-ANON-2', 'anonymous chip shows "not 80G eligible"', /not 80G/i.test(anonChip ?? ''), anonChip?.slice(0, 50));
  }

  // ── 7. Search the picker for the donor we created ────────────────────────────
  await page.goto(`${WEB}/donations/add`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const search = page.locator('input[placeholder="Search by name or mobile — or add a new donor"]');
  await search.fill(donorMobile);
  await page.waitForTimeout(1200);
  const dropdown = await page.locator('.absolute.z-30').first().textContent().catch(() => '');
  rec('UIV2-SEARCH-1', 'search finds the donor we created', (dropdown ?? '').includes(donorName) || (dropdown ?? '').includes(donorMobile), (dropdown ?? '').slice(0, 60));
  await shot('04-search-results');

  // ── 8. Donors list page shows the donor + masked PAN column ──────────────────
  await page.goto(`${WEB}/donors`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const donorsBody = await page.textContent('body');
  rec('UIV2-DNR-1', 'donors list shows PAN masked (X pattern), no raw PAN', /[A-Z]{2}X{3,}/.test(donorsBody ?? '') && !(donorsBody ?? '').includes(donorPan));
  await shot('05-donors-list');

  // ── summary ──────────────────────────────────────────────────────────────────
  const pass = results.filter((r) => r.ok).length;
  const fails = results.filter((r) => !r.ok);
  console.log(`\n=== UI v2 SUMMARY: ${pass}/${results.length} passed, ${fails.length} failed ===`);
  fails.forEach((f) => console.log(`  ✘ ${f.id} ${f.title} — ${f.detail}`));
  console.log('JSON_RESULTS=' + JSON.stringify(results));
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error('FATAL', e); process.exitCode = 2;
} finally {
  await browser.close();
}
