/**
 * Manual entry sweep — temple/trust portal.
 *
 * Creates 10+ real entries in every money-moving module, deliberately using
 * EVERY distinct way each module accepts an entry (tender mode, split tender,
 * anonymous vs identified donor, inline-new vs existing master, backdated,
 * bulk import, credit vs paid, advance vs settle…), then records what it
 * created into `results/entry-ledger.json`.
 *
 * The point is not "the POST returned 200". It is that the sweep computes,
 * in JS, what every register/report/ledger MUST say afterwards, so
 * `13-calculation-verify.mjs` can assert the product's arithmetic against an
 * independent expectation rather than against itself.
 *
 * Run: node 12-manual-entry-sweep.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, t, mandirApi, mandirLogin, expect, FIXTURES } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');

// ── Business calendar ───────────────────────────────────────────────────────
// Today is inside FY 2026-27 (April–March). Backdated rows stay inside the
// same FY on purpose: a row that slips into 2025-26 would legitimately vanish
// from this year's register and read as a bug in the verifier.
const todayIst = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const TODAY = todayIst();
const daysAgo = (n) => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
const dPlus = (base, n) => new Date(Date.parse(base) + n * 86400e3).toISOString().slice(0, 10);
const FY = '2026-27';

/** Everything created, with the amounts the reports must later agree with. */
const ledger = {
  fy: FY, today: TODAY, tenant: FIXTURES.tenant,
  donations: [], expenses: [], prasad: [], bhojanshala: [], seva: [],
  rooms: [], halls: [], bolis: [], events: [], eventRegs: [], journal: [],
  masters: {},
};

let TOKEN = null;
const api = (m, p, body) => mandirApi(m, p, { token: TOKEN, body });

/** POST + assert 2xx + return data, so every case fails loudly on a bad shape. */
async function post(path, body, what) {
  const r = await api('POST', path, body);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`);
  }
  return r.data;
}

await suite('12-manual-entry-sweep', async () => {
  // ── Setup ─────────────────────────────────────────────────────────────────
  ({ token: TOKEN } = await mandirLogin(FIXTURES.admin, FIXTURES.tenant));

  const pick = async (res) => {
    const r = await api('GET', `/${res}?limit=100`);
    const rows = r.data?.rows ?? r.data ?? [];
    return Array.isArray(rows) ? rows : [];
  };
  const cats = await pick('donation-categories');
  const expCats = await pick('expense-categories');
  const accounts = await pick('accounts');
  const rooms = await pick('rooms');
  const halls = await pick('halls');
  const sevas = await pick('sevas');
  const vendors = await pick('vendors');
  const prasadRes = await api('GET', '/prasad/items?limit=100');
  const prasadItems = prasadRes.data?.rows ?? (Array.isArray(prasadRes.data) ? prasadRes.data : []);

  const cashAcct = accounts.find((a) => a.is_default_cash) ?? accounts[0];
  const bankAcct = accounts.find((a) => a.type === 'bank') ?? accounts[1] ?? cashAcct;
  const gen = cats.find((c) => /general/i.test(c.name)) ?? cats[0];
  const corpusCat = cats.find((c) => /corpus|building/i.test(c.name)) ?? cats[1] ?? gen;
  const annadaan = cats.find((c) => /annadaan/i.test(c.name)) ?? gen;
  ledger.masters = {
    cashAcct: cashAcct?.id, bankAcct: bankAcct?.id,
    cats: cats.map((c) => ({ id: c.id, name: c.name, is80g: c.is_80g_eligible })),
  };

  await t('ENT-SETUP-01', 'P1', 'masters present for the sweep', async () => {
    expect.ok(cats.length >= 3, `donation categories: ${cats.length}`);
    expect.ok(accounts.length >= 1, `accounts: ${accounts.length}`);
    expect.ok(rooms.length >= 1, `rooms: ${rooms.length}`);
    expect.ok(sevas.length >= 1, `sevas: ${sevas.length}`);
    return `${cats.length} cats, ${accounts.length} accts, ${rooms.length} rooms, ${sevas.length} sevas`;
  });

  // A second bank account, so bank-vs-cash splits are provable per account.
  let bank2 = accounts.find((a) => a.name === 'QA Sweep Bank');
  await t('ENT-SETUP-02', 'P2', 'create a second bank account (master CRUD path)', async () => {
    if (!bank2) {
      bank2 = await post('/accounts', {
        name: 'QA Sweep Bank', type: 'bank', bank_name: 'HDFC', account_no: '00112233445566',
        ifsc: 'HDFC0000123', branch: 'MG Road', is_active: true,
      }, 'create account');
    }
    ledger.masters.bank2 = bank2.id;
    return `account ${bank2.id}`;
  });

  // Donors: a mix of PAN/no-PAN, used to prove 80G and donor-ledger maths.
  const donors = [];
  await t('ENT-SETUP-03', 'P1', 'create 5 donors (with and without PAN)', async () => {
    const spec = [
      { name: 'Sweep Donor Alpha', mobile: '9700000101', pan: 'ABCDE1234F', city: 'Indore' },
      { name: 'Sweep Donor Bravo', mobile: '9700000102', pan: 'BCDEF2345G', city: 'Bhopal' },
      { name: 'Sweep Donor Charlie', mobile: '9700000103', city: 'Ujjain' },
      { name: 'Sweep Donor Delta', mobile: '9700000104', pan: 'CDEFG3456H', city: 'Dewas' },
      { name: 'Sweep Donor Echo', mobile: '9700000105', city: 'Ratlam' },
    ];
    for (const s of spec) {
      const existing = await api('GET', `/donors?q=${encodeURIComponent(s.mobile)}`);
      const found = (existing.data?.rows ?? []).find((d) => d.mobile === s.mobile);
      donors.push(found ?? await post('/donors', s, `donor ${s.name}`));
    }
    ledger.masters.donors = donors.map((d) => ({ id: d.id, name: d.name, mobile: d.mobile }));
    expect.eq(donors.length, 5, 'donor count');
    return donors.map((d) => d.name).join(', ');
  });

  // ── 1. DONATIONS — every creation path ────────────────────────────────────
  // 16 rows: 5 tender modes, split tender, anonymous, corpus/specific/general,
  // existing-donor vs inline-new-donor, backdated, and a bulk import.
  const donationPlan = [
    // Cash over ₹2,000 cannot claim 80G (s.80G(5D)) — proved separately by
    // ENT-DON-NEG-01. Cash rows here stay off the 80G flag.
    { k: 'cash-existing-donor', body: { amount_paise: 5_00_000, payment_mode: 'cash', donor: { id: null }, category_id: null, fund_type: 'general', is_80g_eligible: false, donation_date: TODAY, source: 'walk_in' }, donorIdx: 0 },
    { k: 'upi-with-utr', body: { amount_paise: 2_51_000, payment_mode: 'upi', utr_number: 'UTRSWEEP0001', fund_type: 'general', is_80g_eligible: true, donation_date: TODAY }, donorIdx: 1 },
    { k: 'cheque', body: { amount_paise: 11_00_000, payment_mode: 'cheque', cheque_number: '100201', cheque_bank: 'SBI', cheque_date: TODAY, fund_type: 'general', is_80g_eligible: true, donation_date: TODAY }, donorIdx: 3 },
    { k: 'bank-transfer', body: { amount_paise: 25_00_000, payment_mode: 'neft', utr_number: 'NEFTSWEEP002', fund_type: 'corpus', is_80g_eligible: true, donation_date: TODAY }, donorIdx: 0 },
    { k: 'card', body: { amount_paise: 3_00_000, payment_mode: 'card', utr_number: 'CARDSWEEP003', fund_type: 'general', donation_date: TODAY }, donorIdx: 2 },
    { k: 'split-cash+upi', body: { amount_paise: 10_00_000, payment_mode: 'cash', fund_type: 'general', is_80g_eligible: true, donation_date: TODAY, payments: [{ payment_mode: 'cash', amount_paise: 1_00_000 }, { payment_mode: 'upi', amount_paise: 9_00_000, reference_no: 'UTRSPLIT01' }] }, donorIdx: 1 },
    { k: 'anonymous-cash', body: { amount_paise: 1_51_000, payment_mode: 'cash', is_anonymous: true, anonymous_category: 'general', fund_type: 'general', donation_date: TODAY } },
    { k: 'anonymous-upi', body: { amount_paise: 75_000, payment_mode: 'upi', utr_number: 'ANONUPI004', is_anonymous: true, fund_type: 'general', donation_date: TODAY } },
    { k: 'inline-new-donor', body: { amount_paise: 7_50_000, payment_mode: 'cash', donor: { name: 'Sweep Inline Foxtrot', mobile: '9700000106', pan: 'DEFGH4567J' }, fund_type: 'general', is_80g_eligible: false, donation_date: TODAY } },
    { k: 'corpus-fund', body: { amount_paise: 50_00_000, payment_mode: 'neft', utr_number: 'CORPUS005', fund_type: 'corpus', is_80g_eligible: true, donation_date: daysAgo(3) }, donorIdx: 3 },
    { k: 'specific-fund', body: { amount_paise: 15_00_000, payment_mode: 'cheque', cheque_number: '100202', cheque_bank: 'ICICI', cheque_date: daysAgo(2), fund_type: 'specific', donation_date: daysAgo(2) }, donorIdx: 4 },
    { k: 'backdated-5d', body: { amount_paise: 4_00_000, payment_mode: 'cash', fund_type: 'general', donation_date: daysAgo(5) }, donorIdx: 2 },
    { k: 'annadaan-category', body: { amount_paise: 6_00_000, payment_mode: 'upi', utr_number: 'ANNA006', fund_type: 'general', donation_date: daysAgo(1), category_id: annadaan?.id }, donorIdx: 0 },
    { k: 'small-cash-51', body: { amount_paise: 5_100, payment_mode: 'cash', fund_type: 'general', donation_date: TODAY }, donorIdx: 4 },
    // Same ₹30,000 cash gift, but NOT claiming 80G — s.80G(5D) only bars the
    // deduction, it never bars the receipt. Refusing this would be a bug.
    { k: 'large-cash-no-80g', body: { amount_paise: 30_00_000, payment_mode: 'cash', fund_type: 'general', is_80g_eligible: false, donation_date: TODAY }, donorIdx: 1 },
    { k: 'bank2-account-scoped', body: { amount_paise: 8_00_000, payment_mode: 'neft', utr_number: 'BANK2007', fund_type: 'general', donation_date: TODAY }, donorIdx: 3 },
  ];

  for (const [i, p] of donationPlan.entries()) {
    await t(`ENT-DON-${String(i + 1).padStart(2, '0')}`, 'P1', `donation via ${p.k}`, async () => {
      const body = { ...p.body };
      if (p.donorIdx != null) body.donor = { id: donors[p.donorIdx].id };
      if (!body.category_id) body.category_id = p.body.fund_type === 'corpus' ? corpusCat?.id : gen?.id;
      if (p.k === 'bank2-account-scoped') body.payment_account_id = bank2?.id;
      const d = await post('/donations', body, 'create donation');
      const row = d?.donation ?? d;
      expect.ok(row?.id, `no id back: ${JSON.stringify(d)?.slice(0, 200)}`);
      expect.paise(Number(row.amount_paise), 'amount_paise');
      expect.eq(Number(row.amount_paise), body.amount_paise, 'amount round-trip');
      ledger.donations.push({
        kind: p.k, id: row.id, amount_paise: body.amount_paise,
        payment_mode: body.payment_mode, fund_type: body.fund_type ?? 'general',
        date: body.donation_date, anonymous: !!body.is_anonymous,
        donor_id: body.donor?.id ?? row.donor_id ?? null,
        receipt_no: row.receipt_no ?? row.receipt_number ?? null,
        category_id: body.category_id ?? null,
        payments: body.payments ?? null,
        account_id: body.payment_account_id ?? null,
        eighty_g: row.is_80g_eligible ?? body.is_80g_eligible ?? false,
        voided: false,
      });
      return `₹${(body.amount_paise / 100).toFixed(2)} ${row.receipt_no ?? ''}`;
    });
  }

  // s.80G(5D): cash above ₹2,000 cannot carry an 80G claim. The rule must bite
  // at the counter, not at Form 10BD time.
  await t('ENT-DON-NEG-01', 'P1', 'cash > ₹2,000 claiming 80G is refused (s.80G(5D))', async () => {
    const r = await api('POST', '/donations', {
      amount_paise: 30_00_000, payment_mode: 'cash', fund_type: 'general',
      is_80g_eligible: true, donation_date: TODAY, donor: { id: donors[1].id },
      category_id: gen?.id,
    });
    expect.rejected(r, 'cash 80G over limit must be refused');
    expect.eq(r.code, 'CASH_LIMIT_EXCEEDED', 'error code');
    return `refused ${r.status} ${r.code}`;
  });

  // Bulk import — the 17th..20th donations, a genuinely different code path.
  await t('ENT-DON-17', 'P1', 'donations via bulk-import (4 rows)', async () => {
    const rows = [
      { donor_name: 'Bulk Donor One', donor_mobile: '9700000201', amount_paise: 1_00_000, payment_mode: 'cash', donation_date: TODAY },
      { donor_name: 'Bulk Donor Two', donor_mobile: '9700000202', amount_paise: 2_00_000, payment_mode: 'upi', utr_number: 'BULKUTR1', donation_date: TODAY },
      { donor_name: 'Bulk Donor Three', donor_mobile: '9700000203', amount_paise: 3_00_000, payment_mode: 'cash', donation_date: daysAgo(1) },
      { donor_name: 'Bulk Donor Four', donor_mobile: '9700000204', amount_paise: 4_50_000, payment_mode: 'neft', utr_number: 'BULKUTR2', donation_date: daysAgo(1) },
    ];
    const res = await post('/donations/bulk-import', { rows, category_id: gen?.id }, 'bulk import');
    const n = Number(res?.imported ?? 0);
    expect.eq(n, 4, `imported count (errors: ${JSON.stringify(res?.errors ?? [])?.slice(0, 200)})`);
    expect.eq(Number(res?.failed ?? 0), 0, 'failed count');
    rows.forEach((r) => ledger.donations.push({
      kind: 'bulk-import', id: null,
      amount_paise: r.amount_paise, payment_mode: r.payment_mode, fund_type: 'general',
      date: r.donation_date, anonymous: false, donor_id: null, category_id: gen?.id,
      payments: null, account_id: null, eighty_g: false, voided: false,
    }));
    return `${n} rows`;
  });

  // Void one donation — the register and every total must drop it.
  await t('ENT-DON-18', 'P1', 'void a donation (void + reissue rail)', async () => {
    const target = ledger.donations.find((d) => d.kind === 'small-cash-51');
    const r = await api('PATCH', `/donations/${target.id}/void`, { reason: 'QA sweep void' });
    expect.http2xx(r, 'void donation');
    target.voided = true;
    return `voided ${target.receipt_no ?? target.id} (₹${(target.amount_paise / 100).toFixed(2)})`;
  });

  // ── 2. EXPENSES — every creation path ─────────────────────────────────────
  const expPlan = [
    { k: 'cash-simple', body: { amount_paise: 2_00_000, payment_mode: 'cash', category: expCats[0]?.name, description: 'Sweep electricity', expense_date: TODAY } },
    { k: 'bank-with-utr', body: { amount_paise: 5_00_000, payment_mode: 'neft', utr_number: 'EXPUTR001', category: expCats[1]?.name, description: 'Sweep repairs', expense_date: TODAY } },
    { k: 'cheque', body: { amount_paise: 3_50_000, payment_mode: 'cheque', cheque_number: '900101', cheque_bank: 'SBI', cheque_date: TODAY, category: expCats[2]?.name, description: 'Sweep supplies', expense_date: TODAY } },
    { k: 'upi', body: { amount_paise: 1_25_000, payment_mode: 'upi', utr_number: 'EXPUPI002', category: expCats[0]?.name, description: 'Sweep misc', expense_date: TODAY } },
    { k: 'with-vendor-id', body: { amount_paise: 4_00_000, payment_mode: 'cash', vendor_id: vendors[0]?.id, category: expCats[1]?.name, description: 'Sweep vendor work', expense_date: TODAY } },
    { k: 'inline-vendor-name', body: { amount_paise: 2_75_000, payment_mode: 'cash', vendor_name: 'Sweep New Vendor', vendor_mobile: '9700000301', category: expCats[2]?.name, description: 'Sweep new vendor', expense_date: TODAY } },
    { k: 'with-gst', body: { amount_paise: 11_80_000, gst_paid_paise: 1_80_000, payment_mode: 'neft', utr_number: 'EXPGST003', vendor_id: vendors[0]?.id, category: expCats[1]?.name, description: 'Sweep GST bill', bill_number: 'BILL/001', bill_date: TODAY, expense_date: TODAY } },
    { k: 'with-tds', body: { amount_paise: 20_00_000, tds_deducted: true, tds_amount_paise: 2_00_000, tds_section: '194C', payment_mode: 'neft', utr_number: 'EXPTDS004', vendor_id: vendors[0]?.id, category: expCats[1]?.name, description: 'Sweep contractor', expense_date: TODAY } },
    { k: 'on-credit', body: { amount_paise: 7_00_000, is_on_credit: true, vendor_id: vendors[0]?.id, category: expCats[2]?.name, description: 'Sweep credit purchase', expense_date: TODAY } },
    { k: 'backdated', body: { amount_paise: 1_50_000, payment_mode: 'cash', category: expCats[0]?.name, description: 'Sweep backdated', expense_date: daysAgo(4) } },
    { k: 'recurring-flag', body: { amount_paise: 6_00_000, payment_mode: 'neft', utr_number: 'EXPREC005', is_recurring: true, recurrence_rule: 'monthly', category: expCats[0]?.name, description: 'Sweep rent', expense_date: TODAY } },
    { k: 'salary', body: { amount_paise: 12_00_000, payment_mode: 'neft', utr_number: 'EXPSAL006', category: expCats.find((c) => /salar|staff/i.test(c.name))?.name ?? expCats[0]?.name, description: 'Sweep salaries', expense_date: TODAY } },
  ];

  for (const [i, p] of expPlan.entries()) {
    await t(`ENT-EXP-${String(i + 1).padStart(2, '0')}`, 'P1', `expense via ${p.k}`, async () => {
      const e = await post('/expenses', p.body, 'create expense');
      const row = e?.expense ?? e;
      expect.ok(row?.id, `no id: ${JSON.stringify(e)?.slice(0, 200)}`);
      expect.eq(Number(row.amount_paise), p.body.amount_paise, 'amount round-trip');
      ledger.expenses.push({
        kind: p.k, id: row.id, amount_paise: p.body.amount_paise,
        payment_mode: p.body.payment_mode ?? null, date: p.body.expense_date,
        on_credit: !!p.body.is_on_credit, tds_paise: p.body.tds_amount_paise ?? 0,
        gst_paise: p.body.gst_paid_paise ?? 0, voucher_no: row.voucher_no ?? null,
        category: p.body.category ?? null, voided: false,
      });
      return `₹${(p.body.amount_paise / 100).toFixed(2)} ${row.voucher_no ?? ''}`;
    });
  }

  // ── 3. PRASAD — POS sales, several tender + buyer shapes ──────────────────
  const prItem = prasadItems[0];
  const prItem2 = prasadItems[1] ?? prasadItems[0];
  const prasadPlan = [
    { k: 'cash-1x', items: [{ item_id: prItem?.id, qty: 1 }], payment_mode: 'cash' },
    { k: 'cash-5x', items: [{ item_id: prItem?.id, qty: 5 }], payment_mode: 'cash' },
    { k: 'upi-2x', items: [{ item_id: prItem?.id, qty: 2 }], payment_mode: 'upi', utr: 'PRUPI001' },
    { k: 'card-3x', items: [{ item_id: prItem?.id, qty: 3 }], payment_mode: 'card' },
    { k: 'multi-item', items: [{ item_id: prItem?.id, qty: 2 }, { item_id: prItem2?.id, qty: 3 }], payment_mode: 'cash' },
    { k: 'named-buyer', items: [{ item_id: prItem?.id, qty: 4 }], payment_mode: 'cash', buyer_name: 'Sweep Buyer', buyer_mobile: '9700000401' },
    { k: 'anonymous', items: [{ item_id: prItem?.id, qty: 1 }], payment_mode: 'cash', is_anonymous: true },
    { k: 'second-item-only', items: [{ item_id: prItem2?.id, qty: 6 }], payment_mode: 'upi', utr: 'PRUPI002' },
    { k: 'bulk-10x', items: [{ item_id: prItem?.id, qty: 10 }], payment_mode: 'cash' },
    { k: 'mixed-qty', items: [{ item_id: prItem?.id, qty: 7 }, { item_id: prItem2?.id, qty: 2 }], payment_mode: 'card' },
  ];

  for (const [i, p] of prasadPlan.entries()) {
    await t(`ENT-PRA-${String(i + 1).padStart(2, '0')}`, 'P1', `prasad sale ${p.k}`, async () => {
      const body = { items: p.items, payment_mode: p.payment_mode };
      if (p.utr) body.utr = p.utr;
      if (p.buyer_name) { body.buyer_name = p.buyer_name; body.buyer_mobile = p.buyer_mobile; }
      if (p.is_anonymous) body.is_anonymous = true;
      const s = await post('/prasad/sales', body, 'prasad sale');
      const row = s?.sale ?? s;
      expect.ok(row?.id, `no id: ${JSON.stringify(s)?.slice(0, 200)}`);
      // Independent expectation: qty × unit price, summed over lines.
      const expected = p.items.reduce((sum, li) => {
        const it = prasadItems.find((x) => x.id === li.item_id);
        return sum + Math.round(Number(it?.price_paise ?? 0)) * li.qty;
      }, 0);
      ledger.prasad.push({
        kind: p.k, id: row.id, total_paise: Number(row.total_paise ?? row.amount_paise ?? 0),
        expected_subtotal_paise: expected, payment_mode: p.payment_mode, date: TODAY,
        items: p.items, gst_paise: Number(row.gst_paise ?? 0),
      });
      return `total ₹${(Number(row.total_paise ?? row.amount_paise ?? 0) / 100).toFixed(2)} (subtotal expect ₹${(expected / 100).toFixed(2)})`;
    });
  }

  // ── 4. BHOJANSHALA — plates × rate, meal types, sponsor ───────────────────
  const bhojPlan = [
    { k: 'lunch-10-cash', meal_type: 'lunch', plates: 10, rate_per_plate_paise: 5_000, payment_mode: 'cash' },
    { k: 'dinner-5-cash', meal_type: 'dinner', plates: 5, rate_per_plate_paise: 5_000, payment_mode: 'cash' },
    { k: 'breakfast-20-upi', meal_type: 'breakfast', plates: 20, rate_per_plate_paise: 3_000, payment_mode: 'upi', utr: 'BHUPI001' },
    { k: 'lunch-1-cash', meal_type: 'lunch', plates: 1, rate_per_plate_paise: 5_000, payment_mode: 'cash' },
    { k: 'lunch-50-card', meal_type: 'lunch', plates: 50, rate_per_plate_paise: 5_000, payment_mode: 'card' },
    { k: 'dinner-12-named', meal_type: 'dinner', plates: 12, rate_per_plate_paise: 6_000, payment_mode: 'cash', buyer_name: 'Sweep Bhoj Buyer', buyer_mobile: '9700000501' },
    { k: 'lunch-backdated', meal_type: 'lunch', plates: 8, rate_per_plate_paise: 5_000, payment_mode: 'cash', sale_date: daysAgo(2) },
    { k: 'breakfast-3-upi', meal_type: 'breakfast', plates: 3, rate_per_plate_paise: 3_000, payment_mode: 'upi', utr: 'BHUPI002' },
    { k: 'dinner-25-cash', meal_type: 'dinner', plates: 25, rate_per_plate_paise: 6_000, payment_mode: 'cash' },
    { k: 'lunch-100-bank', meal_type: 'lunch', plates: 100, rate_per_plate_paise: 5_000, payment_mode: 'neft', utr: 'BHNEFT003' },
  ];

  for (const [i, p] of bhojPlan.entries()) {
    await t(`ENT-BHO-${String(i + 1).padStart(2, '0')}`, 'P1', `bhojanshala ${p.k}`, async () => {
      const body = { meal_type: p.meal_type, plates: p.plates, rate_per_plate_paise: p.rate_per_plate_paise, payment_mode: p.payment_mode };
      if (p.utr) body.utr = p.utr;
      if (p.buyer_name) { body.buyer_name = p.buyer_name; body.buyer_mobile = p.buyer_mobile; }
      if (p.sale_date) body.sale_date = p.sale_date;
      const s = await post('/bhojanshala/sales', body, 'bhojanshala sale');
      const row = s?.sale ?? s;
      expect.ok(row?.id, `no id: ${JSON.stringify(s)?.slice(0, 200)}`);
      const expected = p.plates * p.rate_per_plate_paise;
      ledger.bhojanshala.push({
        kind: p.k, id: row.id, total_paise: Number(row.total_paise ?? row.amount_paise ?? 0),
        expected_paise: expected, plates: p.plates, rate: p.rate_per_plate_paise,
        payment_mode: p.payment_mode, date: p.sale_date ?? TODAY,
      });
      return `${p.plates}×₹${(p.rate_per_plate_paise / 100).toFixed(2)} = expect ₹${(expected / 100).toFixed(2)}, got ₹${(Number(row.total_paise ?? row.amount_paise ?? 0) / 100).toFixed(2)}`;
    });
  }

  // ── 5. SEVA bookings ──────────────────────────────────────────────────────
  for (let i = 0; i < 10; i++) {
    const sv = sevas[i % sevas.length];
    const anon = i === 7;
    await t(`ENT-SEV-${String(i + 1).padStart(2, '0')}`, 'P1', `seva booking #${i + 1} (${sv?.name})`, async () => {
      const body = {
        service_id: sv.id,
        seva_date: dPlus(TODAY, i % 5),
        payment_mode: ['cash', 'upi', 'card', 'cash', 'neft'][i % 5],
        amount_paise: Math.round(Number(sv.price_paise)),
      };
      if (body.payment_mode !== 'cash') body.utr = `SEVAREF${i}`;
      if (anon) body.is_anonymous = true;
      else { body.devotee_name = `Sweep Seva Devotee ${i + 1}`; body.devotee_mobile = `97000006${String(i).padStart(2, '0')}`; body.gotra = 'Kashyap'; }
      const s = await post('/seva-bookings', body, 'seva booking');
      const row = s?.booking ?? s;
      expect.ok(row?.id, `no id: ${JSON.stringify(s)?.slice(0, 200)}`);
      ledger.seva.push({
        id: row.id, amount_paise: body.amount_paise, seva_id: sv.id, seva_name: sv.name,
        payment_mode: body.payment_mode, date: body.seva_date, anonymous: anon,
        returned_paise: Number(row.amount_paise ?? 0),
      });
      return `${sv.name} ₹${(body.amount_paise / 100).toFixed(2)}`;
    });
  }

  // ── 6. ROOM BOOKINGS — advance vs full, multi-night, part payments ────────
  for (let i = 0; i < 10; i++) {
    const room = rooms[i % rooms.length];
    const nights = (i % 3) + 1;
    const checkIn = dPlus(TODAY, i * 3);          // no overlap on the same room
    const checkOut = dPlus(checkIn, nights);
    const tariff = Math.round(Number(room.tariff_paise));
    const total = tariff * nights;
    const advance = i % 3 === 0 ? Math.round(total / 2) : total;
    await t(`ENT-ROM-${String(i + 1).padStart(2, '0')}`, 'P1', `room booking #${i + 1} (${nights}n, ${advance === total ? 'full' : 'advance'})`, async () => {
      const body = {
        room_id: room.id, check_in_date: checkIn, check_out_date: checkOut,
        persons_count: (i % 4) + 1,
        guest: { name: `Sweep Guest ${i + 1}`, mobile: `97000007${String(i).padStart(2, '0')}`, id_proof_type: 'aadhaar', id_last4: String(1000 + i) },
        tariff_per_night_paise: tariff,
        advance_paise: advance,
        payment_mode: ['cash', 'upi', 'card', 'cash', 'neft'][i % 5],
      };
      if (body.payment_mode !== 'cash') body.utr_number = `ROOMREF${i}`;
      const b = await post('/room-bookings', body, 'room booking');
      const row = b?.booking ?? b;
      expect.ok(row?.id, `no id: ${JSON.stringify(b)?.slice(0, 250)}`);
      ledger.rooms.push({
        id: row.id, room_id: room.id, nights, tariff_paise: tariff,
        expected_total_paise: total, advance_paise: advance,
        returned_total_paise: Number(row.total_paise ?? 0),
        check_in: checkIn, check_out: checkOut, payment_mode: body.payment_mode,
        extra_payments: [],
      });
      return `${nights}n × ₹${(tariff / 100).toFixed(2)} = expect ₹${(total / 100).toFixed(2)}, paid ₹${(advance / 100).toFixed(2)}`;
    });
  }

  // Settle the part-paid ones through the payments rail (a second entry path).
  for (const [i, bk] of ledger.rooms.filter((r) => r.advance_paise < r.expected_total_paise).entries()) {
    await t(`ENT-ROMPAY-${String(i + 1).padStart(2, '0')}`, 'P1', `room balance payment #${i + 1}`, async () => {
      const due = bk.expected_total_paise - bk.advance_paise;
      const p = await post(`/room-bookings/${bk.id}/payments`, { amount_paise: due, payment_mode: 'cash', paid_on: TODAY }, 'room payment');
      expect.ok(p, 'no payment payload');
      bk.extra_payments.push(due);
      return `settled ₹${(due / 100).toFixed(2)}`;
    });
  }

  // ── 7. HALL BOOKINGS — hourly / session / fullday ─────────────────────────
  // The four session types are exactly the options the Add Hall Booking form
  // offers (`AddHallBooking.tsx` + `SessionType`), so each one must price off
  // the tariff its name implies. morning/evening are the half-day sessions and
  // must bill `session_tariff_paise`.
  const hall = halls[0];
  const HALL_MODES = ['morning', 'evening', 'full_day', 'hourly'];
  const hourlyRate = Math.round(Number(hall.hourly_tariff_paise));
  const sessionRate = Math.round(Number(hall.session_tariff_paise));
  const fulldayRate = Math.round(Number(hall.fullday_tariff_paise));

  for (let i = 0; i < 10; i++) {
    const mode = HALL_MODES[i % 4];
    const bookingDate = dPlus(TODAY, i + 1);
    const body = {
      hall_id: hall.id, booking_date: bookingDate, purpose: `Sweep function ${i + 1}`,
      session_type: mode,
      booker: { name: `Sweep Booker ${i + 1}`, mobile: `97000008${String(i).padStart(2, '0')}` },
      payment_mode: ['cash', 'upi', 'neft'][i % 3],
    };
    let expected;
    if (mode === 'hourly') {
      body.hours = (i % 4) + 2;
      body.start_time = '09:00';
      body.end_time = `${String(9 + body.hours).padStart(2, '0')}:00`;
      expected = hourlyRate * body.hours;
    } else if (mode === 'morning' || mode === 'evening') {
      expected = sessionRate;
    } else {
      expected = fulldayRate;
    }
    const advance = i % 2 === 0 ? Math.round(expected / 2) : expected;
    body.advance_paise = advance;
    if (body.payment_mode !== 'cash') body.utr_number = `HALLREF${i}`;

    await t(`ENT-HAL-${String(i + 1).padStart(2, '0')}`, 'P1', `hall booking #${i + 1} (${mode}) bills the ${mode} tariff`, async () => {
      const b = await post('/hall-bookings', body, 'hall booking');
      const row = b?.booking ?? b;
      expect.ok(row?.id, `no id: ${JSON.stringify(b)?.slice(0, 250)}`);
      const subtotal = Number(row.subtotal_paise ?? 0);
      ledger.halls.push({
        id: row.id, mode, expected_subtotal_paise: expected,
        returned_subtotal_paise: subtotal,
        expected_total_paise: Number(row.total_paise ?? 0), advance_paise: advance,
        returned_total_paise: Number(row.total_paise ?? 0), date: bookingDate,
        payment_mode: body.payment_mode, extra_payments: [],
      });
      expect.eq(subtotal, expected,
        `${mode} must bill ₹${(expected / 100).toFixed(2)} (hourly=₹${hourlyRate / 100}/h, session=₹${sessionRate / 100}, fullday=₹${fulldayRate / 100})`);
      return `${mode} subtotal ₹${(subtotal / 100).toFixed(2)}, total ₹${(Number(row.total_paise ?? 0) / 100).toFixed(2)}`;
    });
  }

  for (const [i, bk] of ledger.halls.filter((h) => h.advance_paise < h.expected_total_paise).entries()) {
    await t(`ENT-HALPAY-${String(i + 1).padStart(2, '0')}`, 'P1', `hall balance payment #${i + 1}`, async () => {
      const due = bk.expected_total_paise - bk.advance_paise;
      await post(`/hall-bookings/${bk.id}/payments`, { amount_paise: due, payment_mode: 'upi', utr_number: `HALLBAL${i}`, paid_on: TODAY }, 'hall payment');
      bk.extra_payments.push(due);
      return `settled ₹${(due / 100).toFixed(2)}`;
    });
  }

  // ── 8. BOLIS — pledge, part-pay, full-pay, waive ──────────────────────────
  for (let i = 0; i < 10; i++) {
    const pledged = (i + 1) * 1_00_000;
    await t(`ENT-BOL-${String(i + 1).padStart(2, '0')}`, 'P1', `boli pledge #${i + 1}`, async () => {
      const body = {
        seva_description: `Sweep Boli ${i + 1}`, pledged_amount_paise: pledged,
        boli_date: TODAY, donor: i === 9 ? undefined : { id: donors[i % donors.length].id },
      };
      if (i === 9) { body.is_anonymous = true; body.anonymous_category = 'general'; }
      const b = await post('/bolis', body, 'boli');
      const row = b?.boli ?? b;
      expect.ok(row?.id, `no id: ${JSON.stringify(b)?.slice(0, 250)}`);
      ledger.bolis.push({ id: row.id, pledged_paise: pledged, payments: [], waived_paise: 0, date: TODAY });
      return `pledged ₹${(pledged / 100).toFixed(2)}`;
    });
  }

  // Pay some in full, some partly, waive one — outstanding must be derived.
  for (const [i, b] of ledger.bolis.entries()) {
    if (i >= 8) continue;                     // leave #9 unpaid, #10 for waiver
    const part = i % 2 === 0 ? Math.round(b.pledged_paise / 2) : b.pledged_paise;
    await t(`ENT-BOLPAY-${String(i + 1).padStart(2, '0')}`, 'P1', `boli payment #${i + 1} (${part === b.pledged_paise ? 'full' : 'part'})`, async () => {
      await post(`/bolis/${b.id}/payments`, { amount_paise: part, payment_mode: i % 3 === 0 ? 'cash' : 'upi', utr: `BOLIREF${i}`, payment_date: TODAY }, 'boli payment');
      b.payments.push(part);
      return `paid ₹${(part / 100).toFixed(2)} of ₹${(b.pledged_paise / 100).toFixed(2)}`;
    });
  }

  await t('ENT-BOLWAIVE-01', 'P1', 'waive the last boli', async () => {
    const b = ledger.bolis[9];
    const r = await api('POST', `/bolis/${b.id}/waive`, { reason: 'QA sweep waiver' });
    expect.http2xx(r, 'waive boli');
    b.waived_paise = b.pledged_paise;
    return `waived ₹${(b.pledged_paise / 100).toFixed(2)}`;
  });

  // ── 9. EVENTS + registrations ─────────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    await t(`ENT-EVT-${String(i + 1).padStart(2, '0')}`, 'P2', `event #${i + 1}`, async () => {
      const body = {
        name: `Sweep Event ${i + 1}`, event_type: 'festival',
        start_date: dPlus(TODAY, 7 + i * 7), end_date: dPlus(TODAY, 8 + i * 7),
        location: 'Main Hall', allow_registration: true,
        registration_fee_paise: (i + 1) * 50_000, estimated_budget_paise: 10_00_000,
      };
      const e = await post('/events', body, 'event');
      const row = e?.event ?? e;
      expect.ok(row?.id, `no id: ${JSON.stringify(e)?.slice(0, 250)}`);
      ledger.events.push({ id: row.id, name: body.name, fee_paise: body.registration_fee_paise });
      return `${body.name} fee ₹${(body.registration_fee_paise / 100).toFixed(2)}`;
    });
  }

  for (let i = 0; i < 10; i++) {
    const ev = ledger.events[i % Math.max(ledger.events.length, 1)];
    if (!ev) break;
    await t(`ENT-EVTREG-${String(i + 1).padStart(2, '0')}`, 'P2', `event registration #${i + 1}`, async () => {
      const body = {
        name: `Sweep Attendee ${i + 1}`, mobile: `97000009${String(i).padStart(2, '0')}`,
        attendee_count: (i % 3) + 1, amount_paise: ev.fee_paise, payment_mode: i % 2 ? 'upi' : 'cash',
      };
      const r = await post(`/events/${ev.id}/registrations`, body, 'event registration');
      const row = r?.registration ?? r;
      expect.ok(row?.id ?? row, `no registration back: ${JSON.stringify(r)?.slice(0, 200)}`);
      ledger.eventRegs.push({ id: row?.id ?? null, event_id: ev.id, amount_paise: body.amount_paise, payment_mode: body.payment_mode });
      return `${ev.name} ₹${(body.amount_paise / 100).toFixed(2)}`;
    });
  }

  // ── 10. JOURNAL — manual double entry, must stay balanced ─────────────────
  // The General Ledger page fills its manual-entry account dropdown from
  // GET /journal/accounts. On a tenant that has never posted, that read is a
  // plain SELECT over an empty table — `ensureChart()` runs only inside
  // `sync()` — so the dropdown is empty and no adjustment can be posted.
  await t('ENT-JRN-BOOT-01', 'P2', 'chart of accounts is available before any sync', async () => {
    const before = await api('GET', '/journal/accounts');
    expect.http2xx(before, 'GET /journal/accounts');
    const n = Array.isArray(before.data) ? before.data.length : 0;
    expect.ok(n > 0,
      `chart of accounts is empty before /journal/sync — the General Ledger ` +
      `manual-entry dropdown has nothing to pick and POST /journal/entries ` +
      `fails with "Unknown ledger account"`);
    return `${n} accounts`;
  });

  // What a real accountant does: press Sync, which seeds the chart and posts
  // every movement made above. Everything after this point is the journal's.
  await t('ENT-JRN-SYNC-01', 'P1', 'journal sync posts the sweep to the ledger', async () => {
    const r = await api('POST', '/journal/sync', { fy: FY });
    expect.http2xx(r, 'journal sync');
    const posted = r.data?.vouchers_posted ?? 0;
    expect.ok(posted > 0, `expected vouchers posted, got ${posted}`);
    ledger.vouchers_posted = posted;
    return `${posted} vouchers`;
  });

  const coa = (await api('GET', '/journal/accounts')).data ?? [];
  // Cash/bank ledger accounts are generated per `accounts` row (1001, 1002…),
  // so resolve the cash leg from the chart rather than hard-coding a code.
  const cashLedger = (Array.isArray(coa) ? coa : []).find((a) => /cash in hand/i.test(a.name))
    ?? (Array.isArray(coa) ? coa : []).find((a) => a.kind === 'asset' && /^10/.test(a.code));
  const expenseLedger = (Array.isArray(coa) ? coa : []).find((a) => a.code === '5000');

  await t('ENT-JRN-COA-01', 'P1', 'chart of accounts has cash + expense legs after sync', async () => {
    expect.ok(cashLedger?.code, `no cash ledger account in ${coa.length} accounts`);
    expect.ok(expenseLedger?.code, 'no 5000 General Expenses account');
    return `cash=${cashLedger.code} (${cashLedger.name}), expense=${expenseLedger.code}`;
  });

  for (let i = 0; i < 10; i++) {
    const amt = (i + 1) * 25_000;
    await t(`ENT-JRN-${String(i + 1).padStart(2, '0')}`, 'P1', `journal entry #${i + 1} (balanced)`, async () => {
      const body = {
        entry_date: TODAY, narration: `Sweep journal ${i + 1}`,
        lines: [
          { code: expenseLedger.code, debit_paise: amt, credit_paise: 0 },
          { code: cashLedger.code, debit_paise: 0, credit_paise: amt },
        ],
      };
      const j = await post('/journal/entries', body, 'journal entry');
      const row = j?.entry ?? j;
      expect.ok(row?.id ?? row, `no entry back: ${JSON.stringify(j)?.slice(0, 250)}`);
      ledger.journal.push({ id: row?.id ?? null, amount_paise: amt, date: TODAY });
      return `Dr ${expenseLedger.code} / Cr ${cashLedger.code} ₹${(amt / 100).toFixed(2)}`;
    });
  }

  await t('ENT-JRN-NEG-01', 'P1', 'unbalanced journal entry is rejected', async () => {
    const r = await api('POST', '/journal/entries', {
      entry_date: TODAY, narration: 'Sweep unbalanced',
      lines: [{ code: expenseLedger.code, debit_paise: 10_000, credit_paise: 0 },
              { code: cashLedger.code, debit_paise: 0, credit_paise: 9_000 }],
    });
    expect.rejected(r, 'unbalanced entry must be refused');
    return `rejected ${r.status} ${r.code ?? ''}`;
  });

  // ── Persist the ledger for the verifier ───────────────────────────────────
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'entry-ledger.json'), JSON.stringify(ledger, null, 2));

  await t('ENT-LEDGER-01', 'P1', 'entry ledger written for verification', async () => {
    const counts = Object.entries(ledger)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => `${k}=${v.length}`).join(' ');
    const total = Object.values(ledger).filter(Array.isArray).reduce((s, v) => s + v.length, 0);
    expect.ok(total >= 90, `expected 90+ entries, got ${total}`);
    return counts;
  });
});
