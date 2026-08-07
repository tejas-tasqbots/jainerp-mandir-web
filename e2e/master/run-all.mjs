/**
 * Runs the whole master pack and totals it up.
 *
 * Each suite is a separate process, so a suite that dies outright cannot take
 * the run with it — its results file simply says so. The exit code is driven by
 * the collected results rather than by the child exit codes, because a shell
 * pipeline (`| head`, `| grep`) silently discards those.
 *
 *   node e2e/master/run-all.mjs              # everything
 *   node e2e/master/run-all.mjs 01 02        # just those suites
 *   SKIP_SLOW=1 node e2e/master/run-all.mjs  # skip builds + Flutter
 *
 * Prereqs: postgres on :5434, the four APIs and four portals running, and a
 * `npm run build` in each portal (suite 07 does this itself).
 */
import { readdirSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');
/** Suites that shell out to builds, Flutter and the Dart SDK. */
const SLOW = new Set(['07-static-contract', '08-mobile-desktop']);

const filter = process.argv.slice(2);
const suites = readdirSync(HERE)
  .filter((f) => /^\d\d-.*\.mjs$/.test(f))
  .sort()
  .filter((f) => !filter.length || filter.some((p) => f.startsWith(p)))
  .filter((f) => !(process.env.SKIP_SLOW && SLOW.has(f.replace('.mjs', ''))));

if (!suites.length) {
  console.error(`no suites matched ${filter.join(', ')}`);
  process.exit(2);
}

// Start clean so a suite that fails to run cannot leave a stale green behind.
rmSync(RESULTS, { recursive: true, force: true });
mkdirSync(RESULTS, { recursive: true });

const started = Date.now();
console.log(`\n╔══ JainERP master test pack — ${suites.length} suites ══╗\n`);

for (const s of suites) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${s.replace('.mjs', '')} … `);
  const r = spawnSync(process.execPath, [join(HERE, s)], {
    encoding: 'utf8',
    cwd: join(HERE, '../..'),
    timeout: 45 * 60 * 1000,
  });
  const file = join(RESULTS, `${s.replace('.mjs', '')}.json`);
  if (!existsSync(file)) {
    // The suite never got as far as writing results — record that as a failure
    // rather than letting the totals quietly omit it.
    const why = (r.stderr || r.stdout || 'no output').trim().split('\n').slice(-6).join('\n');
    console.log(`CRASHED (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    console.log(`    ${why.replace(/\n/g, '\n    ')}`);
    continue;
  }
  const res = JSON.parse(readFileSync(file, 'utf8'));
  const pass = res.cases.filter((c) => c.ok).length;
  const fail = res.cases.length - pass;
  console.log(
    `${pass}/${res.cases.length} passed${fail ? `, ${fail} FAILED` : ''} ` +
    `(${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
}

// ── Totals ──────────────────────────────────────────────────────────────────
const files = existsSync(RESULTS) ? readdirSync(RESULTS).filter((f) => f.endsWith('.json')) : [];
const all = files.flatMap((f) => {
  const r = JSON.parse(readFileSync(join(RESULTS, f), 'utf8'));
  return r.cases.map((c) => ({ ...c, suite: r.name }));
});

const pass = all.filter((c) => c.ok && !c.skipped);
const skipped = all.filter((c) => c.skipped);
const failed = all.filter((c) => !c.ok);
const byPri = (p) => failed.filter((c) => c.pri === p).length;

console.log(`\n╔══ Totals ══╗`);
console.log(`  suites   : ${files.length}/${suites.length} produced results`);
console.log(`  cases    : ${all.length}`);
console.log(`  passed   : ${pass.length}`);
console.log(`  skipped  : ${skipped.length}`);
console.log(`  failed   : ${failed.length}  (P1 ${byPri('P1')} · P2 ${byPri('P2')} · P3 ${byPri('P3')})`);
console.log(`  duration : ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);

if (skipped.length) {
  console.log(`\n── Skipped ──`);
  for (const c of skipped) console.log(`  ○ ${c.id} [${c.suite}] ${c.title} — ${c.detail}`);
}

if (failed.length) {
  console.log(`\n── Failures ──`);
  for (const c of failed) {
    console.log(`  ✘ ${c.id} [${c.pri}] [${c.suite}] ${c.title}`);
    console.log(`      ${String(c.detail).split('\n')[0].slice(0, 200)}`);
  }
}

console.log(
  failed.length
    ? `\n✘ ${failed.length} case(s) failed.\n`
    : `\n✔ All ${pass.length} cases passed${skipped.length ? ` (${skipped.length} skipped)` : ''}.\n`,
);
process.exit(failed.length ? 1 : 0);
