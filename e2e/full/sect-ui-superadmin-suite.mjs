/**
 * UI check — the super-admin console captures sampradaya.
 *
 * Both console forms that write a sant had a `SECTS` constant declared and
 * never used, no Sampradaya control at all, and a field labelled
 * "Samuday / Sect" bound to `samuday` whose placeholder ("Tapagachha") is a
 * *gaccha* — conflating all three of the fields migration 024 split apart.
 *
 * Also covers the tenant form: choosing a sect and then switching temple_type
 * away from jain must not post a Jain sampradaya for a non-Jain trust.
 */
import { execFileSync } from 'node:child_process';
import { superAdminLogin as saLogin, QA_ID, QA_PASSWORD } from './sa-auth.mjs';

// Playwright ships CJS, so an absolute-path import lands the namespace under
// `default`; a bare 'playwright' resolves to the named export. Reading both is
// what ui-suite.mjs already does — without it this file threw
// "Cannot read properties of undefined" before the first assertion ever ran.
const pw = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const WEB = process.env.SA_WEB ?? 'http://localhost:5180';
const API = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';
const PG = {
  c: process.env.PG_CONTAINER ?? 'jainerp-superadmin-pg',
  u: process.env.E2E_PG_USER ?? 'jainerp',
  d: process.env.E2E_PG_DB ?? 'jainerp',
  host: process.env.E2E_PG_HOST ?? 'localhost',
  port: process.env.E2E_PG_PORT ?? '5434',
  password: process.env.E2E_PG_PASSWORD ?? 'jainerp_dev',
};

const results = [];
const rec = (id, ok, d = '') => { results.push({ id, ok }); console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id}${d ? ' — ' + d : ''}`); };
/**
 * Read a value straight from Postgres — this suite verifies what the console
 * WROTE, not what it echoed back.
 *
 * Falls back to a local psql when there is no docker container, the same as
 * sa-auth.mjs: the daemon needs root on some dev boxes, and without the
 * fallback the whole suite died on its first query.
 */
function psql(sql) {
  try {
    return execFileSync('docker', ['exec', PG.c, 'psql', '-U', PG.u, '-d', PG.d, '-tAc', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return execFileSync('psql',
      ['-h', PG.host, '-p', String(PG.port), '-U', PG.u, '-d', PG.d, '-tAc', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PGPASSWORD: PG.password } },
    ).trim();
  }
}

async function sa(method, path, { token, body } = {}) {
  const res = await fetch(API + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, data: json?.data, code: json?.error?.code ?? json?.code };
}

const token = await saLogin(sa);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage();
// The console keeps its session in localStorage — same bypass the other SA suites use.
await page.addInitScript((s) => localStorage.setItem('jainerp_sa_session', JSON.stringify(s)),
  { access_token: token, user: { email: QA_ID, name: 'QA Tester', role: 'super_admin' } });

// ---------- the sant form ----------
await page.goto(`${WEB}/maharaj`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('button:has-text("Add"), button:has-text("New")').first().click();
await page.waitForTimeout(1200);

const labels = (await page.locator('.field span').allTextContents()).map(s => s.trim());
rec('SA-SECT-01 the sant form offers a Sampradaya control', labels.includes('Sampradaya'), labels.join(' | '));
rec('SA-SECT-02 samuday is no longer mislabelled as "Sect"',
  labels.includes('Samuday (community)') && !labels.some(l => /Samuday \/ Sect/.test(l)));

const name = `SA Sect QA ${Date.now().toString().slice(-6)}`;
await page.locator('.field input').first().fill(name);
const sectSel = page.locator('.field select').nth(1);   // 0 = Type, 1 = Sampradaya
await sectSel.selectOption('digambar');
await page.waitForTimeout(400);
rec('SA-SECT-03 the panth field appears once a sect is chosen',
  (await page.locator('.field span').allTextContents()).some(s => s.trim() === 'Panth / Gaccha'));
await page.locator('.field input').nth(2).fill('Bisapanth');  // 0 name, 1 samuday, 2 sub_sect
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(3500);

const row = psql(`SELECT sect, sub_sect FROM public.sant_profiles WHERE name = '${name}'`);
const [gotSect, gotSub] = row.split('|');
rec('SA-SECT-04 the console stores the chosen sampradaya', gotSect === 'digambar', `sect=${gotSect || 'null'} row=${row || 'none'}`);
rec('SA-SECT-05 the console stores the chosen panth', gotSub === 'Bisapanth', `sub_sect=${gotSub || 'null'}`);
if (row) psql(`DELETE FROM public.sant_profiles WHERE name = '${name}'`);

// ---------- the tenant form ----------
await page.goto(`${WEB}/mandirs`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('button:has-text("Onboard Mandir")').first().click();
await page.waitForTimeout(1200);

const typeSel = page.locator('select[name="temple_type"]');
rec('SA-SECT-06 Sampradaya shows for a Jain trust',
  (await page.locator('select[name="sect"]').count()) > 0);
await typeSel.selectOption('jain');
await page.locator('select[name="sect"]').selectOption('digambar');
await page.waitForTimeout(300);
// Now switch away from jain — the section hides, and the value must not survive.
await typeSel.selectOption('hindu');
await page.waitForTimeout(500);
rec('SA-SECT-07 Sampradaya is hidden for a non-Jain trust',
  (await page.locator('select[name="sect"]').count()) === 0);
await typeSel.selectOption('jain');
await page.waitForTimeout(500);
const retained = await page.locator('select[name="sect"]').inputValue();
rec('SA-SECT-08 switching away from Jain clears the sampradaya rather than keeping it hidden',
  retained === '', `value after round-trip="${retained}"`);

// ---------- the readiness report's inline fix ----------
// The doc says the report "lists the temples and sants so they can be fixed
// inline". Temples had buttons; sants had a bare link to the sant list — and
// until the console's sant form gained a Sampradaya control that link was a
// dead end. Both halves are asserted here.
const santName = `SA Readiness QA ${Date.now().toString().slice(-6)}`;
const made = await sa('POST', '/admin/sant', {
  token, body: { name: santName, type: 'muni', samuday: 'Oswal', city: 'Pune', state: 'Maharashtra', verified: true },
});
rec('SA-SECT-09 a sant can be created with no sampradaya', made.status === 201 && !made.data?.sect,
  `sect=${made.data?.sect ?? 'null'}`);

await page.goto(`${WEB}/sect-readiness`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const santRow = page.locator('tr', { hasText: santName });
rec('SA-SECT-10 the outstanding sant is listed on the readiness report',
  (await santRow.count()) > 0);
rec('SA-SECT-11 the sant row offers an inline fix, not just a link',
  (await santRow.locator('button:has-text("Digambar")').count()) > 0);

await santRow.locator('button:has-text("Digambar")').first().click();
await page.waitForTimeout(3000);
const fixed = psql(`SELECT sect FROM public.sant_profiles WHERE name = '${santName}'`);
rec('SA-SECT-12 the inline fix actually writes the sampradaya', fixed === 'digambar', `sect=${fixed || 'null'}`);
rec('SA-SECT-13 the fixed sant drops off the outstanding list',
  (await page.locator('tr', { hasText: santName }).count()) === 0);
psql(`DELETE FROM public.sant_profiles WHERE name = '${santName}'`);

await page.screenshot({ path: process.env.SHOT ?? 'e2e/full/screens/sa-sect.png', fullPage: true });
await browser.close();
const bad = results.filter(r => !r.ok);
console.log(`\n=== SUPERADMIN SECT UI: ${results.length - bad.length}/${results.length} passed ===`);
if (bad.length) console.log('FAILED:', bad.map(r => r.id).join(', '));
process.exit(bad.length ? 1 : 0);
