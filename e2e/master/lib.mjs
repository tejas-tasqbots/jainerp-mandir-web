/**
 * Shared harness for the master test pack (`e2e/master/`).
 *
 * The older suites in `e2e/full/` each re-implement login, HTTP and result
 * recording, which is why they drifted apart and why a suite that threw halfway
 * reported "passing" for everything it never reached. This harness fixes both:
 *
 *  - `t()` runs every case inside its own try/catch, so one broken case cannot
 *    hide the rest of the suite. A thrown assertion is a FAIL, not a crash.
 *  - every suite writes `results/<name>.json`, so `run-all.mjs` can total the
 *    pack up and fail the run on any P1 regression rather than on exit codes
 *    that a `| head` in CI would swallow.
 *
 * Usage:
 *   import { suite, t, mandir, expect } from './lib.mjs';
 *   await suite('my-suite', async () => {
 *     await t('TC-X-01', 'P1', 'thing works', async () => { ... });
 *   });
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');

// ── Service endpoints ───────────────────────────────────────────────────────
// Vite binds IPv6 localhost only, so the web URLs must use `localhost`, never
// `127.0.0.1` — the latter connection-refuses and reads as "the app is down".
export const URLS = {
  mandirApi: process.env.E2E_MANDIR_API ?? 'http://localhost:3106/api/v1',
  saApi: process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1',
  devoteeApi: process.env.E2E_DEVOTEE_API ?? 'http://localhost:3107/api/v1',
  santApi: process.env.E2E_SANT_API ?? 'http://localhost:3108/api/v1',
  mandirWeb: process.env.E2E_MANDIR_WEB ?? 'http://localhost:5173',
  devoteeWeb: process.env.E2E_DEVOTEE_WEB ?? 'http://localhost:5174',
  santWeb: process.env.E2E_SANT_WEB ?? 'http://localhost:5175',
  saWeb: process.env.E2E_SA_WEB ?? 'http://localhost:5180',
};

export const FIXTURES = {
  tenant: process.env.E2E_TENANT ?? 'smoke-portal',
  admin: '9876512345',
  cashier: '9844444444',
  bhojanshalaCashier: '9833300011',
  saEmail: 'qa-tester@tasqbots.com',
  saPassword: 'QaTest@12345',
};

// ── Result recording ────────────────────────────────────────────────────────
let current = null;

/** Assertion helpers — all throw, so `t()` turns them into a FAIL. */
export const expect = {
  ok(cond, msg = 'expected truthy') {
    if (!cond) throw new Error(msg);
  },
  eq(actual, wanted, msg = '') {
    if (actual !== wanted) {
      throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)}`);
    }
  },
  /** HTTP status in [200,300). */
  http2xx(r, msg = 'expected 2xx') {
    if (!(r.status >= 200 && r.status < 300)) {
      throw new Error(`${msg}: got ${r.status} ${JSON.stringify(r.json)?.slice(0, 220)}`);
    }
  },
  status(r, want, msg = '') {
    if (r.status !== want) {
      throw new Error(`${msg || 'status'}: got ${r.status} (want ${want}) ${JSON.stringify(r.json)?.slice(0, 200)}`);
    }
  },
  /** Any of the listed statuses — for cases where 400 vs 422 is not the point. */
  statusIn(r, wants, msg = '') {
    if (!wants.includes(r.status)) {
      throw new Error(`${msg || 'status'}: got ${r.status} (want one of ${wants}) ${JSON.stringify(r.json)?.slice(0, 200)}`);
    }
  },
  /** Rejected = any 4xx. Used for negative/validation cases. */
  rejected(r, msg = 'expected rejection') {
    if (r.status < 400 || r.status >= 500) {
      throw new Error(`${msg}: got ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
    }
  },
  has(obj, key, msg = '') {
    if (obj == null || !(key in obj)) throw new Error(`${msg || 'missing key'}: ${key} in ${JSON.stringify(obj)?.slice(0, 200)}`);
  },
  /** Integer paise — the money invariant this codebase cares most about. */
  paise(v, msg = 'amount must be integer paise') {
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`${msg}: got ${JSON.stringify(v)} (${typeof v})`);
  },
};

/**
 * Run one case. Never throws: an exception inside `fn` is recorded as a FAIL
 * with its message, so the suite continues.
 */
export async function t(id, pri, title, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    current.cases.push({ id, pri, title, ok: true, detail: detail ?? '', ms: Date.now() - started });
    console.log(`  ✔ PASS ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
    return true;
  } catch (e) {
    const msg = e?.message ?? String(e);
    current.cases.push({ id, pri, title, ok: false, detail: msg, ms: Date.now() - started });
    console.log(`  ✘ FAIL ${id} [${pri}] ${title} — ${msg}`);
    return false;
  }
}

/** Record a case that could not run (missing fixture, service down). */
export function skip(id, pri, title, why) {
  current.cases.push({ id, pri, title, ok: true, skipped: true, detail: `SKIPPED: ${why}` });
  console.log(`  ○ SKIP ${id} [${pri}] ${title} — ${why}`);
}

/** Wrap a whole suite: prints a header, writes results/<name>.json, sets exit code. */
export async function suite(name, fn) {
  current = { name, cases: [], startedAt: new Date().toISOString() };
  console.log(`\n=== ${name} ===\n`);
  try {
    await fn();
  } catch (e) {
    // A throw outside any t() means the suite could not set itself up. Record
    // it as a P1 failure rather than exiting silently — a suite that dies
    // during setup previously reported zero failures.
    current.cases.push({
      id: `${name}-SETUP`, pri: 'P1', title: 'suite setup', ok: false,
      detail: `suite aborted: ${e?.message ?? e}`,
    });
    console.log(`  ✘ FAIL ${name}-SETUP [P1] suite aborted — ${e?.message ?? e}`);
  }
  const pass = current.cases.filter((c) => c.ok).length;
  const fail = current.cases.filter((c) => !c.ok);
  const p1 = fail.filter((c) => c.pri === 'P1');
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${name}.json`), JSON.stringify(current, null, 2));
  console.log(`\n--- ${name}: ${pass}/${current.cases.length} passed, ${fail.length} failed (${p1.length} P1) ---`);
  if (fail.length) process.exitCode = 1;
  return current;
}

// ── HTTP ────────────────────────────────────────────────────────────────────
/**
 * @returns {Promise<{status:number, json:any, data:any, meta:any, code:string|undefined, text:string}>}
 */
export async function req(base, method, path, { token, body, rawBody, headers } = {}) {
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers ?? {}),
      },
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`network error calling ${method} ${path}: ${e.message}`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json (html receipt, etc.) */ }
  return {
    status: res.status,
    json,
    text,
    data: json?.data,
    meta: json?.meta,
    code: json?.error?.code ?? json?.code,
    headers: res.headers,
  };
}

export const mandirApi = (m, p, o) => req(URLS.mandirApi, m, p, o);
export const saApi = (m, p, o) => req(URLS.saApi, m, p, o);
export const devoteeApi = (m, p, o) => req(URLS.devoteeApi, m, p, o);
export const santApi = (m, p, o) => req(URLS.santApi, m, p, o);

// ── Logins ──────────────────────────────────────────────────────────────────
/**
 * Mandir/devotee/sant all use mobile + mock OTP. Returns the dev OTP.
 *
 * Backs off on a throttle refusal instead of failing. The APIs allow 600
 * requests per 60s window, and the pack is fast enough to spend that — so the
 * suite that ran *after* the one exercising rate limits could not even log in,
 * and reported "suite aborted" as though the product were broken. Waiting is
 * what a real client does, and it keeps a full run from depending on the order
 * the suites happen to execute in.
 */
async function otpFor(api, mobile) {
  let last = null;
  for (const waitMs of [0, 5_000, 15_000, 30_000, 30_000]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    const send = await api('POST', '/auth/send-otp', { body: { mobile } });
    if (send.data?.dev_otp) return send.data.dev_otp;
    last = send;
    const throttled = send.status === 429 ||
      /RATE_LIMITED|Throttler|Too Many/i.test(JSON.stringify(send.json ?? ''));
    if (!throttled) break;
  }
  throw new Error(
    `no dev_otp for ${mobile} (OTP_MOCK off, or still throttled after backoff): ` +
    `${JSON.stringify(last?.json)?.slice(0, 200)}`,
  );
}

/** Mandir login is two-step: verify-otp yields a selection token, then a tenant. */
export async function mandirLogin(mobile = FIXTURES.admin, tenant = FIXTURES.tenant) {
  const otp = await otpFor(mandirApi, mobile);
  const ver = await mandirApi('POST', '/auth/verify-otp', { body: { mobile, otp } });
  const sel = ver.data?.selection_token;
  if (!sel) throw new Error(`verify-otp gave no selection_token: ${JSON.stringify(ver.json)?.slice(0, 200)}`);
  const r = await mandirApi('POST', '/auth/select-tenant', {
    body: { selection_token: sel, tenant_slug: tenant },
  });
  if (!r.data?.access_token) throw new Error(`select-tenant failed for ${tenant}: ${JSON.stringify(r.json)?.slice(0, 200)}`);
  return { token: r.data.access_token, refresh: r.data.refresh_token, selection: sel, tenants: ver.data?.tenants ?? [] };
}

export async function devoteeLogin(mobile) {
  const otp = await otpFor(devoteeApi, mobile);
  const r = await devoteeApi('POST', '/auth/verify-otp', { body: { mobile, otp } });
  if (!r.data?.access_token) throw new Error(`devotee login failed: ${JSON.stringify(r.json)?.slice(0, 200)}`);
  return { token: r.data.access_token, refresh: r.data.refresh_token, user: r.data.user };
}

export async function santLogin(mobile) {
  const otp = await otpFor(santApi, mobile);
  const r = await santApi('POST', '/auth/verify-otp', { body: { mobile, otp } });
  if (!r.data?.access_token) throw new Error(`sant login failed: ${JSON.stringify(r.json)?.slice(0, 200)}`);
  return { token: r.data.access_token, refresh: r.data.refresh_token, user: r.data.user };
}

/**
 * Super Admin is password + TOTP. Enrolment is one-shot and `mfa/setup`
 * rotates the secret, so the only reliable way to log in repeatedly is to
 * clear the QA account's TOTP first and walk enrolment fresh. Same approach as
 * `e2e/full/sa-auth.mjs`; kept here so the master pack has no cross-dependency.
 */
export async function superAdminLogin() {
  psql(`UPDATE public.super_admin_credentials c
           SET totp_secret_enc = NULL, totp_enrolled_at = NULL,
               recovery_codes_hash = '{}', recovery_codes_used = 0,
               failed_attempts = 0, locked_until = NULL
          FROM public.global_users u
         WHERE u.id = c.global_user_id AND u.email = '${FIXTURES.saEmail}'`);
  const { authenticator } = await import('../../../superadmin-web/node_modules/otplib/index.js');
  const login = await saApi('POST', '/admin/auth/login', {
    body: { identifier: FIXTURES.saEmail, password: FIXTURES.saPassword },
  });
  const mfaToken = login.data?.mfa_token;
  if (!mfaToken) throw new Error(`SA login failed (run seed-qa-tester.ts): ${JSON.stringify(login.json)?.slice(0, 200)}`);
  const setup = await saApi('POST', '/admin/auth/mfa/setup', { body: { mfa_token: mfaToken } });
  const secret = setup.data?.otpauth_uri?.match(/secret=([A-Z0-9]+)/)?.[1];
  if (!secret) throw new Error(`mfa/setup gave no secret: ${JSON.stringify(setup.json)?.slice(0, 200)}`);
  const verify = await saApi('POST', '/admin/auth/mfa/verify', {
    body: { mfa_token: mfaToken, type: 'totp', code: authenticator.generate(secret) },
  });
  if (!verify.data?.access_token) throw new Error(`SA mfa/verify failed: ${JSON.stringify(verify.json)?.slice(0, 200)}`);
  return verify.data.access_token;
}

// ── DB access (assertions the API cannot make) ──────────────────────────────
const PG = {
  container: process.env.E2E_PG_CONTAINER ?? 'jainerp-superadmin-pg',
  db: process.env.E2E_PG_DB ?? 'jainerp',
  user: process.env.E2E_PG_USER ?? 'jainerp',
  host: process.env.E2E_PG_HOST ?? 'localhost',
  port: process.env.E2E_PG_PORT ?? '5434',
  password: process.env.E2E_PG_PASSWORD ?? 'jainerp_dev',
};

const SEP = '\x01';

/** Low-level runner: exactly one database, no schema resolution. */
function runPsql(sql, db) {
  const parse = (out) =>
    out.trim() ? out.trim().split('\n').map((l) => l.split(SEP)) : [];
  try {
    return parse(execFileSync(
      'docker',
      ['exec', PG.container, 'psql', '-U', PG.user, '-d', db, '-tAF', SEP, '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ));
  } catch (e) {
    // Only fall back when docker itself is unusable — a SQL error must still
    // surface as a SQL error, not be retried into a confusing second failure.
    if (!/docker|Cannot connect|not found|No such container/i.test(String(e.stderr ?? e.message))) throw e;
  }
  return parse(execFileSync(
    'psql',
    ['-h', PG.host, '-p', String(PG.port), '-U', PG.user, '-d', db, '-tAF', SEP, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PGPASSWORD: PG.password } },
  ));
}

/**
 * schema_name → the database that schema actually lives in. Built once, lazily.
 *
 * A tenant schema is NOT necessarily in `jainerp`. A `pooled` tenant lives in a
 * shared pool database (`jainerp_pool_1`, …) and a `dedicated` one in its own,
 * and `public.tenants.db_name` records which. Resolved from the registry rather
 * than guessed, so a suite cannot be wrong about it.
 */
let SCHEMA_DB = null;
function schemaDbMap() {
  if (SCHEMA_DB) return SCHEMA_DB;
  SCHEMA_DB = new Map();
  try {
    for (const [schema, db] of runPsql(
      `SELECT schema_name, COALESCE(db_name, '${PG.db}') FROM public.tenants WHERE schema_name IS NOT NULL`,
      PG.db,
    )) {
      SCHEMA_DB.set(schema, db);
    }
  } catch {
    // A registry we cannot read is not fatal here: every caller that does not
    // name a tenant schema still works against the default database.
  }
  return SCHEMA_DB;
}

/**
 * Run SQL against the dev postgres. Returns rows as arrays of strings.
 * Fields are split on SOH (0x01) rather than `|` so that values containing a
 * pipe — notes, addresses, names — do not silently shift the columns.
 *
 * Tries the docker container first (the documented dev setup), then a local
 * psql over TCP. The fallback matters: the docker daemon needs root on some dev
 * boxes, and without it every suite in this pack aborted at SETUP with a
 * docker-socket error rather than running a single case.
 *
 * **The database is derived from the schema the SQL names**, unless the caller
 * passes one explicitly. Every suite builds its queries as `${S}.donations`
 * from `schemaOf(FIXTURES.tenant)` and then ran them against `jainerp` — but
 * `smoke-portal` is a POOLED tenant, so its schema is in `jainerp_pool_1` and
 * all 24 of those cases failed with "relation does not exist". Worse than the
 * noise: an assertion of the form "this row is NOT in the table" passes on a
 * missing table for the wrong reason, so the gap could hand out unearned passes
 * as easily as false failures.
 */
export function psql(sql, { db } = {}) {
  if (!db) {
    const text = String(sql);
    // A schema used as a QUALIFIER (`tenant_x.donations`) names its database.
    const named = [...text.matchAll(/\b(tenant_[0-9a-f]+)\s*\./gi)].map((m) => m[1]);
    // So does a schema named as a VALUE in a CATALOG query
    // (`information_schema.columns WHERE table_schema = 'tenant_…'`,
    // `pg_namespace.nspname = 'tenant_…'`). Catalogs are per-database, so
    // asking one about a schema it does not contain answers "no such column"
    // rather than erroring — which is how 18 CRUD cases decided every table
    // had neither `deleted_at` nor `is_active`, took the hard-delete branch,
    // and failed against an API that had soft-deleted correctly.
    //
    // Deliberately NOT applied to ordinary statements: `UPDATE public.tenants
    // SET schema_name = 'tenant_…'` (TC-SEC-005) names a schema as data, and
    // the row it writes lives in the registry database.
    if (/\binformation_schema\.|\bpg_namespace\b|\bpg_class\b|\bpg_constraint\b/i.test(text)) {
      named.push(...[...text.matchAll(/'(tenant_[0-9a-f]+)'/gi)].map((m) => m[1]));
    }
    for (const schema of named) {
      const found = schemaDbMap().get(schema);
      if (found) { db = found; break; }
    }
  }
  return runPsql(sql, db ?? PG.db);
}

/** Single scalar from a query. */
export function psql1(sql, opts) {
  const rows = psql(sql, opts);
  return rows[0]?.[0];
}

/**
 * Execute a .sql FILE. Same docker→TCP fallback as `psql()`.
 *
 * `-f`, not `-c`: `-c` wraps everything in one implicit transaction, and the
 * migrations this replays commit deliberately per schema (one transaction over
 * hundreds of schemas exhausted the lock table — see TC-EV-005). Running them
 * through `-c` would test something the deploy never does.
 */
export function psqlFile(file, { db = PG.db } = {}) {
  try {
    return execFileSync(
      'docker',
      ['exec', '-i', PG.container, 'psql', '-U', PG.user, '-d', db, '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      { encoding: 'utf8', input: readFileSync(file, 'utf8'), stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (e) {
    if (!/docker|Cannot connect|not found|No such container/i.test(String(e.stderr ?? e.message))) throw e;
  }
  return execFileSync(
    'psql',
    ['-h', PG.host, '-p', String(PG.port), '-U', PG.user, '-d', db, '-q', '-v', 'ON_ERROR_STOP=1', '-f', file],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PGPASSWORD: PG.password } },
  );
}

/** Every database that actually holds tenant schemas (main + pools + dedicated). */
export function tenantDatabases() {
  const dbs = new Set(schemaDbMap().values());
  return dbs.size ? [...dbs].sort() : [PG.db];
}

/** Resolve a tenant slug to its schema name. */
export function schemaOf(slug) {
  const s = psql1(`SELECT schema_name FROM public.tenants WHERE slug = '${slug}'`);
  if (!s) throw new Error(`no such tenant: ${slug}`);
  return s;
}

/** The database a tenant's schema lives in (`jainerp`, a pool DB, or its own). */
export function dbOf(slug) {
  return psql1(
    `SELECT COALESCE(db_name, '${PG.db}') FROM public.tenants WHERE slug = '${slug}'`,
  ) ?? PG.db;
}

/**
 * Same answer keyed by schema name, for callers that only hold the schema —
 * and for SQL where the schema is a **quoted value** rather than a qualifier
 * (`information_schema.columns WHERE table_schema = 'tenant_…'`, `pg_namespace`
 * lookups), which `psql()` cannot route on its own.
 */
export function dbForSchema(schema) {
  return schemaDbMap().get(schema) ?? PG.db;
}

/** Connection settings for a `pg.Pool` against a tenant's own database. */
export function pgConfigFor(slug) {
  return {
    host: PG.host, port: Number(PG.port), user: PG.user,
    password: PG.password, database: dbOf(slug),
  };
}

export const uniq = () => Math.floor(Math.random() * 900000 + 100000);
/** A mobile in the dev range that is never a real person. */
export const testMobile = () => `9${String(Math.floor(Math.random() * 900000000 + 100000000))}`;
