/**
 * Functional API E2E — sect (sampradaya) capture and scoping, migration 032.
 *
 * Digambar and Shwetambar are distinct traditions. This suite proves the two
 * things that make the rollout safe:
 *
 *   FLAG OFF (default) — capture works and NOTHING a user sees changes. Run
 *                        with the APIs started normally.
 *   FLAG ON            — devotees see only their own tradition, non-Jain trusts
 *                        stay visible, and people who never set a sect still see
 *                        everything. Run with SECT_FILTER_ENFORCED=true on
 *                        superadmin-api + devotee-api, and pass E2E_SECT=on.
 *
 * The second mode is the one that would empty the app if the predicate were
 * wrong, so it asserts the "unknown is not excluded" rule explicitly rather
 * than only the happy path.
 *
 *   node e2e/full/sect-suite.mjs             # flag-off expectations
 *   E2E_SECT=on node e2e/full/sect-suite.mjs # flag-on expectations
 *
 * Re-run `superadmin-api/scripts/seed-qa-tester.ts` first — MFA enrolment is
 * one-shot by design.
 */
import { superAdminLogin as saLogin, QA_ID, QA_PASSWORD } from './sa-auth.mjs';

const SA = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';
const DEVOTEE = process.env.E2E_DEVOTEE_API ?? 'http://localhost:3107/api/v1';
const ENFORCED = (process.env.E2E_SECT ?? 'off') === 'on';

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
const dv = (m, p, o) => http(DEVOTEE, m, p, o);
const rowsOf = (r) => (Array.isArray(r.data) ? r.data : r.data?.rows ?? []);

// TOTP enrolment is one-shot, so the secret is cached by sa-auth.mjs; without
// that only the first suite in a run could log in as super admin.
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
  console.log(`\n=== Sect scoping — SA ${SA} / devotee ${DEVOTEE} — expecting filter ${ENFORCED ? 'ON' : 'OFF'} ===\n`);
  const ADMIN = await superAdminLogin();
  /** Provisioned only in enforced mode; collected so cleanup stays unconditional. */
  const stayTemples = [];

  // ---------- capture ----------
  const dig = await makeTemple(ADMIN, 'dig', { sect: 'digambar' });
  const shw = await makeTemple(ADMIN, 'shw', { sect: 'shwetambar' });
  const unset = await makeTemple(ADMIN, 'unset');
  const hindu = await makeTemple(ADMIN, 'hindu', { templeType: 'hindu' });
  const digSant = await makeSant(ADMIN, 'dig', { sect: 'digambar' });
  const shwSant = await makeSant(ADMIN, 'shw', { sect: 'shwetambar' });
  const unsetSant = await makeSant(ADMIN, 'unset');

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

  // ---------- the readiness report (the gate for enabling the filter) ----------
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
  record('SECT-07', 'P1', 'the report reflects the live flag state',
    readiness.data?.enforced === ENFORCED, `enforced=${readiness.data?.enforced}`);

  // ---------- backfill ----------
  const fix = await sa('PATCH', `/admin/tenants/${unset.id}/sect`, {
    token: ADMIN, body: { sect: 'digambar', sub_sect: 'Bisapanth' },
  });
  record('SECT-08', 'P1', 'a temple’s sect can be backfilled from the report',
    fix.status === 200 && fix.data?.sect === 'digambar', `sect=${fix.data?.sect}`);

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
  if (hinduWithSect.status === 201) stayTemples.push({ id: hinduWithSect.data.id, slug: hinduWithSect.data.slug });

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

  // ---------- what the devotee actually sees ----------
  const dirDig = rowsOf(await dv('GET', '/temples/directory?limit=100', { token: DIG_TOKEN }));
  const sawShw = dirDig.some((t) => t.id === shw.id);
  const sawDig = dirDig.some((t) => t.id === dig.id);
  const sawHindu = dirDig.some((t) => t.id === hindu.id);

  if (!ENFORCED) {
    record('SECT-12', 'P1', 'FLAG OFF: nothing is filtered — the other tradition is still visible',
      sawShw && sawDig, `digambar=${sawDig} shwetambar=${sawShw}`);
    const donate = await dv('POST', '/me/donate', {
      token: DIG_TOKEN, body: { tenant_slug: shw.slug, category: 'general', amount_paise: 10000 },
    });
    record('SECT-13', 'P1', 'FLAG OFF: a cross-tradition donation is allowed',
      donate.status === 200 || donate.status === 201, `status=${donate.status} code=${donate.code ?? ''}`);
  } else {
    record('SECT-12', 'P1', 'FLAG ON: only the devotee’s own tradition is listed',
      sawDig && !sawShw, `digambar=${sawDig} shwetambar=${sawShw}`);
    record('SECT-13', 'P1', 'FLAG ON: a non-Jain trust is still visible — sect does not apply to it',
      sawHindu, `hindu=${sawHindu}`);

    const donate = await dv('POST', '/me/donate', {
      token: DIG_TOKEN, body: { tenant_slug: shw.slug, category: 'general', amount_paise: 10000 },
    });
    record('SECT-14', 'P1', 'FLAG ON: a cross-tradition donation is refused with SECT_MISMATCH',
      donate.status === 403 && donate.code === 'SECT_MISMATCH', `status=${donate.status} code=${donate.code}`);

    const ownDonate = await dv('POST', '/me/donate', {
      token: DIG_TOKEN, body: { tenant_slug: dig.slug, category: 'general', amount_paise: 10000 },
    });
    record('SECT-15', 'P1', 'FLAG ON: donating within your own tradition still works',
      ownDonate.status === 200 || ownDonate.status === 201, `status=${ownDonate.status}`);

    // The rule that makes a partial backfill safe.
    const dirNone = rowsOf(await dv('GET', '/temples/directory?limit=100', { token: NONE_TOKEN }));
    record('SECT-16', 'P1', 'FLAG ON: a devotee with NO sect still sees every tradition',
      dirNone.some((t) => t.id === dig.id) && dirNone.some((t) => t.id === shw.id),
      `n=${dirNone.length}`);

    const noSectDonate = await dv('POST', '/me/donate', {
      token: NONE_TOKEN, body: { tenant_slug: shw.slug, category: 'general', amount_paise: 10000 },
    });
    record('SECT-17', 'P1', 'FLAG ON: a devotee with no sect can still donate anywhere',
      noSectDonate.status === 200 || noSectDonate.status === 201, `status=${noSectDonate.status}`);
  }

  // ---------- clearing a sect (both modes) ----------
  // "Prefer not to say" sends '' — @IsOptional() only skips null/undefined, so
  // this 400'd and a devotee stayed pinned to whatever sect they first picked.
  // Under enforcement that is also the only tradition they can see or give to,
  // so it has to be reversible without a support ticket.
  await dv('PATCH', '/me', { token: DIG_TOKEN, body: { sect: 'digambar' } });
  const cleared = await dv('PATCH', '/me', { token: DIG_TOKEN, body: { sect: '' } });
  const clearedMe = await dv('GET', '/me', { token: DIG_TOKEN });
  record('SECT-18', 'P1', 'a devotee can go back to "Prefer not to say"',
    cleared.status === 200 && !clearedMe.data?.sect,
    `status=${cleared.status} sect=${clearedMe.data?.sect ?? 'null'}`);
  await dv('PATCH', '/me', { token: DIG_TOKEN, body: { sect: 'digambar' } });

  record('SECT-19', 'P1', 'a sant’s sampradaya is captured by the super admin',
    digSant.sect === 'digambar', `sect=${digSant.sect}`);

  // ---------- the sant directory (documented as scoped, never asserted) ----------
  const santsDig = rowsOf(await dv('GET', '/sant?limit=100', { token: DIG_TOKEN }));
  const sawDigSant = santsDig.some((s) => s.id === digSant.id);
  const sawShwSant = santsDig.some((s) => s.id === shwSant.id);
  const sawUnsetSant = santsDig.some((s) => s.id === unsetSant.id);

  if (!ENFORCED) {
    record('SECT-20', 'P1', 'FLAG OFF: the sant directory is not filtered either',
      sawDigSant && sawShwSant, `digambar=${sawDigSant} shwetambar=${sawShwSant}`);
  } else {
    record('SECT-20', 'P1', 'FLAG ON: the sant directory shows only the viewer’s tradition',
      sawDigSant && !sawShwSant, `digambar=${sawDigSant} shwetambar=${sawShwSant}`);
    // Ascetics have no "not applicable" case, so a NULL is genuinely
    // "not captured yet" and must stay visible.
    record('SECT-21', 'P1', 'FLAG ON: a sant with no recorded sect is still listed',
      sawUnsetSant, `unset_sant_visible=${sawUnsetSant}`);
    const santsNone = rowsOf(await dv('GET', '/sant?limit=100', { token: NONE_TOKEN }));
    record('SECT-22', 'P1', 'FLAG ON: a devotee with no sect still sees every tradition’s sants',
      santsNone.some((s) => s.id === digSant.id) && santsNone.some((s) => s.id === shwSant.id),
      `n=${santsNone.length}`);

    // Room booking gates on sect too. That is not in Sect_Segregation.md §5,
    // which lists only directory/sant/donate — booking takes money just as
    // donating does, so it is asserted here rather than left to the code.
    const shwStay = await makeTemple(ADMIN, 'shwstay', { sect: 'shwetambar', preset: 'dharamshala_trust' });
    stayTemples.push(shwStay);
    const avail = await dv(
      'GET',
      `/temples/${shwStay.slug}/rooms/availability?check_in=2026-09-01&check_out=2026-09-02`,
      { token: DIG_TOKEN },
    );
    record('SECT-23', 'P1', 'FLAG ON: booking a room cross-tradition is refused with SECT_MISMATCH',
      avail.status === 403 && avail.code === 'SECT_MISMATCH',
      `status=${avail.status} code=${avail.code}`);
  }

  // ---------- cleanup ----------
  for (const t of [dig, shw, unset, hindu, ...stayTemples]) {
    await sa('DELETE', `/admin/tenants/${t.id}`, { token: ADMIN, body: { confirm_slug: t.slug } });
  }
  for (const s of [digSant, shwSant, unsetSant]) {
    await sa('DELETE', `/admin/sant/${s.id}`, { token: ADMIN });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== SECT SUMMARY (${ENFORCED ? 'enforced' : 'capture-only'}): ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
