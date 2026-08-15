/**
 * Mobile payload parity — do the phones' own payloads account correctly?
 *
 * The mobile apps are the clients that send the LEAST: of mandir-mobile's eight
 * money-writing calls, only `createDonation` ever sends `payment_account_id`,
 * and it only sends it when the caller happened to supply one. Every non-cash
 * rupee taken on a phone therefore depended on the server resolving an account
 * by itself — and until 2026-08-15 the server resolved non-cash to `null`, which
 * the journal books to Suspense.
 *
 * So the web suites could be perfectly green while the phones quietly filled
 * "Suspense — unallocated receipts/payments". This suite replays each mobile
 * payload EXACTLY as the Dart repository builds it (see
 * `mandir-mobile/app/lib/data/repositories.dart`) and then checks the books:
 * every rupee must reach a real cash or bank account, and Suspense must stay
 * at zero.
 *
 * Run: node 14-mobile-payload-parity.mjs
 */
import {
  suite, t, mandirApi, devoteeApi, mandirLogin, devoteeLogin,
  expect, FIXTURES, psql1, schemaOf,
} from './lib.mjs';

// A `tenant_x.` qualifier lets `psql()` route itself to the pool database the
// schema actually lives in, so nothing here has to know about jainerp_pool_N.
const S = schemaOf(FIXTURES.tenant);

const todayIst = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const TODAY = todayIst();
const dPlus = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
// Rooms carry a no-overlap exclusion constraint, so a fixed window makes the
// suite bookable exactly once. Offset far out and by the clock so re-running
// never collides with its own previous run.
const ROOM_OFFSET = 200 + (Math.floor(Date.now() / 1000) % 500);
const FY = '2026-27';
const rs = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

let TOKEN = null;
const api = (m, p, body) => mandirApi(m, p, { token: TOKEN, body });

async function post(path, body, what) {
  const r = await api('POST', path, body);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`);
  }
  return r.data;
}

/** Every non-cash tender the phones write, in the shape the Dart code sends. */
const created = [];

await suite('14-mobile-payload-parity', async () => {
  ({ token: TOKEN } = await mandirLogin(FIXTURES.admin, FIXTURES.tenant));

  const list = async (res) => {
    const r = await api('GET', `/${res}?limit=100`);
    const rows = r.data?.rows ?? r.data ?? [];
    return Array.isArray(rows) ? rows : [];
  };
  const accounts = await list('accounts');
  const rooms = await list('rooms');
  const sevas = await list('sevas');
  const cats = await list('donation-categories');
  const prasadItems = await list('prasad/items');
  const defaultBank = accounts.find((a) => a.is_default_bank);
  const defaultCash = accounts.find((a) => a.is_default_cash);

  await t('MOB-SETUP-01', 'P1', 'the trust has a default cash and bank account', async () => {
    expect.ok(defaultCash?.id, 'no is_default_cash account');
    expect.ok(defaultBank?.id, 'no is_default_bank account — non-cash cannot resolve');
    return `cash=${defaultCash.name}, bank=${defaultBank.name}`;
  });

  // ── mandir-mobile: the eight money writes, payload-for-payload ────────────
  // Each uses a NON-CASH mode and omits payment_account_id, which is exactly
  // what the Dart repository does — that combination is the one that used to
  // land in Suspense.

  await t('MOB-DON-01', 'P1', 'donation (UPI, no account) — repositories.dart createDonation', async () => {
    const d = await post('/donations', {
      category_id: cats[0]?.id,
      amount_paise: 2_50_000,
      payment_mode: 'upi',
      is_80g_eligible: false,
      utr_number: 'MOBUPI001',
      // The Dart nests the donor; flat donor_name is ignored and the insert
      // then fails on "Donor name is required".
      donor: { name: 'Mobile Donor', mobile: '9700001001' },
    }, 'mobile donation');
    const row = d?.donation ?? d;
    expect.ok(row?.id, 'no donation id');
    created.push({ kind: 'donation', id: row.id, paise: 2_50_000 });
    return `${row.receipt_no ?? row.id} ${rs(2_50_000)}`;
  });

  await t('MOB-PRA-01', 'P1', 'prasad sale (card, no account) — createPrasadSale', async () => {
    const item = prasadItems[0];
    const s = await post('/prasad/sales', {
      items: [{ item_id: item.id, qty: 3 }],
      payment_mode: 'card',
      is_anonymous: false,
      buyer_name: 'Mobile Buyer',
      buyer_mobile: '9700001002',
    }, 'mobile prasad sale');
    const row = s?.sale ?? s;
    const expected = Math.round(Number(item.price_paise)) * 3;
    // The create response carries only {id, invoice_no, total_paise, items},
    // so the subtotal/GST split has to come from the register.
    const sales = (await api('GET', '/prasad/sales?limit=100')).data;
    const full = (sales.rows ?? sales).find((x) => x.id === row.id);
    expect.ok(full, 'sale missing from the register');
    expect.eq(Number(full.subtotal_paise), expected, 'qty × price');
    expect.eq(Number(row.total_paise), Number(full.subtotal_paise) + Number(full.gst_paise),
      'total ≠ subtotal + GST');
    created.push({ kind: 'prasad', id: row.id, paise: Number(row.total_paise) });
    return `subtotal ${rs(full.subtotal_paise)} + GST ${rs(full.gst_paise)} = ${rs(row.total_paise)}`;
  });

  // The phone sends `tokens` + `rate_paise`; the web counter sends `plates` +
  // `rate_per_plate_paise`. Both are accepted, and both must price the same.
  await t('MOB-BHO-01', 'P1', 'bhojanshala sale (upi, tokens/rate_paise spelling)', async () => {
    const s = await post('/bhojanshala/sales', {
      tokens: 12,
      rate_paise: 5_000,
      meal_type: 'lunch',
      payment_mode: 'upi',
      buyer_name: 'Mobile Bhoj',
      buyer_mobile: '9700001003',
    }, 'mobile bhojanshala sale');
    const row = s?.sale ?? s;
    expect.eq(Number(row.total_paise ?? row.amount_paise), 12 * 5_000,
      'tokens × rate_paise must price like plates × rate_per_plate_paise');
    created.push({ kind: 'bhojanshala', id: row.id, paise: 12 * 5_000 });
    return `12 × ${rs(5_000)} = ${rs(12 * 5_000)}`;
  });

  await t('MOB-ROM-01', 'P1', 'room booking (neft advance, no account) — createRoomBooking', async () => {
    const room = rooms[0];
    const b = await post('/room-bookings', {
      room_id: room.id,
      devotee: { name: 'Mobile Guest', mobile: '9700001004' },
      check_in_date: dPlus(ROOM_OFFSET),
      check_out_date: dPlus(ROOM_OFFSET + 2),
      persons: 2,
      advance_paise: 1_00_000,
      payment_mode: 'neft',
    }, 'mobile room booking');
    const row = b?.booking ?? b;
    expect.ok(row?.id, 'no booking id');
    created.push({ kind: 'room', id: row.id, paise: 1_00_000 });
    return `${row.invoice_no ?? row.id} advance ${rs(1_00_000)}`;
  });

  await t('MOB-SEV-01', 'P1', 'seva booking (card, no account) — createSevaBooking', async () => {
    const sv = sevas[0];
    const s = await post('/seva-bookings', {
      service_id: sv.id,
      amount_paise: Math.round(Number(sv.price_paise)),
      payment_mode: 'card',
      is_anonymous: false,
      devotee: { name: 'Mobile Sevak', mobile: '9700001005' },
      gotra: 'Kashyap',
      seva_date: TODAY,
    }, 'mobile seva booking');
    const row = s?.booking ?? s;
    created.push({ kind: 'seva', id: row.id, paise: Math.round(Number(sv.price_paise)) });
    return `${sv.name} ${rs(sv.price_paise)}`;
  });

  await t('MOB-BOL-01', 'P1', 'named boli pledge then payment (upi) — createBoli + payBoli', async () => {
    const b = await post('/bolis', {
      description: 'Mobile Boli', pledged_amount_paise: 5_00_000,
      is_anonymous: false, devotee: { name: 'Mobile Pledger', mobile: '9700001006' },
    }, 'mobile boli');
    const id = (b?.boli ?? b).id;
    await post(`/bolis/${id}/payments`, {
      amount_paise: 2_00_000, payment_mode: 'upi', utr: 'MOBBOLI01',
    }, 'mobile boli payment');
    created.push({ kind: 'boli-payment', id, paise: 2_00_000 });
    return `pledged ${rs(5_00_000)}, paid ${rs(2_00_000)}`;
  });

  // `createBoli(isAnonymous: true)` is a supported call on the phone and a
  // "Gupt Daan" chip on the web. Collecting against it must work, or the pledge
  // can never be settled and the money is uncollectable through the product.
  await t('MOB-BOL-02', 'P1', 'an anonymous (gupt daan) pledge can be collected', async () => {
    const b = await post('/bolis', {
      description: 'Mobile Anonymous Boli', pledged_amount_paise: 4_00_000,
      is_anonymous: true,
    }, 'anonymous boli');
    const boli = b?.boli ?? b;
    const pay = await api('POST', `/bolis/${boli.id}/payments`, {
      amount_paise: 1_50_000, payment_mode: 'upi', utr: 'MOBANON01',
    });
    expect.http2xx(pay, 'collecting against an anonymous pledge');
    created.push({ kind: 'boli-payment', id: boli.id, paise: 1_50_000 });

    // …and the receipt must stay anonymous: the pledger asked for that.
    const reg = (await api('GET', `/reports/donation-register?fy=${FY}&limit=500`)).data;
    const named = (reg.rows ?? []).find(
      (r) => /Mobile Anonymous/.test(r.donor ?? '') && r.donor !== 'Anonymous',
    );
    expect.ok(!named, `the anonymous pledger was named on the receipt: ${named?.donor}`);

    const after = (await api('GET', `/bolis/${boli.id}`)).data;
    const row = after?.boli ?? after;
    expect.eq(Number(row.paid_amount_paise), 1_50_000, 'paid total');
    expect.eq(Number(row.outstanding_paise ?? (4_00_000 - 1_50_000)), 2_50_000, 'outstanding');
    return `collected ${rs(1_50_000)} of ${rs(4_00_000)}, ${rs(2_50_000)} outstanding`;
  });

  await t('MOB-EXP-01', 'P1', 'expense (neft, no account) — createExpense', async () => {
    const e = await post('/expenses', {
      amount_paise: 3_00_000,
      category: 'Electricity',
      description: 'Mobile expense',
      payment_mode: 'neft',
      is_on_credit: false,
      vendor_name: 'Mobile Vendor',
      expense_date: TODAY,
    }, 'mobile expense');
    const row = e?.expense ?? e;
    created.push({ kind: 'expense', id: row.id, paise: 3_00_000 });
    return `${row.voucher_no ?? row.id} ${rs(3_00_000)}`;
  });

  // ── The point of the suite: where did the phones' money land? ─────────────
  await t('MOB-ACCT-01', 'P1', 'every non-cash mobile tender resolved to a real account', async () => {
    const unresolved = psql1(
      `SELECT count(*) FROM ${S}.payments
        WHERE payment_account_id IS NULL AND payment_mode NOT IN ('cash','cheque')`,
    );
    expect.eq(Number(unresolved), 0,
      `${unresolved} non-cash tenders have no account — they will post to Suspense`);
    return 'all non-cash tenders carry an account';
  });

  await t('MOB-ACCT-02', 'P1', 'the phones’ money reached the default bank account', async () => {
    const bankPaise = Number(psql1(
      `SELECT COALESCE(SUM(amount_paise),0) FROM ${S}.payments WHERE payment_account_id = '${defaultBank.id}'`,
    ));
    expect.ok(bankPaise > 0, 'nothing reached the default bank account');
    return rs(bankPaise);
  });

  await t('MOB-ACCT-03', 'P1', 'after sync, Suspense is still zero', async () => {
    const sync = await api('POST', '/journal/sync', { fy: FY });
    expect.http2xx(sync, 'journal sync');
    const tb = (await api('GET', `/journal/trial-balance?fy=${FY}`)).data;
    const susp = tb.rows.find((r) => r.code === '1900');
    const amount = Number(susp?.debit_paise ?? 0) - Number(susp?.credit_paise ?? 0);
    expect.eq(amount, 0,
      `${rs(amount)} of mobile money is sitting in Suspense — unallocated receipts/payments`);
    return `Suspense ${rs(0)} across ${tb.rows.length} accounts`;
  });

  await t('MOB-ACCT-04', 'P1', 'the books still balance with the mobile entries in', async () => {
    const tb = (await api('GET', `/journal/trial-balance?fy=${FY}`)).data;
    const dr = tb.rows.reduce((s, r) => s + Number(r.debit_paise), 0);
    const cr = tb.rows.reduce((s, r) => s + Number(r.credit_paise), 0);
    expect.eq(dr, cr, `debits ${rs(dr)} vs credits ${rs(cr)}`);
    const bs = (await api('GET', `/accounting/balance-sheet?fy=${FY}`)).data;
    expect.eq(Number(bs.difference_paise), 0, `balance sheet difference ${rs(bs.difference_paise)}`);
    return `Dr = Cr = ${rs(dr)}, balance sheet diff ${rs(0)}`;
  });

  await t('MOB-ACCT-05', 'P1', 'mobile receipts appear in the collection summary', async () => {
    const col = (await api('GET', `/reports/collection-summary?fy=${FY}`)).data;
    const streams = (col.included_streams ?? []).map((k) => Number(col[k] ?? 0));
    expect.eq(Number(col.total_collection_paise), streams.reduce((a, b) => a + b, 0), 'streams vs total');
    const inflow = created.filter((c) => c.kind !== 'expense').reduce((s, c) => s + c.paise, 0);
    expect.ok(Number(col.total_collection_paise) >= inflow,
      `collection ${rs(col.total_collection_paise)} < the ${rs(inflow)} entered from mobile payloads`);
    return `${rs(col.total_collection_paise)} collected, mobile contributed ${rs(inflow)}`;
  });

  // ── devotee-mobile: the giving rail on the devotee API ────────────────────
  await t('MOB-DEV-01', 'P2', 'devotee-mobile can read its own giving ledger', async () => {
    const mob = psql1(
      `SELECT replace(mobile,'+91','') FROM public.global_users WHERE is_devotee = true ORDER BY created_at LIMIT 1`,
    );
    if (!mob) return 'no devotee fixture';
    const { token } = await devoteeLogin(mob);
    const r = await devoteeApi('GET', '/me/transactions?limit=50', { token });
    expect.http2xx(r, 'devotee transactions');
    for (const x of (r.data ?? [])) {
      for (const [k, v] of Object.entries(x)) {
        if (k.endsWith('_paise') && v != null) expect.paise(Number(v), k);
      }
    }
    return `${(r.data ?? []).length} transactions, all integer paise`;
  });
});
