/**
 * Functional API E2E — autonomous online room booking (tenant-migration 015).
 *
 * A devotee books a dharamshala room end to end with no staff involved:
 * search → hold → pay → confirm → ticket → cancel. The interesting cases are
 * the ones where money and inventory can disagree:
 *
 *   - two devotees racing for the last room
 *   - a webhook and a checkout callback confirming the same payment
 *   - money arriving after the hold has already expired
 *
 *   devotee-api     (:3107) — the whole booking flow
 *   mandir-api (:3106) — the temple's own register, where it must appear
 *   superadmin-api  (:3105) — provisions a Dharamshala trust to test against
 *
 *   node e2e/full/booking-suite.mjs
 *
 * Re-run `superadmin-api/scripts/seed-qa-tester.ts` first — MFA enrolment is
 * one-shot by design.
 */
import { createHmac } from 'crypto';
import { superAdminLogin as saLogin, QA_ID, QA_PASSWORD } from './sa-auth.mjs';

const SA = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';
const MANDIR = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const DEVOTEE = process.env.E2E_DEVOTEE_API ?? 'http://localhost:3107/api/v1';
const WEBHOOK_SECRET = process.env.E2E_RAZORPAY_WEBHOOK_SECRET ?? 'xxx';

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function http(base, method, path, { token, body, headers, raw } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, data: json?.data, code: json?.error?.code ?? json?.code };
}
const sa = (m, p, o) => http(SA, m, p, o);
const md = (m, p, o) => http(MANDIR, m, p, o);
const dv = (m, p, o) => http(DEVOTEE, m, p, o);
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

async function devoteeLogin(mobile) {
  const send = await dv('POST', '/auth/send-otp', { body: { mobile } });
  const ver = await dv('POST', '/auth/verify-otp', {
    body: { mobile, otp: send.data.dev_otp, device_id: crypto.randomUUID(), device_name: 'e2e', platform: 'web' },
  });
  if (!ver.data?.access_token) throw new Error(`devotee login failed: ${JSON.stringify(ver.json)}`);
  return ver.data.access_token;
}

/** Deliver a signed payment.captured for a room booking, exactly as Razorpay would. */
async function webhook(paymentId, amountPaise, notes) {
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, amount: amountPaise, notes } } },
  });
  return dv('POST', '/webhooks/razorpay', {
    raw: body,
    headers: { 'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(body)).digest('hex') },
  });
}

const dayOffset = (n) => new Date(Date.now() + n * 86400000 + 330 * 60000).toISOString().slice(0, 10);

async function run() {
  console.log(`\n=== Autonomous room booking — devotee ${DEVOTEE} / mandir ${MANDIR} ===\n`);
  const ADMIN = await superAdminLogin();

  // ---------- a dharamshala trust with exactly one room ----------
  const suffix = String(Date.now()).slice(-6);
  const slug = `book-qa-${suffix}`;
  const adminMobile = `+9196${String(20000000 + Math.floor(Math.random() * 9999999))}`;
  const created = await sa('POST', '/admin/tenants', {
    token: ADMIN,
    body: {
      name: `BOOK QA Dharamshala ${suffix}`, slug, plan: 'standard', tenancy_tier: 'pooled',
      module_preset: 'dharamshala_trust',
      admin_contact: { name: 'Book QA Admin', mobile: adminMobile, email: `book-qa-${suffix}@example.com` },
      address: { line1: '1 Test Road', state: 'Maharashtra', city: 'Pune', pincode: '411001' },
    },
  });
  record('BOOK-00', 'P1', 'a Dharamshala trust can be onboarded', created.status === 201,
    `status=${created.status} modules=${JSON.stringify(created.data?.modules)}`);
  if (created.status !== 201) { console.log(JSON.stringify(created.json)); process.exit(1); }
  const tenantId = created.data.id;

  // Granting the module is not the same as having rooms — create the one the
  // whole suite competes over.
  const STAFF = await mandirLogin(adminMobile, slug);
  const room = await md('POST', '/rooms', {
    token: STAFF,
    body: { room_number: '101', name: 'Test Room', room_type: 'ac', capacity_persons: 3, tariff_paise: 100000, gst_rate: 12, is_available: true },
  });
  record('BOOK-01', 'P1', 'staff create the only room the trust has',
    room.status === 201 || room.status === 200, `status=${room.status}`);

  const D1 = await devoteeLogin(`97551${String(Math.floor(10000 + Math.random() * 89999))}`);
  const D2 = await devoteeLogin(`97552${String(Math.floor(10000 + Math.random() * 89999))}`);
  const from = dayOffset(14);
  const to = dayOffset(16);

  // ---------- search ----------
  const avail = await dv('GET', `/temples/${slug}/rooms/availability?from=${from}&to=${to}&persons=2`, { token: D1 });
  const offered = avail.data?.rooms ?? [];
  record('BOOK-02', 'P1', 'the room shows as available and priced for the stay',
    avail.status === 200 && offered.length === 1 && offered[0].nights === 2,
    `rooms=${offered.length} nights=${offered[0]?.nights}`);
  record('BOOK-03', 'P1', 'the quote includes GST on the tariff',
    offered[0]?.subtotal_paise === 200000 && offered[0]?.total_paise === 224000,
    `subtotal=${offered[0]?.subtotal_paise} total=${offered[0]?.total_paise}`);

  const tooMany = await dv('GET', `/temples/${slug}/rooms/availability?from=${from}&to=${to}&persons=9`, { token: D1 });
  record('BOOK-04', 'P2', 'a room that cannot sleep the party is not offered',
    (tooMany.data?.rooms ?? []).length === 0, `rooms=${tooMany.data?.rooms?.length}`);

  const badDates = await dv('GET', `/temples/${slug}/rooms/availability?from=${to}&to=${from}`, { token: D1 });
  record('BOOK-05', 'P2', 'check-out before check-in is refused', badDates.status === 400, `status=${badDates.status}`);

  // ---------- hold ----------
  const hold = await dv('POST', `/temples/${slug}/rooms/hold`, {
    token: D1, body: { room_id: offered[0].room_id, from, to, persons: 2 },
  });
  record('BOOK-06', 'P1', 'the room can be held while paying',
    hold.status === 201 && !!hold.data?.booking_id && !!hold.data?.expires_at,
    `expires_at=${hold.data?.expires_at}`);
  const bookingId = hold.data.booking_id;

  const stillFree = await dv('GET', `/temples/${slug}/rooms/availability?from=${from}&to=${to}`, { token: D2 });
  record('BOOK-07', 'P1', 'a held room disappears from everyone else’s search',
    (stillFree.data?.rooms ?? []).length === 0, `rooms=${stillFree.data?.rooms?.length}`);

  // The race the exclusion constraint exists for.
  const race = await Promise.all([
    dv('POST', `/temples/${slug}/rooms/hold`, { token: D2, body: { room_id: offered[0].room_id, from, to, persons: 1 } }),
    dv('POST', `/temples/${slug}/rooms/hold`, { token: D2, body: { room_id: offered[0].room_id, from, to, persons: 1 } }),
  ]);
  record('BOOK-08', 'P1', 'a second devotee cannot hold the same room — 409, not a double-sell',
    race.every((r) => r.status === 409 && r.code === 'ROOM_UNAVAILABLE'),
    race.map((r) => `${r.status}/${r.code}`).join(' '));

  // ---------- pay ----------
  const order = await dv('POST', `/temples/${slug}/rooms/bookings/${bookingId}/order`, { token: D1 });
  record('BOOK-09', 'P1', 'an order is created for the held booking',
    order.status === 201 && order.data?.amount_paise === 224000,
    `amount=${order.data?.amount_paise}`);

  const foreign = await dv('POST', `/temples/${slug}/rooms/bookings/${bookingId}/order`, { token: D2 });
  record('BOOK-10', 'P1', 'another devotee cannot pay for someone else’s hold',
    foreign.status === 403, `status=${foreign.status}`);

  // ---------- confirm (via the real webhook) ----------
  const paymentId = `pay_book_${Date.now()}`;
  const notes = { type: 'room_booking', tenant_id: tenantId, devotee_id: 'x', booking_id: bookingId };
  const hook = await webhook(paymentId, 224000, notes);
  record('BOOK-11', 'P1', 'the webhook confirms the booking', hook.status === 200, `status=${hook.status}`);

  const mine = await dv('GET', '/me/bookings', { token: D1 });
  const confirmed = (mine.data ?? []).find((b) => b.id === bookingId);
  record('BOOK-12', 'P1', 'the booking is confirmed with a gapless receipt number',
    confirmed?.status === 'confirmed' && /^ROOM\/\d{4}-\d{2}\/\d{6}$/.test(confirmed?.invoice_no ?? ''),
    `status=${confirmed?.status} invoice_no=${confirmed?.invoice_no}`);
  record('BOOK-13', 'P1', 'a ticket code is issued',
    /^JRB-[0-9A-Z]{6}$/.test(confirmed?.ticket_code ?? ''), `ticket=${confirmed?.ticket_code}`);

  const replay = await webhook(paymentId, 224000, notes);
  const afterReplay = (await dv('GET', '/me/bookings', { token: D1 })).data ?? [];
  record('BOOK-14', 'P1', 'a webhook replay does not create a second booking',
    replay.status === 200 && afterReplay.filter((b) => b.id === bookingId).length === 1,
    `n=${afterReplay.filter((b) => b.id === bookingId).length}`);

  // ---------- ticket ----------
  const ticket = await dv('GET', `/temples/${slug}/rooms/bookings/${bookingId}/ticket`, { token: D1 });
  record('BOOK-15', 'P1', 'the ticket carries everything needed to print it',
    ticket.status === 200 && ticket.data?.qr_payload === confirmed?.ticket_code &&
    !!ticket.data?.temple?.name && ticket.data?.room_number === '101',
    `qr=${ticket.data?.qr_payload} room=${ticket.data?.room_number}`);

  const foreignTicket = await dv('GET', `/temples/${slug}/rooms/bookings/${bookingId}/ticket`, { token: D2 });
  record('BOOK-16', 'P1', 'another devotee cannot fetch the ticket',
    foreignTicket.status === 403, `status=${foreignTicket.status}`);

  // ---------- the temple's own register ----------
  const staffList = await md('GET', '/room-bookings?limit=50', { token: STAFF });
  const staffRow = rowsOf(staffList).find((b) => b.id === bookingId);
  record('BOOK-17', 'P1', 'the online booking appears in the temple’s register',
    !!staffRow, `found=${!!staffRow}`);

  // ---------- money that arrives too late ----------
  const lateHold = await dv('POST', `/temples/${slug}/rooms/hold`, {
    token: D2, body: { room_id: offered[0].room_id, from: dayOffset(40), to: dayOffset(41) },
  });
  const lateId = lateHold.data?.booking_id;
  await dv('POST', `/temples/${slug}/rooms/bookings/${lateId}/cancel`, { token: D2, body: { reason: 'simulate expiry' } });
  const lateHook = await webhook(`pay_late_${Date.now()}`, 112000, {
    type: 'room_booking', tenant_id: tenantId, booking_id: lateId,
  });
  const lateRows = (await dv('GET', '/me/bookings', { token: D2 })).data ?? [];
  const lateRow = lateRows.find((b) => b.id === lateId);
  record('BOOK-18', 'P1', 'payment for a released hold does NOT resurrect it (would double-sell)',
    lateHook.status === 200 && lateRow?.status === 'cancelled', `status=${lateRow?.status}`);

  // ---------- cancel ----------
  const cancel = await dv('POST', `/temples/${slug}/rooms/bookings/${bookingId}/cancel`, {
    token: D1, body: { reason: 'Plans changed' },
  });
  record('BOOK-19', 'P1', 'a devotee can cancel and is told the refund position',
    cancel.status === 201 && cancel.data?.refund_paise === 224000 && !!cancel.data?.refund_note,
    `refund=${cancel.data?.refund_paise}`);

  const freedAgain = await dv('GET', `/temples/${slug}/rooms/availability?from=${from}&to=${to}`, { token: D2 });
  record('BOOK-20', 'P1', 'cancelling puts the room back on sale',
    (freedAgain.data?.rooms ?? []).length === 1, `rooms=${freedAgain.data?.rooms?.length}`);

  const twice = await dv('POST', `/temples/${slug}/rooms/bookings/${bookingId}/cancel`, { token: D1, body: {} });
  record('BOOK-21', 'P2', 'cancelling twice is refused', twice.status === 409, `status=${twice.status}`);

  // ---------- module + entitlement interaction ----------
  const donationOnly = await sa('POST', '/admin/tenants', {
    token: ADMIN,
    body: {
      name: `BOOK QA NoRooms ${suffix}`, slug: `book-qa-norooms-${suffix}`, plan: 'standard',
      tenancy_tier: 'pooled', module_preset: 'donation_only',
      admin_contact: { name: 'x', mobile: `+9195${String(20000000 + Math.floor(Math.random() * 9999999))}` },
      address: { line1: '1', state: 'Maharashtra', city: 'Pune', pincode: '411001' },
    },
  });
  const noRooms = await dv('GET', `/temples/book-qa-norooms-${suffix}/rooms/availability?from=${from}&to=${to}`, { token: D1 });
  record('BOOK-22', 'P1', 'a trust without the Dharamshala module offers no booking',
    noRooms.status === 403 && noRooms.code === 'MODULE_NOT_ENABLED',
    `status=${noRooms.status} code=${noRooms.code}`);

  // ---------- contract: what the mobile app reads ----------
  // devotee-mobile is the first client of these two payloads (devotee-web has a
  // ticket page but no bookings list), so a missing field would ship as a blank
  // card or a broken route rather than a caught error. Same class of defect as
  // DEF-01/02 in Test_Report.md, asserted the same way: every field the UI
  // reads must actually be present.
  const mobileRow = ((await dv('GET', '/me/bookings', { token: D1 })).data ?? [])
    .find((b) => b.id === bookingId);
  const listFields = ['id', 'check_in_date', 'check_out_date', 'nights', 'persons_count',
    'total_paise', 'status', 'ticket_code', 'room_number', 'refund_paise'];
  const missingList = listFields.filter((f) => mobileRow?.[f] === undefined);
  record('BOOK-23', 'P1', '/me/bookings carries every field the mobile list renders',
    !!mobileRow && missingList.length === 0 && !!mobileRow?.temple?.slug && !!mobileRow?.temple?.name,
    missingList.length ? `missing=${missingList.join(',')}`
      : `temple.slug=${mobileRow?.temple?.slug ?? 'MISSING — ticket route would break'}`);

  const ticketFields = ['id', 'check_in_date', 'check_out_date', 'nights', 'persons_count',
    'tariff_per_night_paise', 'subtotal_paise', 'cgst_paise', 'sgst_paise', 'igst_paise',
    'total_paise', 'status', 'room_number', 'qr_payload'];
  const missingTicket = ticketFields.filter((f) => ticket.data?.[f] === undefined);
  record('BOOK-24', 'P1', 'the ticket payload carries every field the mobile ticket screen renders',
    missingTicket.length === 0 && ticket.data?.temple?.address !== undefined,
    missingTicket.length ? `missing=${missingTicket.join(',')}` : 'all present');

  // ---------- cleanup ----------
  await sa('DELETE', `/admin/tenants/${tenantId}`, { token: ADMIN, body: { confirm_slug: slug } });
  if (donationOnly.data?.id) {
    await sa('DELETE', `/admin/tenants/${donationOnly.data.id}`, {
      token: ADMIN, body: { confirm_slug: `book-qa-norooms-${suffix}` },
    });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== BOOKING SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  process.exit(p1Failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
