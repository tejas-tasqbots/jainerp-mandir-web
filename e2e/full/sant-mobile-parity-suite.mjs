/**
 * Every sant-api capability the sant MOBILE app now calls, exercised as the app
 * calls it.
 *
 * The gap this closes: an audit of `sant-api` controllers against
 * `sant-mobile/lib/data/maharaj_repository.dart` showed six endpoints the phone
 * could not reach at all — links, publications, publication covers, portrait
 * upload/removal, and change requests. A rep travelling with a Sadhu-Sadhvi had
 * no way to publish a new book or correct a verified name from the device they
 * actually carry.
 *
 * It also asserts the thing the whole feature is for: that what a rep writes
 * here is what a DEVOTEE reads in their own app.
 *
 *   node e2e/full/sant-mobile-parity-suite.mjs
 */
const SANT = process.env.E2E_SANT ?? 'http://localhost:3108/api/v1';
const DEV = process.env.E2E_DEVOTEE ?? 'http://localhost:3107/api/v1';
const REP_MOBILE = '9764564185';
const DEVOTEE_MOBILE = '9876500001';

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

function client(base) {
  return async (method, path, { token, body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, data: json?.data, code: json?.error?.code, message: json?.error?.message, text };
  };
}
const st = client(SANT);
const dv = client(DEV);

async function login(api, mobile) {
  const s = await api('POST', '/auth/send-otp', { body: { mobile } });
  const v = await api('POST', '/auth/verify-otp', { body: { mobile, otp: s.data.dev_otp } });
  if (!v.data?.access_token) throw new Error(`login failed: ${v.text}`);
  return v.data.access_token;
}

// A 1x1 PNG — the smallest thing that is genuinely a valid image.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function run() {
  console.log(`\n=== sant-mobile parity — sant ${SANT} / devotee ${DEV} ===\n`);
  const T = await login(st, REP_MOBILE);
  const auth = { token: T };

  const mine = await st('GET', '/sant/mine', auth);
  const sant = (mine.data ?? [])[0];
  record('SM-01', 'P1', 'a rep can list the Sadhu-Sadhvi they represent',
    mine.status === 200 && !!sant, `n=${mine.data?.length} first=${sant?.name}`);
  if (!sant) {
    console.log('\nNo sant profile for this rep — cannot continue.');
    process.exit(1);
  }
  const id = sant.id;

  // ---------- long-form profile (migration 034) ----------
  const patch = await st('PATCH', `/sant/${id}`, {
    ...auth,
    body: {
      about: 'Walked over 40,000 km teaching Tattvartha Sutra.',
      lineage: 'Mula Sangh · Balatkara Gana',
      diksha_place: 'Shri Mahavirji',
      education: 'Nyaya and Prakrit grammar',
      honours: 'Upadhyay (conferred 2015)',
    },
  });
  record('SM-02', 'P1', 'long-form profile fields save even on a VERIFIED profile',
    patch.status === 200, `status=${patch.status} verified=${sant.verified} ${patch.code ?? ''}`);

  const after = await st('GET', `/sant/${id}`, auth);
  record('SM-03', 'P1', 'they persist and read back',
    after.data?.about?.includes('40,000') && after.data?.honours?.includes('Upadhyay'),
    `lineage=${after.data?.lineage}`);

  // A conferred title must never be mistaken for the canonical rank.
  record('SM-04', 'P1', 'honours did not overwrite the canonical rank',
    after.data?.type === sant.type, `type=${after.data?.type} (unchanged)`);

  // ---------- links ----------
  const l1 = await st('POST', `/sant/${id}/links`, {
    ...auth, body: { kind: 'youtube', label: 'Pravachan', url: 'youtube.com/@parity-test' },
  });
  record('SM-05', 'P1', 'the phone can add a link, bare domain upgraded to https',
    l1.status === 201 && l1.data?.url === 'https://youtube.com/@parity-test', `url=${l1.data?.url}`);

  const evil = await st('POST', `/sant/${id}/links`, {
    ...auth, body: { kind: 'website', url: 'javascript:alert(1)' },
  });
  record('SM-06', 'P1', 'a javascript: link is refused here too',
    evil.status === 400, `status=${evil.status}`);

  await st('POST', `/sant/${id}/links`, {
    ...auth, body: { kind: 'youtube', url: 'https://youtube.com/@parity-corrected' },
  });
  const links = await st('GET', `/sant/${id}/links`, auth);
  const yt = (links.data ?? []).filter((l) => l.kind === 'youtube');
  record('SM-07', 'P1', 'a second YouTube link replaces rather than duplicates',
    yt.length === 1 && yt[0].url.includes('corrected'), `youtube rows=${yt.length}`);

  // ---------- publications ----------
  const pub = await st('POST', `/sant/${id}/publications`, {
    ...auth,
    body: {
      title: 'Parity Suite Commentary', kind: 'commentary', language: 'Hindi',
      year: 2011, publisher: 'Test Press', description: 'Seeded by the parity suite.',
      cover_base64: TINY_PNG, cover_mime: 'image/png',
    },
  });
  record('SM-08', 'P1', 'the phone can publish a work, with a cover',
    pub.status === 201 && !!pub.data?.id, `id=${pub.data?.id?.slice(0, 8)} has_cover=${pub.data?.has_cover}`);

  const pubs = await st('GET', `/sant/${id}/publications`, auth);
  const row = (pubs.data ?? []).find((p) => p.id === pub.data?.id);
  record('SM-09', 'P1', 'the list sends has_cover, never the inline bytes',
    !!row?.has_cover && !('cover_base64' in (row ?? {})),
    `has_cover=${row?.has_cover} inline=${row && 'cover_base64' in row}`);

  const cover = await st('GET', `/sant/${id}/publications/${pub.data?.id}/cover`, auth);
  record('SM-10', 'P1', 'the cover is fetchable on demand',
    cover.status === 200 && `${cover.data?.cover_base64}`.startsWith('data:image/'),
    `mime=${cover.data?.cover_mime}`);

  const badCover = await st('POST', `/sant/${id}/publications`, {
    ...auth, body: { title: 'Bad cover', cover_base64: 'not-a-data-uri' },
  });
  record('SM-11', 'P2', 'a cover that is not an image data URI is refused',
    badCover.status === 400, `status=${badCover.status}`);

  // ---------- portrait ----------
  const photo = await st('POST', `/sant/${id}/photo`, { ...auth, body: { photo_base64: TINY_PNG } });
  record('SM-12', 'P1', 'the phone can set the portrait', photo.status === 201 || photo.status === 200,
    `status=${photo.status}`);

  // ---------- change requests ----------
  // The reason this matters: a verified profile refuses a name edit outright.
  const lockedEdit = await st('PATCH', `/sant/${id}`, { ...auth, body: { name: 'Renamed By Test' } });
  const isLocked = lockedEdit.status === 403 && lockedEdit.code === 'VERIFIED_LOCKED';
  record('SM-13', 'P1', 'a verified profile refuses an identity edit',
    !sant.verified || isLocked, `verified=${sant.verified} status=${lockedEdit.status} ${lockedEdit.code ?? ''}`);

  // Withdraw any request this suite left behind on an earlier run: the API
  // refuses a SECOND pending request for the same field (REQUEST_PENDING), which
  // is correct — two open corrections for one name is not a thing a Super Admin
  // should have to arbitrate. The suite has to start from clean rather than
  // treat that refusal as a failure.
  for (const r of (await st('GET', `/sant/${id}/change-requests`, auth)).data ?? []) {
    if (r.field === 'name' && r.status === 'pending') {
      await st('DELETE', `/sant/${id}/change-requests/${r.id}`, auth);
    }
  }

  const cr = await st('POST', `/sant/${id}/change-requests`, {
    ...auth, body: { field: 'name', requested_value: 'Corrected Name', reason: 'spelling' },
  });
  record('SM-14', 'P1', 'so the rep can raise a correction from the phone instead',
    cr.status === 201 || cr.status === 200, `status=${cr.status} ${cr.code ?? ''}`);

  const dupe = await st('POST', `/sant/${id}/change-requests`, {
    ...auth, body: { field: 'name', requested_value: 'Another Name' },
  });
  record('SM-14b', 'P2', 'but a second pending request for the same field is refused',
    dupe.status === 400 && dupe.code === 'REQUEST_PENDING', `status=${dupe.status} ${dupe.code ?? ''}`);

  const crs = await st('GET', `/sant/${id}/change-requests`, auth);
  const mineCr = (crs.data ?? []).find((r) => r.field === 'name');
  record('SM-15', 'P1', 'and see it listed as pending',
    crs.status === 200 && mineCr?.status === 'pending', `n=${crs.data?.length} status=${mineCr?.status}`);

  if (mineCr?.id) {
    const wd = await st('DELETE', `/sant/${id}/change-requests/${mineCr.id}`, auth);
    record('SM-16', 'P2', 'and withdraw it', wd.status === 200, `status=${wd.status}`);
  }

  // ---------- what the DEVOTEE actually sees ----------
  const D = await login(dv, DEVOTEE_MOBILE);
  const seen = await dv('GET', `/maharaj/${id}`, { token: D });
  record('SM-17', 'P1', 'the devotee app shows the long-form profile the rep wrote',
    seen.status === 200 && seen.data?.about?.includes('40,000') &&
      seen.data?.lineage === 'Mula Sangh · Balatkara Gana',
    `about=${(seen.data?.about ?? '').slice(0, 30)}…`);

  record('SM-18', 'P1', 'the devotee app shows the links and published works',
    (seen.data?.links ?? []).length > 0 && (seen.data?.publications ?? []).length > 0,
    `links=${seen.data?.links?.length} pubs=${seen.data?.publications?.length}`);

  record('SM-19', 'P1', 'the devotee payload carries no inline cover bytes',
    (seen.data?.publications ?? []).every((p) => !('cover_base64' in p)), 'checked all');

  // ---------- ownership ----------
  const foreign = await st('GET', '/sant/00000000-0000-0000-0000-000000000000/links', auth);
  record('SM-20', 'P1', 'a rep cannot read another profile’s links by changing the id',
    foreign.status === 403 || foreign.status === 404, `status=${foreign.status}`);

  // ---------- cleanup ----------
  if (pub.data?.id) await st('DELETE', `/sant/${id}/publications/${pub.data.id}`, auth);
  for (const l of (await st('GET', `/sant/${id}/links`, auth)).data ?? []) {
    if (`${l.url}`.includes('parity-')) await st('DELETE', `/sant/${id}/links/${l.id}`, auth);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== SANT MOBILE PARITY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => `${r.id} (${r.detail})`).join('; '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
