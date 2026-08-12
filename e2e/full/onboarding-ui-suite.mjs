/**
 * First-run onboarding UI suite — the setup wizard, the setup checklist and the
 * product tour, driven in a real browser.
 *
 * These three are all "shown once" surfaces, which makes them exactly the kind
 * of thing that passes a code review and fails in front of a customer: the bug
 * only appears on a state you have to deliberately construct (a brand-new
 * tenant, a user who has never signed in on this browser). So the suite resets
 * that state itself rather than hoping to find it.
 *
 *   PLAYWRIGHT_PATH=<abs path to playwright> \
 *   E2E_WEB=http://localhost:5199 E2E_API=http://localhost:3196/api/v1 \
 *   E2E_MOBILE=9855121877 E2E_SLUG=e2e-test-trust-55121877 \
 *   node e2e/full/onboarding-ui-suite.mjs
 */
import { mkdirSync } from 'fs';

const pwPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const pw = await import(pwPath);
const chromium = pw.chromium ?? pw.default?.chromium;

const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const MOBILE = (process.env.E2E_MOBILE ?? '9876512345').replace(/\D/g, '').slice(-10);
const SLUG = process.env.E2E_SLUG ?? 'smoke-portal';
const SHOTS = new URL('./screens-onboarding/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} ${title}${detail ? ' — ' + detail : ''}`);
}

// ---- API helper, so UI claims can be checked against what was actually saved --
let token = '';
async function apiLogin() {
  const j = async (r) => (await r.json()).data;
  const sent = await j(await fetch(`${API}/auth/send-otp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile: MOBILE }),
  }));
  const ver = await j(await fetch(`${API}/auth/verify-otp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile: MOBILE, otp: sent.dev_otp }),
  }));
  const sel = await j(await fetch(`${API}/auth/select-tenant`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selection_token: ver.selection_token, tenant_slug: SLUG }),
  }));
  token = sel.access_token;
}
const auth = () => ({ Authorization: `Bearer ${token}`, 'content-type': 'application/json' });
async function getSetup() {
  const r = await fetch(`${API}/tenants/me/setup`, { headers: auth() });
  return (await r.json()).data;
}

await apiLogin();

// PRECONDITION. The wizard is offered only to a trust that still has setup to
// do AND has not dismissed the checklist — both correct behaviours, and both
// make this suite order-dependent unless it establishes the state itself. It
// also dismisses the card at OB-18, so a second run would otherwise fail at
// OB-01 with no bug present. Clear one field to make the trust measurably
// incomplete, and un-dismiss.
await fetch(`${API}/tenants/me`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ custom_receipt_footer: '', setup_done: false }),
});

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
page.on('dialog', (d) => d.accept().catch(() => {}));

const crashes = [];
page.on('pageerror', (e) => crashes.push(String(e)));
const serverErrors = [];
page.on('response', (r) => {
  if (r.url().includes('/api/v1/') && r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
});

async function shot(name) { await page.screenshot({ path: `${SHOTS}${name}.png` }); }

/**
 * The tour is a modal overlay on the dashboard, so anything that wants to click
 * the page underneath has to close it first. Returns whether one was open —
 * several assertions below care about that.
 */
async function closeTourIfOpen() {
  const dlg = page.locator('[role="dialog"][aria-modal="true"]');
  if (!(await dlg.count())) return false;
  const skip = dlg.locator('button:has-text("Skip")').first();
  if (await skip.count()) await skip.click(); else await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  return true;
}

async function login() {
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=tel]');
  await page.fill('input[type=tel]', MOBILE);
  await page.click('button:has-text("Send OTP")');
  await page.waitForSelector('text=Dev mode — OTP:', { timeout: 15000 });
  const otp = (await page.textContent('.font-mono.font-bold')).trim();
  await page.fill('input[maxlength="6"]', otp);
  await page.click('button:has-text("Verify OTP")');
  await page.waitForTimeout(1200);
  if (await page.locator('text=Select your temple').count()) {
    await page.locator('.space-y-2 button').first().click();
  }
  await page.waitForURL(/\/(dashboard|setup)/, { timeout: 20000 });
}

/** Put the browser back into "never seen any of this" state. */
async function clearFirstRunFlags() {
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('jainerp_tour_done') || k.startsWith('jainerp_setup_wizard_offered')) {
        localStorage.removeItem(k);
      }
    }
  });
}

try {
  // ══ 1. First login offers the wizard ════════════════════════════════════
  await login();
  // The very first login may already have landed on /setup; if a previous run
  // marked it offered, clear and reload so the real first-run path is tested.
  if (!/\/setup$/.test(new URL(page.url()).pathname)) {
    await clearFirstRunFlags();
    await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
  }
  const onWizard = /\/setup$/.test(new URL(page.url()).pathname);
  record('OB-01', 'first login is taken to the setup wizard', onWizard,
    onWizard ? '' : `landed on ${new URL(page.url()).pathname}`);
  await shot('01-wizard-step1');

  // ══ 2. The wizard looks like registration and is escapable ══════════════
  const bodyA = await page.textContent('body');
  record('OB-02', 'wizard shows the 7-step stepper', /Trust details/i.test(bodyA) && /Public page/i.test(bodyA));
  record('OB-03', '"Do this later" is offered on the FIRST step', /Do this later/i.test(bodyA));
  record('OB-04', '"Skip this step" is offered on the first step', /Skip this step/i.test(bodyA));

  // ══ 3. Step 1 opens pre-filled from what is already saved ═══════════════
  const nameVal = await page.locator('input').first().inputValue();
  record('OB-05', 'step 1 is pre-filled, not blank', nameVal.trim().length > 0, `name="${nameVal}"`);

  // ══ 4. Skip does NOT save ═══════════════════════════════════════════════
  const websiteBefore = (await getSetup()) && null; // touch API to be sure it is live
  await page.fill('input >> nth=8', 'https://skipped-should-not-save.example');
  await page.click('button:has-text("Skip this step")');
  await page.waitForTimeout(900);
  const profAfterSkip = await (await fetch(`${API}/tenants/me`, { headers: auth() })).json();
  const skippedSaved = String(profAfterSkip.data?.website ?? '').includes('skipped-should-not-save');
  record('OB-06', 'Skip does not write the half-typed field', !skippedSaved,
    skippedSaved ? 'the skipped value was persisted' : 'ok');
  await shot('02-wizard-step2');

  // ══ 5. Next saves ═══════════════════════════════════════════════════════
  // We are on step 2 (tax). Type an 80G number and press Next.
  const marker = `QA80G${Date.now().toString().slice(-6)}`;
  const taxInputs = page.locator('input[type=text], input:not([type])');
  await taxInputs.nth(1).fill(marker);      // 80G registration number
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(1400);
  const prof2 = await (await fetch(`${API}/tenants/me`, { headers: auth() })).json();
  const saved = String(prof2.data?.reg_80g_number ?? '') === marker;
  record('OB-07', 'Next saves the step before advancing', saved,
    saved ? `reg_80g=${marker}` : `got "${prof2.data?.reg_80g_number}"`);
  await shot('03-wizard-step3');

  // ══ 6. Walk to the end ══════════════════════════════════════════════════
  for (let i = 0; i < 5; i++) {
    const btn = page.locator('button:has-text("Skip this step")');
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(500); }
  }
  const doneBody = await page.textContent('body');
  const onDone = /essentials done|Go to dashboard/i.test(doneBody);
  record('OB-08', 'wizard reaches its summary step', onDone);
  const pct = (doneBody.match(/(\d{1,3})%/) ?? [])[1];
  const apiPct = (await getSetup())?.percent;
  record('OB-09', 'summary meter agrees with the API', String(apiPct) === pct,
    `ui=${pct}% api=${apiPct}%`);
  await shot('04-wizard-done');

  await page.click('button:has-text("Go to dashboard")');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  record('OB-10', '"Go to dashboard" leaves the wizard', true);

  // ══ 7. It is offered ONCE ═══════════════════════════════════════════════
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const stillDash = /\/dashboard$/.test(new URL(page.url()).pathname);
  record('OB-11', 'the wizard is not forced a second time', stillDash,
    stillDash ? '' : `re-redirected to ${new URL(page.url()).pathname}`);

  // ══ 8. The dashboard checklist ══════════════════════════════════════════
  // Make sure it is not dismissed from an earlier run.
  await fetch(`${API}/tenants/me`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ setup_done: false }) });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  // Coming back from the wizard, a first-time user meets the tour on the
  // dashboard. It is modal, so the checklist underneath cannot be used until it
  // is dismissed — which is the behaviour, but it means this suite has to close
  // it before asserting on anything below.
  const tourOverDash = await closeTourIfOpen();
  record('OB-12a', 'the tour is dismissible and releases the page', !tourOverDash
    || (await page.locator('[role="dialog"][aria-modal="true"]').count()) === 0);
  const card = page.locator('[data-tour="setup-checklist"]');
  const hasCard = await card.count();
  record('OB-12', 'dashboard shows the setup checklist', hasCard > 0);
  await shot('05-dashboard-checklist');

  if (hasCard) {
    const meterPct = (await card.textContent()).match(/(\d{1,3})%/)?.[1];
    const apiPct2 = (await getSetup())?.percent;
    record('OB-13', 'checklist meter agrees with the API', String(apiPct2) === meterPct,
      `ui=${meterPct}% api=${apiPct2}%`);
    record('OB-14', 'checklist highlights exactly one next action',
      (await card.locator('[data-testid="setup-next"]').count()) === 1);
    record('OB-15', 'checklist offers the step-by-step wizard',
      (await card.locator('[data-testid="setup-wizard-link"]').count()) === 1);

    // Expand — every group the API returned must be on screen.
    await card.locator('button:has-text("Show everything")').click();
    await page.waitForTimeout(500);
    const expanded = await card.textContent();
    const setup = await getSetup();
    const missingGroups = setup.groups
      .map((g) => g.title.split('.')[0])
      .filter((title) => !expanded.includes(title.split(' ')[0]));
    record('OB-16', `checklist renders all ${setup.groups.length} groups`,
      missingGroups.length === 0, missingGroups.join(', '));
    await shot('06-checklist-expanded');

    // Every item's route must be a real page, not a dead link.
    const routes = [...new Set(setup.groups.flatMap((g) => g.items.map((i) => i.route)))];
    const dead = [];
    for (const r of routes) {
      await page.goto(`${WEB}${r}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const landed = new URL(page.url()).pathname;
      const want = r.split('?')[0];
      if (landed !== want) dead.push(`${r} → ${landed}`);
    }
    record('OB-17', `all ${routes.length} checklist routes are live pages`,
      dead.length === 0, dead.join('; '));
  }

  // ══ 9. Dismiss ══════════════════════════════════════════════════════════
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await closeTourIfOpen();
  if (await page.locator('[data-testid="setup-dismiss"]').count()) {
    await page.click('[data-testid="setup-dismiss"]');
    await page.waitForTimeout(1200);
    const gone = (await page.locator('[data-tour="setup-checklist"]').count()) === 0;
    const apiDismissed = (await getSetup())?.dismissed === true;
    record('OB-18', 'dismiss hides the card and persists', gone && apiDismissed,
      `hidden=${gone} api.dismissed=${apiDismissed}`);
  } else {
    record('OB-18', 'dismiss hides the card and persists', false, 'no dismiss button');
  }

  // ══ 10. Settings keeps the meter after dismissal ════════════════════════
  await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const settingsBody = await page.textContent('body');
  const apiPct3 = (await getSetup())?.percent;
  record('OB-19', 'Settings still shows the meter after dismissal',
    settingsBody.includes(`${apiPct3}%`), `looking for ${apiPct3}%`);
  record('OB-20', 'Settings offers a way back into setup', /Finish setup/i.test(settingsBody));
  await shot('07-settings-meter');

  // ══ 11. The product tour ════════════════════════════════════════════════
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await clearFirstRunFlags();
  // The wizard flag was cleared too — set it so the tour, not the wizard, runs.
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('jainerp-auth') ?? '{}');
    const id = t?.state?.tenant?.id;
    if (id) localStorage.setItem(`jainerp_setup_wizard_offered:${id}`, '1');
  });
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const tour = page.locator('[role="dialog"][aria-modal="true"]');
  const tourOpen = await tour.count();
  record('OB-21', 'first-time user is shown the tour', tourOpen > 0);
  await shot('08-tour-step1');

  if (tourOpen) {
    // Every step must spotlight something with real size — a step pointing at a
    // zero-sized or missing element is the failure mode this design has.
    let steps = 0, empty = 0;
    for (let i = 0; i < 20; i++) {
      const ring = page.locator('.ring-brand-red');
      if (await ring.count()) {
        const box = await ring.first().boundingBox();
        if (!box || box.width < 8 || box.height < 8) empty++;
      }
      steps++;
      const next = page.locator('[role="dialog"] button:has-text("Next")');
      if (!(await next.count())) break;
      await next.click();
      await page.waitForTimeout(650);
    }
    record('OB-22', `tour ran ${steps} steps with no empty spotlight`, empty === 0, `empty=${empty}`);

    const doneBtn = page.locator('[role="dialog"] button:has-text("Got it")');
    if (await doneBtn.count()) { await doneBtn.click(); await page.waitForTimeout(600); }
    record('OB-23', 'finishing the tour closes it',
      (await page.locator('[role="dialog"][aria-modal="true"]').count()) === 0);

    // Shown once.
    await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    record('OB-24', 'the tour does not reappear on the next visit',
      (await page.locator('[role="dialog"][aria-modal="true"]').count()) === 0);
  }

  // ══ 12. Replay from the top bar ═════════════════════════════════════════
  const compass = page.locator('header button[title]:not([title=""])').filter({ has: page.locator('svg') });
  const replay = page.locator('header button').nth(0);
  await page.goto(`${WEB}/donations`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const replayBtn = page.locator('header button[aria-label]');
  let clicked = false;
  for (let i = 0; i < (await replayBtn.count()); i++) {
    const label = await replayBtn.nth(i).getAttribute('aria-label');
    if (label && /around|tour|फेर|दिखा/i.test(label)) { await replayBtn.nth(i).click(); clicked = true; break; }
  }
  await page.waitForTimeout(2500);
  const replayed = (await page.locator('[role="dialog"][aria-modal="true"]').count()) > 0;
  record('OB-25', 'the top-bar compass replays the tour from any page', clicked && replayed,
    `clicked=${clicked} opened=${replayed}`);
  await shot('09-tour-replay');
  void compass; void replay; void websiteBefore;

  record('OB-26', 'no unhandled client errors during the run', crashes.length === 0,
    crashes.slice(0, 2).join(' | '));
  record('OB-27', 'no 5xx from the API during the run', serverErrors.length === 0,
    serverErrors.slice(0, 2).join(' | '));
} catch (e) {
  record('OB-FATAL', 'suite completed', false, String(e).slice(0, 300));
  await shot('99-fatal');
} finally {
  await browser.close();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n  ${pass}/${results.length} passed`);
if (pass !== results.length) {
  console.log('\n  Failures:');
  for (const r of results.filter((x) => !x.ok)) console.log(`   - ${r.id} ${r.title}: ${r.detail}`);
}
process.exit(pass === results.length ? 0 : 1);
