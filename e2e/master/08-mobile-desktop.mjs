/**
 * The three Flutter apps and the Electron desktop edition.
 *
 * There is no device automation here — these are the checks that actually catch
 * this codebase's mobile defects:
 *
 *  - `dart analyze`, because grep-verification once shipped a call to
 *    `AppRadius.sm` (which exists in none of the three `packages/ui` copies)
 *    into code that therefore could not compile.
 *  - vendored-package drift: `packages/core` and `packages/ui` are duplicated
 *    across all three mobile repos with no shared package, and they have
 *    already diverged.
 *  - API parity, so a field the mobile client reads is one the API sends.
 *
 * Flutter is not on PATH — it lives at ~/development/flutter.
 *
 *   node e2e/master/08-mobile-desktop.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { suite, t, skip, expect } from './lib.mjs';

const ROOT = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps';
const MOBILES = ['mandir-mobile', 'devotee-mobile', 'sant-mobile'];
const FLUTTER = `${process.env.HOME}/development/flutter/bin`;

const flutterEnv = { ...process.env, PATH: `${FLUTTER}:${process.env.PATH}` };
const sh = (cmd, cwd, env = process.env) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

function walk(dir, re, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (['node_modules', 'build', '.dart_tool', '.git'].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, re, out);
    else if (re.test(e)) out.push(p);
  }
  return out;
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Accepted, already-known divergences between the vendored mobile packages. */
const BASELINE = JSON.parse(
  readFileSync(new URL('./vendored-drift-baseline.json', import.meta.url), 'utf8'));

/**
 * Blank out Dart comment bodies, preserving offsets.
 *
 * Several files *document* the maharaj→sant rename by naming the old
 * identifier, and scanning raw text reports the explanation as the defect.
 */
const stripDart = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
     .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

await suite('08-mobile-desktop', async () => {
  const haveFlutter = existsSync(join(FLUTTER, 'flutter'));

  await t('TC-MOB-001', 'P1', 'the Flutter SDK is where the docs say it is', async () => {
    expect.ok(haveFlutter, `no flutter at ${FLUTTER} — the SDK is not on PATH by design`);
    const v = sh('flutter --version', ROOT, flutterEnv);
    expect.ok(v.ok, v.out.slice(-300));
    return v.out.split('\n')[0].slice(0, 60);
  });

  // ═══════════════════════ Repo layout ═════════════════════════════════════
  for (const app of MOBILES) {
    await t(`TC-MOB-LAYOUT-${app}`, 'P1', `${app}: is a pub workspace with app + core + ui`, async () => {
      expect.ok(existsSync(join(ROOT, app, 'pubspec.yaml')), 'no root pubspec — resolution is a pub workspace');
      for (const d of ['app', 'packages/core', 'packages/ui']) {
        expect.ok(existsSync(join(ROOT, app, d)), `missing ${d}`);
      }
      return 'app + packages/core + packages/ui';
    });
  }

  await t('TC-MOB-002', 'P1', 'melos.yaml is fan-out only, not the resolver', async () => {
    for (const app of MOBILES) {
      const f = join(ROOT, app, 'melos.yaml');
      if (!existsSync(f)) continue;
      const root = readFileSync(join(ROOT, app, 'pubspec.yaml'), 'utf8');
      expect.ok(/workspace:/.test(root), `${app} root pubspec declares no workspace`);
    }
    return 'native pub workspace resolution';
  });

  // ═══════════════════════ Vendored package drift ══════════════════════════
  // Three copies of the same source with no shared package between them.
  //
  // `packages/ui` genuinely is one source in three places and must stay
  // byte-identical. `packages/core` is a shared base each app specialises —
  // its eight divergences were diffed and are structural (different API port
  // per app, tenant module entitlements on mandir only, devotee's own auth
  // repository), so they are declared in vendored-drift-baseline.json rather
  // than treated as debt. What this case actually guards is a change made in
  // one copy and never ported: any *undeclared* difference fails.
  for (const pkg of ['core', 'ui']) {
    await t(`TC-MOB-DRIFT-${pkg}`, 'P1', `packages/${pkg} has no undeclared divergence between the three apps`, async () => {
      const byApp = {};
      for (const app of MOBILES) {
        const dir = join(ROOT, app, 'packages', pkg, 'lib');
        if (!existsSync(dir)) continue;
        const files = {};
        for (const f of walk(dir, /\.dart$/)) {
          files[relative(dir, f)] = sha(readFileSync(f, 'utf8'));
        }
        byApp[app] = files;
      }
      const apps = Object.keys(byApp);
      if (apps.length < 2) return `only ${apps.length} copy present`;
      // Only the *shared surface* is compared: a file that exists in one app
      // alone (devotee_auth_repository.dart, say) is a legitimate app-specific
      // addition, not drift. A file every copy carries but whose contents
      // differ is a change that was made once and never ported — the failure
      // mode CLAUDE.md warns about.
      const [base, ...rest] = apps;
      const shared = Object.keys(byApp[base]).filter((n) => apps.every((a) => byApp[a][n]));
      const appOnly = [];
      for (const a of apps) {
        for (const n of Object.keys(byApp[a])) {
          if (!apps.every((x) => byApp[x][n])) appOnly.push(`${n} (only ${a})`);
        }
      }
      const diffs = [];
      for (const name of shared) {
        const variants = new Set(apps.map((a) => byApp[a][name]));
        if (variants.size > 1) diffs.push(name);
      }
      // Declared divergences are baselined so this case guards against a real
      // un-ported change rather than sitting red on deliberate per-app
      // structure. See vendored-drift-baseline.json for the diff of each.
      const baseline = new Set(BASELINE[pkg] ?? []);
      const fresh = diffs.filter((d) => !baseline.has(d));
      const healed = [...baseline].filter((b) => !diffs.includes(b));
      expect.eq(fresh.length, 0,
        `${fresh.length} UNDECLARED divergence(s) — diff each one: if it is a fix ` +
        `made in one app and not the others, port it; only declare it in the ` +
        `baseline if the difference is structural:\n  ` + fresh.slice(0, 12).join('\n  '));
      const note = healed.length ? `; ${healed.length} baselined file(s) now match — drop them from the baseline` : '';
      return `${shared.length} shared, ${diffs.length} declared, 0 undeclared${note}`;
    });
  }

  // ═══════════════════════ dart analyze ════════════════════════════════════
  for (const app of MOBILES) {
    if (!haveFlutter) {
      skip(`TC-MOB-ANALYZE-${app}`, 'P1', `${app}: dart analyze`, 'Flutter SDK not available');
      continue;
    }
    await t(`TC-MOB-ANALYZE-${app}`, 'P1', `${app}: dart analyze is clean`, async () => {
      // `flutter pub get` runs at the *root*, not in app/ — this is a pub
      // workspace, and running it in app/ resolves the wrong thing.
      const get = sh('flutter pub get', join(ROOT, app), flutterEnv);
      expect.ok(get.ok, `pub get failed:\n${get.out.slice(-600)}`);
      const r = sh('dart analyze .', join(ROOT, app), flutterEnv);
      expect.ok(r.ok, `analyze found issues:\n${r.out.slice(-1200)}`);
      return 'no issues';
    });
  }

  // ═══════════════════════ Flutter unit tests ══════════════════════════════
  for (const app of MOBILES) {
    if (!haveFlutter) continue;
    for (const pkg of ['app', 'packages/core', 'packages/ui']) {
      const dir = join(ROOT, app, pkg);
      if (!existsSync(join(dir, 'test'))) continue;
      await t(`TC-MOB-TEST-${app}-${pkg.replace('/', '-')}`, 'P1',
        `${app}/${pkg}: flutter test passes`, async () => {
          // Tests run per package; the repo root has no test/ directory.
          const r = sh('flutter test', dir, flutterEnv);
          expect.ok(r.ok, `tests failed:\n${r.out.slice(-1200)}`);
          const m = r.out.match(/(\d+) test.? passed/i);
          return m ? `${m[1]} tests passed` : 'passed';
        });
    }
  }

  // ═══════════════════════ Mobile ↔ API parity ═════════════════════════════
  await t('TC-MOB-003', 'P1', 'the mobile API base URL is injectable, never hard-coded', async () => {
    const offenders = [];
    for (const app of MOBILES) {
      for (const f of walk(join(ROOT, app), /\.dart$/)) {
        // Tests point at a mock server on purpose; only shipped code matters.
        if (/(^|\/)test\//.test(f) || /_test\.dart$/.test(f)) continue;
        const src = stripDart(readFileSync(f, 'utf8'));
        if (/https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|\d+\.\d+\.\d+\.\d+)/.test(src)
            && !/String\.fromEnvironment/.test(src)) {
          offenders.push(relative(ROOT, f));
        }
      }
    }
    expect.eq(offenders.length, 0, `hard-coded endpoints: ${offenders.slice(0, 6).join(', ')}`);
    return 'API_BASE_URL comes from --dart-define';
  });

  await t('TC-MOB-004', 'P1', 'every mobile app defaults to the versioned API base', async () => {
    // Relative paths in the client are correct; what has to carry /api/v1 is
    // the base URL each app defaults to when no --dart-define is passed.
    const bad = [];
    for (const app of MOBILES) {
      const envFiles = walk(join(ROOT, app), /^env\.dart$|^app_config\.dart$|^config\.dart$/);
      const src = envFiles.map((f) => stripDart(readFileSync(f, 'utf8'))).join('\n');
      if (!src) { bad.push(`${app}: no env.dart to inspect`); continue; }
      if (!/api\/v1/.test(src)) bad.push(`${app}: default base URL is not versioned`);
      if (!/String\.fromEnvironment/.test(src)) bad.push(`${app}: base URL is not overridable`);
    }
    expect.eq(bad.length, 0, bad.join('; '));
    return 'all three default to /api/v1 and accept --dart-define';
  });

  await t('TC-MOB-004b', 'P1', 'each mobile app targets its OWN API port', async () => {
    // The concrete bug the vendored env.dart causes: the sant app once shipped
    // with :3106 (mandir's port) because the file was copied between repos,
    // which 404s every call silently. Pinned so a future copy-paste fails here.
    const want = { 'mandir-mobile': '3106', 'devotee-mobile': '3107', 'sant-mobile': '3108' };
    for (const [app, port] of Object.entries(want)) {
      const src = readFileSync(join(ROOT, app, 'packages/core/lib/src/env.dart'), 'utf8');
      const got = src.match(/http:\/\/10\.0\.2\.2:(\d+)\/api\/v1/)?.[1];
      expect.eq(got, port, `${app} default API port`);
    }
    return 'mandir:3106 devotee:3107 sant:3108';
  });

  await t('TC-MOB-004c', 'P1', 'each app ships the env file a distributable build needs', async () => {
    // Every env.dart tells the builder to pass --dart-define-from-file=env/dev.json
    // and none of those files existed, so `flutter build apk --release` silently
    // baked in the emulator loopback (10.0.2.2). The APK installs, launches, and
    // then fails every request — which reads as "the OTP never arrives", not as
    // a build error. That shipped on 2026-08-13.
    const want = { 'mandir-mobile': 'mandir', 'devotee-mobile': 'devotee', 'sant-mobile': 'sant' };
    const bad = [];
    for (const [app, host] of Object.entries(want)) {
      const file = join(ROOT, app, 'app/env/dev.json');
      if (!existsSync(file)) { bad.push(`${app}: app/env/dev.json is missing`); continue; }
      const url = JSON.parse(readFileSync(file, 'utf8')).API_BASE_URL ?? '';
      // https, because a release build refuses cleartext; the app's own host,
      // because pointing one app at another's API 404s every call.
      if (!url.startsWith('https://')) bad.push(`${app}: ${url} is not https`);
      if (!url.includes(`dev-api-${host}.jainerp.org`)) bad.push(`${app}: ${url} is not its own API`);
      if (!url.endsWith('/api/v1')) bad.push(`${app}: ${url} is not versioned`);
    }
    expect.eq(bad.length, 0, bad.join('; '));
    return 'all three ship env/dev.json pointing at their own https API';
  });

  await t('TC-MOB-004d', 'P1', 'a release build with no API URL refuses to run', async () => {
    // Belt to TC-MOB-004c's braces: even if someone builds without the env file,
    // the app must say so on its first frame instead of failing at sign-in.
    const bad = [];
    for (const app of MOBILES) {
      const main = stripDart(readFileSync(join(ROOT, app, 'app/lib/main.dart'), 'utf8'));
      if (!/kReleaseMode\s*&&\s*apiUrlUnreachableOnDevice/.test(main)) {
        bad.push(`${app}: main() has no unreachable-API guard`);
      }
      if (!/MisconfiguredBuildApp/.test(main)) bad.push(`${app}: guard shows no explanation screen`);
    }
    expect.eq(bad.length, 0, bad.join('; '));
    return 'all three fail loudly at launch';
  });

  await t('TC-MOB-006', 'P1', 'each app has ONE name across every surface', async () => {
    // The apps carried three or four names each (home screen "Sadhu-Sadhvi Seva",
    // iOS "Mandir Admin", task switcher "JainERP Sadhu-Sadhvi", session list
    // "Mandir Admin mobile"), so a user could not tell which app they were in.
    const want = {
      'mandir-mobile': 'JainERP Mandir',
      'devotee-mobile': 'JainERP Devotee',
      'sant-mobile': 'JainERP Sant',
    };
    const bad = [];
    for (const [app, name] of Object.entries(want)) {
      const read = (p) => readFileSync(join(ROOT, app, p), 'utf8');
      const label = read('app/android/app/src/main/AndroidManifest.xml').match(/android:label="([^"]*)"/)?.[1];
      if (label !== name) bad.push(`${app}: home-screen label is "${label}"`);
      const ios = read('app/ios/Runner/Info.plist')
        .match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]*)<\/string>/)?.[1];
      if (ios !== name) bad.push(`${app}: iOS display name is "${ios}"`);
      const title = stripDart(read('app/lib/main.dart')).match(/title: '([^']*)'/)?.[1];
      if (title !== name) bad.push(`${app}: task-switcher title is "${title}"`);
      const device = stripDart(read('app/lib/features/auth/login_screen.dart'))
        .match(/deviceName: '([^']*)'/)?.[1];
      if (device !== `${name} (Android)`) bad.push(`${app}: session-list name is "${device}"`);
    }
    expect.eq(bad.length, 0, bad.join('; '));
    return 'JainERP Mandir / Devotee / Sant, on all four surfaces each';
  });

  await t('TC-MOB-005', 'P1', 'the sant mobile client uses sant_* naming, not maharaj_*', async () => {
    // The vendored core copies had already diverged on exactly this.
    const stale = [];
    for (const app of MOBILES) {
      for (const f of walk(join(ROOT, app), /\.dart$/)) {
        const src = stripDart(readFileSync(f, 'utf8'));
        const m = src.match(/\bmaharaj_(ids|id|profiles?|reps?)\b/g);
        if (!m) continue;
        // Reading BOTH keys is the rolling-deploy-safe form and is allowed;
        // reading only the pre-rename key is the defect.
        if (/sant_(ids|id|profiles?|reps?)/.test(src)) continue;
        stale.push(`${relative(ROOT, f)} (${[...new Set(m)].join(',')})`);
      }
    }
    expect.eq(stale.length, 0, `pre-rename identifiers still in Dart: ${stale.slice(0, 6).join('; ')}`);
    return 'sant_* naming throughout';
  });

  // ═══════════════════════ Release build config ════════════════════════════
  for (const app of MOBILES) {
    await t(`TC-MOB-RELEASE-${app}`, 'P1', `${app}: can produce a release build`, async () => {
      // sant-mobile had no release build at all — a missing proguard-rules.pro
      // fails only at `flutter build apk --release`, never in debug.
      const gradle = join(ROOT, app, 'app/android/app/build.gradle');
      const gradleKts = `${gradle}.kts`;
      const f = existsSync(gradle) ? gradle : existsSync(gradleKts) ? gradleKts : null;
      expect.ok(f, 'no android/app/build.gradle');
      const src = readFileSync(f, 'utf8');
      if (/minifyEnabled\s+true|isMinifyEnabled\s*=\s*true/.test(src)) {
        const rules = join(ROOT, app, 'app/android/app/proguard-rules.pro');
        expect.ok(existsSync(rules),
          'minification is on but proguard-rules.pro is missing — the release build cannot succeed');
      }
      expect.ok(/signingConfig/.test(src), 'no signingConfig — a release build would be unsigned');
      return 'release config present';
    });
  }

  // ═══════════════════════ Electron desktop ════════════════════════════════
  const DESK = join(ROOT, 'mandir-desktop');

  await t('TC-DSK-001', 'P1', 'the desktop app is present and declares an Electron build', async () => {
    expect.ok(existsSync(join(DESK, 'package.json')), 'no mandir-desktop package.json');
    const pkg = JSON.parse(readFileSync(join(DESK, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect.ok(deps.electron || deps['electron-builder'], 'no electron toolchain declared');
    return `electron ${deps.electron ?? deps['electron-builder']}`;
  });

  await t('TC-DSK-002', 'P1', 'the desktop app typechecks', async () => {
    if (!existsSync(join(DESK, 'node_modules'))) return 'dependencies not installed — skipped';
    // The Electron main process is built from tsconfig.electron.json, not a
    // root tsconfig.json.
    const cfg = ['tsconfig.electron.json', 'tsconfig.json'].find((c) => existsSync(join(DESK, c)));
    expect.ok(cfg, 'no TypeScript config found for the Electron main process');
    const r = sh(`npx tsc --noEmit -p ${cfg}`, DESK);
    expect.ok(r.ok, `tsc failed:\n${r.out.slice(-900)}`);
    return `typechecks (${cfg})`;
  });

  await t('TC-DSK-003', 'P1', 'the offline sync import guards against the three data-loss bugs', async () => {
    // /sync/import is the desktop restore path. It previously had a jsonb bind
    // bug, a transaction-poisoning bug and a CASCADE wipe — all silent.
    const svc = walk(join(ROOT, 'mandir-api/src/sync'), /\.ts$/)
      .map((f) => stripDart(readFileSync(f, 'utf8'))).join('\n');
    expect.ok(svc.length > 0, 'no sync module found in mandir-api');
    expect.ok(/tx\(|transaction/i.test(svc), 'the import does not run in a transaction');
    // The fix for the CASCADE wipe was to clear every table in ONE statement
    // before any insert runs, rather than truncating table-by-table (which
    // cascaded away rows the restore had already written).
    const truncates = svc.match(/TRUNCATE TABLE/gi) ?? [];
    expect.ok(truncates.length <= 1,
      `${truncates.length} separate TRUNCATEs — a per-table cascade wipes restored child rows`);
    return `transactional, ${truncates.length} combined truncate`;
  });

  await t('TC-DSK-004', 'P1', 'licence activation validates against the platform', async () => {
    const { mandirApi } = await import('./lib.mjs');
    // A blank or unknown key must never activate an install.
    for (const key of ['', 'NOT-A-KEY', 'JERP-0000-0000-0000-0000']) {
      const r = await mandirApi('POST', '/license/validate', { body: { key } });
      expect.rejected(r, `key "${key}" was accepted`);
    }
    return '3 bad keys refused';
  });

  await t('TC-DSK-005', 'P1', 'the desktop edition ships no server-side PDF dependency', async () => {
    // Receipts render client-side precisely so the desktop build works offline.
    const pkg = JSON.parse(readFileSync(join(DESK, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const server = deps.filter((d) => /puppeteer|playwright|wkhtmltopdf|phantom/.test(d));
    expect.eq(server.length, 0, `server-side PDF dependency would break offline receipts: ${server}`);
    return 'client-side rendering only';
  });
});
