/**
 * Static CSS contract: every class a component asks for must actually exist.
 *
 * This exists because of the Change Requests page, which was written against a
 * different design system's names (`modal-actions`, `row-actions`, bare
 * `<button>`, `<table>`) and therefore rendered as unstyled text — "CancelApprove"
 * jammed together, a borderless table — while typecheck, lint and every API test
 * passed. Nothing in the toolchain notices a class that does not exist.
 *
 * The check: Tailwind's JIT only emits utilities it finds in the source, and the
 * `@layer components` blocks are emitted verbatim, so **the built stylesheet is
 * the set of every class that can possibly have styling**. A class named in the
 * source but absent from the built CSS is styling that silently does nothing.
 *
 * Only fully-static `className="..."` attributes are checked. Expression forms
 * (`className={cond ? 'a' : 'b'}`, template literals) also contain comparison
 * *values* — `method === 'online'` — which are not class names at all, and
 * flagging those buried the real defects in noise.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Class names that are real but can never appear in the built CSS. */
const IGNORE = new Set([
  'group', 'peer',        // Tailwind marker classes — emit no rules of their own
  'dark', 'light',        // theme roots
  'sr-only',              // may be tree-shaken when unused elsewhere
]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e)) out.push(p);
  }
  return out;
}

/** Every class selector present in a built stylesheet, un-escaped. */
export function builtClasses(distDir) {
  const css = readdirSync(distDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(distDir, f), 'utf8'))
    .join('\n');
  const set = new Set();
  for (const m of css.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) set.add(m[1].replace(/\\/g, ''));
  return set;
}

/**
 * Blank out comment bodies, keeping line count and offsets intact.
 *
 * Needed because several files *document* a past styling defect by quoting the
 * broken class ("every field used `className=\"field\"`, which is not defined"),
 * and scanning the raw text reports the explanation as a fresh defect.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Classes named in fully-static className attributes → token -> ["file:line"]. */
export function staticClassUses(srcDir) {
  const uses = new Map();
  for (const f of walk(srcDir)) {
    stripComments(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/className\s*=\s*"([^"]*)"/g)) {
        for (const tok of m[1].split(/\s+/)) {
          if (!tok || IGNORE.has(tok)) continue;
          // Arbitrary-value utilities (`text-[10px]`, `w-1/2`) are legitimate
          // but are emitted with escapes; the un-escaping above handles them.
          if (!/^[A-Za-z][A-Za-z0-9_:/.[\]%!-]*$/.test(tok)) continue;
          if (!uses.has(tok)) uses.set(tok, []);
          uses.get(tok).push(`${f}:${i + 1}`);
        }
      }
    });
  }
  return uses;
}

/** @returns {{token:string, at:string[]}[]} classes used but never defined. */
export function findDrift(appDir) {
  const dist = join(appDir, 'dist/assets');
  if (!existsSync(dist)) throw new Error(`no build output at ${dist} — run \`npm run build\` first`);
  const defined = builtClasses(dist);
  const used = staticClassUses(join(appDir, 'src'));
  return [...used.entries()]
    .filter(([tok]) => !defined.has(tok))
    .map(([token, at]) => ({ token, at }));
}
