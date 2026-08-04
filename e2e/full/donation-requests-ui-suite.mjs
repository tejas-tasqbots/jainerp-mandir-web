/**
 * UI smoke E2E (real Chrome) — devotee bank/UPI donation approval workflow.
 *
 * Drives BOTH webs end-to-end through the new UI:
 *   devotee-web (:5174)  — Donate → pick temple → "UPI / Bank Transfer" →
 *                          bank card + QR + donor block → submit request →
 *                          Donations → Requests tab shows it pending
 *   mandir-web (:5173) — Donation Requests inbox (badge/tabs) → Review
 *                          modal (proof + donor details) → Approve → receipt
 *                          prompt; Settings → Donor Payments tab renders
 *
 *   PLAYWRIGHT_PATH="$(cd ../superadmin-web && node -e "console.log(require.resolve('playwright'))")" \
 *     node e2e/full/donation-requests-ui-suite.mjs
 *
 * Screenshots → e2e/full/screens/donation-requests/.
 */
import { mkdirSync } from 'fs';

const pwPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const pw = await import(pwPath);
const chromium = pw.chromium ?? pw.default?.chromium;

const MANDIR_WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const DEVOTEE_WEB = process.env.E2E_DEVOTEE_WEB ?? 'http://localhost:5174';
const ADMIN_MOBILE = '9876512345';
const DEVOTEE_MOBILE = `98112${String(Math.floor(10000 + Math.random() * 89999))}`;
const SHOTS = new URL('./screens/donation-requests/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} ${title}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: false }).catch(() => {});
}

/** OTP login shared by both webs (same "Dev mode — OTP:" bypass). */
async function otpLogin(page, web, mobile) {
  await page.goto(web, { waitUntil: 'networkidle' });
  await page.fill('input[type=tel]', mobile);
  await page.click('button:has-text("Send OTP")');
  await page.waitForSelector('text=Dev mode — OTP:', { timeout: 12000 });
  const otp = (await page.textContent('.font-mono.font-bold')).trim();
  await page.fill('input[maxlength="6"]', otp);
  await page.click('button:has-text("Verify OTP")');
  await page.waitForTimeout(1500);
}

try {
  // ============ DEVOTEE SIDE ============
  const dev = await newPage();
  await otpLogin(dev, DEVOTEE_WEB, DEVOTEE_MOBILE);

  // A brand-new mobile is routed to /register (profile completion) first.
  if ((await dev.url()).includes('/register') || (await dev.locator('text=Complete Your Profile').count())) {
    await dev.fill('input[placeholder="Ayush Kasliwal"]', 'UI Smoke Devotee');
    await dev.click('button:has-text("Save & Continue")');
    await dev.waitForTimeout(1500);
  }
  record('UIDR-01', 'devotee logs in + completes profile (fresh mobile)', !(await dev.url()).includes('/register'));

  // Donate → search temple → pick
  await dev.goto(`${DEVOTEE_WEB}/donate`, { waitUntil: 'networkidle' });
  await dev.fill('input[placeholder*="Search temple"]', 'Smoke');
  await dev.waitForSelector('text=Smoke Portal Mandir', { timeout: 12000 });
  await dev.click('text=Smoke Portal Mandir');
  await dev.waitForTimeout(1200);

  // Manual method toggle appears (temple has UPI/bank configured by API suite)
  const toggleVisible = await dev.locator('[data-testid="pay-method-toggle"]').count();
  record('UIDR-02', 'payment-method toggle offers "UPI / Bank Transfer"', toggleVisible > 0);
  await dev.click('text=UPI / Bank Transfer');
  await dev.waitForTimeout(800);

  const bankCard = await dev.locator('[data-testid="bank-details-card"]').count();
  const bodyTxt = (await dev.textContent('body')) ?? '';
  const hasUpi = /smokeportal@upi/.test(bodyTxt);
  const hasBank = /12345678901/.test(bodyTxt);
  const qrCount = await dev.locator('img[alt="UPI QR"]').count();
  record('UIDR-03', 'bank details card shows UPI id + bank account', bankCard > 0 && hasUpi && hasBank,
    `upi=${hasUpi} bank=${hasBank}`);

  await dev.fill('input[type=number]', '251');
  await dev.waitForTimeout(900); // QR debounce/regen with amount
  const qrAfterAmount = await dev.locator('img[alt="UPI QR"]').count();
  record('UIDR-04', 'UPI QR image rendered (generated from UPI id)', qrAfterAmount > 0, `imgs=${qrAfterAmount}(pre=${qrCount})`);
  await shot(dev, '01-devotee-bank-details-qr');

  // 80G on → donor details required; fill everything
  await dev.click('#is80g');
  await dev.fill('input[placeholder="ABCDE1234F"]', 'AAAPZ9999E');
  const donorBlock = await dev.locator('[data-testid="donor-details"]').count();
  record('UIDR-05', '80G checkbox (temple is registered) + donor receipt-details block', donorBlock > 0);

  const donor = dev.locator('[data-testid="donor-details"]');
  await donor.locator('input').nth(0).fill('UI Smoke Devotee');
  await donor.locator('input').nth(1).fill('9 Test Lane');
  await donor.locator('input').nth(2).fill('Indore');
  await donor.locator('input').nth(3).fill('MP');
  await donor.locator('input').nth(4).fill('452001');

  // Submit without UTR/proof → inline validation stops it
  await dev.click('button:has-text("Submit for verification")');
  await dev.waitForTimeout(600);
  const errShown = /UTR|reference number|screenshot/i.test((await dev.textContent('body')) ?? '');
  record('UIDR-06', 'submit without UTR/screenshot blocked with helper message', errShown);

  const utrRef = `UIS${Date.now()}`.slice(0, 16);
  await dev.fill('input[placeholder*="415223"]', utrRef);
  await shot(dev, '02-devotee-request-form');
  await dev.click('button:has-text("Submit for verification")');
  await dev.waitForSelector('text=Sent for verification!', { timeout: 15000 });
  record('UIDR-07', 'request submitted → pending-approval result screen', true);
  await shot(dev, '03-devotee-request-submitted');

  // Donations → Requests tab shows the pending row
  await dev.goto(`${DEVOTEE_WEB}/donations`, { waitUntil: 'networkidle' });
  await dev.click('button:has-text("Requests")');
  await dev.waitForTimeout(800);
  const reqList = (await dev.textContent('[data-testid="requests-list"]').catch(() => '')) ?? '';
  record('UIDR-08', 'devotee Requests tab lists the pending request',
    /Pending approval/i.test(reqList) && /Smoke Portal/i.test(reqList));
  await shot(dev, '04-devotee-requests-tab');

  // ============ MANDIR SIDE ============
  const adm = await newPage();
  await otpLogin(adm, MANDIR_WEB, ADMIN_MOBILE);
  if (await adm.locator('text=Select your temple').count()) {
    await adm.click('text=Smoke Portal Mandir');
    await adm.waitForTimeout(1500);
  }

  // Requests inbox lives inside the Donations hub (tab `?tab=requests`);
  // the old /donation-requests URL redirects there.
  await adm.waitForSelector('a:has-text("Donations")', { timeout: 12000 });
  await adm.goto(`${MANDIR_WEB}/donations?tab=requests`, { waitUntil: 'networkidle' });
  await adm.waitForSelector('text=Donation Requests', { timeout: 12000 });
  record('UIDR-09', 'Donations hub exposes the Requests tab (inbox)', true);
  await adm.waitForTimeout(1000);
  const inboxTxt = (await adm.textContent('body')) ?? '';
  record('UIDR-10', 'inbox lists the pending request from the devotee',
    /UI Smoke Devotee/.test(inboxTxt) && /251\.00/.test(inboxTxt));
  await shot(adm, '05-mandir-inbox-pending');

  // Review modal: proof + donor details
  await adm.click('button:has-text("Review")');
  await adm.waitForSelector('text=Receipt details', { timeout: 8000 });
  const modalTxt = (await adm.textContent('body')) ?? '';
  record('UIDR-11', 'review modal shows donor identity for the 80G receipt',
    /UI Smoke Devotee/.test(modalTxt) && /9 Test Lane/.test(modalTxt) && /AAXXXXX99E/.test(modalTxt));
  await shot(adm, '06-mandir-review-modal');

  // Approve (modal button → ConfirmDialog → post-approve print prompt → Later)
  await adm.click('button:has-text("Approve & create receipt")');
  await adm.waitForSelector('text=Verify ₹', { timeout: 8000 });
  await shot(adm, '07-mandir-approve-confirm');
  await adm.locator('button:has-text("Approve & create receipt")').last().click();
  await adm.waitForSelector('text=Print the receipt now?', { timeout: 20000 });
  record('UIDR-12', 'approval succeeds → receipt-created prompt (WhatsApp text auto-sent)', true);
  await shot(adm, '08-mandir-approved-print-prompt');
  await adm.click('button:has-text("Later")');
  await adm.waitForTimeout(1000);

  // Scope to this run's own UTR, not the shared "UI Smoke Devotee" display
  // name — repeated suite runs leave other still-pending rows with that name.
  const pendingNow = (await adm.textContent('body')) ?? '';
  record('UIDR-13', 'approved request left the pending tab', !pendingNow.includes(utrRef));
  await adm.click('button:has-text("Approved")');
  await adm.waitForTimeout(800);
  const approvedTab = (await adm.textContent('body')) ?? '';
  record('UIDR-14', 'approved tab shows the receipt number', /DON\/\d{4}-\d{2}\/\d{6}/.test(approvedTab));
  await shot(adm, '09-mandir-approved-tab');

  // Settings → Donor Payments tab
  await adm.goto(`${MANDIR_WEB}/settings`, { waitUntil: 'networkidle' });
  await adm.click('button:has-text("Donor Payments")');
  await adm.waitForTimeout(800);
  const dpTxt = (await adm.textContent('body')) ?? '';
  record('UIDR-15', 'Settings → Donor Payments tab (toggle + UPI + bank + 80G hint)',
    /Accept UPI \/ bank-transfer donation requests/.test(dpTxt) && /UPI ID/.test(dpTxt) && /80G/.test(dpTxt));
  await shot(adm, '10-mandir-donor-payments-settings');

  // ============ DEVOTEE SEES APPROVAL ============
  await dev.goto(`${DEVOTEE_WEB}/notifications`, { waitUntil: 'networkidle' });
  await dev.waitForTimeout(900);
  const notifTxt = (await dev.textContent('body')) ?? '';
  record('UIDR-16', 'devotee notification "Donation approved" with receipt link',
    /Donation approved/.test(notifTxt) && /View receipt/.test(notifTxt));
  await shot(dev, '11-devotee-approved-notification');

  await dev.goto(`${DEVOTEE_WEB}/donations`, { waitUntil: 'networkidle' });
  await dev.click('button:has-text("Requests")');
  await dev.waitForTimeout(900);
  const reqTxt2 = (await dev.textContent('[data-testid="requests-list"]').catch(() => '')) ?? '';
  record('UIDR-17', 'devotee request now Approved with receipt no + Receipt button',
    /Approved/.test(reqTxt2) && /DON\/\d{4}-\d{2}\/\d{6}/.test(reqTxt2) && /Receipt/.test(reqTxt2));
  await shot(dev, '12-devotee-request-approved');

  // ============ DESKTOP OFFLINE GATE (simulated Electron) ============
  // The inbox is online-only (central-server data). Simulate the desktop
  // shell reporting "offline" and assert the page gates instead of fetching.
  const desk = await newPage();
  await desk.addInitScript(() => {
    window.__JAINERP_DESKTOP__ = true;
    window.electronAPI = {
      isElectron: true,
      checkConnectivity: () => Promise.resolve(false),
      onConnectivityChange: () => () => {},
    };
  });
  await otpLogin(desk, MANDIR_WEB, ADMIN_MOBILE);
  if (await desk.locator('text=Select your temple').count()) {
    await desk.click('text=Smoke Portal Mandir');
    await desk.waitForTimeout(1500);
  }
  // Desktop uses HashRouter (Electron file:// needs hash routing, toggled by
  // __JAINERP_DESKTOP__), so a plain goto(path) doesn't navigate the SPA —
  // click through the UI like a real user instead.
  await desk.waitForSelector('a:has-text("Donations")', { timeout: 12000 });
  await desk.click('a:has-text("Donations")');
  await desk.waitForTimeout(800);
  await desk.click('button:has-text("Requests")');
  await desk.waitForTimeout(1200);
  const deskTxt = (await desk.textContent('body')) ?? '';
  record('UIDR-18', 'desktop offline → inbox gates with "needs internet" state (no fetch)',
    /Donation requests need an internet connection/.test(deskTxt) && !/UI Smoke Devotee/.test(deskTxt));
  await shot(desk, '13-desktop-offline-gate');
  await desk.close();
} catch (e) {
  record('UIDR-ERR', 'suite crashed', false, String(e).slice(0, 140));
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n=== UI SMOKE: ${results.length - fails.length}/${results.length} passed ===`);
if (fails.length) fails.forEach((f) => console.log(`  ✘ ${f.id} ${f.title} — ${f.detail}`));
process.exit(fails.length ? 1 : 0);
