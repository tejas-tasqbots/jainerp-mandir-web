/**
 * Settings deep-linking: every ?tab= must land on the tab it names, and every
 * route the setup checklist hands out must be one of them.
 *
 * This is the regression that made the whole checklist feel broken — the links
 * were right, nothing read them, and every item landed on Temple Profile.
 */
const pw = await import(process.env.PLAYWRIGHT_PATH);
const chromium = pw.chromium ?? pw.default?.chromium;
const WEB = process.env.WEB, API = process.env.API;

const results = [];
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${id}${detail ? ' — ' + detail : ''}`);
};

const j = async (p, b) => (await (await fetch(`${API}${p}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})).json()).data;
const s = await j('/auth/send-otp', { mobile: '9855121877' });
const v = await j('/auth/verify-otp', { mobile: '9855121877', otp: s.dev_otp });
const t = await j('/auth/select-tenant', { selection_token: v.selection_token, tenant_slug: 'e2e-test-trust-55121877' });
const setup = (await (await fetch(`${API}/tenants/me/setup`, {
  headers: { Authorization: `Bearer ${t.access_token}` } })).json()).data;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.setDefaultTimeout(20000);

// The tab label rendered highlighted tells us which pane is really showing.
async function activeTab() {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('button')]
      .find(b => b.className.includes('bg-navy-900') && b.className.includes('text-white'));
    return el?.textContent?.trim() ?? null;
  });
}

try {
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.fill('input[type=tel]', '9855121877');
  await page.click('button:has-text("Send OTP")');
  await page.waitForSelector('text=Dev mode — OTP:');
  await page.fill('input[maxlength="6"]', (await page.textContent('.font-mono.font-bold')).trim());
  await page.click('button:has-text("Verify OTP")');
  await page.waitForTimeout(1200);
  if (await page.locator('text=Select your temple').count()) await page.locator('.space-y-2 button').first().click();
  await page.waitForURL(/\/(dashboard|setup)/, { timeout: 20000 });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('jainerp-auth') ?? '{}');
    const ten = raw?.state?.tenant?.id, u = raw?.state?.user?.id;
    if (ten) localStorage.setItem(`jainerp_setup_wizard_offered:${ten}`, '1');
    if (ten && u) localStorage.setItem(`jainerp_tour_done:mandir:${ten}:${u}`, '1');
  });

  // ── 1. every tab id addresses its own pane ──────────────────────────────
  const expect = {
    'my-account': 'My Account', profile: 'Temple Profile', 'public-profile': 'Public profile',
    trustees: 'Trustees', accounts: 'Bank & Cash Accounts', receipts: 'Receipt Settings',
    numbering: 'Numbering', messages: 'Messages', masters: 'Categories & Dropdowns',
    users: 'Users', backup: 'Backup', privacy: 'Privacy & Sync', subscription: 'Subscription & Usage',
  };
  for (const [id, label] of Object.entries(expect)) {
    await page.goto(`${WEB}/settings?tab=${id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const active = await activeTab();
    rec(`?tab=${id}`, active === label, `active="${active}" expected="${label}"`);
  }

  // ── 2. the folded tabs are gone from the bar ────────────────────────────
  await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const bar = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(Boolean).join('|'));
  for (const gone of ['Donor Payments', 'Gallery', 'Accounting Rules']) {
    rec(`"${gone}" is no longer its own tab`, !new RegExp(`\\|${gone}\\|`).test(`|${bar}|`));
  }

  // ── 3. old links still work, folded into their owner ────────────────────
  for (const [alias, label] of Object.entries({
    'donor-payments': 'Bank & Cash Accounts', gallery: 'Public profile', accounting: 'Temple Profile',
  })) {
    await page.goto(`${WEB}/settings?tab=${alias}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const active = await activeTab();
    rec(`old ?tab=${alias} still lands (→ ${label})`, active === label, `active="${active}"`);
  }

  // ── 4. the absorbed content is actually on the owning tab ───────────────
  await page.goto(`${WEB}/settings?tab=accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const acct = (await page.textContent('body')) ?? '';
  rec('donor payment details render under Bank & Cash Accounts', /UPI ID|Direct donations/i.test(acct));
  rec('the UPI QR image URL field is gone', !/UPI QR image URL/i.test(acct));

  await page.goto(`${WEB}/settings?tab=public-profile`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const pub = (await page.textContent('body')) ?? '';
  rec('the gallery renders under Public profile', /Gallery|Photos/i.test(pub));

  await page.goto(`${WEB}/settings?tab=profile`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const prof = (await page.textContent('body')) ?? '';
  // Assert on FIELDS, not prose: the tab now carries a note telling the user
  // where those settings moved to, which naturally contains the words.
  const footerInputs = await page.locator('textarea, input').evaluateAll(els =>
    els.filter(e => /footer|upi/i.test(e.getAttribute('placeholder') ?? '')).length);
  rec('Temple Profile no longer has a receipt-footer or UPI input', footerInputs === 0,
    `${footerInputs} such inputs`);
  rec('Temple Profile points at where those settings moved', /Receipt Settings/i.test(prof));

  // ── 5. EVERY route the checklist hands out lands where it says ──────────
  const routes = [...new Set(setup.groups.flatMap(g => g.items.map(i => i.route)))];
  const bad = [];
  for (const r of routes) {
    await page.goto(`${WEB}${r}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const url = new URL(page.url());
    if (url.pathname !== r.split('?')[0]) { bad.push(`${r} → ${url.pathname}`); continue; }
    const want = new URLSearchParams(r.split('?')[1] ?? '').get('tab');
    if (want && url.searchParams.get('tab') !== want) bad.push(`${r} → tab=${url.searchParams.get('tab')}`);
  }
  rec(`all ${routes.length} checklist routes land on what they name`, bad.length === 0, bad.join('; '));
} catch (e) {
  rec('FATAL', false, String(e).slice(0, 200));
} finally {
  await browser.close();
}
const pass = results.filter(r => r.ok).length;
console.log(`\n  ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
