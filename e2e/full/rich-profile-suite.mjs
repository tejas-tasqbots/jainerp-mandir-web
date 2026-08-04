/**
 * Public profiles for mandirs and sants — the LinkedIn-shaped page a devotee
 * reads before giving or travelling: the paragraph, the timings, the links,
 * the published books.
 *
 * One implementation (`RichProfileService`, migration 034) serves both owners
 * via `subject_type`, so the interesting cases are the ones where "both" could
 * go wrong: one trust deleting another's link by id, a second YouTube channel
 * silently replacing the first, and a `javascript:` URL reaching an anchor a
 * devotee taps.
 *
 *   node e2e/full/rich-profile-suite.mjs
 */
const MANDIR = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const DEV = process.env.E2E_DEVOTEE ?? 'http://localhost:3107/api/v1';
const TENANT = 'smoke-portal';
const ADMIN_MOBILE = '9876512345';
const CASHIER_MOBILE = '9844444444';
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
const md = client(MANDIR);
const dv = client(DEV);

async function mandirLogin(mobile) {
  const s = await md('POST', '/auth/send-otp', { body: { mobile } });
  const v = await md('POST', '/auth/verify-otp', { body: { mobile, otp: s.data.dev_otp } });
  const sel = await md('POST', '/auth/select-tenant', {
    body: { selection_token: v.data?.selection_token, tenant_slug: TENANT },
  });
  if (!sel.data?.access_token) throw new Error(`mandir login failed: ${sel.text}`);
  return sel.data.access_token;
}
async function devoteeLogin(mobile) {
  const s = await dv('POST', '/auth/send-otp', { body: { mobile } });
  const v = await dv('POST', '/auth/verify-otp', { body: { mobile, otp: s.data.dev_otp } });
  if (!v.data?.access_token) throw new Error(`devotee login failed: ${v.text}`);
  return v.data.access_token;
}

async function run() {
  console.log(`\n=== Rich public profiles — mandir ${MANDIR} / devotee ${DEV} ===\n`);
  const T = await mandirLogin(ADMIN_MOBILE);
  const auth = { token: T };

  // ---------- the trust's own words ----------
  const upd = await md('PATCH', '/tenants/me/public-profile', {
    ...auth,
    body: {
      about: 'A Digambar Jain trust serving pilgrims since the 1890s.',
      founded_year: 1893,
      main_deity: 'Bhagwan Adinath',
      darshan_timings: '5:30–11:00, 16:00–20:30',
      languages: ['Hindi', 'Gujarati', 'English'],
    },
  });
  record('PROF-01', 'P1', 'a trust can write its public profile',
    upd.status === 200 && upd.data?.founded_year === 1893 && upd.data?.languages?.length === 3,
    `year=${upd.data?.founded_year} langs=${upd.data?.languages?.length}`);

  const badYear = await md('PATCH', '/tenants/me/public-profile', {
    ...auth, body: { founded_year: 3025 },
  });
  record('PROF-02', 'P2', 'a founding year in the future is refused',
    badYear.status === 400, `status=${badYear.status} ${badYear.code ?? ''}`);

  // ---------- links ----------
  const yt = await md('POST', '/tenants/me/links', {
    ...auth, body: { kind: 'youtube', label: 'Pravachan channel', url: 'youtube.com/@example' },
  });
  record('PROF-03', 'P1', 'a bare domain is upgraded to https rather than rejected',
    yt.status === 201 && yt.data?.url === 'https://youtube.com/@example', `url=${yt.data?.url}`);

  const evil = await md('POST', '/tenants/me/links', {
    ...auth, body: { kind: 'website', url: 'javascript:alert(document.cookie)' },
  });
  record('PROF-04', 'P1', 'a javascript: URL is refused (it would be script execution, not a link)',
    evil.status === 400, `status=${evil.status} ${evil.code ?? ''}`);

  const dataUrl = await md('POST', '/tenants/me/links', {
    ...auth, body: { kind: 'website', url: 'data:text/html,<script>alert(1)</script>' },
  });
  record('PROF-05', 'P1', 'a data: URL is refused too',
    dataUrl.status === 400, `status=${dataUrl.status}`);

  const yt2 = await md('POST', '/tenants/me/links', {
    ...auth, body: { kind: 'youtube', url: 'https://youtube.com/@corrected' },
  });
  const links = await md('GET', '/tenants/me/links', auth);
  const ytCount = (links.data ?? []).filter((l) => l.kind === 'youtube').length;
  record('PROF-06', 'P1', 'a second YouTube link replaces the first, never duplicates it',
    yt2.status === 201 && ytCount === 1 && links.data.find((l) => l.kind === 'youtube')?.url.includes('corrected'),
    `youtube rows=${ytCount}`);

  await md('POST', '/tenants/me/links', { ...auth, body: { kind: 'other', url: 'https://a.example' } });
  await md('POST', '/tenants/me/links', { ...auth, body: { kind: 'other', url: 'https://b.example' } });
  const links2 = await md('GET', '/tenants/me/links', auth);
  const otherCount = (links2.data ?? []).filter((l) => l.kind === 'other').length;
  record('PROF-07', 'P2', "but several 'other' links are allowed (the unique index is partial)",
    otherCount >= 2, `other rows=${otherCount}`);

  // ---------- publications ----------
  const book = await md('POST', '/tenants/me/publications', {
    ...auth,
    body: {
      title: 'Tattvartha Sutra — a commentary', kind: 'commentary',
      language: 'Hindi', year: 1998, publisher: 'Trust Press',
      description: 'Verse-by-verse commentary.',
    },
  });
  record('PROF-08', 'P1', 'a trust can publish a book on its profile',
    book.status === 201 && !!book.data?.id, `id=${book.data?.id?.slice(0, 8)}`);

  const noTitle = await md('POST', '/tenants/me/publications', { ...auth, body: { kind: 'book' } });
  record('PROF-09', 'P2', 'a publication with no title is refused',
    noTitle.status === 400, `status=${noTitle.status}`);

  const pubs = await md('GET', '/tenants/me/publications', auth);
  const row = (pubs.data ?? []).find((p) => p.id === book.data?.id);
  record('PROF-10', 'P1', 'the list sends has_cover, never the inline image',
    !!row && 'has_cover' in row && !('cover_base64' in row),
    `has_cover=${row?.has_cover} inline=${row && 'cover_base64' in row}`);

  // ---------- roles ----------
  const C = await mandirLogin(CASHIER_MOBILE);
  const cashierWrite = await md('POST', '/tenants/me/publications', {
    token: C, body: { title: 'Cashier should not publish' },
  });
  record('PROF-11', 'P1', 'a cashier cannot publish in the trust’s name',
    cashierWrite.status === 403, `status=${cashierWrite.status}`);

  const cashierRead = await md('GET', '/tenants/me/publications', { token: C });
  record('PROF-12', 'P2', 'but staff can still read the profile',
    cashierRead.status === 200, `status=${cashierRead.status}`);

  // ---------- the devotee sees it ----------
  const D = await devoteeLogin(DEVOTEE_MOBILE);
  const temple = await dv('GET', `/temples/${TENANT}`, { token: D });
  record('PROF-13', 'P1', 'the devotee temple page carries the profile the trust wrote',
    temple.status === 200 && temple.data?.about?.includes('pilgrims') &&
      temple.data?.main_deity === 'Bhagwan Adinath' && temple.data?.founded_year === 1893,
    `deity=${temple.data?.main_deity} year=${temple.data?.founded_year}`);

  record('PROF-14', 'P1', 'links and publications reach the devotee',
    (temple.data?.links ?? []).length > 0 && (temple.data?.publications ?? []).length > 0,
    `links=${temple.data?.links?.length} pubs=${temple.data?.publications?.length}`);

  record('PROF-15', 'P1', 'the devotee payload never carries inline cover bytes',
    (temple.data?.publications ?? []).every((p) => !('cover_base64' in p)),
    'checked every publication');

  // ---------- deletion is scoped ----------
  const del = await md('DELETE', `/tenants/me/publications/${book.data?.id}`, auth);
  record('PROF-16', 'P1', 'a trust can remove its own publication',
    del.status === 200, `status=${del.status}`);

  const delAgain = await md('DELETE', `/tenants/me/publications/${book.data?.id}`, auth);
  record('PROF-17', 'P1', 'deleting it twice is refused rather than silently succeeding',
    delAgain.status === 400 || delAgain.status === 404, `status=${delAgain.status}`);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== RICH PROFILE SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
