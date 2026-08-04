/**
 * Functional API E2E — per-tenant module entitlements (migration 031).
 *
 * Not every tenant is a full temple: some trusts run only a Bhojanshala, only a
 * Gaushala, or a private Dharamshala. This suite provisions a throwaway
 * donation-only mandir and proves that:
 *
 *   - the modules it was NOT given are refused server-side (403 MODULE_NOT_ENABLED)
 *   - the generic resource registry is not a way around that
 *   - core modules cannot be revoked, and still work
 *   - Dashboard and Reports omit the streams it does not run — no zero rows
 *   - granting a module later makes it work, without a redeploy
 *
 *   superadmin-api  (:3105) — the registry, presets and per-tenant grants
 *   mandir-api (:3106) — enforcement, and the derived surfaces
 *
 * Re-run `superadmin-api/scripts/seed-qa-tester.ts` first — the QA super admin
 * enrols TOTP during the run and enrolment is one-shot by design.
 *
 *   node e2e/full/modules-suite.mjs
 *
 * Emits one line per case: PASS/FAIL <MOD-ID>. Exit 1 if any P1 fails.
 */
import { superAdminLogin as saLogin, QA_ID, QA_PASSWORD } from './sa-auth.mjs';

const SA = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';
const MANDIR = process.env.E2E_API ?? 'http://localhost:3106/api/v1';

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function http(base, method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, data: json?.data, code: json?.error?.code ?? json?.code };
}
const sa = (m, p, o) => http(SA, m, p, o);
const md = (m, p, o) => http(MANDIR, m, p, o);
const rowsOf = (r) => (Array.isArray(r.data) ? r.data : r.data?.rows ?? []);

// TOTP enrolment is one-shot, so the secret is cached by sa-auth.mjs; without
// that only the first suite in a run could log in as super admin.
const superAdminLogin = () => saLogin(sa);

async function mandirLogin(mobile, tenantSlug) {
  const send = await md('POST', '/auth/send-otp', { body: { mobile } });
  const otp = send.data?.dev_otp;
  if (!otp) throw new Error(`no dev_otp for ${mobile}: ${JSON.stringify(send.json)}`);
  const ver = await md('POST', '/auth/verify-otp', { body: { mobile, otp } });
  const sel = await md('POST', '/auth/select-tenant', {
    body: { selection_token: ver.data?.selection_token, tenant_slug: tenantSlug },
  });
  if (!sel.data?.access_token) throw new Error(`select-tenant failed: ${JSON.stringify(sel.json)}`);
  return sel.data;
}

async function run() {
  console.log(`\n=== Module entitlements — SA ${SA} / mandir ${MANDIR} ===\n`);
  const ADMIN = await superAdminLogin();

  // ---------- the registry ----------
  const registry = await sa('GET', '/admin/modules', { token: ADMIN });
  const mods = registry.data?.modules ?? [];
  record('MOD-01', 'P1', 'registry lists core and optional modules',
    registry.status === 200 && mods.some((m) => m.is_core) && mods.some((m) => !m.is_core),
    `core=${mods.filter((m) => m.is_core).length} optional=${mods.filter((m) => !m.is_core).length}`);
  record('MOD-02', 'P1', 'onboarding presets are offered',
    (registry.data?.presets ?? []).some((p) => p.key === 'donation_only') &&
    (registry.data?.presets ?? []).some((p) => p.key === 'full_mandir'),
    `presets=${(registry.data?.presets ?? []).map((p) => p.key).join(',')}`);

  // ---------- a donation-only trust ----------
  const suffix = String(Date.now()).slice(-6);
  const slug = `mod-qa-trust-${suffix}`;
  const adminMobile = `+9198${String(20000000 + Math.floor(Math.random() * 9999999))}`;
  const created = await sa('POST', '/admin/tenants', {
    token: ADMIN,
    body: {
      name: `MOD QA Trust ${suffix}`, slug, plan: 'standard', tenancy_tier: 'pooled',
      module_preset: 'donation_only',
      admin_contact: { name: 'MOD QA Admin', mobile: adminMobile, email: `mod-qa-${suffix}@example.com` },
      address: { line1: '1 Test Road', state: 'Maharashtra', city: 'Pune', pincode: '411001' },
    },
  });
  record('MOD-03', 'P1', 'a donation-only trust can be onboarded',
    created.status === 201, `status=${created.status} ${created.code ?? ''} modules=${JSON.stringify(created.data?.modules)}`);
  if (created.status !== 201) {
    console.log('\nAborting — onboarding failed:', JSON.stringify(created.json));
    process.exit(1);
  }
  const tenantId = created.data.id;
  record('MOD-04', 'P1', 'the donation-only preset grants no optional modules',
    Array.isArray(created.data.modules) && created.data.modules.length === 0,
    `modules=${JSON.stringify(created.data.modules)}`);

  const view = await sa('GET', `/admin/tenants/${tenantId}/modules`, { token: ADMIN });
  record('MOD-05', 'P1', 'core modules are held implicitly, not granted',
    (view.data?.core_modules ?? []).includes('donations') &&
    !(view.data?.tenant_modules ?? []).includes('donations'),
    `core=${(view.data?.core_modules ?? []).length} tenant=${JSON.stringify(view.data?.tenant_modules)}`);

  // ---------- enforcement ----------
  const session = await mandirLogin(adminMobile, slug);
  const TOKEN = session.access_token;
  record('MOD-06', 'P1', 'login returns the module list for offline caching',
    Array.isArray(session.effective_modules) && session.effective_modules.includes('donations'),
    `n=${session.effective_modules?.length}`);

  const rooms = await md('GET', '/rooms/availability?date=2026-08-05', { token: TOKEN });
  record('MOD-07', 'P1', 'an ungranted module is refused with MODULE_NOT_ENABLED',
    rooms.status === 403 && rooms.code === 'MODULE_NOT_ENABLED', `status=${rooms.status} code=${rooms.code}`);

  const booking = await md('POST', '/room-bookings', { token: TOKEN, body: { room_id: '00000000-0000-4000-8000-000000000001' } });
  record('MOD-08', 'P1', 'writes to an ungranted module are refused too',
    booking.status === 403 && booking.code === 'MODULE_NOT_ENABLED', `status=${booking.status} code=${booking.code}`);

  // The generic CRUD surface is the easiest way around a route decorator.
  const regRooms = await md('GET', '/rooms', { token: TOKEN });
  record('MOD-09', 'P1', 'the resource registry is not a way around the gate',
    regRooms.status === 403 && regRooms.code === 'MODULE_NOT_ENABLED', `status=${regRooms.status} code=${regRooms.code}`);

  const regWrite = await md('POST', '/rooms', { token: TOKEN, body: { room_number: '101' } });
  record('MOD-10', 'P1', 'registry writes are gated as well as reads',
    regWrite.status === 403 && regWrite.code === 'MODULE_NOT_ENABLED', `status=${regWrite.status}`);

  const bin = await md('GET', '/recycle-bin', { token: TOKEN });
  const binResources = new Set(rowsOf(bin).map((r) => r.resource));
  record('MOD-11', 'P2', 'the recycle bin does not leak ungranted resources',
    bin.status === 200 && !binResources.has('rooms') && !binResources.has('halls'),
    `resources=${[...binResources].join(',') || 'none'}`);

  const donations = await md('GET', '/donations?limit=5', { token: TOKEN });
  record('MOD-12', 'P1', 'core modules still work — donations is never gated',
    donations.status === 200, `status=${donations.status}`);

  const categories = await md('GET', '/donation-categories?limit=5', { token: TOKEN });
  record('MOD-13', 'P1', 'core registry resources are not gated',
    categories.status === 200, `status=${categories.status}`);

  // ---------- derived surfaces ----------
  const dash = await md('GET', '/dashboard', { token: TOKEN });
  record('MOD-14', 'P1', 'the dashboard omits tiles for modules the trust lacks',
    dash.status === 200 && !('rooms_available' in (dash.data ?? {})) && !('bolis' in (dash.data ?? {})),
    `tiles=${JSON.stringify(dash.data?.tiles)}`);
  record('MOD-15', 'P1', 'quick actions do not link to a 403',
    (dash.data?.quick_actions ?? []).length === 0, `actions=${JSON.stringify(dash.data?.quick_actions)}`);

  const summary = await md('GET', '/reports/collection-summary', { token: TOKEN });
  const streams = summary.data?.included_streams ?? [];
  record('MOD-16', 'P1', 'collection summary omits disabled streams entirely (no zero rows)',
    summary.status === 200 && streams.includes('donations_paise') &&
    !streams.includes('room_advance_paise') && !streams.includes('seva_paise') &&
    !('seva_paise' in (summary.data ?? {})),
    `included=${JSON.stringify(streams)}`);

  const daily = await md('GET', '/reports/daily-collection', { token: TOKEN });
  record('MOD-17', 'P1', 'daily collection is filtered the same way',
    daily.status === 200 && !('prasad_paise' in (daily.data ?? {})),
    `included=${JSON.stringify(daily.data?.included_streams)}`);

  const boliReport = await md('GET', '/reports/boli-register', { token: TOKEN });
  record('MOD-18', 'P1', 'module-specific reports are hidden with their module',
    boliReport.status === 403 && boliReport.code === 'MODULE_NOT_ENABLED', `status=${boliReport.status}`);

  const donationRegister = await md('GET', '/reports/donation-register', { token: TOKEN });
  record('MOD-19', 'P1', 'core reports still render',
    donationRegister.status === 200, `status=${donationRegister.status}`);

  // All 8 Accounts statements are double-entry over whatever exists — correct
  // for any module mix, so they must never be gated.
  const statements = ['day-book', 'ledger', 'trial-balance', 'balance-sheet',
                      'income-expenditure', 'receipts-payments', 'cash-book', 'account-balances'];
  const acct = [];
  for (const st of statements) {
    const r = await md('GET', `/accounting/${st}`, { token: TOKEN });
    acct.push(`${st}:${r.status}`);
  }
  record('MOD-20', 'P1', 'every Accounts statement still renders for a donation-only trust',
    acct.every((a) => a.endsWith(':200')), acct.join(' '));

  // ---------- granting later (the upsell path) ----------
  const grant = await sa('PUT', `/admin/tenants/${tenantId}/modules`, {
    token: ADMIN, body: { modules: ['dharamshala'], note: 'E2E upsell' },
  });
  record('MOD-21', 'P1', 'a module can be granted after onboarding',
    grant.status === 200 && (grant.data?.modules ?? []).includes('dharamshala'),
    `modules=${JSON.stringify(grant.data?.modules)}`);
  record('MOD-22', 'P2', 'granting surfaces what still needs setting up',
    !!grant.data?.setup_checklist?.dharamshala?.length,
    `steps=${grant.data?.setup_checklist?.dharamshala?.length ?? 0}`);

  // mandir-api caches the tenant context for 30s and a grant is made in a
  // DIFFERENT process, so there is a bounded propagation delay with no shared
  // invalidation to shortcut it. Poll rather than assume, and report how long it
  // really took — that number is the promise the console makes to an operator.
  const startedAt = Date.now();
  let session2 = null;
  let rooms2 = { status: 0 };
  for (let i = 0; i < 15; i++) {
    session2 = await mandirLogin(adminMobile, slug);
    rooms2 = await md('GET', '/rooms', { token: session2.access_token });
    if (rooms2.status === 200) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  const propagationMs = Date.now() - startedAt;
  record('MOD-23', 'P1', 'the newly granted module works within the cache window',
    rooms2.status === 200 && propagationMs < 45_000,
    `status=${rooms2.status} after ${(propagationMs / 1000).toFixed(1)}s`);

  const dash2 = await md('GET', '/dashboard', { token: session2.access_token });
  record('MOD-24', 'P1', 'the dashboard picks the new tile up without a redeploy',
    'rooms_available' in (dash2.data ?? {}), `tiles=${JSON.stringify(dash2.data?.tiles)}`);

  // ---------- guard rails ----------
  const revokeCore = await sa('PUT', `/admin/tenants/${tenantId}/modules`, {
    token: ADMIN, body: { modules: ['donations'] },
  });
  record('MOD-25', 'P1', 'a core module cannot be granted/revoked here — 400 CORE_MODULE',
    revokeCore.status === 400 && revokeCore.code === 'CORE_MODULE', `status=${revokeCore.status} code=${revokeCore.code}`);

  const unknown = await sa('PUT', `/admin/tenants/${tenantId}/modules`, {
    token: ADMIN, body: { modules: ['not-a-real-module'] },
  });
  record('MOD-26', 'P2', 'an unknown module key is refused',
    unknown.status === 400, `status=${unknown.status}`);

  const deps = await sa('PUT', `/admin/tenants/${tenantId}/modules`, {
    token: ADMIN, body: { modules: ['gaushala'] },
  });
  record('MOD-27', 'P1', 'dependencies are expanded, never left dangling',
    deps.status === 200 && (deps.data?.effective_modules ?? []).includes('donations'),
    `modules=${JSON.stringify(deps.data?.modules)}`);

  // ---------- cleanup ----------
  const del = await sa('DELETE', `/admin/tenants/${tenantId}`, { token: ADMIN, body: { confirm_slug: slug } });
  record('MOD-28', 'P3', 'throwaway trust soft-deleted (cleanup)',
    del.status === 200 || del.status === 204, `status=${del.status}`);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== MODULES SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
