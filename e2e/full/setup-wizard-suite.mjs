/**
 * The rewritten wizard: does each step actually WRITE what it collects, into
 * the place the product now reads from?
 *
 * The money step is the one that mattered — it used to type bank details into
 * kshetra_profile columns the devotee app no longer reads, so a trust could
 * complete setup and still show donors nothing.
 */
const pw = await import(process.env.PLAYWRIGHT_PATH);
const chromium = pw.chromium ?? pw.default?.chromium;
const WEB = process.env.WEB, API = process.env.API;

const results = [];
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${id}${detail ? ' — ' + detail : ''}`);
};

const post = async (p, b) => (await (await fetch(API + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})).json()).data;
const s = await post('/auth/send-otp', { mobile: '9855121877' });
const v = await post('/auth/verify-otp', { mobile: '9855121877', otp: s.dev_otp });
const t = await post('/auth/select-tenant', { selection_token: v.selection_token, tenant_slug: 'e2e-test-trust-55121877' });
const TOK = t.access_token;
const get = async (p) => (await (await fetch(API + p, { headers: { Authorization: `Bearer ${TOK}` } })).json());

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.setDefaultTimeout(25000);
const crashes = [];
page.on('pageerror', e => crashes.push(String(e).slice(0, 140)));

const stamp = Date.now().toString().slice(-6);

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

  await page.goto(`${WEB}/setup`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  const stepper = (await page.textContent('body')) ?? '';
  rec('the wizard has a Categories step', /Categories/i.test(stepper));

  // ── walk to Money ────────────────────────────────────────────────────────
  for (let i = 0; i < 2; i++) {
    await page.click('button:has-text("Skip this step")');
    await page.waitForTimeout(600);
  }
  const money = (await page.textContent('body')) ?? '';
  rec('money step asks about the bank account', /Your bank account/i.test(money));
  rec('money step says the details get verified', /verifies these details/i.test(money));
  rec('UPI hint says the QR is generated', /do not need to upload/i.test(money));

  // This trust already has bank accounts, so the step must offer a CHOICE
  // rather than a second form — that gap let a trust finish setup with no
  // donation account nominated at all.
  const radios = page.locator('input[type=radio][name="wizard-donation-account"]');
  const nChoices = await radios.count();
  rec('existing bank accounts are offered as a choice', nChoices > 0, `${nChoices} accounts`);
  if (nChoices > 0) await radios.first().check();
  await page.locator('input[type=text], input:not([type])').last().fill(`qa${stamp}@sbi`);
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(2200);

  // ── the money step must have written to the NEW model ───────────────────
  const acct = (await get('/tenants/me/donation-account')).data;
  rec('the wizard nominated a donation account', !!acct?.account_no,
    acct ? `${acct.name} ${acct.account_no}` : 'nothing nominated');
  rec('the nominated account starts unverified', acct ? acct.is_verified === false : false);
  const prof = (await get('/tenants/me')).data;
  rec('the UPI id was saved', prof.upi_id === `qa${stamp}@sbi`, prof.upi_id);

  // ── Categories step ─────────────────────────────────────────────────────
  const cats = (await page.textContent('body')) ?? '';
  rec('categories step explains why it is asking',
    /needs a category|needs a head|nothing can be recorded/i.test(cats));
  const catBefore = (await get('/donation-categories?limit=1')).meta?.total ?? 0;
  const headBefore = (await get('/expense-categories?limit=1')).meta?.total ?? 0;
  const cinputs = page.locator('input[type=text], input:not([type])');
  await cinputs.nth(0).fill(`QA Cat A ${stamp}, QA Cat B ${stamp}`);
  await cinputs.nth(1).fill(`QA Head ${stamp}`);
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(2200);
  const catAfter = (await get('/donation-categories?limit=1')).meta?.total ?? 0;
  const headAfter = (await get('/expense-categories?limit=1')).meta?.total ?? 0;
  rec('two donation categories were created', catAfter === catBefore + 2, `${catBefore} → ${catAfter}`);
  rec('one expense head was created', headAfter === headBefore + 1, `${headBefore} → ${headAfter}`);

  // ── reach the summary ───────────────────────────────────────────────────
  for (let i = 0; i < 6; i++) {
    const b = page.locator('button:has-text("Skip this step")');
    if (!(await b.count())) break;
    await b.click(); await page.waitForTimeout(500);
  }
  const done = (await page.textContent('body')) ?? '';
  rec('the summary is reached', /Go to dashboard/i.test(done));
  const pct = (done.match(/(\d{1,3})%/) ?? [])[1];
  const apiPct = (await get('/tenants/me/setup')).data?.percent;
  rec('the summary percentage matches the API', String(apiPct) === pct, `ui=${pct}% api=${apiPct}%`);

  rec('no unhandled client errors', crashes.length === 0, crashes.slice(0, 2).join(' | '));
} catch (e) {
  rec('FATAL', false, String(e).slice(0, 220));
  await page.screenshot({ path: `${process.env.SHOTS}99-fatal.png` }).catch(() => {});
} finally {
  await browser.close();
}

const pass = results.filter(r => r.ok).length;
console.log(`\n  ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
