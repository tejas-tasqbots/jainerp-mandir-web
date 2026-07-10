/**
 * EXHAUSTIVE edge-case regression for the donor-picker rebuild + PAN-on-receipt.
 * Every small scenario around the two changed areas:
 *   A) donorPan() render logic — pure buildReceiptHtml() over the full matrix of
 *      { 80G on/off } × { pan present/absent/empty } × { all 10 templates }
 *      + anonymous/Dan-Peti + XSS-ish PAN safety + amount-in-words extremes.
 *   B) picker/back-end data paths — register (with/without PAN, no-PAN flag,
 *      already-verified, international mobile), OTP verify, PAN backfill onto an
 *      existing donor, invalid PAN, duplicate mobile, 80G guard, cash>2000 rule.
 *
 * Run: node e2e/full/pan-picker-edge-suite.mjs   (API :3106, tenant smoke-portal)
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
let group = '';
const G = (g) => { group = g; console.log(`\n── ${g} ──`); };
const rec = (id, title, ok, detail = '') => {
  results.push({ id, group, title, ok, detail });
  console.log(`  ${ok ? '✔' : '✘ FAIL'} ${id} ${title}${detail ? ' — ' + detail : ''}`);
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
  const r = await http('POST', '/auth/select-tenant', { body: { selection_token: ver.data?.selection_token, tenant_slug: TENANT } });
  return r.data?.access_token;
}
async function loadRenderer() {
  const out = await build({
    entryPoints: [new URL('../../src/lib/printReceipt.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /\.\/api$/ }, () => ({ path: 'stub', namespace: 's' }));
      b.onLoad({ filter: /.*/, namespace: 's' }, () => ({ contents: 'export const api={};', loader: 'js' }));
    }}],
  });
  const dir = mkdtempSync(join(tmpdir(), 'rc-'));
  const file = join(dir, 'r.mjs'); writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

const TEMPLATES = ['classic', 'minimal', 'modern', 'traditional', 'elegant', 'temple', 'tabular', 'acknowledgement', 'jain_tirth', '80g'];

// Base payload shell for pure-render tests.
function payload(over = {}) {
  return {
    receipt_number: 'DON/2026-27/000999', date: '2026-07-08T00:00:00Z',
    mandir: { name: 'Test Mandir', address: 'Addr, City', template: 'classic', primary_color: '#0D1B2E', show_80g: true, reg_80g_number: 'AAA80G', pan: 'TRUST1234T' },
    donor: { name: 'Test Donor', mobile: '+919876500000', pan_masked: 'ABXXXXX34F' },
    category: 'Corpus', amount_paise: 1500000, payment_mode: 'upi', is_80g_eligible: true, is_voided: false,
    ...over,
  };
}
const mask = 'ABXXXXX34F';

async function run() {
  console.log(`\n=== EXHAUSTIVE PAN + Picker edge regression — ${BASE} (${TENANT}) ===`);
  const token = await loginFull(ADMIN);
  const { buildReceiptHtml } = await loadRenderer();

  // ───────────────────────────────────────────────────────────────────────────
  G('A1 — donorPan render: 80G + PAN present → masked PAN on ALL templates');
  for (const t of TEMPLATES) {
    const html = buildReceiptHtml(payload({ mandir: { ...payload().mandir, template: t } }));
    rec(`A1-${t}`, `${t} shows masked PAN`, html.includes(mask) && !html.includes('ABCDE'), '');
  }

  G('A2 — 80G eligible but NO donor PAN → PAN line absent (all templates), no crash');
  for (const t of TEMPLATES) {
    const html = buildReceiptHtml(payload({ donor: { name: 'NoPan Donor', mobile: '+919876500001', pan_masked: null }, mandir: { ...payload().mandir, template: t } }));
    // Must not print a bare "PAN:" donor line with empty value, must still render
    const ok = html.length > 200 && !/PAN:\s*<\/(b|span|div)>/.test(html) && !html.includes('PAN: <b></b>');
    rec(`A2-${t}`, `${t} no empty donor-PAN line`, ok, '');
  }

  G('A3 — NOT 80G but PAN on file → donor PAN must NOT appear (all templates)');
  for (const t of TEMPLATES) {
    const html = buildReceiptHtml(payload({ is_80g_eligible: false, mandir: { ...payload().mandir, template: t } }));
    rec(`A3-${t}`, `${t} hides PAN when non-80G`, !html.includes(mask), '');
  }

  G('A4 — empty-string PAN (not null) → treated as absent');
  for (const t of ['classic', 'temple', 'tabular', 'jain_tirth', '80g']) {
    const html = buildReceiptHtml(payload({ donor: { name: 'D', pan_masked: '' }, mandir: { ...payload().mandir, template: t } }));
    rec(`A4-${t}`, `${t} empty PAN not shown`, !/PAN:\s*<\/?b>?\s*<\/(div|span)>/.test(html) && !html.includes('PAN: </b>'), '');
  }

  G('A5 — anonymous / Dan-Peti donor (name Anonymous, no PAN) → never a PAN line');
  for (const t of ['classic', 'minimal', 'temple']) {
    const html = buildReceiptHtml(payload({ is_80g_eligible: false, donor: { name: 'Anonymous', mobile: null, pan_masked: null }, mandir: { ...payload().mandir, template: t } }));
    rec(`A5-${t}`, `${t} anonymous has no PAN`, !html.includes(mask) && html.includes('Anonymous'), '');
  }

  G('A6 — amount-in-words extremes (no infinite recursion / no crash)');
  for (const amt of [0, 100, 99999, 100000, 10000000, 999999999900]) {
    let ok = true, detail = '';
    try { const html = buildReceiptHtml(payload({ amount_paise: amt })); ok = html.length > 200; }
    catch (e) { ok = false; detail = String(e).slice(0, 40); }
    rec(`A6-${amt}`, `amount ${amt} renders`, ok, detail);
  }

  G('A7 — voided receipt still renders PAN + void banner');
  {
    const html = buildReceiptHtml(payload({ is_voided: true }));
    rec('A7-1', 'voided shows PAN + VOID banner', html.includes(mask) && /VOID/i.test(html), '');
  }

  G('A8 — mandir.show_80g=false but donation 80G → donor PAN still shows (donor PAN is independent of trust 80G display)');
  {
    const html = buildReceiptHtml(payload({ mandir: { ...payload().mandir, show_80g: false } }));
    rec('A8-1', 'donor PAN independent of show_80g', html.includes(mask), '');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // B — live picker / backend data paths
  const cats = (await http('GET', '/donation-categories?is_active=true', { token })).data ?? [];
  const cat80 = cats.find(c => c.is_80g_eligible) ?? cats[0];
  const catNon = cats.find(c => !c.is_80g_eligible);
  const stamp = Date.now().toString().slice(-8); // 8 digits
  // Valid Indian E.164: +91 then exactly 10 digits starting 9 → 9 + 8 stamp + suffix.
  const mob = (suffix) => `+919${stamp}${suffix}`; // +91 (9 + 8 + 1 = 10 digits)

  G('B1 — register donor WITH inline PAN (picker saveDonor online path)');
  const r1 = await http('POST', '/devotees/register', { token, body: { mobile: mob('1'), name: 'Edge PAN', pan: 'ABCDE1234F', city: 'Pune' } });
  const uid1 = r1.data?.user_id;
  rec('B1-1', 'register returns user_id', r1.status < 300 && !!uid1, `code=${r1.code ?? 'ok'}`);
  rec('B1-2', 'register returns dev_otp for optional verify', !!r1.data?.dev_otp, '');

  G('B2 — register donor WITHOUT PAN (noPan / not-shared path)');
  const r2 = await http('POST', '/devotees/register', { token, body: { mobile: mob('2'), name: 'Edge NoPan', city: 'Pune' } });
  rec('B2-1', 'register w/o PAN ok', r2.status < 300 && !!r2.data?.user_id, '');

  G('B3 — invalid PAN format rejected at donation time (regex ^[A-Z]{5}\\d{4}[A-Z]$)');
  const rBad = await http('POST', '/donations', { token, body: { category_id: cat80?.id, amount_paise: 100000, payment_mode: 'upi', is_80g_eligible: true, donor: { name: 'Bad PAN', mobile: mob('3'), pan: 'NOTAPAN' } } });
  rec('B3-1', 'invalid PAN → error (not silently stored)', rBad.status >= 400, `code=${rBad.code} status=${rBad.status}`);

  G('B4 — 80G donation for PAN donor → FULL PAN on live receipt (masked stays in payload)');
  const d4 = await http('POST', '/donations', { token, body: { category_id: cat80?.id, amount_paise: 500000, payment_mode: 'upi', is_80g_eligible: true, utr_number: `U${stamp}`, donor: { global_user_id: uid1, name: 'Edge PAN', mobile: mob('1') } } });
  const rc4 = (await http('GET', `/donations/${d4.data?.id}/receipt`, { token })).data;
  const m4 = rc4?.donor?.pan_masked;
  const f4 = rc4?.donor?.pan_full;
  rec('B4-1', 'receipt payload carries masked + full PAN for 80G', !!m4 && /X/.test(m4) && !!f4 && !/X/.test(f4), `masked=${m4} full=${f4}`);
  // 80G receipt renders the FULL PAN (income-tax rule), not the masked form.
  const html4 = buildReceiptHtml({ ...rc4, mandir: { ...rc4.mandir, template: 'classic' } });
  rec('B4-2', 'live 80G receipt renders FULL PAN on classic (not masked)', !!f4 && html4.includes(f4) && !html4.includes(m4), '');

  G('B5 — PAN backfill: donor created WITHOUT PAN, then 80G donation supplies inline PAN → backfilled + on receipt');
  const uid5 = r2.data?.user_id;
  const d5 = await http('POST', '/donations', { token, body: { category_id: cat80?.id, amount_paise: 400000, payment_mode: 'cheque', cheque_number: 'CHQ1', is_80g_eligible: true, donor: { global_user_id: uid5, name: 'Edge NoPan', mobile: mob('2'), pan: 'PQRSX6789Z' } } });
  rec('B5-1', 'donation accepted w/ inline PAN backfill', d5.status < 300, `code=${d5.code ?? 'ok'}`);
  const rc5 = (await http('GET', `/donations/${d5.data?.id}/receipt`, { token })).data;
  rec('B5-2', 'backfilled PAN now on receipt (masked)', !!rc5?.donor?.pan_masked && /X/.test(rc5.donor.pan_masked), `pan=${rc5?.donor?.pan_masked}`);

  G('B5b — donor w/ PAN on file (UNVERIFIED, no OTP) → 2nd 80G donation without resending PAN still succeeds');
  // Regression for the reported bug: a picked donor whose PAN is on file but who
  // was never OTP-verified, and whose tenant donors row may pre-date the PAN,
  // must not be blocked with PAN_REQUIRED. resolveRef backfills the PAN from the
  // global user. uid1 is the B4 PAN donor; this donation resends neither pan nor
  // an OTP verification.
  const d5b = await http('POST', '/donations', { token, body: { category_id: cat80?.id, amount_paise: 111100, payment_mode: 'upi', is_80g_eligible: true, utr_number: `V${stamp}`, donor: { global_user_id: uid1, name: 'Edge PAN', mobile: mob('1') } } });
  rec('B5b-1', 'unverified donor w/ PAN → 80G accepted (no PAN_REQUIRED)', d5b.status < 300, `status=${d5b.status} code=${d5b.code ?? 'ok'}`);
  const rc5b = (await http('GET', `/donations/${d5b.data?.id}/receipt`, { token })).data;
  rec('B5b-2', 'receipt still carries full PAN for that donor', !!rc5b?.donor?.pan_full && !/X/.test(rc5b.donor.pan_full), `full=${rc5b?.donor?.pan_full}`);

  G('B6 — 80G with NO PAN anywhere → PAN_REQUIRED');
  const uid6 = (await http('POST', '/devotees/register', { token, body: { mobile: mob('6'), name: 'Edge Block' } })).data?.user_id;
  const d6 = await http('POST', '/donations', { token, body: { category_id: cat80?.id, amount_paise: 300000, payment_mode: 'upi', is_80g_eligible: true, donor: { global_user_id: uid6, name: 'Edge Block', mobile: mob('6') } } });
  rec('B6-1', '80G w/o PAN blocked', d6.status >= 400 && d6.code === 'PAN_REQUIRED', `code=${d6.code}`);

  G('B7 — anonymous / Dan-Peti donation forced non-80G (no PAN possible)');
  const dAnon = await http('POST', '/donations', { token, body: { category_id: cat80?.id, amount_paise: 200000, payment_mode: 'cash', is_80g_eligible: true, is_anonymous: true } });
  const rcAnon = dAnon.data?.id ? (await http('GET', `/donations/${dAnon.data.id}/receipt`, { token })).data : null;
  rec('B7-1', 'anonymous donation created', dAnon.status < 300, `code=${dAnon.code ?? 'ok'}`);
  rec('B7-2', 'anonymous forced non-80G', rcAnon ? rcAnon.is_80g_eligible === false : false, `80g=${rcAnon?.is_80g_eligible}`);
  rec('B7-3', 'anonymous receipt has no donor PAN', rcAnon ? !rcAnon.donor?.pan_masked : true, '');

  const dPeti = await http('POST', '/donations', { token, body: { category_id: cat80?.id, amount_paise: 150000, payment_mode: 'cash', is_80g_eligible: true, is_anonymous: true, anonymous_category: 'dan_peti' } });
  rec('B7-4', 'Dan-Peti donation created non-80G', dPeti.status < 300, `code=${dPeti.code ?? 'ok'}`);

  G('B8 — cash > ₹2,000 is not 80G eligible (UI auto-unchecks; server must not require PAN)');
  const d8 = await http('POST', '/donations', { token, body: { category_id: cat80?.id, amount_paise: 500000, payment_mode: 'cash', is_80g_eligible: false, donor: { name: 'Cash Big', mobile: mob('8') } } });
  rec('B8-1', 'cash>2000 non-80G accepted w/o PAN', d8.status < 300, `code=${d8.code ?? 'ok'}`);

  G('B9 — international mobile (non-India dial code) register (PhoneInput E.164)');
  const intl = `+13235550${stamp.slice(-3)}`; // US-format E.164
  const r9 = await http('POST', '/devotees/register', { token, body: { mobile: intl, name: 'Intl Donor', country: 'United States' } });
  rec('B9-1', 'international mobile accepted', r9.status < 300 && !!r9.data?.user_id, `status=${r9.status} code=${r9.code ?? 'ok'}`);

  G('B10 — invalid mobile rejected (too many digits, matches the test-bug I hit earlier)');
  const r10 = await http('POST', '/devotees/register', { token, body: { mobile: '+9198123456789012', name: 'Bad Mobile' } });
  rec('B10-1', 'malformed mobile rejected', r10.status >= 400, `code=${r10.code}`);

  G('B11 — duplicate mobile on register → same user (idempotent, no error)');
  const rDupA = await http('POST', '/devotees/register', { token, body: { mobile: mob('1'), name: 'Edge PAN' } });
  rec('B11-1', 'duplicate register resolves same user', rDupA.status < 300 && !!rDupA.data?.user_id, '');

  G('B12 — OTP verify path (register→verify) marks donor verified + linked');
  const vMob = mob('9');
  const rReg = await http('POST', '/devotees/register', { token, body: { mobile: vMob, name: 'Verify Me', pan: 'LMNOP1234Q' } });
  const vOtp = rReg.data?.dev_otp; const vUser = rReg.data?.user_id;
  const rVer = vOtp ? await http('POST', '/devotees/verify-otp', { token, body: { user_id: vUser, otp: vOtp } }) : { status: 0, data: null };
  rec('B12-1', 'verify-otp returns global_user_id + masked PAN', rVer.status < 300 && !!rVer.data?.global_user_id && /X/.test(rVer.data?.pan_masked ?? ''), `pan=${rVer.data?.pan_masked}`);

  G('B13 — wrong OTP rejected');
  const rBadOtp = await http('POST', '/devotees/verify-otp', { token, body: { user_id: vUser, otp: '000000' } });
  rec('B13-1', 'wrong OTP → error', rBadOtp.status >= 400, `code=${rBadOtp.code} status=${rBadOtp.status}`);

  G('B14 — devotee search: min length + finds the donor we created');
  const rShort = await http('GET', '/devotees/search?q=ab', { token });
  rec('B14-1', 'search <3 chars rejected', rShort.status >= 400, `code=${rShort.code}`);
  const rFind = await http('GET', `/devotees/search?q=${stamp.slice(0,6)}`, { token });
  rec('B14-2', 'search returns array (annotated rows)', Array.isArray(rFind.data), `n=${rFind.data?.length ?? 'n/a'}`);

  G('B15 — non-80G category donation never requires PAN even if is_80g_eligible omitted');
  if (catNon) {
    const dNon = await http('POST', '/donations', { token, body: { category_id: catNon.id, amount_paise: 250000, payment_mode: 'upi', donor: { name: 'NonCat', mobile: mob('4') } } });
    const rcNon = dNon.data?.id ? (await http('GET', `/donations/${dNon.data.id}/receipt`, { token })).data : null;
    rec('B15-1', 'non-80G category donation ok', dNon.status < 300, `code=${dNon.code ?? 'ok'}`);
    rec('B15-2', 'non-80G receipt hides PAN', rcNon ? !buildReceiptHtml({ ...rcNon, donor: { ...rcNon.donor, pan_masked: mask } }).includes(mask) : true, '');
  } else rec('B15-0', 'no non-80G category seeded (skipped)', true, 'skip');

  // ── summary
  const pass = results.filter(r => r.ok).length;
  console.log(`\n=== SUMMARY: ${pass}/${results.length} passed, ${results.length - pass} failed ===`);
  const fails = results.filter(r => !r.ok);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log(`  ✘ [${f.group}] ${f.id} ${f.title} — ${f.detail}`)); }
  console.log('JSON_RESULTS=' + JSON.stringify(results));
  process.exit(fails.length ? 1 : 0);
}
run().catch(e => { console.error('FATAL', e); process.exit(2); });
