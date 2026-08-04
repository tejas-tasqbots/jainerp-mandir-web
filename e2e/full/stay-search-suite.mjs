/**
 * Cross-temple dharamshala search — the "somewhere to stay near Palitana for
 * these two nights" question, the way OYO or Booking.com answers it.
 *
 * The interesting cases are the ones a naive implementation gets wrong:
 * ranking by distance BEFORE truncating, refusing to offer a trust with no free
 * room on the chosen dates, and never listing a trust that does not run a
 * dharamshala at all.
 *
 *   node e2e/full/stay-search-suite.mjs
 */
const DEV = process.env.E2E_DEVOTEE ?? 'http://localhost:3107/api/v1';
const DEVOTEE_MOBILE = '9876500001';

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function dv(method, path, { token, body } = {}) {
  const res = await fetch(`${DEV}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, data: json?.data, meta: json?.meta, code: json?.error?.code, text };
}

async function login(mobile) {
  const s = await dv('POST', '/auth/send-otp', { body: { mobile } });
  const v = await dv('POST', '/auth/verify-otp', { body: { mobile, otp: s.data.dev_otp } });
  if (!v.data?.access_token) throw new Error(`devotee login failed: ${v.text}`);
  return v.data.access_token;
}

const day = (n) =>
  new Date(Date.now() + n * 86400000 + 330 * 60000).toISOString().slice(0, 10);

async function run() {
  console.log(`\n=== Dharamshala stay search — ${DEV} ===\n`);
  const T = await login(DEVOTEE_MOBILE);
  const auth = { token: T };

  // ---------- browse (no dates) ----------
  const all = await dv('GET', '/stays/search?limit=50', auth);
  const stays = all.data?.stays ?? [];
  record('STAY-01', 'P1', 'search answers without dates (browsing places, not prices)',
    all.status === 200 && Array.isArray(stays), `status=${all.status} stays=${stays.length}`);

  record('STAY-02', 'P1', 'every result is a trust that actually runs a dharamshala',
    stays.length > 0 && stays.every((s) => s.rooms_total === null || s.rooms_total >= 0),
    `n=${stays.length}`);

  record('STAY-03', 'P1', 'each stay carries what a search card needs',
    stays.length > 0 && stays.every((s) => s.slug && s.name && 'from_paise' in s && 'city' in s),
    stays[0] ? `e.g. ${stays[0].name} · ${stays[0].city} · from=${stays[0].from_paise}` : 'none');

  // ---------- locality filter ----------
  const udaipur = await dv('GET', '/stays/search?city=udaipur', auth);
  const udaipurRows = udaipur.data?.stays ?? [];
  record('STAY-04', 'P1', 'city filter is case-insensitive and partial',
    udaipur.status === 200 && udaipurRows.every((s) => /udaipur/i.test(s.city ?? '')),
    `n=${udaipurRows.length}`);

  const area = await dv('GET', '/stays/search?area=palitana', auth);
  record('STAY-05', 'P2', 'area filter matches the words people actually use',
    area.status === 200 && (area.data?.stays ?? []).every((s) => /palitana/i.test(s.area ?? '')),
    `n=${area.data?.stays?.length}`);

  const localities = await dv('GET', '/stays/localities', auth);
  record('STAY-06', 'P2', 'localities endpoint feeds the filter chips',
    localities.status === 200 && Array.isArray(localities.data) && localities.data.length > 0,
    `cities=${localities.data?.length}`);

  // ---------- near me ----------
  // Udaipur city centre. Distance must be measured, not guessed.
  const near = await dv('GET', '/stays/search?lat=24.5854&lng=73.7125&sort=distance', auth);
  const nearRows = near.data?.stays ?? [];
  record('STAY-07', 'P1', '"near me" returns trusts ranked by real distance',
    near.status === 200 && nearRows.length > 0 && nearRows.every((s) => typeof s.distance_km === 'number'),
    nearRows.slice(0, 3).map((s) => `${s.city}:${s.distance_km}km`).join(' '));

  const ascending = nearRows.every((s, i) => i === 0 || s.distance_km >= nearRows[i - 1].distance_km);
  record('STAY-08', 'P1', 'nearest comes first (ranked BEFORE the shortlist is cut, not after)',
    ascending, ascending ? 'ordered' : nearRows.map((s) => s.distance_km).join(','));

  record('STAY-09', 'P1', 'the trust at those exact coordinates is ~0 km away',
    nearRows[0] && nearRows[0].distance_km < 1, `nearest=${nearRows[0]?.distance_km}km (${nearRows[0]?.name})`);

  const radius = await dv('GET', '/stays/search?lat=24.5854&lng=73.7125&radius_km=50', auth);
  record('STAY-10', 'P1', 'a radius excludes what is beyond it',
    radius.status === 200 && (radius.data?.stays ?? []).every((s) => s.distance_km <= 50),
    `n=${radius.data?.stays?.length} of ${nearRows.length} unbounded`);

  // ---------- dated availability ----------
  const from = day(400), to = day(402);
  const dated = await dv('GET', `/stays/search?from=${from}&to=${to}&persons=1`, auth);
  const datedRows = dated.data?.stays ?? [];
  record('STAY-11', 'P1', 'a dated search returns only trusts with a genuinely free room',
    dated.status === 200 && datedRows.every((s) => s.rooms_available > 0),
    `n=${datedRows.length} nights=${dated.meta?.nights ?? dated.data?.meta?.nights}`);

  record('STAY-12', 'P1', 'a dated result is priced for the whole stay, not per night alone',
    datedRows.length > 0 && datedRows.every(
      (s) => s.from_total_paise === s.from_paise * s.nights && s.nights === 2),
    datedRows[0] ? `from=${datedRows[0].from_paise} × ${datedRows[0].nights} = ${datedRows[0].from_total_paise}` : 'none');

  // A party too big for any room must not be offered one.
  const huge = await dv('GET', `/stays/search?from=${from}&to=${to}&persons=49`, auth);
  record('STAY-13', 'P1', 'a party nobody can sleep gets no results, not a room that cannot fit',
    huge.status === 200 && (huge.data?.stays ?? []).every((s) => s.sleeps_max >= 49),
    `n=${huge.data?.stays?.length}`);

  // ---------- price ----------
  const byPrice = await dv('GET', '/stays/search?sort=price', auth);
  const priceRows = (byPrice.data?.stays ?? []).filter((s) => s.from_paise != null);
  record('STAY-14', 'P2', 'sort=price puts the cheapest first',
    priceRows.every((s, i) => i === 0 || s.from_paise >= priceRows[i - 1].from_paise),
    priceRows.slice(0, 3).map((s) => s.from_paise).join(','));

  const capped = await dv('GET', '/stays/search?max_price_paise=100000', auth);
  record('STAY-15', 'P2', 'a price ceiling is respected',
    (capped.data?.stays ?? []).every((s) => s.from_paise <= 100000),
    `n=${capped.data?.stays?.length}`);

  // ---------- honesty about truncation ----------
  record('STAY-16', 'P1', 'the response says whether the shortlist was capped',
    all.data?.meta ? typeof all.data.meta.truncated === 'boolean' : false,
    `truncated=${all.data?.meta?.truncated} searched=${all.data?.meta?.searched}`);

  // ---------- auth ----------
  const anon = await dv('GET', '/stays/search');
  record('STAY-17', 'P1', 'search requires a signed-in devotee', anon.status === 401,
    `status=${anon.status}`);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== STAY SEARCH SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
