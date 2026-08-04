/**
 * UI check — the Sampradaya control on the devotee profile page.
 *
 * Registration tells the devotee "You can change it later"; until this control
 * existed, web had no later. Under SECT_FILTER_ENFORCED a wrong value also
 * hides their own temples, so being able to clear it back matters as much as
 * being able to set it.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const BASE = process.env.DEVOTEE_WEB ?? 'http://localhost:5174';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage();
const results = [];
const rec = (id, ok, d = '') => { results.push({ id, ok }); console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id}${d ? ' — ' + d : ''}`); };

/** The OTP screen uses an on-screen keypad, not a text input. */
async function typeOtp(otp) {
  for (const d of otp) await page.locator(`button:text-is("${d}")`).first().click();
}

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const mobile = '98' + String(Date.now()).slice(-8);
await page.fill('input[type="tel"]', mobile);
await page.click('button:has-text("Send OTP")');
await page.waitForTimeout(3000);

const otp = ((await page.textContent('body')).match(/OTP:\s*(\d{6})/) || [])[1];
rec('LOGIN otp is shown in dev mode', !!otp, `otp=${otp}`);
if (!otp) { await browser.close(); process.exit(1); }
await typeOtp(otp);
await page.click('button:has-text("Verify OTP")');
await page.waitForTimeout(4000);

if (page.url().includes('/register')) {
  await page.fill('input[placeholder="Ayush Kasliwal"]', 'Sect UI Devotee');
  await page.locator('button:has-text("Shwetambar")').first().click();
  await page.locator('button:has-text("Save & Continue")').first().click();
  await page.waitForTimeout(4000);
}

await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

rec('SECT-UI-01 the profile page has a Sampradaya control',
  /Sampradaya/i.test(await page.textContent('body')));
for (const label of ['Prefer not to say', 'Digambar', 'Shwetambar']) {
  rec(`SECT-UI-02 "${label}" is offered`,
    (await page.locator(`button:text-is("${label}")`).count()) > 0);
}
rec('SECT-UI-03 the sect chosen at registration is pre-selected',
  (await page.locator('button:text-is("Shwetambar")').first().getAttribute('class') || '').includes('brand-red'));

await page.locator('button:text-is("Digambar")').first().click();
await page.waitForTimeout(400);
const sub = page.locator('input[placeholder*="Terapanth" i]');
rec('SECT-UI-04 a panth/gaccha field appears once a sect is chosen', (await sub.count()) > 0);
if (await sub.count()) await sub.fill('Bisapanth');
await page.locator('button:has-text("Save")').first().click();
await page.waitForTimeout(3500);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const subVal = await page.locator('input[placeholder*="Terapanth" i]').first().inputValue().catch(() => '');
const digSel = (await page.locator('button:text-is("Digambar")').first().getAttribute('class') || '').includes('brand-red');
rec('SECT-UI-05 the change survives a reload', digSel && subVal === 'Bisapanth', `digambar=${digSel} sub_sect="${subVal}"`);

// The case that used to 400: switching back to "Prefer not to say".
await page.locator('button:text-is("Prefer not to say")').first().click();
await page.locator('button:has-text("Save")').first().click();
// The confirmation clears itself after 3s, so read it before then.
await page.waitForTimeout(1200);
const saved = /Profile saved/i.test(await page.textContent('body'));
await page.waitForTimeout(2000);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const cleared = !(await page.locator('button:text-is("Digambar")').first().getAttribute('class') || '').includes('brand-red');
rec('SECT-UI-06 clearing back to "Prefer not to say" saves and sticks', saved && cleared, `saved=${saved} cleared=${cleared}`);

await page.screenshot({ path: process.env.SHOT ?? 'devotee-sect-profile.png', fullPage: true });
await browser.close();
const bad = results.filter(r => !r.ok);
console.log(`\n=== DEVOTEE SECT UI: ${results.length - bad.length}/${results.length} passed ===`);
if (bad.length) console.log('FAILED:', bad.map(r => r.id).join(', '));
process.exit(bad.length ? 1 : 0);
