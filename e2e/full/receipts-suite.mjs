/**
 * Functional API E2E — a printable receipt for EVERY revenue module.
 *
 * Donations, prasad, seva and bhojanshala already had one. Room bookings and
 * hall bookings had only a `/bill` (the working data a checkout screen needs),
 * and gaushala had nothing — so a guest who paid for a room could not be handed
 * a document, and a cow sponsor had no certificate.
 *
 * Every receipt must carry the temple block the client renders from (template,
 * colour, paper, copies, language) — a payload missing it prints blank.
 *
 *   node e2e/full/receipts-suite.mjs
 *
 * Re-run `superadmin-api/scripts/seed-qa-tester.ts` first if the tenant needs
 * provisioning; this suite otherwise runs against `smoke-portal`.
 */
const MANDIR = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const TENANT = 'smoke-portal';
const ADMIN_MOBILE = '9876512345';

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function md(method, path, { token, body } = {}) {
  const res = await fetch(`${MANDIR}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, data: json?.data, code: json?.error?.code };
}
const rowsOf = (r) => (Array.isArray(r.data) ? r.data : r.data?.rows ?? []);

async function login(mobile) {
  const send = await md('POST', '/auth/send-otp', { body: { mobile } });
  const ver = await md('POST', '/auth/verify-otp', { body: { mobile, otp: send.data.dev_otp } });
  const sel = await md('POST', '/auth/select-tenant', {
    body: { selection_token: ver.data?.selection_token, tenant_slug: TENANT },
  });
  if (!sel.data?.access_token) throw new Error(`login failed: ${JSON.stringify(sel.json)}`);
  return sel.data.access_token;
}

/** Every receipt renders from this block — without it the template prints blank. */
function hasTempleBlock(r) {
  const m = r?.mandir;
  return !!m && !!m.name && !!m.template && !!m.primary_color && !!m.receipt_paper;
}

// Each run books DIFFERENT nights. The room_no_overlap exclusion constraint
// counts a checked-out booking as still occupying those nights — correctly, since
// two guests cannot have shared one room on one night, even historically. Reusing
// fixed dates made every run after the first fail with 409.
const RUN_OFFSET = 200 + Math.floor(Math.random() * 3000);
const day = (n) =>
  new Date(Date.now() + (RUN_OFFSET + n) * 86400000 + 330 * 60000).toISOString().slice(0, 10);

async function run() {
  console.log(`\n=== Receipts for every revenue module — ${MANDIR} (${TENANT}) ===\n`);
  const T = await login(ADMIN_MOBILE);
  const auth = { token: T };

  // ---------- already existed: prove they still work ----------
  const don = rowsOf(await md('GET', '/donations?limit=1', auth))[0];
  if (don) {
    const r = await md('GET', `/donations/${don.id}/receipt`, auth);
    record('RCPT-01', 'P1', 'donation receipt', r.status === 200 && hasTempleBlock(r.data),
      `no=${r.data?.receipt_number}`);
  } else record('RCPT-01', 'P1', 'donation receipt', false, 'no donation to test');

  const prasad = rowsOf(await md('GET', '/prasad/sales?limit=1', auth))[0];
  record('RCPT-02', 'P2', 'prasad receipt',
    !prasad || (await md('GET', `/prasad/sales/${prasad.id}/receipt`, auth)).status === 200,
    prasad ? 'ok' : 'no sale to test');

  const seva = rowsOf(await md('GET', '/seva-bookings?limit=1', auth))[0];
  record('RCPT-03', 'P2', 'seva receipt',
    !seva || (await md('GET', `/seva-bookings/${seva.id}/receipt`, auth)).status === 200,
    seva ? 'ok' : 'no booking to test');

  // The user believed this one was missing — it is not. Asserted rather than argued.
  const bhoj = rowsOf(await md('GET', '/bhojanshala/sales?limit=1', auth))[0];
  if (bhoj) {
    const r = await md('GET', `/bhojanshala/sales/${bhoj.id}/receipt`, auth);
    record('RCPT-04', 'P1', 'bhojanshala receipt (already existed)',
      r.status === 200 && hasTempleBlock(r.data), `no=${r.data?.receipt_number}`);
  } else record('RCPT-04', 'P1', 'bhojanshala receipt (already existed)', false, 'no sale to test');

  // ---------- new: room ----------
  const rooms = rowsOf(await md('GET', '/rooms?limit=1', auth));
  let roomReceiptOk = false, roomDetail = 'no room master';
  if (rooms.length) {
    const chk = await md('POST', '/room-bookings', {
      ...auth,
      body: {
        room_id: rooms[0].id, guest: { name: 'Receipt QA Guest', mobile: '9764564185' },
        check_in_date: day(0), check_out_date: day(1), persons_count: 1,
      },
    });
    const bookingId = chk.data?.id ?? chk.data?.booking?.id;
    if (bookingId) {
      await md('PATCH', `/room-bookings/${bookingId}/checkin`, { ...auth, body: {} });
      const out = await md('PATCH', `/room-bookings/${bookingId}/checkout`, {
        ...auth, body: { payments: [{ payment_mode: 'cash', amount_paise: 100000 }] },
      });
      const r = await md('GET', `/room-bookings/${bookingId}/receipt`, auth);
      roomReceiptOk = r.status === 200 && hasTempleBlock(r.data) && /^ROOM\//.test(r.data?.receipt_number ?? '');
      roomDetail = `checkout=${out.status} receipt=${r.status} no=${r.data?.receipt_number} lines=${r.data?.lines?.length}`;
      record('RCPT-06', 'P1', 'room receipt itemises nights and GST',
        (r.data?.lines?.length ?? 0) > 0 && r.data?.tax != null,
        `cgst=${r.data?.tax?.cgst_paise} sgst=${r.data?.tax?.sgst_paise}`);
      record('RCPT-07', 'P1', 'room receipt is never marked 80G (it is a service)',
        r.data?.is_80g_eligible === false, `is_80g=${r.data?.is_80g_eligible}`);

      // ---- DEF-RCPT-02: the availability screen and the DB must agree ----
      // The room above has just been checked out, so its booking still spans
      // the night that was actually slept in. `availability()` used to ignore
      // `checked_out` rows and offer that night as free, while the
      // `room_no_overlap` exclusion constraint (correctly) still blocked it —
      // so the screen offered a room the insert then refused with a 409.
      //
      // This asserts the INVARIANT rather than either side's answer: whatever
      // availability says, attempting the booking must produce the matching
      // outcome. A test written against one side would have to be rewritten if
      // the product ever decides the other side was right.
      const avail = await md('GET', `/rooms/availability?from=${day(0)}&to=${day(0)}`, auth);
      const thisRoom = (avail.data ?? []).find((x) => x.id === rooms[0].id);
      const rebook = await md('POST', '/room-bookings', {
        ...auth,
        body: {
          room_id: rooms[0].id, guest: { name: 'Overlap QA Guest', mobile: '9764564185' },
          check_in_date: day(0), check_out_date: day(1), persons_count: 1,
        },
      });
      const insertAccepted = rebook.status === 200 || rebook.status === 201;
      record('RCPT-12', 'P1', 'availability agrees with what the booking insert will actually allow',
        thisRoom != null && thisRoom.available === insertAccepted,
        `available=${thisRoom?.available} insert=${rebook.status}${insertAccepted ? '' : ` (${rebook.data?.code ?? rebook.code ?? 'refused'})`}`);

      // Clean up if the re-book unexpectedly succeeded, so the next run starts
      // from the same state this one did.
      const dupeId = rebook.data?.id ?? rebook.data?.booking?.id;
      if (dupeId) await md('DELETE', `/room-bookings/${dupeId}`, auth);
    } else roomDetail = `booking failed: ${chk.status} ${chk.code ?? ''}`;
  }
  record('RCPT-05', 'P1', 'room booking receipt (NEW)', roomReceiptOk, roomDetail);

  // ---------- new: hall ----------
  const halls = rowsOf(await md('GET', '/halls?limit=1', auth));
  let hallOk = false, hallDetail = 'no hall master';
  if (halls.length) {
    const hb = await md('POST', '/hall-bookings', {
      ...auth,
      body: {
        hall_id: halls[0].id, event_name: 'Receipt QA Event', booker_name: 'Receipt QA',
        booker_mobile: '9764564185', booking_date: day(3), total_paise: 500000,
      },
    });
    const id = hb.data?.id;
    if (id) {
      const r = await md('GET', `/hall-bookings/${id}/receipt`, auth);
      hallOk = r.status === 200 && hasTempleBlock(r.data);
      hallDetail = `receipt=${r.status} no=${r.data?.receipt_number ?? 'null (not completed yet)'}`;
    } else hallDetail = `booking failed: ${hb.status} ${hb.code ?? ''}`;
  }
  record('RCPT-08', 'P1', 'hall booking receipt (NEW)', hallOk, hallDetail);

  // ---------- new: gaushala sponsorship ----------
  // smoke-portal is a full mandir, so it holds the gaushala module.
  const cow = await md('POST', '/cattle', {
    ...auth, body: { tag_number: `RQA-${String(Date.now()).slice(-6)}`, name: 'Receipt QA Cow', category: 'cow' },
  });
  let gauOk = false, gauDetail = `cattle=${cow.status} ${cow.code ?? ''}`;
  if (cow.data?.id) {
    const sp = await md('POST', '/cow-sponsorships', {
      ...auth,
      body: { cattle_id: cow.data.id, sponsor_name: 'Receipt QA Sponsor', sponsor_mobile: '9764564185', plan: 'monthly', amount_paise: 150000 },
    });
    if (sp.data?.id) {
      const r = await md('GET', `/cow-sponsorships/${sp.data.id}/receipt`, auth);
      gauOk = r.status === 200 && hasTempleBlock(r.data) && !!r.data?.meta?.cow;
      gauDetail = `receipt=${r.status} cow=${r.data?.meta?.cow} received=${r.data?.meta?.total_received_paise}`;
      record('RCPT-10', 'P1', 'sponsorship certificate names the cow and its plan',
        r.data?.meta?.plan === 'monthly' && /RQA-/.test(r.data?.meta?.cow ?? ''), `plan=${r.data?.meta?.plan}`);
      record('RCPT-11', 'P1', 'sponsorship with no payment yet shows zero received, not an error',
        r.data?.meta?.total_received_paise === 0, `received=${r.data?.meta?.total_received_paise}`);
    } else gauDetail = `sponsorship failed: ${sp.status} ${sp.code ?? ''}`;
  }
  record('RCPT-09', 'P1', 'gaushala sponsorship certificate (NEW)', gauOk, gauDetail);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== RECEIPTS SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
