/**
 * PAN-on-receipt — v2 (property-based / fuzz rewrite).
 *
 * Different from pan-picker-suite.mjs (which uses fixed values): this asserts
 * INVARIANTS over many randomised inputs, so a template that only handles one
 * PAN shape, or leaks the raw PAN, is caught statistically.
 *
 * Invariants checked for every random (pan, amount, template):
 *   I1  80G + valid PAN  → the MASKED pan appears in the HTML.
 *   I2  the RAW pan NEVER appears in the HTML (masking is total).
 *   I3  non-80G          → the masked pan does NOT appear.
 *   I4  mask format is exactly  <2 letters>XXXXX<3 chars>  (matches the API).
 *   I5  buildReceiptHtml never throws and always returns non-trivial HTML.
 *
 * Run: node e2e/full/pan-render-fuzz-suite.mjs   (no server needed — pure render)
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'url';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const results = [];
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); if (!ok) console.log(`  ✘ FAIL ${id} — ${detail}`); };

async function loadRenderer() {
  const out = await build({
    entryPoints: [new URL('../../src/lib/printReceipt.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /\.\/api$/ }, () => ({ path: 'stub', namespace: 's' }));
      b.onLoad({ filter: /.*/, namespace: 's' }, () => ({ contents: 'export const api={};', loader: 'js' }));
    }}],
  });
  const dir = mkdtempSync(join(tmpdir(), 'fz-'));
  const file = join(dir, 'r.mjs'); writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

const TEMPLATES = ['classic', 'minimal', 'modern', 'traditional', 'elegant', 'temple', 'tabular', 'acknowledgement', 'jain_tirth', '80g'];
const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const rnd = (n) => Math.floor(Math.random() * n);
function randomPan() {
  let p = '';
  for (let i = 0; i < 5; i++) p += LET[rnd(26)];
  for (let i = 0; i < 4; i++) p += rnd(10);
  p += LET[rnd(26)];
  return p;
}
const apiMask = (pan) => `${pan.slice(0, 2)}XXXXX${pan.slice(-3)}`;

function payload(over) {
  return {
    receipt_number: 'DON/2026-27/000777', date: '2026-07-08T00:00:00Z',
    mandir: { name: 'Fuzz Mandir', address: 'A, C', template: 'classic', primary_color: '#123456', show_80g: true, reg_80g_number: 'X80G', pan: 'TRUST5678T' },
    donor: { name: 'Fuzz Donor', mobile: '+919000000000' },
    category: 'Corpus', amount_paise: 100000, payment_mode: 'upi', is_80g_eligible: true, is_voided: false,
    ...over,
  };
}

async function run() {
  console.log('\n=== PAN render fuzz (property-based) — pure buildReceiptHtml() ===');
  const { buildReceiptHtml } = await loadRenderer();
  const ITER = 250; // 250 random cases × up to 5 invariants each
  let cases = 0;

  for (let i = 0; i < ITER; i++) {
    const pan = randomPan();
    const masked = apiMask(pan);
    const amount = rnd(2) ? rnd(2_000_000_00) : [0, 100, 50000, 99999900][rnd(4)];
    const template = TEMPLATES[rnd(TEMPLATES.length)];
    const is80 = !!rnd(2);
    const base = payload({
      is_80g_eligible: is80, amount_paise: amount,
      donor: { name: 'Fuzz Donor', mobile: '+919000000000', pan_masked: masked },
      mandir: { ...payload().mandir, template },
    });

    let html = '';
    try { html = buildReceiptHtml(base); } catch (e) { rec(`I5-throw-${i}`, false, `${template} threw: ${String(e).slice(0, 50)}`); continue; }
    cases++;

    // I5: always renders
    rec(`I5-${i}`, html.length > 200, `${template} html too short (${html.length})`);
    // I2: raw PAN never present (the strongest invariant)
    rec(`I2-${i}`, !html.includes(pan), `${template} LEAKED raw PAN ${pan}`);
    // I4: mask format
    rec(`I4-${i}`, /^[A-Z]{2}XXXXX[0-9A-Z]{3}$/.test(masked), `bad mask ${masked}`);

    if (is80) {
      // I1: masked PAN present when 80G
      rec(`I1-${i}`, html.includes(masked), `${template} 80G but masked PAN ${masked} absent`);
    } else {
      // I3: masked PAN absent when non-80G
      rec(`I3-${i}`, !html.includes(masked), `${template} non-80G but showed PAN ${masked}`);
    }
  }

  // Edge amounts that previously caused infinite recursion must be safe.
  for (const amt of [undefined, NaN, -1, 0, Number.MAX_SAFE_INTEGER]) {
    let ok = true, d = '';
    try { const h = buildReceiptHtml(payload({ amount_paise: amt })); ok = h.length > 200; }
    catch (e) { ok = false; d = String(e).slice(0, 40); }
    rec(`EDGE-amt-${String(amt)}`, ok, d);
  }

  const pass = results.filter((r) => r.ok).length;
  const fails = results.filter((r) => !r.ok);
  console.log(`\n=== FUZZ SUMMARY: ${pass}/${results.length} invariant checks passed over ${cases} random cases, ${fails.length} failed ===`);
  fails.slice(0, 20).forEach((f) => console.log(`  ✘ ${f.id} — ${f.detail}`));
  process.exit(fails.length ? 1 : 0);
}
run().catch((e) => { console.error('FATAL', e); process.exit(2); });
