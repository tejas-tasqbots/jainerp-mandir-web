/**
 * UI check — the sant registration form captures Sampradaya.
 *
 * The form has always shown a Sampradaya picker; the POST body never carried
 * it, so every self-registered sant arrived with sect NULL and landed on the
 * super admin's backfill list.
 */
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const PG_CONTAINER = process.env.PG_CONTAINER ?? 'jainerp-superadmin-pg';
const PG_USER = process.env.PG_USER ?? 'jainerp';
const PG_DB = process.env.PG_DB ?? 'jainerp';
const BASE = process.env.SANT_WEB ?? 'http://localhost:5175';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage();
const results = [];
const rec = (id, ok, d = '') => { results.push({ id, ok }); console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id}${d ? ' — ' + d : ''}`); };

const mobile = '97' + String(Date.now()).slice(-8);
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.fill('input[type="tel"], input[type="text"]', mobile);
await page.locator('button:has-text("Send OTP"), button:has-text("Continue")').first().click();
await page.waitForTimeout(3000);
const otp = ((await page.textContent('body')).match(/OTP:\s*(\d{6})/) || [])[1];
rec('LOGIN dev OTP is shown', !!otp, `otp=${otp}`);
if (!otp) { await browser.close(); process.exit(1); }
const otpBox = page.locator('input').last();
await otpBox.fill(otp);
await page.locator('button:has-text("Verify")').first().click();
await page.waitForTimeout(4000);

if (!page.url().includes('/profiles/new')) {
  await page.goto(`${BASE}/profiles/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
}

rec('SANT-UI-01 the form offers a Sampradaya picker',
  (await page.locator('#newpro-sect-sampradaya').count()) > 0);
rec('SANT-UI-02 no panth field until a sect is chosen',
  (await page.locator('#newpro-sub-sect').count()) === 0);

const name = `QA Sect Sant ${Date.now().toString().slice(-6)}`;
await page.fill('#newpro-sect-sampradaya ~ *, input.input >> nth=0', name).catch(() => {});
const nameInput = page.locator('input.input').first();
await nameInput.fill(name);
await page.selectOption('#newpro-sect-sampradaya', 'digambar');
await page.waitForTimeout(400);
rec('SANT-UI-03 the panth field appears once a sect is chosen',
  (await page.locator('#newpro-sub-sect').count()) > 0);

const opts = await page.locator('#newpro-sub-sect option').allTextContents();
rec('SANT-UI-04 the panth options are the ones for that tradition',
  opts.includes('Bisapanth') && !opts.includes('Murtipujak'), opts.join('/'));
await page.selectOption('#newpro-sub-sect', 'Bisapanth');

// samuday is required and is a different field from sect
const samuday = page.locator('#newpro-samuday-community');
if (await samuday.count()) await samuday.fill('Oswal');
await page.locator('button[type="submit"]').last().click();
await page.waitForTimeout(4500);

// Read it back from the DATABASE, not the screen and not the list API: the
// bug was in what the form SENT, and a freshly registered profile is
// unverified so it is deliberately absent from the devotee-facing list.
const row = execFileSync('docker', ['exec', PG_CONTAINER, 'psql', '-U', PG_USER, '-d', PG_DB, '-tAc',
  `SELECT sect, sub_sect FROM public.sant_profiles WHERE name = '${name}'`],
  { encoding: 'utf8' }).trim();
const [gotSect, gotSub] = row.split('|');
rec('SANT-UI-05 the profile was created', !!row, `row=${row || 'none'}`);
rec('SANT-UI-06 the chosen sampradaya was actually stored', gotSect === 'digambar', `sect=${gotSect || 'null'}`);
rec('SANT-UI-07 the chosen panth was actually stored', gotSub === 'Bisapanth', `sub_sect=${gotSub || 'null'}`);

// ---------- the edit path ----------
// Registration could capture a sampradaya but the edit form had no control for
// it, so a rep who skipped it or picked wrong could never correct the field the
// sant directory will filter on.
await page.locator('button:has-text("Edit Profile")').first().click();
await page.waitForTimeout(1500);
rec('SANT-UI-08 the edit form offers a Sampradaya control',
  (await page.locator('#profil-sect').count()) > 0);
rec('SANT-UI-09 it is pre-filled with what registration captured',
  (await page.locator('#profil-sect').inputValue()) === 'digambar');

await page.selectOption('#profil-sect', 'shwetambar');
await page.waitForTimeout(500);
const subOpts = await page.locator('#profil-sub-sect option').allTextContents();
rec('SANT-UI-10 the panth list follows the newly chosen tradition',
  subOpts.includes('Murtipujak') && !subOpts.includes('Bisapanth'), subOpts.join('/'));
await page.selectOption('#profil-sub-sect', 'Murtipujak');
await page.locator('button:has-text("Save Changes")').first().click();
await page.waitForTimeout(3500);

const after = execFileSync('docker', ['exec', PG_CONTAINER, 'psql', '-U', PG_USER, '-d', PG_DB, '-tAc',
  `SELECT sect, sub_sect FROM public.sant_profiles WHERE name = '${name}'`], { encoding: 'utf8' }).trim();
rec('SANT-UI-11 the edited sampradaya is stored', after === 'shwetambar|Murtipujak', `row=${after}`);

await page.screenshot({ path: process.env.SHOT ?? 'sant-sect-form.png', fullPage: true });
await browser.close();
const bad = results.filter(r => !r.ok);
console.log(`\n=== SANT SECT UI: ${results.length - bad.length}/${results.length} passed ===`);
if (bad.length) console.log('FAILED:', bad.map(r => r.id).join(', '));
process.exit(bad.length ? 1 : 0);
