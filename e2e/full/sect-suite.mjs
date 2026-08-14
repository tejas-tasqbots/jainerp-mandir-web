/**
 * Functional API E2E — sect (sampradaya) capture and scoping, migration 032.
 *
 * Digambar and Shwetambar are distinct traditions. Since 2026-08-14 the devotee
 * app **scopes discovery to the devotee's own tradition by default** and lets
 * them ask for all of them per request (`traditions=all`). There is no
 * environment flag any more, so there is one mode, not two:
 *
 *   node e2e/full/sect-suite.mjs
 *
 * What this suite is really defending is the pair of rules that keep scoping
 * from hiding real temples from real donors, plus the product rule that giving
 * is never refused:
 *
 *   - a temple or sant with NO recorded sect is visible to every tradition
 *   - a non-Jain trust is visible to everyone (sect does not apply to it)
 *   - a devotee with no sect sees everything
 *   - "All traditions" really does return the other tradition
 *   - a cross-tradition donation and a cross-tradition room booking still work
 *
 * The first four are the ones that would empty somebody's app if the predicate
 * were wrong, and they fail silently — a scoped list looks perfectly healthy.
 *
 * Re-run `superadmin-api/scripts/seed-qa-tester.ts` first if the QA super admin
 * does not exist yet; sa-auth.mjs handles the one-shot MFA enrolment itself.
 */
import { superAdminLogin as saLogin } from './sa-auth.mjs';

const SA = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';
const DEVOTEE = process.env.E2E_DEVOTEE_API ?? 'http://localhost:3107/api/v1';

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
  return {
    status: res.status, json, text,
    data: json?.data, meta: json?.meta,
    code: json?.error?.code ?? json?.code,
  };
}
const sa = (m, p, o) => http(SA, m, p, o);
const dv = (m, p, o) => http(DEVOTEE, m, p, o);
const rowsOf = (r) => (Array.isArray(r.data) ? r.data : r.data?.rows ?? r.data?.stays ?? []);
const idsOf = (r) => rowsOf(r).map((x) => x.id ?? x.tenant_id);

// TOTP enrolment is one-shot, so sa-auth.mjs resets it before each login;
// without that only the first suite in a run could log in as super admin.
const superAdminLogin = () => saLogin(sa);

async function devoteeLogin(mobile) {
  const send = await dv('POST', '/auth/send-otp', { body: { mobile } });
  const otp = send.data?.dev_otp;
  if (!otp) throw new Error(`no dev_otp: ${JSON.stringify(send.json)}`);
  const ver = await dv('POST', '/auth/verify-otp', {
    body: { mobile, otp, device_id: crypto.randomUUID(), device_name: 'e2e', platform: 'web' },
  });
  if (!ver.data?.access_token) throw new Error(`devotee login failed: ${JSON.stringify(ver.json)}`);
  return ver.data.access_token;
}

/** Provision a throwaway temple, optionally of a given sect / temple_type. */
async function makeTemple(token, label, { sect, templeType = 'jain', preset = 'donation_only' } = {}) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(-9);
  const slug = `sect-qa-${label}-${suffix}`;
  const res = await sa('POST', '/admin/tenants', {
    token,
    body: {
      name: `SECT QA ${label} ${suffix}`, slug, plan: 'standard', tenancy_tier: 'pooled',
      temple_type: templeType,
      module_preset: preset,
      ...(sect ? { sect } : {}),
      admin_contact: {
        name: 'Sect QA Admin',
        mobile: `+9197${String(30000000 + Math.floor(Math.random() * 9999999))}`,
        email: `sect-qa-${suffix}@example.com`,
      },
      address: { line1: '1 Test Road', state: 'Maharashtra', city: 'Pune', pincode: '411001' },
    },
  });
  if (res.status !== 201) throw new Error(`provision ${label} failed: ${JSON.stringify(res.json)}`);
  return { id: res.data.id, slug, name: `SECT QA ${label} ${suffix}` };
}

/**
 * Provision a verified sant. Only verified profiles reach the devotee
 * directory (`mp.verified = true`), so an unverified one would be absent for a
 * reason that has nothing to do with sect and would make SECT-19 pass by
 * accident.
 */
async function makeSant(token, label, { sect } = {}) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(-9);
  const res = await sa('POST', '/admin/sant', {
    token,
    body: {
      name: `SECT QA Sant ${label} ${suffix}`,
      type: 'muni',
      samuday: 'Oswal',
      city: 'Pune',
      state: 'Maharashtra',
      verified: true,
      ...(sect ? { sect } : {}),
    },
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`sant ${label} failed: ${JSON.stringify(res.json)}`);
  }
  return { id: res.data.id, sect: res.data.sect ?? null };
}

async function run() {
  console.log(`\n=== Sect scoping — SA ${SA} / devotee ${DEVOTEE} ===\n`);
  const ADMIN = await superAdminLogin();

  // ---------- capture ----------
  const dig = await makeTemple(ADMIN, 'dig', { sect: 'digambar' });
  const shw = await makeTemple(ADMIN, 'shw', { sect: 'shwetambar' });
  const unset = await makeTemple(ADMIN, 'unset');
  const hindu = await makeTemple(ADMIN, 'hindu', { templeType: 'hindu' });
  const shwStay = await makeTemple(ADMIN, 'shwstay', {
    sect: 'shwetambar', preset: 'dharamshala_trust',
  });
  const digSant = await makeSant(ADMIN, 'dig', { sect: 'digambar' });
  const shwSant = await makeSant(ADMIN, 'shw', { sect: 'shwetambar' });
  const unsetSant = await makeSant(ADMIN, 'unset');
  const temples = [dig, shw, unset, hindu, shwStay];

  const digDetail = await sa('GET', `/admin/tenants/${dig.id}`, { token: ADMIN });
  record('SECT-01', 'P1', 'a temple’s sampradaya is captured at onboarding',
    digDetail.data?.sect === 'digambar', `sect=${digDetail.data?.sect}`);

  const unsetDetail = await sa('GET', `/admin/tenants/${unset.id}`, { token: ADMIN });
  record('SECT-02', 'P1', 'sect is optional — onboarding without it succeeds',
    unsetDetail.status === 200 && !unsetDetail.data?.sect, `sect=${unsetDetail.data?.sect ?? 'null'}`);

  const badSect = await sa('POST', '/admin/tenants', {
    token: ADMIN,
    body: {
      name: 'SECT QA bad', slug: `sect-qa-bad-${Date.now()}`, plan: 'standard', tenancy_tier: 'pooled',
      sect: 'sthanakvasi',
      admin_contact: { name: 'x', mobile: '+919700000001' },
      address: { line1: '1', state: 'Maharashtra', city: 'Pune', pincode: '411001' },
    },
  });
  record('SECT-03', 'P2', 'an unknown sect is refused', badSect.status === 400, `status=${badSect.status}`);

  // ---------- the readiness report ----------
  const readiness = await sa('GET', '/admin/sect-readiness', { token: ADMIN });
  record('SECT-04', 'P1', 'the "sect not set" report exists and counts what is outstanding',
    readiness.status === 200 && typeof readiness.data?.outstanding === 'number',
    `outstanding=${readiness.data?.outstanding}`);
  record('SECT-05', 'P1', 'the unset temple is listed as outstanding',
    (readiness.data?.temples?.rows ?? []).some((t) => t.id === unset.id),
    `missing_temples=${readiness.data?.temples?.missing}`);
  record('SECT-06', 'P1', 'a non-Jain trust is NOT outstanding — it has no Jain sect',
    !(readiness.data?.temples?.rows ?? []).some((t) => t.id === hindu.id) &&
    (readiness.data?.temples?.not_applicable ?? 0) >= 1,
    `not_applicable=${readiness.data?.temples?.not_applicable}`);
  // The report names the live model rather than a flag: there is no longer a
  // switch to flip, so `enforced` / `ready_to_enforce` would be describing
  // behaviour the code no longer has.
  record('SECT-07', 'P1', 'the report names the live scoping model',
    readiness.data?.scoping === 'discovery_default', `scoping=${readiness.data?.scoping}`);

  // ---------- backfill ----------
  const fix = await sa('PATCH', `/admin/tenants/${unset.id}/sect`, {
    token: ADMIN, body: { sect: 'digambar', sub_sect: 'Bisapanth' },
  });
  record('SECT-08', 'P1', 'a temple’s sect can be backfilled from the report',
    fix.status === 200 && fix.data?.sect === 'digambar', `sect=${fix.data?.sect}`);
  // Put it back: SECT-14 needs a temple that genuinely has no sect.
  await sa('PATCH', `/admin/tenants/${unset.id}/sect`, { token: ADMIN, body: { sect: null } });

  const hinduFix = await sa('PATCH', `/admin/tenants/${hindu.id}/sect`, {
    token: ADMIN, body: { sect: 'digambar' },
  });
  record('SECT-09', 'P1', 'a non-Jain trust cannot be given a Jain sect',
    hinduFix.status === 400 && hinduFix.code === 'SECT_NOT_APPLICABLE',
    `status=${hinduFix.status} code=${hinduFix.code}`);

  // The same rule at ONBOARDING, not just at backfill. Create used to accept
  // it, so the console could produce exactly the row the backfill screen
  // refuses — reachable by choosing a sect and then switching temple_type,
  // which hides the Sampradaya section without clearing its state.
  const hinduWithSect = await sa('POST', '/admin/tenants', {
    token: ADMIN,
    body: {
      name: `SECT QA hindu-with-sect ${Date.now()}`, slug: `sect-qa-hws-${Date.now()}`,
      plan: 'standard', tenancy_tier: 'pooled', temple_type: 'hindu',
      sect: 'digambar', module_preset: 'donation_only',
      admin_contact: { name: 'x', mobile: `+9197${String(50000000 + Math.floor(Math.random() * 9999999))}` },
      address: { line1: '1', state: 'Maharashtra', city: 'Pune', pincode: '411001' },
    },
  });
  record('SECT-24', 'P1', 'a non-Jain trust cannot be ONBOARDED with a Jain sect either',
    hinduWithSect.status === 400 && hinduWithSect.code === 'SECT_NOT_APPLICABLE',
    `status=${hinduWithSect.status} code=${hinduWithSect.code}`);
  if (hinduWithSect.status === 201) temples.push({ id: hinduWithSect.data.id, slug: hinduWithSect.data.slug });

  // ---------- devotees ----------
  const digDevotee = `98221${String(Math.floor(10000 + Math.random() * 89999))}`;
  const noSectDevotee = `98222${String(Math.floor(10000 + Math.random() * 89999))}`;
  const DIG_TOKEN = await devoteeLogin(digDevotee);
  const NONE_TOKEN = await devoteeLogin(noSectDevotee);

  const setSect = await dv('PATCH', '/me', { token: DIG_TOKEN, body: { name: 'Digambar Devotee', sect: 'digambar' } });
  record('SECT-10', 'P1', 'a devotee records their own sampradaya at registration',
    setSect.status === 200 && setSect.data?.sect === 'digambar', `sect=${setSect.data?.sect}`);

  await dv('PATCH', '/me', { token: NONE_TOKEN, body: { name: 'No Sect Devotee' } });
  const noneMe = await dv('GET', '/me', { token: NONE_TOKEN });
  record('SECT-11', 'P1', 'sect is optional for a devotee too',
    noneMe.status === 200 && !noneMe.data?.sect, `sect=${noneMe.data?.sect ?? 'null'}`);

  // ---------- the temple directory ----------
  const scoped = await dv('GET', '/temples/directory?limit=100', { token: DIG_TOKEN });
  const scopedIds = idsOf(scoped);
  record('SECT-12', 'P1', 'by default a devotee sees their own tradition, not the other',
    scopedIds.includes(dig.id) && !scopedIds.includes(shw.id),
    `digambar=${scopedIds.includes(dig.id)} shwetambar=${scopedIds.includes(shw.id)}`);
  record('SECT-13', 'P1', 'a non-Jain trust is still listed — sect does not apply to it',
    scopedIds.includes(hindu.id), `hindu=${scopedIds.includes(hindu.id)}`);
  // The rule that makes a partial backfill safe: a temple that never told us
  // must not disappear from the tradition it may well belong to.
  record('SECT-14', 'P1', 'a temple with NO recorded sect is still listed',
    scopedIds.includes(unset.id), `unset=${scopedIds.includes(unset.id)}`);

  const all = await dv('GET', '/temples/directory?limit=100&traditions=all', { token: DIG_TOKEN });
  const allIds = idsOf(all);
  record('SECT-15', 'P1', '"All traditions" really does return the other tradition',
    allIds.includes(dig.id) && allIds.includes(shw.id),
    `digambar=${allIds.includes(dig.id)} shwetambar=${allIds.includes(shw.id)}`);

  record('SECT-25', 'P1', 'meta.sect_scope reports what was applied, for the UI switch',
    scoped.meta?.sect_scope?.scope === 'mine' &&
    scoped.meta?.sect_scope?.viewer_sect === 'digambar' &&
    scoped.meta?.sect_scope?.applied === 'digambar' &&
    all.meta?.sect_scope?.scope === 'all' &&
    all.meta?.sect_scope?.applied === null,
    `mine=${JSON.stringify(scoped.meta?.sect_scope)} all=${JSON.stringify(all.meta?.sect_scope)}`);

  const dirNone = idsOf(await dv('GET', '/temples/directory?limit=100', { token: NONE_TOKEN }));
  record('SECT-16', 'P1', 'a devotee with NO sect still sees every tradition',
    dirNone.includes(dig.id) && dirNone.includes(shw.id), `n=${dirNone.length}`);

  // Facets are counted under the same scope as the list they filter: a
  // "Maharashtra (12)" built from both traditions promises rows the scoped
  // list then refuses to return.
  const facets = await dv('GET', '/temples/directory/facets', { token: DIG_TOKEN });
  const facetsAll = await dv('GET', '/temples/directory/facets?traditions=all', { token: DIG_TOKEN });
  const mh = (r) => (r.data?.states ?? []).find((s) => s.value === 'Maharashtra')?.count ?? 0;
  record('SECT-26', 'P2', 'directory facets are counted under the same scope as the list',
    mh(facetsAll) > mh(facets), `scoped=${mh(facets)} all=${mh(facetsAll)}`);

  // ---------- giving is never blocked ----------
  // The point of the whole model: scoping shapes discovery, not what a devotee
  // is allowed to give to. Cross-tradition giving genuinely happens.
  const donate = await dv('POST', '/me/donate', {
    token: DIG_TOKEN, body: { tenant_slug: shw.slug, category: 'general', amount_paise: 10000 },
  });
  record('SECT-17', 'P1', 'a cross-tradition donation is still allowed',
    donate.status === 200 || donate.status === 201, `status=${donate.status} code=${donate.code ?? ''}`);

  const ownDonate = await dv('POST', '/me/donate', {
    token: DIG_TOKEN, body: { tenant_slug: dig.slug, category: 'general', amount_paise: 10000 },
  });
  record('SECT-27', 'P1', 'donating within your own tradition still works',
    ownDonate.status === 200 || ownDonate.status === 201, `status=${ownDonate.status}`);

  // Booking takes money the same way donating does, and is refused the same
  // way: not at all. This 403'd with SECT_MISMATCH under the old hard filter.
  //
  // The dates are computed, not hardcoded: a fixed 2026-09-01 quietly becomes a
  // past date and the window validator rejects it, which would leave this
  // asserting "not SECT_MISMATCH" against a 400 it never reached the sect check
  // to earn. Asserting 200 means the request really did go all the way through.
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const avail = await dv(
    'GET',
    `/temples/${shwStay.slug}/rooms/availability?from=${day(7)}&to=${day(8)}`,
    { token: DIG_TOKEN },
  );
  record('SECT-23', 'P1', 'a cross-tradition room booking is not refused for sect',
    avail.status === 200 && avail.code !== 'SECT_MISMATCH',
    `status=${avail.status} code=${avail.code ?? ''}`);

  // ---------- clearing a sect ----------
  // "Prefer not to say" sends '' — @IsOptional() only skips null/undefined, so
  // this 400'd and a devotee stayed pinned to whatever sect they first picked,
  // which is also the only tradition their app would then lead with.
  const cleared = await dv('PATCH', '/me', { token: DIG_TOKEN, body: { sect: '' } });
  const clearedMe = await dv('GET', '/me', { token: DIG_TOKEN });
  record('SECT-18', 'P1', 'a devotee can go back to "Prefer not to say"',
    cleared.status === 200 && !clearedMe.data?.sect,
    `status=${cleared.status} sect=${clearedMe.data?.sect ?? 'null'}`);
  const afterClear = idsOf(await dv('GET', '/temples/directory?limit=100', { token: DIG_TOKEN }));
  record('SECT-28', 'P1', 'clearing it puts every tradition back',
    afterClear.includes(shw.id), `shwetambar=${afterClear.includes(shw.id)}`);
  await dv('PATCH', '/me', { token: DIG_TOKEN, body: { sect: 'digambar' } });

  // ---------- the sant directory ----------
  record('SECT-19', 'P1', 'a sant’s sampradaya is captured by the super admin',
    digSant.sect === 'digambar', `sect=${digSant.sect}`);

  const santsScoped = idsOf(await dv('GET', '/sant?limit=100', { token: DIG_TOKEN }));
  record('SECT-20', 'P1', 'the sant directory leads with the viewer’s tradition',
    santsScoped.includes(digSant.id) && !santsScoped.includes(shwSant.id),
    `digambar=${santsScoped.includes(digSant.id)} shwetambar=${santsScoped.includes(shwSant.id)}`);
  // Ascetics have no "not applicable" case, so a NULL is genuinely
  // "not captured yet" and must stay visible.
  record('SECT-21', 'P1', 'a sant with no recorded sect is still listed',
    santsScoped.includes(unsetSant.id), `unset_sant=${santsScoped.includes(unsetSant.id)}`);

  const santsAll = idsOf(await dv('GET', '/sant?limit=100&traditions=all', { token: DIG_TOKEN }));
  record('SECT-22', 'P1', '"All traditions" returns the other tradition’s sants too',
    santsAll.includes(digSant.id) && santsAll.includes(shwSant.id), `n=${santsAll.length}`);

  // An explicit sampradaya in the filter row is the devotee choosing one, and
  // must beat the default scoping — otherwise "show me Shwetambar sants"
  // silently returns Digambar ones.
  const santsExplicit = idsOf(
    await dv('GET', '/sant?limit=100&traditions=all&sect=shwetambar', { token: DIG_TOKEN }),
  );
  record('SECT-29', 'P1', 'an explicit sect filter overrides the default scoping',
    santsExplicit.includes(shwSant.id) && !santsExplicit.includes(digSant.id),
    `shwetambar=${santsExplicit.includes(shwSant.id)} digambar=${santsExplicit.includes(digSant.id)}`);

  // ---------- stay search ----------
  const staysScoped = idsOf(await dv('GET', '/stays/search?limit=50', { token: DIG_TOKEN }));
  const staysAll = idsOf(await dv('GET', '/stays/search?limit=50&traditions=all', { token: DIG_TOKEN }));
  record('SECT-30', 'P1', 'stay search is scoped the same way, and opens up on request',
    !staysScoped.includes(shwStay.id) && staysAll.includes(shwStay.id),
    `scoped=${staysScoped.includes(shwStay.id)} all=${staysAll.includes(shwStay.id)}`);

  // ---------- cleanup ----------
  for (const t of temples) {
    await sa('DELETE', `/admin/tenants/${t.id}`, { token: ADMIN, body: { confirm_slug: t.slug } });
  }
  for (const s of [digSant, shwSant, unsetSant]) {
    await sa('DELETE', `/admin/sant/${s.id}`, { token: ADMIN });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== SECT SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
