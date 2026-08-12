/**
 * Locale files must contain plain text, never markup.
 *
 * i18next hands `t()` back whatever string is in the JSON, and React escapes it
 * on the way to the DOM. So an HTML entity in a translation does not become an
 * apostrophe — it reaches the screen as the literal characters `&apos;`. That
 * shipped: the donation form read "Donor doesn&apos;t want to share PAN" and
 * "this mandir&rsquo;s events".
 *
 * It is an easy mistake to repeat, because the same entity inside JSX *text* is
 * decoded by the JSX compiler and looks perfectly fine two lines away.
 *
 * Also flags placeholder mismatches between languages, which fail the same way:
 * silently, on one locale only, in front of whoever reads that language.
 *
 *   node e2e/full/locale-lint.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../src/locales/', import.meta.url).pathname;
const ENTITY = /&(?:apos|rsquo|lsquo|quot|ldquo|rdquo|mdash|ndash|hellip|nbsp|amp|lt|gt|#\d+);/;
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const problems = [];

function walk(node, path, visit) {
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, visit);
  } else if (typeof node === 'string') {
    visit(path, node);
  }
}

const locales = readdirSync(ROOT).filter(d => !d.startsWith('.'));
const byLocale = {};
for (const loc of locales) {
  const file = join(ROOT, loc, 'common.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const flat = new Map();
  walk(json, '', (k, v) => {
    flat.set(k, v);
    if (ENTITY.test(v)) {
      problems.push(`${loc}/common.json → ${k}: HTML entity in a translation — "${v.slice(0, 70)}"`);
    }
  });
  byLocale[loc] = flat;
}

// Every language must interpolate the same names, or one of them renders a
// literal {{count}} to its readers and nobody who speaks English ever sees it.
const base = byLocale.en;
if (base) {
  for (const [loc, flat] of Object.entries(byLocale)) {
    if (loc === 'en') continue;
    for (const [key, value] of flat) {
      const want = [...(base.get(key) ?? '').matchAll(PLACEHOLDER)].map(m => m[1]).sort().join(',');
      const got = [...value.matchAll(PLACEHOLDER)].map(m => m[1]).sort().join(',');
      if (base.has(key) && want !== got) {
        problems.push(`${loc}/common.json → ${key}: placeholders {${got}} do not match en {${want}}`);
      }
    }
  }
}

if (problems.length) {
  console.log(`\n  ${problems.length} problem(s):`);
  for (const p of problems) console.log(`   ✘ ${p}`);
  process.exit(1);
}
console.log(`  locales clean (${locales.join(', ')})`);
