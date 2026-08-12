/**
 * Manual QA pass — the states the automated suites do not construct:
 *   - the checklist at 100% (card gone, meter green, no "Finish setup")
 *   - the wizard, checklist and tour rendered in Hindi and Marathi
 *   - a cashier's view of the checklist (read-only, no dismiss)
 *   - the wizard's own back/skip navigation
 * Screenshots go to scratchpad/manual/.
 */
import { mkdirSync } from 'fs';

const pw = await import(process.env.PLAYWRIGHT_PATH);
const chromium = pw.chromium ?? pw.default?.chromium;
const WEB = process.env.E2E_WEB;
const API = process.env.E2E_API;
const SHOTS = process.env.SHOTS;
mkdirSync(SHOTS, { recursive: true });

const results = [];
const rec = (id, title, ok, detail = '') => {
  results.push({ id, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} ${title}${detail ? ' — ' + detail : ''}`);
};

async function apiLogin(mobile, slug) {
  const j = async (r) => (await r.json()).data;
  const s = await j(await fetch(`${API}/auth/send-otp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile }) }));
  const v = await j(await fetch(`${API}/auth/verify-otp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile, otp: s.dev_otp }) }));
  const t = await j(await fetch(`${API}/auth/select-tenant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selection_token: v.selection_token, tenant_slug: slug }) }));
  return t.access_token;
}
const ADMIN = await apiLogin('9855121877', 'e2e-test-trust-55121877');
const auth = { Authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' };

// MP-06 deliberately clears two fields to drop the trust below 100%. Put them
// back first, so the pass is re-runnable instead of passing exactly once.
await fetch(`${API}/tenants/me`, {
  method: 'PATCH', headers: auth,
  // …and un-dismiss: the onboarding suite dismisses the card, so running the
  // two back to back would otherwise hide it here with no bug present.
  body: JSON.stringify({
    reg_80g_number: 'AAATE1234FF20214',
    custom_receipt_footer: 'Thank you for your daan.',
    setup_done: false,
  }),
});
const getSetup = async () => (await (await fetch(`${API}/tenants/me/setup`, { headers: auth })).json()).data;
const patch = (body) => fetch(`${API}/tenants/me`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const crashes = [];
page.on('pageerror', (e) => crashes.push(String(e)));
const shot = (n) => page.screenshot({ path: `${SHOTS}${n}.png` });

async function closeTour() {
  const d = page.locator('[role="dialog"][aria-modal="true"]');
  if (await d.count()) { await d.locator('button:has-text("Skip")').first().click(); await page.waitForTimeout(400); }
}
async function login(mobile) {
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=tel]');
  await page.fill('input[type=tel]', mobile);
  await page.click('button:has-text("Send OTP")');
  await page.waitForSelector('text=Dev mode — OTP:', { timeout: 15000 });
  const otp = (await page.textContent('.font-mono.font-bold')).trim();
  await page.fill('input[maxlength="6"]', otp);
  await page.click('button:has-text("Verify OTP")');
  await page.waitForTimeout(1200);
  if (await page.locator('text=Select your temple').count()) await page.locator('.space-y-2 button').first().click();
  await page.waitForURL(/\/(dashboard|setup)/, { timeout: 20000 });
  // Suppress first-run surfaces unless a case is specifically testing them.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('jainerp-auth') ?? '{}');
    const t = raw?.state?.tenant?.id, u = raw?.state?.user?.id;
    if (t) localStorage.setItem(`jainerp_setup_wizard_offered:${t}`, '1');
    if (t && u) localStorage.setItem(`jainerp_tour_done:mandir:${t}:${u}`, '1');
  });
}

try {
  // ══ A. The 100% state ═══════════════════════════════════════════════════
  await login('9855121877');
  const full = await getSetup();
  rec('MP-01', 'API reports 100% for a fully configured trust',
    full.percent === 100 && full.complete === true && full.next === null,
    `percent=${full.percent} complete=${full.complete} next=${full.next?.key ?? 'null'}`);

  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await closeTour();
  rec('MP-02', 'the checklist card disappears at 100%',
    (await page.locator('[data-tour="setup-checklist"]').count()) === 0);
  await shot('01-dashboard-100');

  await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  const settings100 = await page.textContent('body');
  rec('MP-03', 'Settings still shows the meter at 100%', settings100.includes('100%'));
  rec('MP-04', 'Settings drops "Finish setup" once nothing is left',
    !/Finish setup/i.test(settings100));
  await shot('02-settings-100');

  await page.goto(`${WEB}/setup`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  const wiz100 = await page.textContent('body');
  rec('MP-05', 'the wizard still opens at 100% (it is not a dead end)',
    /Trust details|Set up your Mandir/i.test(wiz100) && !/Something went wrong/i.test(wiz100));
  await shot('03-wizard-100');

  // ══ B. Partially complete again, for the remaining cases ════════════════
  await patch({ reg_80g_number: '', custom_receipt_footer: '' });
  const partial = await getSetup();
  rec('MP-06', 'clearing two fields drops the percentage below 100',
    partial.percent < 100 && partial.next !== null,
    `percent=${partial.percent} next=${partial.next?.key}`);

  // The checklist must be undismissed for the language and cashier cases —
  // OB-18-style dismissals persist on the tenant, not the browser.
  const undismiss = () => patch({ setup_done: false });
  await undismiss();

  // ══ C. Hindi ════════════════════════════════════════════════════════════
  for (const [lng, label, probe] of [['hi', 'Hindi', 'सेटअप'], ['mr', 'Marathi', 'सेटअप']]) {
    // The app takes its language from the persisted auth store, not from
    // i18next's own detector — i18n.ts seeds `lng` from useAuthStore.
    await page.evaluate((l) => {
      const raw = JSON.parse(localStorage.getItem('jainerp-auth') ?? '{}');
      raw.state = { ...(raw.state ?? {}), language: l };
      localStorage.setItem('jainerp-auth', JSON.stringify(raw));
    }, lng);
    await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await closeTour();
    const body = await page.textContent('body');
    const card = page.locator('[data-tour="setup-checklist"]');
    const cardText = (await card.count()) ? await card.textContent() : '';
    // Devanagari anywhere in the card means the setup.* keys resolved.
    const translated = /[ऀ-ॿ]/.test(cardText);
    rec(`MP-07-${lng}`, `${label}: the checklist renders translated, not raw keys`,
      translated && !cardText.includes('setup.'), cardText.slice(0, 60).replace(/\s+/g, ' '));
    await shot(`04-checklist-${lng}`);

    await page.goto(`${WEB}/setup`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const wizBody = await page.textContent('body');
    rec(`MP-08-${lng}`, `${label}: the wizard renders translated, not raw keys`,
      /[ऀ-ॿ]/.test(wizBody) && !wizBody.includes('setupWizard.'),
      wizBody.includes('setupWizard.') ? 'raw key on screen' : 'ok');
    await shot(`05-wizard-${lng}`);
    void probe;
  }
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('jainerp-auth') ?? '{}');
    raw.state = { ...(raw.state ?? {}), language: 'en' };
    localStorage.setItem('jainerp-auth', JSON.stringify(raw));
  });
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });

  // ══ D. Wizard navigation: Back, and Skip on the last step ═══════════════
  await page.goto(`${WEB}/setup`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.click('button:has-text("Skip this step")');
  await page.waitForTimeout(700);
  const hasBack = await page.locator('button:has-text("Back")').count();
  rec('MP-09', 'Back appears from step 2 onward', hasBack > 0);
  if (hasBack) {
    await page.click('button:has-text("Back")');
    await page.waitForTimeout(700);
    rec('MP-10', 'Back returns to step 1 and hides itself again',
      (await page.locator('button:has-text("Back")').count()) === 0);
  }
  // Walk to the summary using Skip only — nothing should be written.
  const before = await (await fetch(`${API}/tenants/me`, { headers: auth })).json();
  for (let i = 0; i < 8; i++) {
    const b = page.locator('button:has-text("Skip this step")');
    if (!(await b.count())) break;
    await b.click(); await page.waitForTimeout(450);
  }
  const after = await (await fetch(`${API}/tenants/me`, { headers: auth })).json();
  const changed = Object.keys(before.data ?? {}).filter(
    (k) => JSON.stringify(before.data[k]) !== JSON.stringify(after.data?.[k]) && k !== 'updated_at');
  rec('MP-11', 'skipping every step writes nothing at all', changed.length === 0, changed.join(', '));
  rec('MP-12', 'skipping every step still reaches the summary',
    /Go to dashboard/i.test(await page.textContent('body')));
  await shot('06-wizard-all-skipped');

  // ══ E. Cashier's view ═══════════════════════════════════════════════════
  await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Logout")').catch(() => {});
  await page.waitForTimeout(1500);
  await undismiss();
  await login('9833300099');
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await closeTour();
  const cashCard = page.locator('[data-tour="setup-checklist"]');
  const cashSees = await cashCard.count();
  rec('MP-13', 'a cashier sees the checklist too', cashSees > 0);
  if (cashSees) {
    await page.click('[data-testid="setup-dismiss"]');
    await page.waitForTimeout(1500);
    const stillDismissed = (await getSetup()).dismissed;
    rec('MP-14', "a cashier's dismiss does not hide the card for the whole trust",
      stillDismissed === false, `api.dismissed=${stillDismissed}`);
  }
  await shot('07-cashier');

  rec('MP-15', 'no unhandled client errors across the pass', crashes.length === 0,
    crashes.slice(0, 2).join(' | '));
} catch (e) {
  rec('MP-FATAL', 'pass completed', false, String(e).slice(0, 250));
  await shot('99-fatal');
} finally {
  await browser.close();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n  ${pass}/${results.length} passed`);
for (const r of results.filter((x) => !x.ok)) console.log(`   - ${r.id} ${r.title}: ${r.detail}`);
process.exit(pass === results.length ? 0 : 1);
