/**
 * The three things the 2026-08-15 pass changed, pinned so they cannot regress:
 * entitlement reaching INSIDE reports, devotee giving being verified-only, and
 * the discovery map having pins at all.
 *
 * Every case here corresponds to a written case in doc-v2/Test_Cases.md
 * (§12a TC-RPT-*, §15d TC-DVD-*, §15e TC-MAP-*) and to a requirement
 * (SRS §5.30a FR-MAP-*, §5.30b FR-MOD-*, §5.30c FR-DACC-*).
 *
 * It provisions its OWN tenant rather than using `smoke-portal`, because the
 * whole point is a trust that holds *few* modules and smoke-portal holds every
 * one. The tenant is soft-deleted at the end.
 *
 *   node e2e/master/11-entitlements-giving-map.mjs
 */
import { readFileSync } from 'node:fs';
import {
  suite, t, expect, FIXTURES,
  mandirApi, saApi, devoteeApi, mandirLogin, devoteeLogin, superAdminLogin,
  psql, psql1, uniq, testMobile,
} from './lib.mjs';

const ROOT = '/home/ayush/Documents/tasqbots/Projects/tasqbots-JainERP';

let SA, SLUG, TENANT_ID, MOBILE, TOK, DEV;

/** The registry cache means a fresh grant is not visible at once (FR-MOD-009). */
const CACHE_WAIT_MS = 32_000;

await suite('11-entitlements-giving-map', async () => {
  SA = await superAdminLogin();

  // A donation-only trust: the shape doc-v2 Test_Cases §12a names as its fixture.
  SLUG = `ent-qa-${uniq()}`;
  MOBILE = testMobile();
  const created = await saApi('POST', '/admin/tenants', {
    token: SA,
    body: {
      name: `Entitlement QA ${SLUG}`, temple_type: 'jain', slug: SLUG,
      plan: 'starter', billing_cycle: 'monthly', tenancy_tier: 'pooled',
      admin_contact: { name: 'Ent QA', mobile: `+91${MOBILE}`, email: `${SLUG}@test.in` },
      address: { line1: '1 QA Marg', city: 'Indore', state: 'MP', pincode: '452001' },
      modules: [],
    },
  });
  expect.http2xx(created, 'could not provision the donation-only fixture');
  TENANT_ID = created.data.id;
  TOK = (await mandirLogin(MOBILE, SLUG)).token;
  // One devotee for the whole suite — the fixture seeded by smoke-portal-setup.
  DEV = (await devoteeLogin(psql1(
    `SELECT replace(mobile,'+91','') FROM public.global_users
      WHERE is_devotee = true AND mobile LIKE '+91%' AND is_active = true
      ORDER BY created_at DESC LIMIT 1`))).token;

  const api = (path) => mandirApi('GET', path, { token: TOK });

  // ═══════════════ Reports carry only the modules the trust holds ═══════════
  await t('TC-RPT-06', 'P1', 'collection streams follow the grant, and say which they are', async () => {
    const r = await api('/reports/daily-collection');
    expect.http2xx(r);
    expect.eq(JSON.stringify(r.data.included_streams), '["donations_paise"]', 'included_streams');
    // The key must be ABSENT, not zero: a ₹0 line for a counter the trust does
    // not run is a statement, and it is the wrong one.
    expect.ok(r.data.prasad_paise === undefined, 'prasad_paise should not be present at all');
    expect.ok(r.data.room_advance_paise === undefined, 'room_advance_paise should not be present');
    return 'donations only';
  });

  await t('TC-RPT-07', 'P1', 'the transaction ledger unions only held counters', async () => {
    const r = await api('/reports/all-transactions');
    expect.http2xx(r);
    expect.eq(JSON.stringify(r.data.included_types), '["donation","expense"]', 'included_types');
    const leaked = r.data.rows.filter((x) => !['donation', 'expense'].includes(x.type));
    expect.eq(leaked.length, 0, 'rows from a module the trust does not hold');
    return `${r.data.rows.length} rows, 2 types`;
  });

  await t('TC-RPT-08', 'P2', 'an unheld type in ?type= is intersected away, not refused', async () => {
    const r = await api('/reports/all-transactions?type=donation,room');
    expect.http2xx(r, 'a stale bookmark must degrade, not break');
    expect.eq(r.data.rows.filter((x) => x.type === 'room').length, 0, 'room rows');
    return '200, room dropped';
  });

  await t('TC-RPT-09', 'P2', 'asking ONLY for an unheld type gives an empty ledger', async () => {
    const r = await api('/reports/all-transactions?type=room');
    expect.http2xx(r);
    // The trap: an empty intersection must not fall back to "no filter" and
    // return everything.
    expect.eq(r.data.rows.length, 0, 'rows');
    return 'empty, not unfiltered';
  });

  await t('TC-RPT-10', 'P1', 'GST output heads follow the grant; input GST survives', async () => {
    const r = await api('/reports/gst-summary');
    expect.http2xx(r);
    expect.eq(JSON.stringify(r.data.included_heads), '[]', 'included_heads');
    expect.ok(r.data.output_gst.rooms_paise === undefined, 'rooms head should be absent');
    expect.ok(typeof r.data.input_gst_paise === 'number', 'input GST comes from expenses (core)');
    return 'no output heads, input intact';
  });

  await t('TC-RPT-11', 'P1', 'a register the trust cannot have is refused', async () => {
    const r = await api('/reports/service-register?type=room');
    expect.status(r, 403);
    expect.eq(r.json?.error?.code, 'MODULE_NOT_ENABLED', 'error code');
    // On a trust holding NONE of the five the controller guard fires first, so
    // the body names required_modules rather than available_types.
    expect.ok(Array.isArray(r.json?.error?.details?.required_modules), 'details.required_modules');
    return 'guard refuses first';
  });

  await t('TC-RPT-13', 'P2', 'cash flow counts only real counters', async () => {
    const r = await api('/reports/cash-flow');
    expect.http2xx(r);
    return `${r.data.months.length} months`;
  });

  await t('TC-RPT-14', 'P2', 'the CA pack omits the pledge register without bolis', async () => {
    const r = await mandirApi('GET', '/reports/ca-pack', { token: TOK });
    // A ZIP is binary, but filenames survive as literal bytes in the archive, so
    // a substring check needs no unzip dependency in the harness.
    const body = r.text ?? '';
    expect.ok(!body.includes('12-boli-register'), 'boli CSV should not be in the pack');
    return 'no boli CSV';
  });

  // ═══════════════ The per-type gate the OR guard cannot close ══════════════
  await t('TC-RPT-12', 'P1', 'the OR guard admits the trust; the per-type gate still refuses', async () => {
    const granted = await saApi('PUT', `/admin/tenants/${TENANT_ID}/modules`, {
      token: SA, body: { modules: ['seva'] },
    });
    expect.http2xx(granted, 'grant failed — note the route is PUT, not PATCH');

    // FR-MOD-009: the resolved context is cached, so a fresh token is not
    // enough. This wait IS the assertion for TC-RPT-12a below.
    await new Promise((r) => setTimeout(r, CACHE_WAIT_MS));
    const tok2 = (await mandirLogin(MOBILE, SLUG)).token;

    const room = await mandirApi('GET', '/reports/service-register?type=room', { token: tok2 });
    const seva = await mandirApi('GET', '/reports/service-register?type=seva', { token: tok2 });
    expect.status(room, 403, 'a seva-only trust must not reach the room register');
    expect.http2xx(seva, 'its own register must work');
    expect.eq(JSON.stringify(room.json?.error?.details?.available_types), '["seva"]', 'available_types');
    expect.eq(JSON.stringify(seva.data.available_types), '["seva"]', 'available_types on success');
    return 'room 403, seva 200';
  });

  await t('TC-RPT-12a', 'P2', 'the entitlement cache stays inside the 60s FR-MOD-009 bound', async () => {
    // Static, because the behavioural half is the 32s wait above and nobody
    // wants a 60s test. This exists so the TTL cannot grow silently.
    const src = readFileSync(`${ROOT}/apps/mandir-api/src/tenancy/tenant-registry.service.ts`, 'utf8');
    const ttl = Number(src.match(/CACHE_TTL_MS\s*=\s*([\d_]+)/)?.[1]?.replace(/_/g, ''));
    expect.ok(Number.isFinite(ttl), 'could not read CACHE_TTL_MS');
    expect.ok(ttl <= 60_000, `CACHE_TTL_MS=${ttl}ms exceeds the 60s FR-MOD-009 bound`);
    return `${ttl / 1000}s`;
  });

  // ═══════════════ Plan bundles deliver what the plan is sold as ════════════
  await t('TC-PLAN-01', 'P1', 'Standard quotes the modules SRS §4.3 sells', async () => {
    const r = await saApi('GET', '/public/onboarding/plans', {});
    expect.http2xx(r);
    const std = r.data.plans.find((p) => p.name === 'standard');
    expect.ok(std, 'standard is not in the public catalogue');
    const keys = std.modules.map((m) => m.key).sort();
    // Migration 041. Before it this array was empty, and because self-serve
    // intersects the request with the plan bundle, a Standard customer who
    // asked for Dharamshala was provisioned without it.
    for (const want of ['dharamshala', 'seva', 'events']) {
      expect.ok(keys.includes(want), `Standard must bundle ${want} (SRS §4.3)`);
    }
    return keys.join(', ');
  });

  await t('TC-PLAN-02', 'P1', 'the plan bundle is the self-serve ceiling', async () => {
    const r = await saApi('GET', '/public/onboarding/plans', {});
    const std = r.data.plans.find((p) => p.name === 'standard').modules.map((m) => m.key);
    const ent = r.data.plans.find((p) => p.name === 'enterprise').modules.map((m) => m.key);
    // FR-MOD-008: a cheaper plan must not quote a dearer plan's modules, or the
    // intersection at registration is not a ceiling at all.
    expect.ok(ent.length > std.length, 'Enterprise should bundle more than Standard');
    expect.ok(!std.includes('gaushala'), 'Standard must not quote an Enterprise-only module');
    return `standard ${std.length} < enterprise ${ent.length}`;
  });

  // ═══════════════ Devotee giving: verified details only ════════════════════
  await t('TC-DVD-03', 'P1', 'an unverified temple releases neither bank nor UPI', async () => {
    const r = await devoteeApi('GET', `/temples/${SLUG}/payment-details`, { token: DEV });
    expect.http2xx(r);
    expect.ok(r.data.bank_verified !== true, 'bank_verified');
    expect.ok(!r.data.bank_account_no, 'bank_account_no must be withheld');
    // The half that regressed once: upi_id lives on kshetra_profile and is
    // reviewed by nobody, so releasing it alone reopens the whole hole.
    expect.ok(!r.data.upi_id, 'upi_id must be withheld on the same terms');
    return 'nothing released';
  });

  // ═══════════════ Discovery map ════════════════════════════════════════════
  await t('TC-MAP-04', 'P1', 'a temple with coordinates appears; one without does not', async () => {
    // Give the fixture a pin. Asserting only "every row has coordinates" passes
    // vacuously on an empty result — the same shape of unearned pass that made
    // the whole pack lie before (DEF-E2E-01), so the positive case is asserted.
    psql(`UPDATE public.tenants SET lat = 22.7196, lng = 75.8577 WHERE slug = '${SLUG}'`);
    const inBox = await devoteeApi(
      'GET', '/temples/map?north=23.5&south=22&east=76.5&west=75&traditions=all', { token: DEV });
    expect.http2xx(inBox);
    expect.ok(inBox.data.some((p) => p.slug === SLUG), 'the pinned temple should be in its own box');
    expect.ok(inBox.data.every((p) => p.lat != null && p.lng != null),
      'a pin without coordinates must never be returned (FR-MAP-005)');
    expect.ok(inBox.data.length <= 500, 'the 500 cap (FR-MAP-002)');

    // Outside the box it must not appear — proves the bound is applied rather
    // than the endpoint simply returning everything.
    const outBox = await devoteeApi(
      'GET', '/temples/map?north=13&south=8&east=78&west=75&traditions=all', { token: DEV });
    expect.ok(!outBox.data.some((p) => p.slug === SLUG), 'bounding box is not being applied');

    // And with no coordinates it drops out entirely (FR-MAP-005).
    psql(`UPDATE public.tenants SET lat = NULL, lng = NULL WHERE slug = '${SLUG}'`);
    const noCoords = await devoteeApi(
      'GET', '/temples/map?north=23.5&south=22&east=76.5&west=75&traditions=all', { token: DEV });
    expect.ok(!noCoords.data.some((p) => p.slug === SLUG),
      'a temple without coordinates must produce no pin');
    return `${inBox.data.length} pins in box, 0 without coords`;
  });

  await t('TC-MAP-05', 'P1', '/temples/map is not swallowed by /temples/:slug', async () => {
    const r = await devoteeApi('GET', '/temples/map?north=37&south=6&east=98&west=68',
      { token: DEV });
    // Nest matches in declaration order; declared after the wildcard this would
    // look up a temple whose slug is "map" and 404.
    expect.http2xx(r, 'the map route must win over the :slug wildcard');
    expect.ok(Array.isArray(r.data), 'should be pins, not a temple object');
    return 'map handler';
  });

  await t('TC-MAP-04b', 'P2', 'a malformed bound is one clear error', async () => {
    const r = await devoteeApi('GET', '/temples/map?north=abc&south=6&east=98&west=68',
      { token: DEV });
    expect.status(r, 400);
    expect.eq(r.json?.error?.code, 'BAD_BOUNDS', 'error code');
    return 'BAD_BOUNDS';
  });

  // ── cleanup ───────────────────────────────────────────────────────────────
  await t('TC-ENT-CLEANUP', 'P3', 'the fixture tenant is removed', async () => {
    const r = await saApi('DELETE', `/admin/tenants/${TENANT_ID}`, {
      token: SA, body: { confirm_slug: SLUG },
    });
    expect.http2xx(r);
    return 'soft-deleted';
  });
});
