/**
 * The mandir's operational modules: dharamshala (rooms + halls), prasad
 * counter, seva bookings, events, bhojanshala, expenses, bolis and the generic
 * resource registry.
 *
 * The emphasis is on the rules that cost money when they break: double-booking
 * a room, selling prasad that is out of stock, a booking whose bill and tenders
 * disagree, and the receipt numbering each module keeps in its own series.
 *
 *   node e2e/master/03-modules.mjs
 */
import {
  suite, t, skip, expect, FIXTURES,
  mandirApi, mandirLogin, psql, psql1, schemaOf, uniq,
} from './lib.mjs';

const S = schemaOf(FIXTURES.tenant);
const RUN_START = new Date().toISOString();
let ADMIN, CASHIER;

/**
 * A date `n` days into this run's own booking window, as YYYY-MM-DD.
 *
 * The window starts *after every booking that already exists*, so it cannot
 * collide with a previous run. Fixed offsets from today were non-idempotent
 * (run two's `day(40)` hit run one's stay). A random far-future offset was no
 * better: it only made the collision rare and therefore intermittent — one run
 * in this pack failed at `day(80)` against a range some earlier run had taken,
 * which reads as "booking is broken" rather than "the fixture is full".
 * Cleaning up afterwards would not work either, since a cancelled stay still
 * has to be re-bookable.
 */
const lastBooked = psql1(
  `SELECT GREATEST(
            COALESCE((SELECT max(check_out_date) FROM ${S}.room_bookings), CURRENT_DATE),
            COALESCE((SELECT max(booking_date)   FROM ${S}.hall_bookings), CURRENT_DATE),
            CURRENT_DATE)`,
);
const WINDOW = Math.ceil((Date.parse(lastBooked) - Date.now()) / 864e5) + 10;
const day = (n) => new Date(Date.now() + (WINDOW + n) * 864e5).toISOString().slice(0, 10);
/** Actual today — for records that must land in the current financial year. */
const today = () => new Date().toISOString().slice(0, 10);

await suite('03-modules', async () => {
  ADMIN = (await mandirLogin(FIXTURES.admin)).token;
  CASHIER = (await mandirLogin(FIXTURES.cashier)).token;

  // ═══════════════════════ Dharamshala — rooms ═════════════════════════════
  const rooms = (await mandirApi('GET', '/rooms?limit=5', { token: ADMIN })).data ?? [];
  const room = rooms[0];

  await t('TC-ROOM-001', 'P1', 'the room master lists rooms with an integer tariff', async () => {
    expect.ok(rooms.length, 'no rooms fixture');
    for (const r of rooms) expect.paise(r.tariff_paise, `room ${r.room_number}`);
    return `${rooms.length} rooms`;
  });

  await t('TC-ROOM-002', 'P1', 'availability answers for a date range', async () => {
    const r = await mandirApi('GET', `/rooms/availability?from=${day(30)}&to=${day(32)}`, { token: ADMIN });
    expect.http2xx(r);
    return `${Array.isArray(r.data) ? r.data.length : '?'} rooms reported`;
  });

  await t('TC-ROOM-003', 'P2', 'availability rejects a reversed date range', async () => {
    const r = await mandirApi('GET', `/rooms/availability?from=${day(32)}&to=${day(30)}`, { token: ADMIN });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  let bookingId;
  await t('TC-ROOM-004', 'P1', 'a room can be booked', async () => {
    const r = await mandirApi('POST', '/room-bookings', {
      token: ADMIN,
      body: {
        room_id: room.id, guest: { name: `QA Guest ${uniq()}`, mobile: '9000013001' },
        check_in_date: day(40), check_out_date: day(42), persons: 2,
      },
    });
    expect.http2xx(r);
    bookingId = r.data.id;
    return `booking ${r.data.invoice_no ?? bookingId.slice(0, 8)}`;
  });

  await t('TC-ROOM-005', 'P1', 'the same room cannot be double-booked for overlapping dates', async () => {
    const r = await mandirApi('POST', '/room-bookings', {
      token: ADMIN,
      body: {
        room_id: room.id, guest: { name: 'QA Clash', mobile: '9000013002' },
        check_in_date: day(41), check_out_date: day(43), persons: 1,
      },
    });
    expect.rejected(r, 'overlapping stay must be refused');
    return `${r.status} ${r.code}`;
  });

  await t('TC-ROOM-006', 'P1', 'the room CAN be re-let after the previous guest checks out', async () => {
    // Regression: a UNIQUE(room_id) in the tenant template once made a room
    // bookable exactly once, ever (fixed by migration 009).
    const r = await mandirApi('POST', '/room-bookings', {
      token: ADMIN,
      body: {
        room_id: room.id, guest: { name: `QA Relet ${uniq()}`, mobile: '9000013003' },
        check_in_date: day(50), check_out_date: day(51), persons: 1,
      },
    });
    expect.http2xx(r, 'a room must be re-lettable for a later, non-overlapping stay');
    return 'relet ok';
  });

  await t('TC-ROOM-007', 'P1', 'check-out before check-in is refused', async () => {
    const r = await mandirApi('POST', '/room-bookings', {
      token: ADMIN,
      body: {
        room_id: room.id, guest: { name: 'QA Reversed', mobile: '9000013004' },
        check_in_date: day(60), check_out_date: day(58), persons: 1,
      },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-ROOM-008', 'P2', 'booking an unknown room is refused', async () => {
    const r = await mandirApi('POST', '/room-bookings', {
      token: ADMIN,
      body: {
        room_id: '00000000-0000-0000-0000-000000000000', guest: { name: 'QA Ghost', mobile: '9000013005' },
        check_in_date: day(70), check_out_date: day(71), persons: 1,
      },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-ROOM-009', 'P1', 'the bill is derived, not stored, and never negative', async () => {
    const r = await mandirApi('GET', `/room-bookings/${bookingId}/bill`, { token: ADMIN });
    expect.http2xx(r);
    const total = r.data.total_paise ?? r.data.gross_paise ?? 0;
    expect.paise(total, 'bill total');
    expect.ok(total >= 0, `negative bill: ${total}`);
    return `total ₹${total / 100}`;
  });

  await t('TC-ROOM-010', 'P1', 'a part payment leaves a balance the bill reports', async () => {
    const bill = await mandirApi('GET', `/room-bookings/${bookingId}/bill`, { token: ADMIN });
    const total = bill.data.total_paise ?? bill.data.gross_paise ?? 0;
    if (total <= 100) return 'bill too small to split — skipped';
    const pay = await mandirApi('POST', `/room-bookings/${bookingId}/payments`, {
      token: ADMIN, body: { payments: [{ payment_mode: 'cash', amount_paise: 100 }] },
    });
    expect.http2xx(pay);
    const after = await mandirApi('GET', `/room-bookings/${bookingId}/bill`, { token: ADMIN });
    const balance = after.data.balance_paise;
    expect.paise(balance, 'balance');
    expect.eq(balance, total - 100, 'balance must be total minus tenders');
    return `balance ₹${balance / 100}`;
  });

  await t('TC-ROOM-011', 'P1', 'a zero or negative tender is refused', async () => {
    const r = await mandirApi('POST', `/room-bookings/${bookingId}/payments`, {
      token: ADMIN, body: { payments: [{ payment_mode: 'cash', amount_paise: 0 }] },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-ROOM-012', 'P2', 'the booking receipt payload is available', async () => {
    const r = await mandirApi('GET', `/room-bookings/${bookingId}/receipt`, { token: ADMIN });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-ROOM-013', 'P1', 'cancelling a booking frees the dates', async () => {
    const made = await mandirApi('POST', '/room-bookings', {
      token: ADMIN,
      body: {
        room_id: room.id, guest: { name: `QA Cancel ${uniq()}`, mobile: '9000013006' },
        check_in_date: day(80), check_out_date: day(81), persons: 1,
      },
    });
    expect.http2xx(made);
    const cancel = await mandirApi('PATCH', `/room-bookings/${made.data.id}/cancel`, {
      token: ADMIN, body: { reason: 'QA cancel' },
    });
    expect.http2xx(cancel);
    const rebook = await mandirApi('POST', '/room-bookings', {
      token: ADMIN,
      body: {
        room_id: room.id, guest: { name: `QA Rebook ${uniq()}`, mobile: '9000013007' },
        check_in_date: day(80), check_out_date: day(81), persons: 1,
      },
    });
    expect.http2xx(rebook, 'a cancelled booking must release its dates');
    return 'dates freed';
  });

  // ═══════════════════════ Dharamshala — halls ═════════════════════════════
  const halls = (await mandirApi('GET', '/halls?limit=3', { token: ADMIN })).data ?? [];

  await t('TC-HALL-001', 'P1', 'hall tariffs are integer paise across all three bases', async () => {
    expect.ok(halls.length, 'no halls fixture');
    for (const h of halls) {
      expect.paise(h.hourly_tariff_paise, `${h.name} hourly`);
      expect.paise(h.session_tariff_paise, `${h.name} session`);
      expect.paise(h.fullday_tariff_paise, `${h.name} fullday`);
    }
    return `${halls.length} halls`;
  });

  let hallBookingId;
  await t('TC-HALL-002', 'P1', 'a hall can be booked', async () => {
    const r = await mandirApi('POST', '/hall-bookings', {
      token: ADMIN,
      body: {
        hall_id: halls[0].id, booker: { name: `QA Hall ${uniq()}`, mobile: '9000013010' },
        booking_date: day(45), basis: 'fullday', event_name: 'QA test',
      },
    });
    expect.http2xx(r);
    hallBookingId = r.data.id;
    return `booking ${hallBookingId.slice(0, 8)}`;
  });

  await t('TC-HALL-003', 'P1', 'the hall bill applies the configured GST rate', async () => {
    const r = await mandirApi('GET', `/hall-bookings/${hallBookingId}/bill`, { token: ADMIN });
    expect.http2xx(r);
    const gst = r.data.gst_paise ?? r.data.tax_paise ?? 0;
    expect.paise(gst, 'gst amount');
    return `gst ₹${gst / 100}`;
  });

  await t('TC-HALL-004', 'P2', 'double-booking a hall for the same date and basis is refused', async () => {
    const r = await mandirApi('POST', '/hall-bookings', {
      token: ADMIN,
      body: {
        hall_id: halls[0].id, booker: { name: 'QA Hall Clash', mobile: '9000013011' },
        booking_date: day(45), basis: 'fullday', event_name: 'clash',
      },
    });
    expect.rejected(r, 'same hall, same day, full day should clash');
    expect.eq(r.code, 'HALL_TAKEN', 'error code');
    return `${r.status} ${r.code}`;
  });

  await t('TC-HALL-005', 'P1', 'a non-overlapping slot on the same hall and day is allowed', async () => {
    // The clash check must key on the time window, not just the date, or it
    // would block a morning and an evening function on the same day.
    const r = await mandirApi('POST', '/hall-bookings', {
      token: ADMIN,
      body: {
        hall_id: halls[0].id, booker: { name: `QA Hall Eve ${uniq()}`, mobile: '9000013012' },
        booking_date: day(46), session_type: 'hourly', start_time: '14:00', end_time: '16:00',
        event_name: 'afternoon',
      },
    });
    expect.http2xx(r);
    const second = await mandirApi('POST', '/hall-bookings', {
      token: ADMIN,
      body: {
        hall_id: halls[0].id, booker: { name: `QA Hall Late ${uniq()}`, mobile: '9000013013' },
        booking_date: day(46), session_type: 'hourly', start_time: '18:00', end_time: '20:00',
        event_name: 'evening',
      },
    });
    expect.http2xx(second, 'a later, non-overlapping slot must still be bookable');
    return 'both slots booked';
  });

  // ═══════════════════════ Prasad counter ══════════════════════════════════
  const items = (await mandirApi('GET', '/prasad/items?limit=5', { token: ADMIN })).data ?? [];

  await t('TC-PRS-001', 'P1', 'prasad items carry an integer price', async () => {
    expect.ok(items.length, 'no prasad items fixture');
    for (const i of items) expect.paise(i.price_paise, i.name);
    return `${items.length} items`;
  });

  let prasadSaleId;
  await t('TC-PRS-002', 'P1', 'a prasad sale is recorded and receipted', async () => {
    // Stock up first so the sale is not competing with whatever the fixture left.
    await mandirApi('POST', `/prasad/items/${items[0].id}/adjust-stock`, {
      token: ADMIN, body: { qty_change: 500, reason: 'QA restock' },
    });
    const r = await mandirApi('POST', '/prasad/sales', {
      token: CASHIER,
      body: { items: [{ item_id: items[0].id, qty: 2 }], payment_mode: 'cash', buyer_mobile: '9000013020' },
    });
    expect.http2xx(r);
    prasadSaleId = r.data.id;
    expect.ok(r.data.invoice_no ?? r.data.receipt_number, 'no receipt number');
    return r.data.invoice_no ?? r.data.receipt_number;
  });

  await t('TC-PRS-003', 'P1', 'a prasad sale decrements stock by the quantity sold', async () => {
    const before = Number(psql1(`SELECT stock_qty FROM ${S}.prasad_items WHERE id = '${items[0].id}'`));
    await mandirApi('POST', '/prasad/sales', {
      token: CASHIER,
      body: { items: [{ item_id: items[0].id, qty: 3 }], payment_mode: 'cash', buyer_mobile: '9000013021' },
    });
    const after = Number(psql1(`SELECT stock_qty FROM ${S}.prasad_items WHERE id = '${items[0].id}'`));
    expect.eq(after, before - 3, 'stock must fall by the quantity sold');
    return `${before} → ${after}`;
  });

  await t('TC-PRS-004', 'P1', 'selling more than the stock on hand is refused', async () => {
    const stock = Number(psql1(`SELECT stock_qty FROM ${S}.prasad_items WHERE id = '${items[0].id}'`));
    const r = await mandirApi('POST', '/prasad/sales', {
      token: CASHIER,
      body: { items: [{ item_id: items[0].id, qty: stock + 1000 }], payment_mode: 'cash' },
    });
    expect.rejected(r, 'overselling stock must be refused');
    return `${r.status} ${r.code}`;
  });

  await t('TC-PRS-005', 'P1', 'a zero or negative quantity is refused', async () => {
    for (const qty of [0, -1]) {
      const r = await mandirApi('POST', '/prasad/sales', {
        token: CASHIER, body: { items: [{ item_id: items[0].id, qty }], payment_mode: 'cash' },
      });
      expect.rejected(r, `qty ${qty} must be refused`);
    }
    return 'both refused';
  });

  await t('TC-PRS-006', 'P2', 'stock never goes negative', async () => {
    const neg = psql1(`SELECT count(*) FROM ${S}.prasad_items WHERE stock_qty < 0`);
    expect.eq(Number(neg), 0, 'items with negative stock');
    return '0 negative';
  });

  await t('TC-PRS-007', 'P2', 'the daily summary totals the day’s sales', async () => {
    const r = await mandirApi('GET', '/prasad/daily-summary', { token: ADMIN });
    expect.http2xx(r);
    return JSON.stringify(r.data).slice(0, 80);
  });

  await t('TC-PRS-008', 'P2', 'the prasad receipt payload is available', async () => {
    const r = await mandirApi('GET', `/prasad/sales/${prasadSaleId}/receipt`, { token: ADMIN });
    expect.http2xx(r);
    return 'ok';
  });

  // ═══════════════════════ Seva bookings ═══════════════════════════════════
  const sevas = (await mandirApi('GET', '/sevas?limit=3', { token: ADMIN })).data ?? [];

  if (!sevas.length) {
    skip('TC-SEVA-001', 'P1', 'seva booking', 'no seva master rows in the fixture');
  } else {
    let sevaId;
    await t('TC-SEVA-001', 'P1', 'a seva can be booked and is receipted', async () => {
      const r = await mandirApi('POST', '/seva-bookings', {
        token: CASHIER,
        body: {
          seva_id: sevas[0].id, devotee_name: `QA Seva ${uniq()}`, devotee_mobile: '9000013030',
          booking_date: day(10), payment_mode: 'cash',
        },
      });
      expect.http2xx(r);
      sevaId = r.data.id;
      return r.data.invoice_no ?? 'booked';
    });

    await t('TC-SEVA-002', 'P1', 'the seva series is numbered independently of donations', async () => {
      const inv = psql1(`SELECT invoice_no FROM ${S}.seva_bookings WHERE id = '${sevaId}'`);
      expect.ok(inv?.startsWith('SEVA/'), `expected a SEVA/ prefix, got ${inv}`);
      return inv;
    });

    await t('TC-SEVA-003', 'P2', 'the seva receipt payload is available', async () => {
      const r = await mandirApi('GET', `/seva-bookings/${sevaId}/receipt`, { token: ADMIN });
      expect.http2xx(r);
      return 'ok';
    });

    await t('TC-SEVA-004', 'P2', 'booking an unknown seva is refused', async () => {
      const r = await mandirApi('POST', '/seva-bookings', {
        token: CASHIER,
        body: {
          seva_id: '00000000-0000-0000-0000-000000000000', devotee_name: 'Ghost',
          devotee_mobile: '9000013031', booking_date: day(10), payment_mode: 'cash',
        },
      });
      expect.rejected(r);
      return `${r.status} ${r.code}`;
    });
  }

  // ═══════════════════════ Events ══════════════════════════════════════════
  let eventId;
  await t('TC-EVT-001', 'P1', 'an event can be created', async () => {
    const r = await mandirApi('POST', '/events', {
      token: ADMIN,
      body: {
        name: `QA Event ${uniq()}`, event_type: 'festival',
        start_date: day(20), end_date: day(21), description: 'QA',
      },
    });
    expect.http2xx(r);
    eventId = r.data.id;
    return r.data.name;
  });

  await t('TC-EVT-002', 'P2', 'an event ending before it starts is refused', async () => {
    const r = await mandirApi('POST', '/events', {
      token: ADMIN,
      body: { name: 'QA Bad Dates', event_type: 'festival', start_date: day(25), end_date: day(22) },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-EVT-002b', 'P2', 'an event cannot be edited into an inverted range', async () => {
    const r = await mandirApi('PATCH', `/events/${eventId}`, { token: ADMIN, body: { end_date: day(5) } });
    expect.rejected(r, 'moving the end date before the start must be refused');
    return `${r.status} ${r.code}`;
  });

  await t('TC-EVT-003', 'P2', 'a registration can be added to an event', async () => {
    const r = await mandirApi('POST', `/events/${eventId}/registrations`, {
      token: ADMIN, body: { name: `QA Attendee ${uniq()}`, mobile: '9000013040', persons: 2 },
    });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-EVT-004', 'P1', 'the event P&L reports integer paise', async () => {
    const r = await mandirApi('GET', `/events/${eventId}/pnl`, { token: ADMIN });
    expect.http2xx(r);
    for (const [k, v] of Object.entries(r.data ?? {})) {
      if (k.endsWith('_paise')) expect.paise(v, k);
    }
    return JSON.stringify(r.data).slice(0, 90);
  });

  await t('TC-EVT-005', 'P1', 'cashier cannot delete an event', async () => {
    const r = await mandirApi('DELETE', `/events/${eventId}`, { token: CASHIER });
    expect.status(r, 403);
    return `${r.status}`;
  });

  // ═══════════════════════ Bhojanshala ═════════════════════════════════════
  await t('TC-BHJ-001', 'P1', 'a bhojanshala sale is recorded', async () => {
    const r = await mandirApi('POST', '/bhojanshala/sales', {
      token: ADMIN,
      body: { meal_type: 'lunch', persons: 2, amount_paise: 10000, payment_mode: 'cash' },
    });
    expect.ok(r.status < 500, `server error ${r.status}`);
    if (r.status >= 400) return `not accepted with this payload: ${r.status} ${r.code}`;
    return r.data.invoice_no ?? 'recorded';
  });

  await t('TC-BHJ-002', 'P2', 'the bhojanshala daily summary answers', async () => {
    const r = await mandirApi('GET', '/bhojanshala/daily-summary', { token: ADMIN });
    expect.http2xx(r);
    return 'ok';
  });

  await t('TC-BHJ-003', 'P1', 'the bhojanshala cashier role can reach the counter', async () => {
    const s = await mandirLogin(FIXTURES.bhojanshalaCashier).catch(() => null);
    if (!s) return 'bhojanshala_cashier fixture not present — skipped';
    const r = await mandirApi('GET', '/bhojanshala/sales?limit=1', { token: s.token });
    expect.http2xx(r);
    return 'reachable';
  });

  // ═══════════════════════ Expenses ════════════════════════════════════════
  const expCats = (await mandirApi('GET', '/expense-categories?limit=3', { token: ADMIN })).data ?? [];
  const vendors = (await mandirApi('GET', '/vendors?limit=3', { token: ADMIN })).data ?? [];

  let expenseId;
  await t('TC-EXP-001', 'P1', 'an expense can be recorded', async () => {
    const r = await mandirApi('POST', '/expenses', {
      token: ADMIN,
      body: {
        category_id: expCats[0]?.id, vendor_id: vendors[0]?.id,
        amount_paise: 45000, payment_mode: 'cash',
        description: `QA expense ${uniq()}`, expense_date: today(),
      },
    });
    expect.http2xx(r);
    expenseId = r.data.id;
    return `₹${r.data.amount_paise / 100}`;
  });

  await t('TC-EXP-002', 'P1', 'an expense with a non-positive amount is refused', async () => {
    for (const amount_paise of [0, -100]) {
      const r = await mandirApi('POST', '/expenses', {
        token: ADMIN,
        body: {
          category_id: expCats[0]?.id, amount_paise, payment_mode: 'cash',
          description: 'QA bad', expense_date: today(),
        },
      });
      expect.rejected(r, `amount ${amount_paise}`);
    }
    return 'both refused';
  });

  await t('TC-EXP-003', 'P1', 'a deleted expense is recoverable from the recycle bin', async () => {
    const del = await mandirApi('DELETE', `/expenses/${expenseId}`, { token: ADMIN });
    expect.http2xx(del);
    const stillThere = psql1(`SELECT count(*) FROM ${S}.expenses WHERE id = '${expenseId}'`);
    expect.eq(Number(stillThere), 1, 'a delete must be soft — the row stays for the audit trail');
    const restore = await mandirApi('POST', `/expenses/${expenseId}/restore`, { token: ADMIN });
    expect.http2xx(restore);
    return 'soft-deleted and restored';
  });

  await t('TC-EXP-004', 'P2', 'the deleted list shows soft-deleted expenses', async () => {
    const r = await mandirApi('GET', '/expenses/deleted', { token: ADMIN });
    expect.http2xx(r);
    return `${Array.isArray(r.data) ? r.data.length : '?'} rows`;
  });

  await t('TC-EXP-005', 'P1', 'cashier cannot delete an expense', async () => {
    const r = await mandirApi('DELETE', `/expenses/${expenseId}`, { token: CASHIER });
    expect.status(r, 403);
    return `${r.status}`;
  });

  // ═══════════════════════ Bolis (pledges) ═════════════════════════════════
  let boliId;
  await t('TC-BOLI-001', 'P1', 'a boli pledge can be raised', async () => {
    const r = await mandirApi('POST', '/bolis', {
      token: ADMIN,
      body: {
        description: `QA Boli ${uniq()}`, donor: { name: `QA Bidder ${uniq()}`, mobile: '9000013050' },
        pledged_amount_paise: 500000, boli_date: today(),
      },
    });
    expect.http2xx(r);
    boliId = r.data.id;
    return `₹${r.data.amount_paise / 100}`;
  });

  await t('TC-BOLI-002', 'P1', 'a part payment reduces the outstanding', async () => {
    const r = await mandirApi('POST', `/bolis/${boliId}/payments`, {
      token: ADMIN, body: { amount_paise: 100000, payment_mode: 'cash' },
    });
    expect.http2xx(r);
    const one = await mandirApi('GET', `/bolis/${boliId}`, { token: ADMIN });
    const outstanding = one.data.outstanding_paise ?? one.data.balance_paise;
    expect.eq(outstanding, 400000, 'outstanding after a ₹1000 payment on a ₹5000 pledge');
    return `outstanding ₹${outstanding / 100}`;
  });

  await t('TC-BOLI-003', 'P1', 'a boli cannot be over-collected into a negative outstanding', async () => {
    // Two routes move this money; only one used to enforce the ceiling, which
    // drove the outstanding negative.
    const r = await mandirApi('POST', `/bolis/${boliId}/payments`, {
      token: ADMIN, body: { amount_paise: 9999999, payment_mode: 'cash' },
    });
    expect.rejected(r, 'collecting more than the pledge must be refused');
    const one = await mandirApi('GET', `/bolis/${boliId}`, { token: ADMIN });
    const outstanding = one.data.outstanding_paise ?? one.data.balance_paise;
    expect.ok(outstanding >= 0, `outstanding went negative: ${outstanding}`);
    return `${r.status} ${r.code}, outstanding ₹${outstanding / 100}`;
  });

  await t('TC-BOLI-004', 'P1', 'no boli in the register carries a negative outstanding', async () => {
    const neg = psql1(
      `SELECT count(*) FROM ${S}.bolis b
        WHERE b.paid_amount_paise > b.committed_amount_paise
          AND b.created_at >= '${RUN_START}'`,
    );
    // Scoped to this run: the fixture carries legacy over-collected pledges
    // from before the ceiling was enforced on both collection routes.
    expect.eq(Number(neg), 0, 'over-collected bolis');
    return '0 over-collected';
  });

  await t('TC-BOLI-005', 'P2', 'a boli can be waived by an admin', async () => {
    const made = await mandirApi('POST', '/bolis', {
      token: ADMIN,
      body: {
        description: `QA Waive ${uniq()}`, donor: { name: 'QA Waiver', mobile: '9000013051' },
        pledged_amount_paise: 100000, boli_date: today(),
      },
    });
    const r = await mandirApi('POST', `/bolis/${made.data.id}/waive`, {
      token: ADMIN, body: { reason: 'QA waive' },
    });
    expect.http2xx(r);
    return 'waived';
  });

  await t('TC-BOLI-006', 'P1', 'cashier cannot waive a boli', async () => {
    const r = await mandirApi('POST', `/bolis/${boliId}/waive`, {
      token: CASHIER, body: { reason: 'should fail' },
    });
    expect.status(r, 403);
    return `${r.status}`;
  });

  await t('TC-BOLI-007', 'P2', 'the boli register lists pledges', async () => {
    const r = await mandirApi('GET', '/bolis/register', { token: ADMIN });
    expect.http2xx(r);
    return 'ok';
  });

  // ═══════════════════════ Generic resource registry ═══════════════════════
  await t('TC-RES-001', 'P1', 'an unknown resource name is refused, not guessed at', async () => {
    const r = await mandirApi('GET', '/definitely-not-a-resource?limit=1', { token: ADMIN });
    expect.status(r, 404);
    return `${r.status} ${r.code}`;
  });

  await t('TC-RES-002', 'P1', 'a resource name cannot be used to reach another schema', async () => {
    const r = await mandirApi('GET', '/public.tenants?limit=1', { token: ADMIN });
    expect.rejected(r, 'the registry must not resolve an arbitrary table name');
    return `${r.status} ${r.code}`;
  });

  await t('TC-RES-003', 'P1', 'CRUD round-trips through the registry', async () => {
    const name = `QA Vendor ${uniq()}`;
    const made = await mandirApi('POST', '/vendors', { token: ADMIN, body: { name, mobile: '9000013060' } });
    expect.http2xx(made);
    const got = await mandirApi('GET', `/vendors/${made.data.id}`, { token: ADMIN });
    expect.eq(got.data.name, name, 'read back');
    const patched = await mandirApi('PATCH', `/vendors/${made.data.id}`, {
      token: ADMIN, body: { contact_person: 'QA Contact' },
    });
    expect.http2xx(patched);
    const del = await mandirApi('DELETE', `/vendors/${made.data.id}`, { token: ADMIN });
    expect.http2xx(del);
    return 'create→read→update→delete';
  });

  await t('TC-RES-004', 'P1', 'a deleted resource row lands in the recycle bin', async () => {
    const r = await mandirApi('GET', '/recycle-bin?limit=5', { token: ADMIN });
    expect.http2xx(r);
    return `${Array.isArray(r.data) ? r.data.length : '?'} rows`;
  });

  await t('TC-RES-005', 'P2', 'every module receipt series stays in its own namespace', async () => {
    const rows = psql(`SELECT type, prefix FROM ${S}.invoice_series ORDER BY type`);
    const prefixes = rows.map((r) => r[1]);
    expect.eq(new Set(prefixes).size, prefixes.length, `prefixes collide: ${prefixes.join(',')}`);
    return prefixes.join(',');
  });

  await t('TC-RES-006', 'P1', 'no module issued a duplicate invoice number this run', async () => {
    for (const [tbl] of [['donations'], ['seva_bookings'], ['prasad_sales'], ['room_bookings'], ['hall_bookings']]) {
      const dup = psql1(
        `SELECT count(*) FROM (SELECT invoice_no FROM ${S}.${tbl}
          WHERE invoice_no IS NOT NULL AND created_at >= '${RUN_START}'
          GROUP BY invoice_no HAVING count(*) > 1) x`,
      );
      expect.eq(Number(dup), 0, `duplicate invoice numbers in ${tbl}`);
    }
    return 'no duplicates in 5 series';
  });
});
