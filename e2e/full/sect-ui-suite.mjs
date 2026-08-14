/**
 * UI check — sampradaya in the devotee portal: the profile control, and the
 * "my tradition / all traditions" switch that makes scoping visible.
 *
 * Registration tells the devotee "You can change it later"; until the profile
 * control existed, web had no later. And since discovery now leads with their
 * own tradition, a devotee who cannot find a temple of the other one must be
 * able to see why and undo it in one tap — a silently scoped list looks
 * identical to a temple that never joined JainERP.
 *
 *   PLAYWRIGHT_PATH=<abs path> node e2e/full/sect-ui-suite.mjs
 *
 * Needs devotee-web on :5174, devotee-api on :3107 and superadmin-api on :3105
 * (it provisions one temple per tradition so the switch has something to prove).
 */
import { superAdminLogin as saLogin } from './sa-auth.mjs';

// Playwright ships CJS, so an absolute-path import lands the namespace under
// `default`; a bare 'playwright' resolves to the named export. Reading both is
// what ui-suite.mjs already does — without it this file threw
// "Cannot read properties of undefined" before the first assertion ever ran.
const pw = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const BASE = process.env.DEVOTEE_WEB ?? 'http://localhost:5174';
const SA = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';

const results = [];
const rec = (id, ok, d = '') => {
  results.push({ id, ok });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id}${d ? ' — ' + d : ''}`);
};

async function sa(method, path, { token, body } = {}) {
  const res = await fetch(`${SA}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, data: json?.data };
}

// ── fixtures: one temple per tradition, named so the page can be searched ────
const ADMIN = await saLogin(sa);
const stamp = String(Date.now()).slice(-6);
async function makeTemple(label, sect) {
  const slug = `sect-ui-${label}-${stamp}`;
  const name = `SectUI ${label} ${stamp}`;
  const r = await sa('POST', '/admin/tenants', {
    token: ADMIN,
    body: {
      name, slug, plan: 'standard', tenancy_tier: 'pooled', temple_type: 'jain',
      module_preset: 'donation_only', sect,
      admin_contact: { name: 'x', mobile: `+9197${String(60000000 + Math.floor(Math.random() * 9999999))}` },
      address: { line1: '1 Test Road', state: 'Maharashtra', city: 'Pune', pincode: '411001' },
    },
  });
  if (r.status !== 201) throw new Error(`provision ${label}: ${JSON.stringify(r.json)}`);
  return { id: r.data.id, slug, name };
}
const digTemple = await makeTemple('dig', 'digambar');
const shwTemple = await makeTemple('shw', 'shwetambar');

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage();

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

// ── the profile control ─────────────────────────────────────────────────────
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

// ── the tradition switch on the temple directory ────────────────────────────
// The devotee is now Digambar, so the directory must lead with Digambar and
// the Shwetambar fixture must be one tap away, not missing.
async function directoryHas(name) {
  return (await page.locator(`text=${name}`).count()) > 0;
}

await page.goto(`${BASE}/temples`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const body = await page.textContent('body');
rec('SECT-UI-07 the directory shows the tradition switch',
  /All traditions/i.test(body) && (await page.locator('button:text-is("Digambar")').count()) > 0);
rec('SECT-UI-08 it says which tradition is being shown',
  /Showing Digambar first/i.test(body), body.match(/Showing[^.]*\./)?.[0] ?? '');

await page.fill('input[placeholder*="Search" i]', `SectUI dig ${stamp}`);
await page.waitForTimeout(2500);
rec('SECT-UI-09 a temple of the devotee’s own tradition is listed',
  await directoryHas(digTemple.name));
rec('SECT-UI-10 each row carries its sampradaya as a badge',
  (await page.locator('span.badge:text-is("Digambar")').count()) > 0);

await page.fill('input[placeholder*="Search" i]', `SectUI shw ${stamp}`);
await page.waitForTimeout(2500);
const hiddenWhileScoped = !(await directoryHas(shwTemple.name));
rec('SECT-UI-11 the other tradition is not in the scoped list', hiddenWhileScoped);

await page.locator('button:text-is("All traditions")').first().click();
await page.waitForTimeout(2500);
rec('SECT-UI-12 "All traditions" brings the other tradition back',
  await directoryHas(shwTemple.name));

// The choice is a browsing preference, not a per-page filter: it has to hold
// across screens and a reload, or the devotee re-picks it constantly.
await page.goto(`${BASE}/sant`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
// aria-pressed, not the Tailwind class: the class string is the same length
// either way and a truncated log of it reads as a failure that passed.
const santPressed = await page.locator('button:text-is("All traditions")').first()
  .getAttribute('aria-pressed');
rec('SECT-UI-13 the choice carries to the sant directory',
  santPressed === 'true', `aria-pressed=${santPressed}`);

await page.goto(`${BASE}/temples`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const stillAll = await page.locator('button:text-is("All traditions")').first()
  .getAttribute('aria-pressed');
rec('SECT-UI-14 and survives a reload', stillAll === 'true', `aria-pressed=${stillAll}`);

// ── back to "Prefer not to say" ─────────────────────────────────────────────
// The case that used to 400. It also has to take the switch away, since there
// is no longer a tradition to switch between.
await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
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

await page.goto(`${BASE}/temples`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const noSectBody = await page.textContent('body');
rec('SECT-UI-15 with no sampradaya there is no switch, just a prompt to add one',
  !/All traditions/i.test(noSectBody) && /sampradaya/i.test(noSectBody));

await page.screenshot({ path: process.env.SHOT ?? 'e2e/full/screens/devotee-sect-profile.png', fullPage: true });
await browser.close();

for (const t of [digTemple, shwTemple]) {
  await sa('DELETE', `/admin/tenants/${t.id}`, { token: ADMIN, body: { confirm_slug: t.slug } });
}

const bad = results.filter(r => !r.ok);
console.log(`\n=== DEVOTEE SECT UI: ${results.length - bad.length}/${results.length} passed ===`);
if (bad.length) console.log('FAILED:', bad.map(r => r.id).join(', '));
process.exit(bad.length ? 1 : 0);
