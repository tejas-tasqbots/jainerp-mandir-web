/**
 * Focused regression for the donor-picker rebuild + PAN-on-receipt work.
 *
 * Mirrors exactly what the rebuilt DevoteePicker.saveDonor() + AddDonation do:
 *   1. register a donor with an inline PAN (POST /devotees/register)
 *   2. create an 80G-eligible donation for that donor
 *   3. fetch the receipt payload (GET /donations/:id/receipt)
 *   4. assert donor.pan_masked is present in the payload
 *   5. render every receipt template via buildReceiptHtml() and assert the
 *      masked PAN actually prints (the bug we fixed)
 *   6. negative: a NON-80G donation must NOT show the donor PAN on any template
 *   7. 80G ticked with no PAN must be blocked (PAN_REQUIRED) — picker/back-end guard
 *
 * Run: node e2e/full/pan-picker-suite.mjs   (API on :3106, tenant smoke-portal)
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'url';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BASE = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const TENANT = 'smoke-portal';
const ADMIN = process.env.E2E_ADMIN ?? '9876512345';

const results = [];
const rec = (id, title, ok, detail = '') => {
  results.push({ id, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} ${title}${detail ? ' — ' + detail : ''}`);
};

async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json, data: json?.data ?? json, code: json?.error?.code ?? json?.code };
}

async function loginFull(mobile) {
  const send = await http('POST', '/auth/send-otp', { body: { mobile } });
  const otp = send.data?.dev_otp;
  if (!otp) throw new Error(`no dev_otp for ${mobile}: ${JSON.stringify(send.json)}`);
  const ver = await http('POST', '/auth/verify-otp', { body: { mobile, otp } });
  const sel = ver.data?.selection_token;
  const r = await http('POST', '/auth/select-tenant', { body: { selection_token: sel, tenant_slug: TENANT } });
  return r.data?.access_token;
}

// Transpile the real buildReceiptHtml (stub ./api — unused by the renderer).
async function loadRenderer() {
  const out = await build({
    entryPoints: [new URL('../../src/lib/printReceipt.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', write: false,
    external: [], logLevel: 'silent',
    plugins: [{
      name: 'stub-api',
      setup(b) {
        b.onResolve({ filter: /\.\/api$/ }, () => ({ path: 'stub-api', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const api = {};', loader: 'js' }));
      },
    }],
  });
  const dir = mkdtempSync(join(tmpdir(), 'rcpt-'));
  const file = join(dir, 'printReceipt.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

const TEMPLATES = ['classic', 'minimal', 'modern', 'traditional', 'elegant', 'temple', 'tabular', 'acknowledgement', 'jain_tirth', '80g'];

async function run() {
  console.log(`\n=== PAN + Picker regression — ${BASE} (tenant ${TENANT}) ===\n`);
  const token = await loginFull(ADMIN);
  if (!token) throw new Error('login failed');
  const { buildReceiptHtml } = await loadRenderer();

  // Need an 80G-eligible category + a cash/bank account.
  const cats = (await http('GET', '/donation-categories?is_active=true', { token })).data ?? [];
  const cat80 = cats.find(c => c.is_80g_eligible) ?? cats[0];
  rec('SETUP-01', '80G donation category available', !!cat80, cat80 ? `${cat80.name}` : 'none');

  // Valid Indian E.164: +91 followed by exactly 10 digits starting 6-9.
  const uniq = Date.now().toString().slice(-6); // 6 digits
  const mobile = `+919${uniq}200`.slice(0, 13);  // +91 9 xxxxxx 200 = 10 national digits
  const pan = 'ABCDE1234F';

  // (1) Register donor with inline PAN — exactly like the picker's saveDonor().
  const reg = await http('POST', '/devotees/register', { token, body: {
    mobile, name: `PAN Test ${uniq}`, pan, email: `pan${uniq}@t.com`,
    country: 'India', state: 'Maharashtra', city: 'Pune', address: 'Test Rd', pincode: '411001',
  }});
  const globalUserId = reg.data?.user_id;
  rec('PICK-01', 'picker register donor w/ inline PAN', reg.status < 300 && !!globalUserId, `user_id=${globalUserId ? 'ok' : 'MISSING'}`);

  // (2) Create an 80G donation for that donor (as AddDonation does).
  const don = await http('POST', '/donations', { token, body: {
    category_id: cat80?.id,
    amount_paise: 5000_00,
    payment_mode: 'upi',
    is_80g_eligible: true,
    utr_number: `UTR${uniq}`,
    donor: { global_user_id: globalUserId, name: `PAN Test ${uniq}`, mobile },
  }});
  const donId = don.data?.id;
  rec('PICK-02', '80G donation created for PAN donor', don.status < 300 && !!donId, `receipt=${don.data?.receipt_number ?? don.code}`);

  // (3)(4) Receipt payload carries masked donor PAN.
  const rcptRes = await http('GET', `/donations/${donId}/receipt`, { token });
  const rcpt = rcptRes.data;
  const masked = rcpt?.donor?.pan_masked;
  const isMasked = !!masked && masked !== pan && /X/.test(masked);
  rec('PAN-01', 'receipt payload has masked donor PAN', isMasked, `pan_masked=${masked ?? 'null'}`);
  rec('PAN-02', 'full PAN is NOT in payload (never printed raw)', JSON.stringify(rcpt).indexOf(pan) === -1, masked ?? '');

  // (5) Every template renders the masked PAN in the HTML.
  for (const t of TEMPLATES) {
    const r = { ...rcpt, mandir: { ...rcpt.mandir, template: t, show_80g: true } };
    const html = buildReceiptHtml(r);
    const ok = masked ? html.includes(masked) : false;
    rec(`TMPL-${t}`, `template '${t}' prints masked donor PAN`, ok, ok ? '' : 'PAN missing from HTML');
  }

  // (6) Negative: a NON-80G donation must NOT show donor PAN on any template.
  const nonMasked = { ...rcpt, is_80g_eligible: false };
  let leaked = false;
  for (const t of TEMPLATES) {
    const html = buildReceiptHtml({ ...nonMasked, mandir: { ...rcpt.mandir, template: t, show_80g: true } });
    if (masked && html.includes(masked)) leaked = true;
  }
  rec('PAN-03', 'non-80G receipts do NOT show donor PAN (any template)', !leaked);

  // (7) 80G ticked but donor has no PAN → blocked.
  const noPanMobile = `+919${uniq}300`.slice(0, 13);
  const reg2 = await http('POST', '/devotees/register', { token, body: { mobile: noPanMobile, name: `NoPAN ${uniq}` }});
  const noPanId = reg2.data?.user_id;
  const blocked = await http('POST', '/donations', { token, body: {
    category_id: cat80?.id, amount_paise: 3000_00, payment_mode: 'upi', is_80g_eligible: true,
    utr_number: `UTR2${uniq}`, donor: { global_user_id: noPanId, name: `NoPAN ${uniq}`, mobile: noPanMobile },
  }});
  rec('PAN-04', '80G without donor PAN is blocked (PAN_REQUIRED)', blocked.status >= 400 && blocked.code === 'PAN_REQUIRED', `code=${blocked.code} status=${blocked.status}`);

  const passed = results.filter(r => r.ok).length;
  console.log(`\n=== SUMMARY: ${passed}/${results.length} passed, ${results.length - passed} failed ===\n`);
  console.log('JSON_RESULTS=' + JSON.stringify(results));
  if (passed !== results.length) process.exit(1);
}

run().catch(e => { console.error('FATAL', e); process.exit(2); });
