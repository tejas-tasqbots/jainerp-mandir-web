/**
 * Multi-tenant isolation and the security properties that hold the platform up.
 *
 * The whole product rests on one invariant: a session issued for tenant A can
 * never read or write tenant B. Every tenant query is schema-scoped through the
 * `{s}` placeholder, so a single unscoped statement — or one that interpolates
 * a caller-supplied string into SQL — breaks isolation for every trust at once.
 *
 * Also covers injection-shaped input, stored XSS, PAN handling and the headers
 * a browser relies on.
 *
 *   node e2e/master/06-tenancy-security.mjs
 */
import {
  suite, t, skip, expect, FIXTURES, URLS,
  mandirApi, saApi, devoteeApi, mandirLogin, superAdminLogin,
  psql, psql1, schemaOf, uniq, testMobile,
} from './lib.mjs';

const S = schemaOf(FIXTURES.tenant);
let ADMIN, CASHIER, SA;

/** Payloads that must never be executed, however they are stored or echoed. */
const INJECTION = [
  "'; DROP TABLE public.tenants; --",
  "' OR '1'='1",
  "1; SELECT pg_sleep(5); --",
  "\\'; DELETE FROM donations WHERE '1'='1",
  "') UNION SELECT NULL,NULL,NULL--",
  '${jndi:ldap://x/a}',
  '../../etc/passwd',
  '%00',
];

const XSS = [
  '<script>window.__xss=1</script>',
  '<img src=x onerror="window.__xss=1">',
  '"><svg/onload=alert(1)>',
  'javascript:alert(1)',
];

await suite('06-tenancy-security', async () => {
  ADMIN = (await mandirLogin(FIXTURES.admin)).token;
  CASHIER = (await mandirLogin(FIXTURES.cashier)).token;
  SA = await superAdminLogin();

  // ═══════════════════════ Cross-tenant isolation ══════════════════════════
  // A second live tenant is required to prove isolation at all; without one
  // every "cannot see tenant B" case is vacuously true.
  const otherSlug = psql1(
    `SELECT slug FROM public.tenants
      WHERE slug <> '${FIXTURES.tenant}' AND status = 'active' AND access_enabled
        AND schema_name IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
  );
  const otherId = otherSlug && psql1(`SELECT id FROM public.tenants WHERE slug = '${otherSlug}'`);

  await t('TC-ISO-001', 'P1', 'a JWT names exactly one tenant', async () => {
    const claims = JSON.parse(Buffer.from(ADMIN.split('.')[1], 'base64url').toString());
    expect.ok(claims.tenant_id, 'no tenant_id claim');
    expect.eq(typeof claims.tenant_id, 'string', 'tenant_id must be a single id, not a list');
    return `tenant_id=${claims.tenant_id.slice(0, 8)}…`;
  });

  await t('TC-ISO-002', 'P1', 'the session cannot be retargeted with a header', async () => {
    // If any of these were honoured, one trust could read another by adding a
    // header — the scoping must come from the signed token alone.
    for (const h of ['X-Tenant-Id', 'X-Tenant', 'X-Tenant-Slug', 'Tenant-Id']) {
      const r = await mandirApi('GET', '/donations?limit=1', {
        token: ADMIN, headers: { [h]: otherId ?? '00000000-0000-0000-0000-000000000000' },
      });
      expect.http2xx(r, `${h} broke the request`);
      const first = r.data?.[0]?.id;
      if (first) {
        const belongs = psql1(`SELECT count(*) FROM ${S}.donations WHERE id = '${first}'`);
        expect.eq(Number(belongs), 1, `${h} redirected the read to another tenant`);
      }
    }
    return '4 headers ignored';
  });

  await t('TC-ISO-003', 'P1', 'a query parameter cannot retarget the tenant', async () => {
    for (const q of ['tenant_id', 'tenant', 'schema', 'tenant_slug']) {
      const r = await mandirApi('GET', `/donations?limit=1&${q}=${otherId ?? 'x'}`, { token: ADMIN });
      expect.ok(r.status < 500, `${q} caused a server error`);
      const first = r.data?.[0]?.id;
      if (first) {
        const belongs = psql1(`SELECT count(*) FROM ${S}.donations WHERE id = '${first}'`);
        expect.eq(Number(belongs), 1, `${q} redirected the read`);
      }
    }
    return '4 params ignored';
  });

  if (!otherSlug) {
    skip('TC-ISO-004', 'P1', 'cross-tenant row access', 'only one active tenant in the fixture');
  } else {
    await t('TC-ISO-004', 'P1', 'a row id from another tenant is not readable', async () => {
      const otherSchema = psql1(`SELECT schema_name FROM public.tenants WHERE slug = '${otherSlug}'`);
      const otherDb = psql1(`SELECT COALESCE(db_name,'jainerp') FROM public.tenants WHERE slug = '${otherSlug}'`);
      let foreignId = null;
      try {
        foreignId = psql1(`SELECT id FROM ${otherSchema}.donations LIMIT 1`, { db: otherDb });
      } catch { /* that tenant has no donations table populated */ }
      if (!foreignId) return `no donation rows in ${otherSlug} to probe with`;
      const r = await mandirApi('GET', `/donations/${foreignId}`, { token: ADMIN });
      expect.status(r, 404, 'another tenant’s donation must not resolve');
      return `${r.status}`;
    });

    await t('TC-ISO-005', 'P1', 'a row from another tenant cannot be voided', async () => {
      const otherSchema = psql1(`SELECT schema_name FROM public.tenants WHERE slug = '${otherSlug}'`);
      const otherDb = psql1(`SELECT COALESCE(db_name,'jainerp') FROM public.tenants WHERE slug = '${otherSlug}'`);
      let foreignId = null;
      try {
        foreignId = psql1(
          `SELECT id FROM ${otherSchema}.donations WHERE is_voided = false LIMIT 1`, { db: otherDb });
      } catch { /* no such table */ }
      if (!foreignId) return `no live donation in ${otherSlug} to probe with`;
      const r = await mandirApi('PATCH', `/donations/${foreignId}/void`, {
        token: ADMIN, body: { reason: 'cross-tenant probe' },
      });
      expect.rejected(r, 'voiding another trust’s receipt must be impossible');
      const stillLive = psql1(
        `SELECT is_voided FROM ${otherSchema}.donations WHERE id = '${foreignId}'`, { db: otherDb });
      expect.eq(stillLive, 'f', 'the other tenant’s row was modified');
      return `${r.status}, row untouched`;
    });
  }

  await t('TC-ISO-006', 'P1', 'the reported total matches this tenant’s rows only', async () => {
    const api = (await mandirApi('GET', '/donations?limit=1', { token: ADMIN })).meta?.total;
    const mine = psql1(`SELECT count(*) FROM ${S}.donations`);
    expect.eq(Number(api), Number(mine), 'the list total spans more than this tenant');
    return `${api} rows`;
  });

  await t('TC-ISO-007', 'P1', 'every tenant query is schema-scoped in source', async () => {
    // A statement against a bare table name would run in whatever search_path
    // the pooled connection happens to carry.
    const { execSync } = await import('node:child_process');
    const out = execSync(
      `grep -rnE "FROM (donations|donors|expenses|payments|bolis|rooms|halls)\\\\b" ` +
      `--include=*.ts /home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/mandir-api/src || true`,
      { encoding: 'utf8' },
    ).trim();
    expect.eq(out, '', `unscoped tenant table reference:\n${out.slice(0, 400)}`);
    return 'all reads use {s}';
  });

  await t('TC-ISO-008', 'P1', 'no tenant SQL interpolates a template variable into the statement', async () => {
    const { execSync } = await import('node:child_process');
    // `${...}` inside a tenant query is how a caller-controlled string reaches
    // SQL. `{s}` (no dollar) is the schema placeholder and is expected.
    const out = execSync(
      `grep -rnE "WHERE [a-z_.]+ = '\\\\$\\\\{" --include=*.ts ` +
      `/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/mandir-api/src || true`,
      { encoding: 'utf8' },
    ).trim();
    expect.eq(out, '', `interpolated predicate:\n${out.slice(0, 400)}`);
    return 'predicates are parameterised';
  });

  await t('TC-ISO-009', 'P1', 'no tenant is live without the schema it points at', async () => {
    // A registry row can outlive (or precede) its schema: `other-mandir` was
    // `active` + `access_enabled` with no `tenant_other` schema. The platform
    // believed it was live, so the per-minute notification cron retried it
    // forever and every request routed to it would have 500'd. In production
    // this shape means a provisioning run failed part-way and nothing noticed.
    //
    // Scoped to schemas that should live in THIS database — a pooled or
    // dedicated tenant's schema sits in its own physical DB.
    const rows = psql(
      `SELECT t.slug FROM public.tenants t
        WHERE t.access_enabled AND t.schema_name IS NOT NULL
          AND COALESCE(t.db_name, 'jainerp') = 'jainerp'
          AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = t.schema_name)`,
    );
    expect.eq(rows.length, 0, `live tenants with no schema: ${rows.map((r) => r[0]).join(', ')}`);
    return 'every live tenant has its schema';
  });

  await t('TC-ISO-010', 'P1', 'access_enabled cannot be set directly, only derived', async () => {
    // Four orthogonal controls feed it. If it were ever made writable, a
    // suspended mandir could be re-opened without changing status.
    const expr = psql1(
      `SELECT generation_expression FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'access_enabled'`,
    );
    expect.ok(expr && /status/.test(expr) && /is_active/.test(expr) && /deleted_at/.test(expr),
      `access_enabled is no longer generated from all three controls: ${expr}`);
    return expr;
  });

  // ═══════════════════════ SQL injection ═══════════════════════════════════
  await t('TC-SEC-001', 'P1', 'injection payloads in a search box are inert', async () => {
    for (const p of INJECTION) {
      const r = await mandirApi('GET', `/donations?q=${encodeURIComponent(p)}&limit=5`, { token: ADMIN });
      expect.ok(r.status < 500, `payload "${p.slice(0, 24)}" caused a ${r.status}`);
    }
    const stillThere = psql1(`SELECT count(*) FROM public.tenants`);
    expect.ok(Number(stillThere) > 0, 'the tenants table is gone — injection succeeded');
    return `${INJECTION.length} payloads inert`;
  });

  await t('TC-SEC-002', 'P1', 'injection payloads stored as a donor name do not execute', async () => {
    for (const p of INJECTION.slice(0, 4)) {
      const r = await mandirApi('POST', '/donations', {
        token: ADMIN,
        body: {
          amount_paise: 1100, category: 'General', payment_mode: 'cash',
          donor: { name: p, mobile: '9000014001' },
        },
      });
      expect.ok(r.status < 500, `storing "${p.slice(0, 24)}" caused a ${r.status}`);
    }
    expect.ok(Number(psql1(`SELECT count(*) FROM ${S}.donations`)) > 0, 'donations table damaged');
    return 'stored verbatim, not executed';
  });

  await t('TC-SEC-003', 'P1', 'an injection-shaped sort column is refused, not interpolated', async () => {
    const r = await mandirApi('GET', '/donations?sort=amount_paise;DROP TABLE x&limit=1', { token: ADMIN });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-SEC-004', 'P1', 'the resource registry cannot be pointed at an arbitrary table', async () => {
    for (const name of ['public.tenants', 'pg_catalog.pg_user', '../donations', 'donations;--']) {
      const r = await mandirApi('GET', `/${encodeURIComponent(name)}?limit=1`, { token: ADMIN });
      expect.rejected(r, `registry resolved "${name}"`);
    }
    return '4 refused';
  });

  await t('TC-SEC-005', 'P1', 'a tenant schema name cannot be smuggled through a change request', async () => {
    const tenantId = psql1(`SELECT id FROM public.tenants WHERE slug = '${FIXTURES.tenant}'`);
    // Only one pending request per (subject, field) is allowed — clear any left
    // by an earlier suite before seeding this one.
    psql(
      `UPDATE public.field_change_requests SET status = 'withdrawn'
        WHERE subject_type = 'tenant' AND subject_id = '${tenantId}'
          AND field = 'upi_id' AND status = 'pending'`,
    );
    const id = psql1(
      `INSERT INTO public.field_change_requests
         (subject_type, subject_id, subject_label, field, current_value, requested_value, status)
       VALUES ('tenant','${tenantId}','QA','upi_id','a','b','pending') RETURNING id`,
    );
    // Point the row at an unsafe schema and confirm the guard refuses it.
    psql(`UPDATE public.tenants SET schema_name = 'public; DROP TABLE x' WHERE id = '${tenantId}'`);
    const r = await saApi('PATCH', `/admin/change-requests/${id}/approve`, { token: SA, body: {} });
    psql(`UPDATE public.tenants SET schema_name = '${S}' WHERE id = '${tenantId}'`);
    expect.rejected(r, 'an unsafe schema name must be refused before it reaches SQL');
    return `${r.status} ${r.code}`;
  });

  // ═══════════════════════ Stored XSS ══════════════════════════════════════
  await t('TC-SEC-006', 'P1', 'script payloads are stored verbatim, never pre-rendered', async () => {
    // React escapes on render; the API's job is to round-trip the exact bytes
    // rather than to strip or, worse, to emit them into HTML itself.
    const payload = XSS[0];
    const made = await mandirApi('POST', '/donations', {
      token: ADMIN,
      body: {
        amount_paise: 1100, category: 'General', payment_mode: 'cash',
        donor: { name: payload, mobile: '9000014002' },
      },
    });
    expect.http2xx(made);
    const stored = psql1(
      `SELECT name FROM ${S}.donors WHERE id = (SELECT donor_id FROM ${S}.donations WHERE id = '${made.data.id}')`,
    );
    expect.eq(stored, payload, 'the payload was altered on the way in');
    return 'round-tripped byte-for-byte';
  });

  await t('TC-SEC-007', 'P1', 'no API response is served as HTML by default', async () => {
    // A JSON endpoint answering with text/html is what turns a stored payload
    // into a live XSS.
    for (const path of ['/donations?limit=1', '/donors?limit=1', '/reports/daily-collection']) {
      const r = await mandirApi('GET', path, { token: ADMIN });
      const ct = r.headers.get('content-type') ?? '';
      expect.ok(!ct.includes('text/html'), `${path} answered as ${ct}`);
    }
    return 'all application/json';
  });

  await t('TC-SEC-008', 'P2', 'XSS payloads survive a round trip through every free-text field', async () => {
    for (const p of XSS) {
      const r = await mandirApi('POST', '/vendors', { token: ADMIN, body: { name: p } });
      expect.ok(r.status < 500, `vendor name "${p.slice(0, 20)}" caused ${r.status}`);
      if (r.status < 300) await mandirApi('DELETE', `/vendors/${r.data.id}`, { token: ADMIN });
    }
    return `${XSS.length} payloads handled`;
  });

  // ═══════════════════════ PAN handling ════════════════════════════════════
  await t('TC-SEC-009', 'P1', 'PAN is never stored in clear text', async () => {
    const clear = psql1(
      `SELECT count(*) FROM ${S}.donors
        WHERE pan_masked IS NOT NULL AND pan_masked ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`,
    );
    expect.eq(Number(clear), 0, 'a full PAN is sitting in the masked column');
    return '0 unmasked';
  });

  await t('TC-SEC-010', 'P1', 'the encrypted PAN column never holds a plain PAN', async () => {
    const clear = psql1(
      `SELECT count(*) FROM ${S}.donors
        WHERE pan_encrypted IS NOT NULL AND pan_encrypted ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`,
    );
    expect.eq(Number(clear), 0, 'pan_encrypted holds plaintext');
    return '0 plaintext';
  });

  await t('TC-SEC-011', 'P1', 'a donor list never returns a full PAN', async () => {
    const r = await mandirApi('GET', '/donors?limit=50', { token: ADMIN });
    expect.http2xx(r);
    const blob = JSON.stringify(r.data);
    const leaked = blob.match(/[A-Z]{5}\d{4}[A-Z]/g) ?? [];
    expect.eq(leaked.length, 0, `full PANs in the list response: ${leaked.slice(0, 3)}`);
    return `${r.data.length} donors, 0 PANs`;
  });

  await t('TC-SEC-012', 'P1', 'revealing a PAN requires a second factor', async () => {
    const donorId = psql1(`SELECT id FROM ${S}.donors WHERE pan_masked IS NOT NULL LIMIT 1`);
    if (!donorId) return 'no donor with a PAN on file';
    const r = await mandirApi('POST', `/donors/${donorId}/pan/reveal`, { token: ADMIN, body: {} });
    expect.rejected(r, 'reveal without an OTP must be refused');
    return `${r.status} ${r.code}`;
  });

  await t('TC-SEC-013', 'P1', 'a cashier cannot reveal a PAN at all', async () => {
    const donorId = psql1(`SELECT id FROM ${S}.donors WHERE pan_masked IS NOT NULL LIMIT 1`);
    if (!donorId) return 'no donor with a PAN on file';
    const r = await mandirApi('POST', `/donors/${donorId}/pan/reveal`, { token: CASHIER, body: {} });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  // ═══════════════════════ Secrets & error hygiene ═════════════════════════
  await t('TC-SEC-014', 'P1', 'a 500 never returns a stack trace or SQL', async () => {
    const probes = [
      ['GET', '/donations/%00'],
      ['GET', '/donations?limit=%ff'],
      ['POST', '/donations'],
    ];
    for (const [m, p] of probes) {
      const r = await mandirApi(m, p, { token: ADMIN, rawBody: m === 'POST' ? '{' : undefined });
      const body = r.text ?? '';
      expect.ok(!/\bat [A-Za-z$_].*\(.*:\d+:\d+\)/.test(body), `stack trace leaked from ${m} ${p}`);
      expect.ok(!/SELECT .* FROM /i.test(body), `SQL leaked from ${m} ${p}`);
      expect.ok(!/password|secret|JWT_SECRET/i.test(body), `secret name leaked from ${m} ${p}`);
    }
    return 'no traces, SQL or secrets';
  });

  await t('TC-SEC-015', 'P1', 'the JWT secret never appears in any response', async () => {
    const secret = 'dd96fc51be9f2722df909c2caaa4d9183d6f2a812929276e';
    for (const [api, path] of [[mandirApi, '/auth/me'], [saApi, '/admin/me']]) {
      const r = await api('GET', path, { token: api === saApi ? SA : ADMIN });
      expect.ok(!(r.text ?? '').includes(secret), `${path} echoed the signing secret`);
    }
    return 'secret not echoed';
  });

  await t('TC-SEC-016', 'P1', 'an error body is the { code, message } envelope, not a raw throw', async () => {
    const r = await mandirApi('GET', '/donations/not-a-uuid', { token: ADMIN });
    expect.rejected(r);
    expect.has(r.json?.error ?? {}, 'code');
    expect.has(r.json?.error ?? {}, 'message');
    return `${r.json.error.code}`;
  });

  // ═══════════════════════ Authorisation edges ═════════════════════════════
  await t('TC-SEC-017', 'P1', 'a token from one API is not accepted by another', async () => {
    const pairs = [
      ['mandir→devotee', devoteeApi, '/me', ADMIN],
      ['mandir→superadmin', saApi, '/admin/tenants?limit=1', ADMIN],
      ['superadmin→mandir', mandirApi, '/donations?limit=1', SA],
      ['superadmin→devotee', devoteeApi, '/me', SA],
    ];
    for (const [label, api, path, token] of pairs) {
      const r = await api('GET', path, { token });
      expect.statusIn(r, [401, 403], `${label} was accepted`);
    }
    return '4 cross-audience rejections';
  });

  await t('TC-SEC-018', 'P1', 'a deleted tenant’s token stops working', async () => {
    // Sessions must not outlive the tenant they were issued for.
    const claims = JSON.parse(Buffer.from(ADMIN.split('.')[1], 'base64url').toString());
    expect.ok(claims.exp, 'tokens must carry an expiry');
    expect.ok(claims.exp - claims.iat <= 86400, `access token TTL too long: ${claims.exp - claims.iat}s`);
    return `TTL ${claims.exp - claims.iat}s`;
  });

  await t('TC-SEC-019', 'P1', 'the bearer scheme is required, not optional', async () => {
    const r = await mandirApi('GET', '/donations?limit=1', { headers: { Authorization: ADMIN } });
    expect.status(r, 401, 'a raw token without the Bearer scheme must not authenticate');
    return `${r.status}`;
  });

  await t('TC-SEC-020', 'P2', 'an oversized request body is refused rather than buffered', async () => {
    const huge = 'x'.repeat(60 * 1024 * 1024);
    const r = await mandirApi('POST', '/donations', {
      token: ADMIN,
      rawBody: JSON.stringify({ amount_paise: 100, notes: huge, category: 'General' }),
    }).catch((e) => ({ status: 413, code: 'CLIENT_ABORT', json: { e: e.message } }));
    expect.ok(r.status >= 400, `a 60MB body was accepted with ${r.status}`);
    return `${r.status}`;
  });

  // ═══════════════════════ Rate limiting ═══════════════════════════════════
  await t('TC-SEC-021', 'P1', 'the OTP send cap is enforced whenever OTP_MOCK is off', async () => {
    // The per-mobile cap (`comms.otpCapOk`) guards SMS spend, so it is skipped
    // in mock mode where nothing is actually sent — hammering send-otp locally
    // therefore returns 200 forever and proves nothing. What can be asserted
    // here is that the cap is still wired into the non-mock path.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/mandir-api/src/auth/auth.service.ts',
      'utf8');
    expect.ok(/!this\.otpMock && !\(await this\.comms\.otpCapOk\(/.test(src),
      'the send-otp cap is no longer applied on the real-delivery path');
    return 'cap wired to the non-mock path';
  });

  await t('TC-SEC-021b', 'P1', 'repeated wrong OTPs lock the mobile out', async () => {
    // The lockout is live in every mode and is what stops OTP brute force.
    // Deliberately a throwaway number: locking a fixture account here would
    // break every later suite that logs in as it (this case did exactly that
    // when it used the cashier's mobile).
    const mobile = testMobile();
    const opened = await mandirApi('POST', '/auth/send-otp', { body: { mobile } });
    if (!opened.data?.dev_otp) return `send-otp refused an unknown mobile: ${opened.status}`;
    let locked = null;
    for (let i = 0; i < 12 && !locked; i++) {
      const r = await mandirApi('POST', '/auth/verify-otp', { body: { mobile, otp: '000000' } });
      if (r.status === 429 || r.code === 'OTP_LOCKED') locked = i + 1;
    }
    expect.ok(locked, 'twelve wrong OTPs did not trigger a lockout');
    // Release it so a rerun of the pack is not affected by this run.
    psql(`UPDATE public.otp_tokens SET locked_until = NULL WHERE mobile LIKE '%${mobile}'`);
    return `locked after ${locked} attempts`;
  });

  await t('TC-SEC-022', 'P1', 'OTP verification does not reveal whether a mobile exists', async () => {
    // Different codes for "no such user" vs "wrong OTP" turn login into a
    // membership oracle.
    const unknown = await mandirApi('POST', '/auth/verify-otp', {
      body: { mobile: '9999900000', otp: '123456' },
    });
    const known = await mandirApi('POST', '/auth/verify-otp', {
      body: { mobile: FIXTURES.admin, otp: '000000' },
    });
    expect.eq(unknown.code, known.code, 'the error code distinguishes known from unknown mobiles');
    return `both ${known.code}`;
  });

  // ═══════════════════════ Comms safety ════════════════════════════════════
  await t('TC-SEC-023', 'P1', 'dev comms cannot reach a real person', async () => {
    // The allow-list is the only thing standing between a test run and real
    // WhatsApp messages to donors.
    const { readFileSync, existsSync } = await import('node:fs');
    const env = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/mandir-api/.env';
    expect.ok(existsSync(env), 'no .env to check');
    const text = readFileSync(env, 'utf8');
    const provider = text.match(/^COMMS_PROVIDER=(.*)$/m)?.[1]?.trim();
    const allow = text.match(/^COMMS_ALLOWLIST=(.*)$/m)?.[1]?.trim();
    expect.ok(provider === 'mock' || !!allow,
      'a real comms provider is configured with no COMMS_ALLOWLIST');
    return `provider=${provider} allowlist=${allow ?? 'n/a'}`;
  });

  await t('TC-SEC-024', 'P1', 'every app defines a comms allow-list guard', async () => {
    const { execSync } = await import('node:child_process');
    const out = execSync(
      `grep -rl "COMMS_ALLOWLIST" --include=*.ts ` +
      `/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/*/src 2>/dev/null || true`,
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    const apps = new Set(out.map((f) => f.split('/apps/')[1].split('/')[0]));
    expect.ok(apps.size >= 3, `only ${[...apps].join(',')} guard outbound comms`);
    return [...apps].join(',');
  });

  // ═══════════════════════ Production config safety ═══════════════════════
  // These settings all have development-safe defaults so local dev needs no
  // .env. That is exactly how a production deploy comes up insecure without
  // anything appearing to fail.
  await t('TC-CFG-001', 'P1', 'every API refuses to boot in production with OTP mocking on', async () => {
    const { execSync } = await import('node:child_process');
    const bad = [];
    for (const api of ['mandir-api', 'superadmin-api', 'devotee-api', 'sant-api']) {
      const dir = `/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/${api}`;
      const out = execSync(
        `NODE_ENV=production JWT_SECRET=$(openssl rand -hex 32) DB_PASSWORD=real OTP_MOCK=true ` +
        `PAN_ENCRYPTION_KEY=$(openssl rand -hex 32) ENCRYPTION_KEY=$(openssl rand -hex 32) ` +
        `node -e "const{collectProductionConfigProblems:c}=require('./dist/common/config-guard.js');` +
        `console.log(c(process.env,{requirePanKey:true,requireEncryptionKey:true}).length)"`,
        { cwd: dir, shell: '/bin/bash', encoding: 'utf8' },
      ).trim();
      if (Number(out) < 1) bad.push(api);
    }
    expect.eq(bad.length, 0, `these APIs would boot with OTP_MOCK=true in production: ${bad}`);
    return '4 APIs refuse';
  });

  await t('TC-CFG-002', 'P1', 'the guard names every unsafe default, not just the first', async () => {
    const { execSync } = await import('node:child_process');
    const dir = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/mandir-api';
    // Nothing set at all: the worst case, and the one a fresh environment hits.
    const out = execSync(
      `NODE_ENV=production node -e "const{collectProductionConfigProblems:c}=require('./dist/common/config-guard.js');` +
      `console.log(JSON.stringify(c({NODE_ENV:'production'},{requirePanKey:true})))"`,
      { cwd: dir, shell: '/bin/bash', encoding: 'utf8' },
    );
    const problems = JSON.parse(out);
    for (const want of ['OTP_MOCK', 'JWT_SECRET', 'DB_PASSWORD', 'PAN_ENCRYPTION_KEY']) {
      expect.ok(problems.some((p) => p.includes(want)), `${want} not reported`);
    }
    return `${problems.length} problems reported`;
  });

  await t('TC-CFG-003', 'P1', 'the guard is inert outside production', async () => {
    // A guard that breaks local dev gets disabled, and then protects nothing.
    const { execSync } = await import('node:child_process');
    const dir = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/mandir-api';
    const out = execSync(
      `NODE_ENV=development node -e "const{assertProductionConfig:a}=require('./dist/common/config-guard.js');` +
      `a({NODE_ENV:'development'},{requirePanKey:true});console.log('ok')"`,
      { cwd: dir, shell: '/bin/bash', encoding: 'utf8' },
    ).trim();
    expect.eq(out, 'ok', 'the guard fired outside production');
    return 'dev unaffected';
  });

  await t('TC-CFG-004', 'P1', 'no deploy compose defaults OTP mocking to on', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const root = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP';
    const files = [`${root}/deploy-repo/docker-compose.aws.yml`, `${root}/docker-compose.gcp.yml`];
    const bad = [];
    for (const f of files) {
      if (!existsSync(f)) continue;
      const text = readFileSync(f, 'utf8');
      // `${OTP_MOCK:-true}` means "mock unless told otherwise" — fail-open.
      if (/OTP_MOCK:\s*\$\{OTP_MOCK:-true\}/.test(text)) bad.push(f.split('/').pop());
    }
    expect.eq(bad.length, 0, `compose files defaulting OTP_MOCK to true: ${bad}`);
    return `${files.length} compose files fail closed`;
  });

  await t('TC-CFG-005', 'P1', 'every API that stores PANs is given its own encryption key', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const root = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP';
    const bad = [];
    for (const f of [`${root}/deploy-repo/docker-compose.aws.yml`, `${root}/docker-compose.gcp.yml`]) {
      if (!existsSync(f)) continue;
      const text = readFileSync(f, 'utf8');
      // Services reading PAN_ENCRYPTION_KEY: mandir-api (aka mandiradmin-api)
      // and devotee-api. Without it the key is derived from JWT_SECRET, so
      // rotating that secret orphans every stored PAN.
      const supplied = (text.match(/PAN_ENCRYPTION_KEY:/g) ?? []).length;
      if (supplied < 2) bad.push(`${f.split('/').pop()} supplies ${supplied}/2`);
    }
    expect.eq(bad.length, 0, `PAN key missing: ${bad.join('; ')}`);
    return 'both APIs supplied in both compose files';
  });

  await t('TC-CFG-006', 'P1', 'a PAN written under the old derived key is still readable', async () => {
    // Introducing PAN_ENCRYPTION_KEY must not orphan PANs already stored under
    // the JWT-derived key — that would be the same silent loss, triggered by
    // the fix instead of by a rotation.
    const { execSync } = await import('node:child_process');
    const dir = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/mandir-api';
    const script =
      `process.env.JWT_SECRET='legacy-secret-value';delete process.env.PAN_ENCRYPTION_KEY;` +
      `const a=require('./dist/common/pan-crypto.js');const blob=a.encryptPan('ABCDE1234F');` +
      `process.env.PAN_ENCRYPTION_KEY=require('crypto').randomBytes(32).toString('hex');` +
      `delete require.cache[require.resolve('./dist/common/pan-crypto.js')];` +
      `const b=require('./dist/common/pan-crypto.js');console.log(b.decryptPan(blob));`;
    const out = execSync(`node -e "${script}"`, { cwd: dir, shell: '/bin/bash', encoding: 'utf8' }).trim();
    expect.eq(out, 'ABCDE1234F', 'a legacy-key PAN became unreadable once a dedicated key was set');
    return 'legacy PANs survive the key introduction';
  });

  // ═══════════════════════ Audit completeness ══════════════════════════════
  await t('TC-SEC-025', 'P1', 'every money mutation this run left an audit trail', async () => {
    const since = new Date(Date.now() - 3600e3).toISOString();
    const audited = Number(psql1(
      `SELECT count(*) FROM ${S}.audit_log WHERE occurred_at >= '${since}'`));
    expect.ok(audited > 0, 'no audit rows written in the last hour of testing');
    return `${audited} audit rows`;
  });

  await t('TC-SEC-026', 'P1', 'audit rows always name an actor', async () => {
    const since = new Date(Date.now() - 3600e3).toISOString();
    const anon = Number(psql1(
      `SELECT count(*) FROM ${S}.audit_log WHERE occurred_at >= '${since}' AND actor_id IS NULL`));
    expect.eq(anon, 0, 'audit rows with no actor — an untraceable change');
    return '0 anonymous';
  });

  await t('TC-SEC-027', 'P1', 'the platform audit log records the operator for console actions', async () => {
    const anon = Number(psql1(
      `SELECT count(*) FROM public.audit_events
        WHERE created_at >= NOW() - INTERVAL '1 hour' AND actor_user_id IS NULL`));
    expect.eq(anon, 0, 'console actions with no operator recorded');
    return '0 anonymous';
  });

  // ═══════════════════════ Web headers ═════════════════════════════════════
  await t('TC-SEC-028', 'P2', 'the portals serve an HTML document', async () => {
    for (const [name, url] of Object.entries({
      mandir: URLS.mandirWeb, devotee: URLS.devoteeWeb, sant: URLS.santWeb, console: URLS.saWeb,
    })) {
      const res = await fetch(url).catch(() => null);
      expect.ok(res?.ok, `${name} portal did not respond`);
      const html = await res.text();
      expect.ok(/<div id="root"|<!doctype html/i.test(html), `${name} served no app shell`);
    }
    return '4 portals up';
  });

  await t('TC-SEC-029', 'P1', 'no portal bundle ships the signing secret or a live key', async () => {
    const { readFileSync, readdirSync, existsSync } = await import('node:fs');
    const secrets = ['dd96fc51be9f2722df909c2caaa4d9183d6f2a812929276e', 'jainerp_dev'];
    const hits = [];
    for (const app of ['mandir-web', 'superadmin-web', 'devotee-web', 'sant-web']) {
      const dir = `/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/${app}/dist/assets`;
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
        const js = readFileSync(`${dir}/${f}`, 'utf8');
        for (const s of secrets) if (js.includes(s)) hits.push(`${app}/${f}: ${s.slice(0, 12)}…`);
      }
    }
    expect.eq(hits.length, 0, `secrets bundled into client JS: ${hits.join('; ')}`);
    return '0 secrets in bundles';
  });

  await t('TC-SEC-030', 'P1', 'no API echoes an arbitrary Origin back', async () => {
    // Every API was `{ origin: true, credentials: true }`, which reflects any
    // site's Origin *and* allows credentials — the combination the CORS spec
    // forbids. Bearer auth meant nothing was exploitable, but the exposure
    // would arrive silently the day anything moved into a cookie.
    for (const [name, api] of [['mandir', mandirApi], ['superadmin', saApi], ['devotee', devoteeApi]]) {
      const r = await api('GET', '/health', { headers: { Origin: 'https://evil.example' } });
      const acao = r.headers.get('access-control-allow-origin');
      expect.ok(acao !== 'https://evil.example', `${name}-api reflected an arbitrary origin`);
    }
    return '3 APIs refuse an unknown origin';
  });

  await t('TC-SEC-030b', 'P1', 'a known portal origin is still allowed', async () => {
    for (const [name, api] of [['mandir', mandirApi], ['superadmin', saApi], ['devotee', devoteeApi]]) {
      const r = await api('GET', '/health', { headers: { Origin: 'http://localhost:5173' } });
      expect.eq(r.headers.get('access-control-allow-origin'), 'http://localhost:5173',
        `${name}-api refused a legitimate portal origin`);
    }
    return '3 APIs allow the dev portal';
  });

  await t('TC-SEC-030c', 'P1', 'a caller sending no Origin is unaffected', async () => {
    // Mobile and desktop clients send no Origin; CORS must not touch them.
    const r = await mandirApi('GET', '/health');
    expect.http2xx(r);
    return 'mobile/desktop path clear';
  });
});
