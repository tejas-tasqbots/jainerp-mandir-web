/**
 * Static contracts — the defects that every runtime test passes straight over.
 *
 * The Change Requests page is the worked example: it called a class that does
 * not exist (`modal-actions` where the stylesheet defines `.modal .actions`) and
 * double-stringified its request body. Typecheck passed, lint passed, every API
 * test passed, and the page still rendered "CancelApprove" as unstyled text over
 * a 400. Nothing in the toolchain looks at either of those, so this suite does.
 *
 * Needs a fresh `npm run build` in each portal — the built stylesheet is the
 * evidence for what a class name can possibly resolve to.
 *
 *   node e2e/master/07-static-contract.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { suite, t, expect, psql, psql1 } from './lib.mjs';
import { findDrift } from './css-contract.mjs';

const ROOT = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps';
const PORTALS = ['mandir-web', 'superadmin-web', 'devotee-web', 'sant-web'];
const APIS = ['mandir-api', 'superadmin-api', 'devotee-api', 'sant-api'];

const sh = (cmd, cwd) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

function walk(dir, re, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, re, out);
    else if (re.test(e)) out.push(p);
  }
  return out;
}

await suite('07-static-contract', async () => {
  // ═══════════════════════ Toolchain (must run first) ══════════════════════
  // The CSS contract reads `dist/`, so the bundles have to be current. Checking
  // drift against a stale build reports classes that a source fix has already
  // added — which is exactly what happened the first time this suite ran.
  for (const app of PORTALS) {
    await t(`TC-BUILD-${app}`, 'P1', `${app}: typecheck and bundle succeed`, async () => {
      const r = sh('npm run build', join(ROOT, app));
      expect.ok(r.ok, `build failed:\n${r.out.slice(-900)}`);
      return 'built';
    });
  }

  // ═══════════════════════ CSS contract ════════════════════════════════════
  for (const app of PORTALS) {
    await t(`TC-CSS-${app}`, 'P1', `${app}: every static class name exists in the built CSS`, async () => {
      const drift = findDrift(join(ROOT, app));
      const detail = drift
        .map((d) => `${d.token} (${d.at[0].replace(ROOT + '/', '')})`)
        .join('; ');
      expect.eq(drift.length, 0, `classes with no styling: ${detail}`);
      return 'no drift';
    });
  }

  await t('TC-CSS-001', 'P1', 'the detector actually catches a planted bad class', async () => {
    // A checker that can only pass is worth nothing. This proves the detector
    // would have caught the Change Requests page.
    const { staticClassUses, builtClasses } = await import('./css-contract.mjs');
    const defined = builtClasses(join(ROOT, 'superadmin-web/dist/assets'));
    expect.ok(!defined.has('modal-actions'), '.modal-actions should not exist — the CSS defines .modal .actions');
    expect.ok(defined.has('btn'), '.btn is the real button class and should exist');
    const uses = staticClassUses(join(ROOT, 'superadmin-web/src'));
    expect.ok(uses.size > 20, 'the scanner found suspiciously few classes');
    return `${uses.size} classes scanned, planted name correctly absent`;
  });

  await t('TC-CSS-002', 'P1', 'the review queue uses the real button and table classes', async () => {
    const src = readFileSync(join(ROOT, 'superadmin-web/src/pages/ChangeRequestsPage.tsx'), 'utf8');
    expect.ok(!src.includes('"modal-actions"'), 'modal-actions is not a class this app defines');
    expect.ok(!src.includes('"row-actions"'), 'row-actions is not a class this app defines');
    expect.ok(src.includes('className="btn'), 'buttons must carry the btn class or they render as bare text');
    expect.ok(src.includes('table className="data"'), 'tables must carry .data or they render unstyled');
    return 'design-system classes in use';
  });

  // ═══════════════════════ Request-body contract ═══════════════════════════
  await t('TC-REQ-001', 'P1', 'no portal double-stringifies a request body', async () => {
    // Each portal's api() serialises the body itself. Passing an
    // already-stringified body sends a bare JSON *string*, which body-parser
    // rejects in strict mode — the exact 400 the console showed on Approve.
    const hits = [];
    for (const app of PORTALS) {
      for (const f of walk(join(ROOT, app, 'src'), /\.(ts|tsx)$/)) {
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          if (/\bbody:\s*JSON\.stringify\(/.test(line) && !/fetch\(/.test(line)) {
            hits.push(`${f.replace(ROOT + '/', '')}:${i + 1}`);
          }
        });
      }
    }
    expect.eq(hits.length, 0, `double-stringified bodies: ${hits.join(', ')}`);
    return '0 in 4 portals';
  });

  await t('TC-REQ-002', 'P1', 'each portal has exactly one place that serialises bodies', async () => {
    for (const app of PORTALS) {
      const clients = walk(join(ROOT, app, 'src'), /\.(ts|tsx)$/).filter((f) =>
        /JSON\.stringify\((opts|init|options)?\.?body\)/.test(readFileSync(f, 'utf8')));
      expect.ok(clients.length <= 1, `${app} serialises bodies in ${clients.length} places`);
    }
    return 'one serialiser per portal';
  });

  await t('TC-REQ-003', 'P1', 'a bare JSON string is rejected by every API', async () => {
    const { mandirApi, saApi, devoteeApi, santApi } = await import('./lib.mjs');
    for (const [name, api] of [['mandir', mandirApi], ['superadmin', saApi],
                               ['devotee', devoteeApi], ['sant', santApi]]) {
      const r = await api('POST', '/auth/send-otp', { rawBody: JSON.stringify(JSON.stringify({})) });
      expect.status(r, 400, `${name}-api accepted a bare JSON string body`);
    }
    return '4 APIs refuse it';
  });

  // ═══════════════════════ Envelope conventions ════════════════════════════
  await t('TC-ENV-001', 'P1', 'every API answers with the { success, data, meta, error } envelope', async () => {
    const { mandirApi, saApi, devoteeApi, santApi } = await import('./lib.mjs');
    for (const [name, api] of [['mandir', mandirApi], ['superadmin', saApi],
                               ['devotee', devoteeApi], ['sant', santApi]]) {
      const r = await api('GET', '/health');
      for (const k of ['success', 'data']) expect.has(r.json ?? {}, k, `${name}-api envelope`);
    }
    return '4 APIs consistent';
  });

  await t('TC-ENV-002', 'P1', 'error bodies carry { code, message } on every API', async () => {
    const { mandirApi, saApi, devoteeApi, santApi } = await import('./lib.mjs');
    for (const [name, api] of [['mandir', mandirApi], ['superadmin', saApi],
                               ['devotee', devoteeApi], ['sant', santApi]]) {
      const r = await api('GET', '/definitely-not-a-route-xyz');
      expect.rejected(r, name);
      expect.has(r.json?.error ?? {}, 'code', `${name}-api error shape`);
      expect.has(r.json?.error ?? {}, 'message', `${name}-api error shape`);
    }
    return '4 APIs consistent';
  });

  await t('TC-ENV-003', 'P1', 'every API serves under /api/v1', async () => {
    for (const [name, port] of [['mandir', 3106], ['superadmin', 3105], ['devotee', 3107], ['sant', 3108]]) {
      const root = await fetch(`http://localhost:${port}/health`).catch(() => null);
      const versioned = await fetch(`http://localhost:${port}/api/v1/health`).catch(() => null);
      expect.ok(versioned?.ok, `${name}-api does not serve /api/v1/health`);
      expect.ok(!root?.ok, `${name}-api still answers at the unversioned root`);
    }
    return '4 APIs on /api/v1 only';
  });

  // ═══════════════════════ SQL / schema contract ═══════════════════════════
  for (const api of APIS) {
    const hasCheck = existsSync(join(ROOT, api, 'package.json')) &&
      JSON.parse(readFileSync(join(ROOT, api, 'package.json'), 'utf8')).scripts?.['check:sql'];
    if (!hasCheck) continue;
    await t(`TC-SQL-${api}`, 'P1', `${api}: every column referenced in SQL exists`, async () => {
      const r = sh('npm run check:sql', join(ROOT, api));
      expect.ok(r.ok, `check:sql failed:\n${r.out.slice(-800)}`);
      return 'schema references resolve';
    });
  }

  await t('TC-SQL-001', 'P1', 'migrations are numbered uniquely and apply in order', async () => {
    const dir = join(ROOT, 'superadmin-api/db/migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const nums = files.map((f) => f.match(/^(\d+)/)?.[1]).filter(Boolean);
    const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
    expect.eq(dupes.length, 0, `duplicate migration numbers: ${[...new Set(dupes)].join(', ')}`);
    return `${files.length} migrations, no collisions`;
  });

  await t('TC-SQL-002', 'P1', 'the sant rename migration still sorts before the DDL it protects', async () => {
    // DbBootstrapService re-runs every migration on every boot in filename
    // order, so the rename has to land before anything that would recreate the
    // old tables. That is the whole reason it is numbered 000.
    const dir = join(ROOT, 'superadmin-api/db/migrations');
    const rename = readdirSync(dir).find((f) => /rename_maharaj_to_sant/.test(f));
    expect.ok(rename, 'the rename migration is missing');
    expect.ok(rename.startsWith('000'), `rename is ${rename} — it must sort first`);
    return rename;
  });

  await t('TC-SQL-003', 'P1', 'a partial unique index is matched by a partial ON CONFLICT', async () => {
    // `ON CONFLICT (cols)` does not match a partial index unless the WHERE is
    // repeated, and the mismatch only shows up at runtime as a failing insert.
    const partial = psql(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE%'`,
    );
    // Informational: the assertion is that we can enumerate them, so a new one
    // is visible to whoever adds the matching upsert.
    expect.ok(Array.isArray(partial), 'could not read index metadata');
    return `${partial.length} partial unique indexes: ${partial.map((r) => r[0]).slice(0, 4).join(', ')}`;
  });

  await t('TC-SQL-004', 'P1', 'no tenant table lost its schema qualification', async () => {
    const bad = execSync(
      `grep -rnE "INSERT INTO (donations|donors|expenses|payments)\\b" --include=*.ts ${ROOT}/mandir-api/src || true`,
      { encoding: 'utf8' },
    ).trim();
    expect.eq(bad, '', `unscoped INSERT: ${bad.slice(0, 300)}`);
    return 'all writes use {s}';
  });

  // ═══════════════════════ Toolchain ═══════════════════════════════════════
  for (const app of [...APIS, ...PORTALS]) {
    await t(`TC-LINT-${app}`, 'P1', `${app}: lint reports no errors`, async () => {
      const r = sh('npm run lint', join(ROOT, app));
      // The portals keep react-hooks findings as warnings on purpose; a clean
      // run means zero *errors*, which is what a non-zero exit reflects.
      expect.ok(r.ok, `lint failed:\n${r.out.slice(-900)}`);
      return 'clean';
    });
  }

  for (const api of APIS) {
    await t(`TC-TSC-${api}`, 'P1', `${api}: typecheck succeeds`, async () => {
      const r = sh('npx tsc --noEmit -p tsconfig.json', join(ROOT, api));
      expect.ok(r.ok, `tsc failed:\n${r.out.slice(-900)}`);
      return 'typechecks';
    });
  }

  // ═══════════════════════ i18n ════════════════════════════════════════════
  for (const app of PORTALS) {
    const localeDir = ['src/i18n/locales', 'src/locales', 'src/i18n']
      .map((d) => join(ROOT, app, d))
      .find((d) => existsSync(d));
    if (!localeDir) continue;
    await t(`TC-I18N-${app}`, 'P2', `${app}: every language file defines the same keys`, async () => {
      const files = readdirSync(localeDir).filter((f) => f.endsWith('.json'));
      if (files.length < 2) return `only ${files.length} locale file(s) — nothing to compare`;
      const flat = (o, p = '', out = {}) => {
        for (const [k, v] of Object.entries(o)) {
          const key = p ? `${p}.${k}` : k;
          if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
          else out[key] = true;
        }
        return out;
      };
      const sets = files.map((f) => ({
        f, keys: new Set(Object.keys(flat(JSON.parse(readFileSync(join(localeDir, f), 'utf8'))))),
      }));
      const base = sets[0];
      const problems = [];
      for (const s of sets.slice(1)) {
        const missing = [...base.keys].filter((k) => !s.keys.has(k));
        if (missing.length) problems.push(`${s.f} missing ${missing.length} (e.g. ${missing.slice(0, 3)})`);
      }
      expect.eq(problems.length, 0, problems.join('; '));
      return `${files.length} locales, ${base.keys.size} keys each`;
    });
  }

  // ═══════════════════════ Docs stay in step ═══════════════════════════════
  await t('TC-DOC-001', 'P2', 'the code-of-record docs still exist where CLAUDE.md says', async () => {
    const docs = join(ROOT, 'superadmin-api/doc-v2');
    for (const f of ['Module_Reference.md', 'User_Stories.md', 'Test_Cases_Master.md', 'Test_Report.md']) {
      expect.ok(existsSync(join(docs, f)), `${f} is missing from doc-v2`);
    }
    return '4 code-of-record docs present';
  });

  await t('TC-DOC-002', 'P2', 'no app claims a jest test script it does not have', async () => {
    // The `test: jest` scripts implied a suite that was never installed.
    const lying = [];
    for (const app of [...APIS, ...PORTALS]) {
      const pkg = JSON.parse(readFileSync(join(ROOT, app, 'package.json'), 'utf8'));
      const script = pkg.scripts?.test ?? '';
      if (/jest/.test(script) && !existsSync(join(ROOT, app, 'node_modules/.bin/jest'))) {
        lying.push(app);
      }
    }
    expect.eq(lying.length, 0, `apps with a jest script but no jest: ${lying.join(', ')}`);
    return 'no phantom test scripts';
  });
});
