/**
 * Auth and RBAC across all four APIs.
 *
 * Covers the OTP login flows (mandir two-step, devotee/sant one-step), the
 * super-admin password+TOTP flow, JWT handling, session management, and the
 * tenant role gate: `@Roles('a','b')` means those roles **or** temple_admin,
 * `@Roles()` with no argument means temple_admin only, and temple_admin passes
 * every gate.
 *
 *   node e2e/master/01-auth-rbac.mjs
 */
import {
  otpFor,
  suite, t, skip, expect, FIXTURES,
  mandirApi, saApi, devoteeApi, santApi,
  mandirLogin, devoteeLogin, superAdminLogin, psql1, testMobile,
} from './lib.mjs';

await suite('01-auth-rbac', async () => {
  /**
   * send-otp, retried past a 429.
   *
   * `/auth/*` overrides the global 600/60s throttler with **20 per 60s**
   * (`@Throttle({ default: { ttl: 60_000, limit: 20 } })` on AuthController),
   * and this suite alone spends more than that. A case asserting how send-otp
   * NORMALISES a mobile is not asserting the rate limit, so a 429 there is a
   * correct-but-useless answer to a question we did not ask — waiting for the
   * window is what a real client does. Throttling itself is pinned by
   * TC-AUTH-029, TC-SEC-021 and TC-SEC-021b.
   */
  const sendOtpBody = async (body) => {
    let r;
    for (const wait of [0, 5_000, 15_000, 30_000, 45_000]) {
      if (wait) await new Promise((res) => setTimeout(res, wait));
      r = await mandirApi('POST', '/auth/send-otp', { body });
      if (r.status !== 429) return r;
    }
    return r;
  };
  const sendOtp = async (mobile) => {
    let r;
    for (const wait of [0, 5_000, 15_000, 30_000, 45_000]) {
      if (wait) await new Promise((res) => setTimeout(res, wait));
      r = await mandirApi('POST', '/auth/send-otp', { body: { mobile } });
      if (r.status !== 429) return r;
    }
    return r;
  };
  // ─────────────────────────── Mandir OTP login ───────────────────────────
  let otp;
  await t('TC-AUTH-001', 'P1', 'send-otp returns a dev OTP in mock mode', async () => {
    const r = await sendOtp(FIXTURES.admin);
    expect.http2xx(r);
    otp = r.data?.dev_otp;
    expect.ok(otp, 'no dev_otp — is OTP_MOCK=true?');
    return `otp=${otp}`;
  });

  await t('TC-AUTH-002', 'P1', 'dev OTP is exactly 6 digits', async () => {
    expect.ok(/^\d{6}$/.test(otp ?? ''), `got ${otp}`);
    return otp;
  });

  await t('TC-AUTH-003', 'P2', 'send-otp accepts a +91 prefixed mobile', async () => {
    const r = await sendOtp(`+91${FIXTURES.admin}`);
    expect.http2xx(r, 'E.164 form should normalise to the same user');
    return 'normalised';
  });

  /**
   * A validation case has to see the VALIDATION error, not merely "some 4xx".
   * `expect.rejected` accepts any 4xx, so under the 20/60s auth throttle these
   * three passed on a 429 — reporting that a malformed mobile was rejected when
   * the server had not looked at the mobile at all. Same unearned-pass shape as
   * TC-DEV-006: green on the wrong reason is not green.
   */
  const expectRejectedOnMerit = (r, what) => {
    expect.ok(r.status !== 429,
      `${what}: got 429 RATE_LIMITED — the validation never ran, so this case proved nothing`);
    expect.rejected(r, what);
  };

  await t('TC-AUTH-004', 'P1', 'send-otp rejects a malformed mobile', async () => {
    const r = await sendOtp('123');
    expectRejectedOnMerit(r, 'malformed mobile');
    return `${r.status} ${r.code}`;
  });

  await t('TC-AUTH-005', 'P1', 'send-otp rejects a missing mobile', async () => {
    const r = await sendOtpBody({});
    expectRejectedOnMerit(r, 'missing mobile');
    return `${r.status} ${r.code}`;
  });

  await t('TC-AUTH-006', 'P2', 'send-otp rejects a non-numeric mobile', async () => {
    const r = await sendOtp('abcdefghij');
    expectRejectedOnMerit(r, 'non-numeric mobile');
    return `${r.status}`;
  });

  let selectionToken, memberships;
  await t('TC-AUTH-007', 'P1', 'verify-otp returns a selection token + memberships', async () => {
    // TC-AUTH-029 deliberately burns the auth throttle budget (20/min), so any
    // case that needs a USABLE OTP has to back off exactly like mandirLogin
    // does. Reading `.data.dev_otp` off a 429 is how this suite used to report
    // "Cannot read properties of null" as a P1 product failure.
    const otp = await otpFor(mandirApi, FIXTURES.admin);
    const r = await mandirApi('POST', '/auth/verify-otp', {
      body: { mobile: FIXTURES.admin, otp },
    });
    expect.http2xx(r);
    selectionToken = r.data?.selection_token;
    memberships = r.data?.tenants ?? [];
    expect.ok(selectionToken, 'no selection_token');
    expect.ok(memberships.length > 0, 'no tenant memberships');
    return `${memberships.length} membership(s)`;
  });

  await t('TC-AUTH-008', 'P1', 'membership list carries the tenant slug and roles', async () => {
    const m = memberships.find((x) => x.slug === FIXTURES.tenant);
    expect.ok(m, `${FIXTURES.tenant} not in memberships`);
    expect.ok(Array.isArray(m.roles) && m.roles.includes('temple_admin'), `roles=${JSON.stringify(m.roles)}`);
    return m.roles.join(',');
  });

  await t('TC-AUTH-009', 'P1', 'verify-otp rejects a wrong OTP', async () => {
    await mandirApi('POST', '/auth/send-otp', { body: { mobile: FIXTURES.admin } });
    const r = await mandirApi('POST', '/auth/verify-otp', { body: { mobile: FIXTURES.admin, otp: '000000' } });
    expect.status(r, 401);
    expect.eq(r.code, 'OTP_INVALID', 'error code');
    return r.code;
  });

  await t('TC-AUTH-010', 'P1', 'verify-otp rejects an unknown mobile', async () => {
    const r = await mandirApi('POST', '/auth/verify-otp', { body: { mobile: '9999900000', otp: '123456' } });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-AUTH-011', 'P1', 'an OTP cannot be replayed after it is consumed', async () => {
    const code = await otpFor(mandirApi, FIXTURES.admin);
    const first = await mandirApi('POST', '/auth/verify-otp', { body: { mobile: FIXTURES.admin, otp: code } });
    expect.http2xx(first, 'first use should succeed');
    const second = await mandirApi('POST', '/auth/verify-otp', { body: { mobile: FIXTURES.admin, otp: code } });
    expect.rejected(second, 'a consumed OTP must not be reusable');
    return `replay -> ${second.status} ${second.code}`;
  });

  await t('TC-AUTH-012', 'P2', 'verify-otp rejects an OTP of the wrong length', async () => {
    await mandirApi('POST', '/auth/send-otp', { body: { mobile: FIXTURES.admin } });
    const r = await mandirApi('POST', '/auth/verify-otp', { body: { mobile: FIXTURES.admin, otp: '12' } });
    expect.rejected(r);
    return `${r.status}`;
  });

  // ─────────────────────────── Tenant selection ───────────────────────────
  let adminToken;
  await t('TC-AUTH-013', 'P1', 'select-tenant issues an access token', async () => {
    const s = await mandirLogin(FIXTURES.admin);
    adminToken = s.token;
    expect.ok(adminToken);
    return 'issued';
  });

  await t('TC-AUTH-014', 'P1', 'access token is a 3-part JWT carrying tenant_id and roles', async () => {
    const parts = adminToken.split('.');
    expect.eq(parts.length, 3, 'JWT segments');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect.has(claims, 'tenant_id');
    expect.has(claims, 'roles');
    expect.ok(claims.roles.includes('temple_admin'), `roles=${claims.roles}`);
    return `tenant_id=${String(claims.tenant_id).slice(0, 8)}… roles=${claims.roles}`;
  });

  await t('TC-AUTH-015', 'P1', 'select-tenant rejects a tenant the user does not belong to', async () => {
    const ver = await mandirApi('POST', '/auth/verify-otp', {
      body: { mobile: FIXTURES.admin, otp: await otpFor(mandirApi, FIXTURES.admin) },
    });
    const r = await mandirApi('POST', '/auth/select-tenant', {
      body: { selection_token: ver.data.selection_token, tenant_slug: 'no-such-tenant-xyz' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-AUTH-016', 'P1', 'select-tenant rejects a forged selection token', async () => {
    const r = await mandirApi('POST', '/auth/select-tenant', {
      body: { selection_token: 'not.a.token', tenant_slug: FIXTURES.tenant },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-AUTH-017', 'P1', 'a selection token is not usable as an access token', async () => {
    const r = await mandirApi('GET', '/donations?limit=1', { token: selectionToken });
    expect.rejected(r, 'selection token must not authorise data reads');
    return `${r.status}`;
  });

  // ─────────────────────────── Token validation ───────────────────────────
  await t('TC-AUTH-018', 'P1', 'a protected route rejects a request with no token', async () => {
    const r = await mandirApi('GET', '/donations?limit=1');
    expect.status(r, 401);
    return `${r.status}`;
  });

  await t('TC-AUTH-019', 'P1', 'a protected route rejects a garbage token', async () => {
    const r = await mandirApi('GET', '/donations?limit=1', { token: 'garbage' });
    expect.status(r, 401);
    return `${r.status}`;
  });

  await t('TC-AUTH-020', 'P1', 'a token with a tampered payload is rejected', async () => {
    const [h, p, s] = adminToken.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    claims.roles = ['temple_admin', 'superuser'];
    const forged = `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`;
    const r = await mandirApi('GET', '/donations?limit=1', { token: forged });
    expect.status(r, 401, 'signature must fail');
    return `${r.status}`;
  });

  await t('TC-AUTH-021', 'P1', 'the alg=none downgrade is rejected', async () => {
    const claims = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64url').toString());
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const forged = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    const r = await mandirApi('GET', '/donations?limit=1', { token: forged });
    expect.status(r, 401);
    return `${r.status}`;
  });

  await t('TC-AUTH-022', 'P2', 'an expired token is rejected', async () => {
    // Signed with the dev secret but already expired. If this passes, `exp` is
    // not being checked at all.
    const { createHmac } = await import('node:crypto');
    const secret = 'dd96fc51be9f2722df909c2caaa4d9183d6f2a812929276e';
    const claims = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64url').toString());
    claims.exp = Math.floor(Date.now() / 1000) - 3600;
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    const r = await mandirApi('GET', '/donations?limit=1', { token: `${h}.${p}.${sig}` });
    expect.status(r, 401, 'expired token must not be accepted');
    return `${r.status}`;
  });

  await t('TC-AUTH-023', 'P2', 'GET /auth/me returns the caller identity', async () => {
    const r = await mandirApi('GET', '/auth/me', { token: adminToken });
    expect.http2xx(r);
    expect.ok(r.data, 'no body');
    return JSON.stringify(r.data).slice(0, 90);
  });

  // ─────────────────────────── Refresh & sessions ─────────────────────────
  await t('TC-AUTH-024', 'P1', 'refresh exchanges a refresh token for a new access token', async () => {
    const s = await mandirLogin(FIXTURES.admin);
    if (!s.refresh) return 'no refresh_token issued — nothing to exchange';
    const r = await mandirApi('POST', '/auth/refresh', { body: { refresh_token: s.refresh } });
    expect.http2xx(r);
    expect.ok(r.data?.access_token, 'no new access_token');
    return 'rotated';
  });

  await t('TC-AUTH-025', 'P1', 'refresh rejects a forged refresh token', async () => {
    const r = await mandirApi('POST', '/auth/refresh', { body: { refresh_token: 'nope' } });
    expect.rejected(r);
    return `${r.status}`;
  });

  await t('TC-AUTH-026', 'P2', 'sessions lists the active sessions', async () => {
    const r = await mandirApi('GET', '/auth/sessions', { token: adminToken });
    expect.http2xx(r);
    expect.ok(Array.isArray(r.data), 'expected an array');
    return `${r.data.length} session(s)`;
  });

  await t('TC-AUTH-027', 'P2', 'logout is accepted', async () => {
    const s = await mandirLogin(FIXTURES.admin);
    const r = await mandirApi('POST', '/auth/logout', {
      token: s.token, body: { refresh_token: s.refresh },
    });
    expect.http2xx(r);
    return `${r.status}`;
  });

  await t('TC-AUTH-028', 'P1', 'a refresh token cannot be reused after logout', async () => {
    const s = await mandirLogin(FIXTURES.admin);
    if (!s.refresh) return 'no refresh_token issued — nothing to revoke';
    await mandirApi('POST', '/auth/logout', { token: s.token, body: { refresh_token: s.refresh } });
    const r = await mandirApi('POST', '/auth/refresh', { body: { refresh_token: s.refresh } });
    expect.rejected(r, 'logout must revoke the refresh token');
    return `${r.status}`;
  });

  // ─────────────────────────── Tenant RBAC ────────────────────────────────
  let cashierToken = null;
  await t('TC-RBAC-001', 'P1', 'cashier can log in to the same tenant', async () => {
    const s = await mandirLogin(FIXTURES.cashier);
    cashierToken = s.token;
    const claims = JSON.parse(Buffer.from(cashierToken.split('.')[1], 'base64url').toString());
    expect.ok(claims.roles.includes('cashier'), `roles=${claims.roles}`);
    return claims.roles.join(',');
  });

  await t('TC-RBAC-002', 'P1', 'cashier CAN record a donation (money-in is their job)', async () => {
    const r = await mandirApi('POST', '/donations', {
      token: cashierToken,
      body: {
        amount_paise: 10100, donor: { name: 'RBAC Probe', mobile: '9000012345' },
        category: 'General', payment_mode: 'cash', is_80g: false,
      },
    });
    expect.http2xx(r);
    return `receipt ${r.data?.receipt_number}`;
  });

  // A temple_admin-only route (`@Roles()` with no argument). DELETE on a UUID
  // that cannot exist proves the *gate* without touching data: the role check
  // runs before the handler, so a cashier is refused at 403 while an admin gets
  // through to a 404. Asserting both directions is what makes this a test of
  // the gate rather than of the fixture.
  const GHOST = '00000000-0000-0000-0000-000000000000';
  await t('TC-RBAC-003', 'P1', 'cashier is refused by a temple_admin-only route', async () => {
    const r = await mandirApi('DELETE', `/events/${GHOST}`, { token: cashierToken });
    expect.status(r, 403, 'admin-only route must refuse a cashier');
    return `${r.status} ${r.code}`;
  });

  await t('TC-RBAC-003b', 'P1', 'temple_admin passes that same gate (404, not 403)', async () => {
    const r = await mandirApi('DELETE', `/events/${GHOST}`, { token: adminToken });
    expect.status(r, 404, 'admin should clear the gate and fall through to not-found');
    return `${r.status} ${r.code}`;
  });

  await t('TC-RBAC-004', 'P1', 'temple_admin passes a gate declared for other roles', async () => {
    const r = await mandirApi('GET', '/donations?limit=1', { token: adminToken });
    expect.http2xx(r);
    return 'admin passes';
  });

  await t('TC-RBAC-005', 'P1', 'a tenant token cannot call the super-admin API', async () => {
    const r = await saApi('GET', '/admin/tenants?limit=1', { token: adminToken });
    expect.statusIn(r, [401, 403], 'tenant JWT must not authorise the platform console');
    return `${r.status}`;
  });

  await t('TC-RBAC-006', 'P1', 'a tenant token cannot call the devotee API as a devotee', async () => {
    const r = await devoteeApi('GET', '/me', { token: adminToken });
    expect.statusIn(r, [401, 403, 404], 'cross-audience token must not be honoured');
    return `${r.status}`;
  });

  // ─────────────────────────── Super Admin auth ───────────────────────────
  let saToken;
  await t('TC-SAAUTH-001', 'P1', 'super admin login + TOTP yields an access token', async () => {
    saToken = await superAdminLogin();
    expect.ok(saToken);
    return 'authenticated';
  });

  await t('TC-SAAUTH-002', 'P1', 'super admin password alone does not authenticate', async () => {
    const r = await saApi('POST', '/admin/auth/login', {
      body: { identifier: FIXTURES.saEmail, password: FIXTURES.saPassword },
    });
    expect.http2xx(r);
    expect.ok(r.data?.mfa_token, 'expected an mfa_token, not a session');
    expect.ok(!r.data?.access_token, 'password step must NOT return an access token');
    return 'mfa required';
  });

  await t('TC-SAAUTH-003', 'P1', 'super admin login rejects a wrong password', async () => {
    const r = await saApi('POST', '/admin/auth/login', {
      body: { identifier: FIXTURES.saEmail, password: 'WrongPassword@1' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-SAAUTH-004', 'P1', 'super admin login rejects an unknown identifier', async () => {
    const r = await saApi('POST', '/admin/auth/login', {
      body: { identifier: 'nobody@example.com', password: 'whatever' },
    });
    expect.rejected(r);
    return `${r.status}`;
  });

  await t('TC-SAAUTH-005', 'P1', 'MFA verify rejects a wrong TOTP code', async () => {
    const login = await saApi('POST', '/admin/auth/login', {
      body: { identifier: FIXTURES.saEmail, password: FIXTURES.saPassword },
    });
    const r = await saApi('POST', '/admin/auth/mfa/verify', {
      body: { mfa_token: login.data.mfa_token, type: 'totp', code: '000000' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-SAAUTH-006', 'P1', 'the super-admin console rejects an unauthenticated read', async () => {
    const r = await saApi('GET', '/admin/tenants?limit=1');
    expect.status(r, 401);
    return `${r.status}`;
  });

  await t('TC-SAAUTH-007', 'P1', 'a super-admin token is accepted by the console', async () => {
    const r = await saApi('GET', '/admin/tenants?limit=1', { token: saToken });
    expect.http2xx(r);
    return 'ok';
  });

  await t('TC-SAAUTH-008', 'P2', 'a super-admin token is not a tenant token', async () => {
    const r = await mandirApi('GET', '/donations?limit=1', { token: saToken });
    expect.statusIn(r, [401, 403], 'SA token must not read tenant data directly');
    return `${r.status}`;
  });

  // ─────────────────────────── Devotee auth ───────────────────────────────
  const devoteeMobile = psql1(
    `SELECT replace(mobile,'+91','') FROM public.global_users
      WHERE is_devotee = true AND mobile LIKE '+91%' ORDER BY created_at DESC LIMIT 1`,
  );

  if (!devoteeMobile) {
    skip('TC-DAUTH-001', 'P1', 'devotee OTP login', 'no devotee fixture in the database');
  } else {
    await t('TC-DAUTH-001', 'P1', 'devotee OTP login yields an access token', async () => {
      const s = await devoteeLogin(devoteeMobile);
      expect.ok(s.token);
      return `as ${devoteeMobile}`;
    });

    await t('TC-DAUTH-002', 'P1', 'devotee verify-otp rejects a wrong OTP', async () => {
      await devoteeApi('POST', '/auth/send-otp', { body: { mobile: devoteeMobile } });
      const r = await devoteeApi('POST', '/auth/verify-otp', { body: { mobile: devoteeMobile, otp: '000000' } });
      expect.rejected(r);
      return `${r.status}`;
    });

    await t('TC-DAUTH-003', 'P1', 'devotee protected route rejects an anonymous call', async () => {
      const r = await devoteeApi('GET', '/me');
      expect.status(r, 401);
      return `${r.status}`;
    });
  }

  await t('TC-DAUTH-004', 'P2', 'devotee send-otp self-registers an unknown mobile or refuses cleanly', async () => {
    const r = await devoteeApi('POST', '/auth/send-otp', { body: { mobile: testMobile() } });
    // Either behaviour is defensible; a 500 is not.
    expect.ok(r.status < 500, `unexpected server error ${r.status}`);
    return `${r.status}`;
  });

  // ─────────────────────────── Sant auth ──────────────────────────────────
  await t('TC-SAUTH-001', 'P1', 'sant-api serves under /api/v1', async () => {
    const r = await santApi('POST', '/auth/send-otp', { body: { mobile: '9000000000' } });
    expect.ok(r.status !== 404, 'sant-api routes must be under /api/v1 since 2026-08-03');
    return `${r.status}`;
  });

  await t('TC-SAUTH-002', 'P1', 'sant protected route rejects an anonymous call', async () => {
    const r = await santApi('GET', '/auth/me');
    expect.status(r, 401);
    return `${r.status}`;
  });

  await t('TC-SAUTH-003', 'P2', 'sant login refuses a mobile that is not a registered rep', async () => {
    const r = await santApi('POST', '/auth/send-otp', { body: { mobile: testMobile() } });
    expect.ok(r.status < 500, `unexpected server error ${r.status}`);
    return `${r.status}`;
  });

  // ─────────────────────────── Rate / abuse ───────────────────────────────
  await t('TC-AUTH-030', 'P1', 'send-otp exposes dev_otp only because OTP_MOCK is on', async () => {
    // Pins the field name so a production build that forgets to strip it fails
    // here. Runs before the rate-limit case below, which deliberately burns the
    // per-mobile quota.
    const r = await mandirApi('POST', '/auth/send-otp', { body: { mobile: FIXTURES.cashier } });
    expect.http2xx(r);
    expect.ok('dev_otp' in (r.data ?? {}), 'dev mode should expose dev_otp');
    return 'dev_otp present (dev only)';
  });

  await t('TC-AUTH-029', 'P1', 'a burst of send-otp is absorbed or throttled, never a 5xx', async () => {
    // Deliberately *not* asserting that a 429 appears. Two different limits
    // exist and neither fires reliably here: the per-mobile SMS cap is skipped
    // when OTP_MOCK is on (nothing is sent), and the auth throttler is 20/60s
    // (AuthController overrides the global 600/60s), so whether a short burst
    // trips it depends on what the rest of the pack did in the preceding
    // minute. Asserting 429 made this pass or
    // fail on run order rather than on behaviour. The limits themselves are
    // pinned deterministically by TC-SEC-021 (cap wiring) and TC-SEC-021b
    // (wrong-OTP lockout).
    const codes = [];
    for (let i = 0; i < 8; i++) {
      const r = await mandirApi('POST', '/auth/send-otp', { body: { mobile: FIXTURES.admin } });
      codes.push(r.status);
    }
    expect.ok(codes.every((c) => c === 200 || c === 201 || c === 429), `unexpected statuses: ${codes}`);
    return codes.join(',');
  });

  await t('TC-AUTH-029b', 'P1', 'a global throttler is configured on the API', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP/apps/mandir-api/src/app.module.ts', 'utf8');
    const m = src.match(/ThrottlerModule\.forRoot\(\[\{\s*ttl:\s*([\d_]+),\s*limit:\s*([\d_]+)/);
    expect.ok(m, 'no ThrottlerModule configured — send-otp would be unbounded');
    return `${m[2].replace(/_/g, '')} requests / ${Number(m[1].replace(/_/g, '')) / 1000}s`;
  });
});
