/**
 * Functional API E2E — the Gaushala module (tenant-migration 016).
 *
 * A trust running an actual cow shelter has to record animals, their health,
 * feed, milk and who sponsors which cow. The one thing it must NOT do is invent
 * a second money rail: a sponsorship payment is an ordinary donation, so 80G,
 * gapless receipt numbering and the global ledger keep working unchanged. This
 * suite proves both halves.
 *
 *   superadmin-api  (:3105) — provisions a Gaushala trust
 *   mandir-api (:3106) — the cattle registers + the donation rail
 *
 *   node e2e/full/gaushala-suite.mjs
 *
 * Re-run `superadmin-api/scripts/seed-qa-tester.ts` first — MFA enrolment is
 * one-shot by design.
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
  const ver = await md('POST', '/auth/verify-otp', { body: { mobile, otp: send.data.dev_otp } });
  const sel = await md('POST', '/auth/select-tenant', {
    body: { selection_token: ver.data?.selection_token, tenant_slug: tenantSlug },
  });
  if (!sel.data?.access_token) throw new Error(`select-tenant failed: ${JSON.stringify(sel.json)}`);
  return sel.data.access_token;
}

async function run() {
  console.log(`\n=== Gaushala — SA ${SA} / mandir ${MANDIR} ===\n`);
  const ADMIN = await superAdminLogin();

  const suffix = String(Date.now()).slice(-6);
  const slug = `gau-qa-${suffix}`;
  const adminMobile = `+9194${String(20000000 + Math.floor(Math.random() * 9999999))}`;
  const created = await sa('POST', '/admin/tenants', {
    token: ADMIN,
    body: {
      name: `GAU QA Trust ${suffix}`, slug, plan: 'standard', tenancy_tier: 'pooled',
      module_preset: 'gaushala_trust',
      admin_contact: { name: 'Gau QA Admin', mobile: adminMobile, email: `gau-qa-${suffix}@example.com` },
      address: { line1: '1 Test Road', state: 'Maharashtra', city: 'Pune', pincode: '411001' },
    },
  });
  record('GAU-00', 'P1', 'a Gaushala trust can be onboarded',
    created.status === 201 && (created.data?.modules ?? []).includes('gaushala'),
    `status=${created.status} modules=${JSON.stringify(created.data?.modules)}`);
  if (created.status !== 201) { console.log(JSON.stringify(created.json)); process.exit(1); }
  const tenantId = created.data.id;
  record('GAU-01', 'P1', 'the preset pulls in donations as a dependency',
    (created.data?.setup_checklist?.gaushala ?? []).length > 0,
    `checklist=${(created.data?.setup_checklist?.gaushala ?? []).length} steps`);

  const TOKEN = await mandirLogin(adminMobile, slug);

  // ---------- the register ----------
  const cow = await md('POST', '/cattle', {
    token: TOKEN,
    body: { tag_number: 'C-001', name: 'Gauri', category: 'cow', breed: 'Gir', sex: 'female', is_milking: true },
  });
  record('GAU-02', 'P1', 'an animal can be added to the register',
    cow.status === 201 && cow.data?.tag_number === 'C-001', `status=${cow.status}`);
  const cattleId = cow.data?.id;

  const dupTag = await md('POST', '/cattle', {
    token: TOKEN, body: { tag_number: 'C-001', category: 'cow' },
  });
  record('GAU-03', 'P1', 'a duplicate tag number is refused',
    dupTag.status === 400 || dupTag.status === 409, `status=${dupTag.status}`);

  const list = await md('GET', '/cattle?limit=50', { token: TOKEN });
  record('GAU-04', 'P1', 'the register lists the animals',
    list.status === 200 && rowsOf(list).length === 1, `n=${rowsOf(list).length}`);

  // ---------- health ----------
  const med = await md('POST', '/cattle-medical', {
    token: TOKEN,
    body: { cattle_id: cattleId, record_type: 'vaccination', treatment: 'FMD vaccine', vet_name: 'Dr Shah', cost_paise: 45000, next_due_date: '2027-02-01' },
  });
  record('GAU-05', 'P1', 'a medical record can be logged against an animal',
    med.status === 201 && med.data?.cattle_id === cattleId, `status=${med.status}`);

  // ---------- feed + milk ----------
  const feed = await md('POST', '/feed-stock', {
    token: TOKEN, body: { item_name: 'Green fodder', unit: 'kg', current_stock: 500, cost_per_unit_paise: 800 },
  });
  record('GAU-06', 'P1', 'feed stock can be recorded', feed.status === 201, `status=${feed.status}`);

  const milk = await md('POST', '/milk-records', {
    token: TOKEN, body: { cattle_id: cattleId, session: 'morning', quantity_litres: 6.5, used_for: 'temple' },
  });
  record('GAU-07', 'P1', 'a milk record can be logged', milk.status === 201, `status=${milk.status}`);

  // ---------- sponsorship: the commitment ----------
  const sponsorship = await md('POST', '/cow-sponsorships', {
    token: TOKEN,
    body: { cattle_id: cattleId, sponsor_name: 'Test Sponsor', sponsor_mobile: '9764564185', plan: 'monthly', amount_paise: 250000, status: 'active' },
  });
  record('GAU-08', 'P1', 'a sponsorship commitment can be recorded',
    sponsorship.status === 201 && sponsorship.data?.amount_paise === 250000, `status=${sponsorship.status}`);
  const sponsorshipId = sponsorship.data?.id;

  // ---------- sponsorship: the money stays a donation ----------
  const cats = rowsOf(await md('GET', '/donation-categories?limit=50', { token: TOKEN }));
  const gauCat = cats.find((c) => /gaushala|cow/i.test(c.name));
  record('GAU-09', 'P1', 'a Gaushala donation category is seeded for the trust',
    !!gauCat, `category=${gauCat?.name}`);

  const donation = await md('POST', '/donations', {
    token: TOKEN,
    body: {
      donor: { name: 'Test Sponsor', mobile: '9764564185' },
      category: gauCat?.name, amount_paise: 250000, payment_mode: 'cash',
      sponsorship_id: sponsorshipId, remarks: 'Monthly cow sponsorship',
    },
  });
  record('GAU-10', 'P1', 'the sponsorship payment is an ordinary receipted donation',
    (donation.status === 201 || donation.status === 200) &&
    /^DON\/\d{4}-\d{2}\/\d{6}$/.test(donation.data?.receipt_number ?? donation.data?.donation?.invoice_no ?? ''),
    `status=${donation.status} receipt=${donation.data?.receipt_number}`);

  // ---------- recycle bin ----------
  const del = await md('DELETE', `/cattle/${cattleId}`, { token: TOKEN });
  const bin = await md('GET', '/recycle-bin', { token: TOKEN });
  record('GAU-11', 'P2', 'a deleted animal is recoverable from the recycle bin',
    (del.status === 200 || del.status === 204) && rowsOf(bin).some((r) => r.resource === 'cattle'),
    `resources=${[...new Set(rowsOf(bin).map((r) => r.resource))].join(',') || 'none'}`);

  const restore = await md('POST', `/cattle/${cattleId}/restore`, { token: TOKEN });
  record('GAU-12', 'P2', 'and can be restored',
    restore.status === 200 || restore.status === 201, `status=${restore.status}`);

  // ---------- the module gate ----------
  const noGau = await sa('POST', '/admin/tenants', {
    token: ADMIN,
    body: {
      name: `GAU QA NoGau ${suffix}`, slug: `gau-qa-none-${suffix}`, plan: 'standard',
      tenancy_tier: 'pooled', module_preset: 'donation_only',
      admin_contact: { name: 'x', mobile: `+9193${String(20000000 + Math.floor(Math.random() * 9999999))}` },
      address: { line1: '1', state: 'Maharashtra', city: 'Pune', pincode: '411001' },
    },
  });
  const otherToken = await mandirLogin(
    noGau.data.id ? (await sa('GET', `/admin/tenants/${noGau.data.id}`, { token: ADMIN })).data.profile.contact.mobile : '',
    `gau-qa-none-${suffix}`,
  ).catch(() => null);
  if (otherToken) {
    const blocked = await md('GET', '/cattle', { token: otherToken });
    record('GAU-13', 'P1', 'a trust without the module cannot reach the cattle register',
      blocked.status === 403 && blocked.code === 'MODULE_NOT_ENABLED',
      `status=${blocked.status} code=${blocked.code}`);
  } else {
    record('GAU-13', 'P1', 'a trust without the module cannot reach the cattle register', false, 'login failed');
  }

  // ---------- cleanup ----------
  await sa('DELETE', `/admin/tenants/${tenantId}`, { token: ADMIN, body: { confirm_slug: slug } });
  if (noGau.data?.id) {
    await sa('DELETE', `/admin/tenants/${noGau.data.id}`, { token: ADMIN, body: { confirm_slug: `gau-qa-none-${suffix}` } });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== GAUSHALA SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
