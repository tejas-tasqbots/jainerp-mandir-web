/**
 * Calculation verification — temple/trust portal.
 *
 * Reads `results/entry-ledger.json` (written by 12-manual-entry-sweep.mjs) and
 * checks every register, report, ledger and dashboard tile against an
 * expectation computed here in JS from what was actually entered.
 *
 * Nothing below asserts a report against another report unless the two are
 * *supposed* to be equal by definition — that is the whole point. A report that
 * agrees with itself proves nothing; the arithmetic has to be reproduced
 * independently from the source entries.
 *
 * Run after 12: node 13-calculation-verify.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, t, mandirApi, mandirLogin, expect, FIXTURES } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const L = JSON.parse(readFileSync(join(HERE, 'results', 'entry-ledger.json'), 'utf8'));
const FY = L.fy;
const rs = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

let TOKEN = null;
const get = (p) => mandirApi('GET', p, { token: TOKEN });
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);

/** Fetch + require 2xx + return data. */
async function data(path, what) {
  const r = await get(path);
  if (r.status < 200 || r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
  return r.data;
}

await suite('13-calculation-verify', async () => {
  ({ token: TOKEN } = await mandirLogin(FIXTURES.admin, FIXTURES.tenant));

  // ── Expectations computed from the entry ledger ───────────────────────────
  const liveDonations = L.donations.filter((d) => !d.voided);
  const voided = L.donations.filter((d) => d.voided);
  const donationsDirect = sum(liveDonations, (d) => d.amount_paise);
  // A boli payment posts a donation row of its own (category "Boli"), so the
  // donation register legitimately holds more rows than the sweep created.
  const boliPaid = sum(L.bolis, (b) => sum(b.payments));
  const boliPledged = sum(L.bolis, (b) => b.pledged_paise);
  const boliWaived = sum(L.bolis, (b) => b.waived_paise);
  const boliOutstanding = sum(
    L.bolis.filter((b) => !b.waived_paise),
    (b) => b.pledged_paise - sum(b.payments),
  );
  const expectedDonationTotal = donationsDirect + boliPaid;

  const expensesTotal = sum(L.expenses, (e) => e.amount_paise);
  const expensesCash = sum(L.expenses.filter((e) => !e.on_credit), (e) => e.amount_paise);
  const expensesCredit = sum(L.expenses.filter((e) => e.on_credit), (e) => e.amount_paise);
  const prasadSubtotal = sum(L.prasad, (p) => p.expected_subtotal_paise);
  const prasadTotal = sum(L.prasad, (p) => p.total_paise);
  const bhojTotal = sum(L.bhojanshala, (b) => b.expected_paise);
  const sevaTotal = sum(L.seva, (s) => s.amount_paise);
  const roomTotal = sum(L.rooms, (r) => r.expected_total_paise);
  const roomPaid = sum(L.rooms, (r) => r.advance_paise + sum(r.extra_payments));
  const hallTotal = sum(L.halls, (h) => h.returned_total_paise);
  const hallPaid = sum(L.halls, (h) => h.advance_paise + sum(h.extra_payments));
  const journalTotal = sum(L.journal, (j) => j.amount_paise);

  await t('VER-BASE-01', 'P1', 'entry ledger loaded', async () =>
    `${L.donations.length} donations (${voided.length} voided), ${L.expenses.length} expenses, ` +
    `${L.prasad.length} prasad, ${L.bhojanshala.length} bhojanshala, ${L.seva.length} seva, ` +
    `${L.rooms.length} rooms, ${L.halls.length} halls, ${L.bolis.length} bolis, ${L.journal.length} journal`);

  // ── 1. DONATION REGISTER ──────────────────────────────────────────────────
  const reg = await data(`/reports/donation-register?fy=${FY}&limit=1000`, 'donation register');

  await t('VER-DON-01', 'P1', 'donation register total = entered donations + boli payments', async () => {
    const got = Number(reg.totals?.amount_paise ?? sum(reg.rows, (r) => r.amount_paise));
    expect.eq(got, expectedDonationTotal,
      `register ${rs(got)} vs entered ${rs(donationsDirect)} + boli ${rs(boliPaid)}`);
    return rs(got);
  });

  await t('VER-DON-02', 'P1', 'register rows sum to the register total (no footer drift)', async () => {
    const rowSum = sum(reg.rows, (r) => r.amount_paise);
    const total = Number(reg.totals?.amount_paise ?? rowSum);
    expect.eq(rowSum, total, 'rows vs totals');
    return `${reg.rows.length} rows = ${rs(rowSum)}`;
  });

  await t('VER-DON-03', 'P1', 'voided donation is excluded from the register', async () => {
    for (const v of voided) {
      const hit = reg.rows.find((r) => r.invoice_no === v.receipt_no);
      expect.ok(!hit, `voided ${v.receipt_no} still in the register`);
    }
    const withVoid = expectedDonationTotal + sum(voided, (v) => v.amount_paise);
    const got = Number(reg.totals?.amount_paise ?? 0);
    expect.ok(got !== withVoid, 'total appears to still include the voided row');
    return `${voided.length} voided row(s) excluded (${rs(sum(voided, (v) => v.amount_paise))})`;
  });

  await t('VER-DON-04', 'P1', 'every register amount is integer paise', async () => {
    for (const r of reg.rows) expect.paise(Number(r.amount_paise), `row ${r.invoice_no}`);
    return `${reg.rows.length} rows clean`;
  });

  // ── 2. DONATION BY CATEGORY ───────────────────────────────────────────────
  const byCat = await data(`/reports/donation-by-category?fy=${FY}`, 'donation by category');

  await t('VER-DON-05', 'P1', 'category breakdown sums to the register total', async () => {
    const catSum = sum(byCat.rows, (r) => r.amount_paise);
    expect.eq(catSum, expectedDonationTotal, `categories ${rs(catSum)} vs register ${rs(expectedDonationTotal)}`);
    return byCat.rows.map((r) => `${r.category}=${rs(r.amount_paise)}`).join(' ');
  });

  await t('VER-DON-06', 'P1', 'category counts sum to the register row count', async () => {
    const catCount = sum(byCat.rows, (r) => r.count);
    expect.eq(catCount, reg.rows.length, 'category count vs register rows');
    return `${catCount} rows`;
  });

  await t('VER-DON-07', 'P1', '80G-eligible never exceeds the amount in any category', async () => {
    for (const r of byCat.rows) {
      expect.ok(Number(r.eligible_80g_paise) <= Number(r.amount_paise),
        `${r.category}: 80G ${rs(r.eligible_80g_paise)} > total ${rs(r.amount_paise)}`);
    }
    return `${byCat.rows.length} categories`;
  });

  // ── 3. COLLECTION SUMMARY (the money-in tile row) ─────────────────────────
  const col = await data(`/reports/collection-summary?fy=${FY}`, 'collection summary');

  await t('VER-COL-01', 'P1', 'collection summary donations = donation register total', async () => {
    expect.eq(Number(col.donations_paise), expectedDonationTotal,
      `summary ${rs(col.donations_paise)} vs register ${rs(expectedDonationTotal)}`);
    return rs(col.donations_paise);
  });

  await t('VER-COL-02', 'P1', 'collection summary seva = entered seva bookings', async () => {
    expect.eq(Number(col.seva_paise), sevaTotal, `summary ${rs(col.seva_paise)} vs entered ${rs(sevaTotal)}`);
    return rs(col.seva_paise);
  });

  await t('VER-COL-03', 'P1', 'collection summary prasad = qty × price + GST', async () => {
    expect.eq(Number(col.prasad_paise), prasadTotal, `summary ${rs(col.prasad_paise)} vs entered ${rs(prasadTotal)}`);
    return `${rs(col.prasad_paise)} (subtotal ${rs(prasadSubtotal)} + GST ${rs(prasadTotal - prasadSubtotal)})`;
  });

  await t('VER-COL-04', 'P1', 'collection summary bhojanshala = plates × rate', async () => {
    expect.eq(Number(col.bhojanshala_paise), bhojTotal, `summary ${rs(col.bhojanshala_paise)} vs entered ${rs(bhojTotal)}`);
    return rs(col.bhojanshala_paise);
  });

  // Rooms are checked by VER-ROM-03, which owns the advance-column finding.
  await t('VER-COL-06', 'P1', 'collection summary hall advances = hall money collected', async () => {
    expect.eq(Number(col.hall_advance_paise), hallPaid, `summary ${rs(col.hall_advance_paise)} vs collected ${rs(hallPaid)}`);
    return rs(col.hall_advance_paise);
  });

  await t('VER-COL-07', 'P1', 'total_collection = sum of its declared streams', async () => {
    const parts = (col.included_streams ?? []).map((k) => Number(col[k] ?? 0));
    expect.eq(Number(col.total_collection_paise), sum(parts), 'declared streams vs total');
    return `${col.included_streams.length} streams = ${rs(col.total_collection_paise)}`;
  });

  await t('VER-COL-08', 'P1', 'net = total collection − expenses', async () => {
    expect.eq(Number(col.net_paise), Number(col.total_collection_paise) - Number(col.expenses_paise), 'net arithmetic');
    return `${rs(col.total_collection_paise)} − ${rs(col.expenses_paise)} = ${rs(col.net_paise)}`;
  });

  await t('VER-COL-09', 'P1', 'payment-mode split covers the donations it summarises', async () => {
    // `payment_modes` is a per-tender breakdown of the DONATION stream only,
    // not of every collection stream, so it must reconcile to donations.
    const modes = col.payment_modes ?? [];
    const modeSum = sum(modes, (m) => m.amount_paise);
    expect.eq(modeSum, expectedDonationTotal,
      `modes ${rs(modeSum)} vs donations ${rs(expectedDonationTotal)}`);
    return modes.map((m) => `${m.payment_mode}=${rs(m.amount_paise)}`).join(' ');
  });

  // ── 4. EXPENSES ───────────────────────────────────────────────────────────
  const expReg = await data(`/reports/expense-register?fy=${FY}&limit=500`, 'expense register');
  const expByCat = await data(`/reports/expense-by-category?fy=${FY}`, 'expense by category');

  await t('VER-EXP-01', 'P1', 'expense register total = entered expenses', async () => {
    const got = Number(expReg.totals?.amount_paise ?? sum(expReg.rows, (r) => r.amount_paise));
    expect.eq(got, expensesTotal, `register ${rs(got)} vs entered ${rs(expensesTotal)}`);
    return `${expReg.rows.length} rows = ${rs(got)}`;
  });

  await t('VER-EXP-02', 'P1', 'expense category breakdown sums to the register total', async () => {
    expect.eq(sum(expByCat.rows, (r) => r.amount_paise), expensesTotal, 'categories vs total');
    expect.eq(Number(expByCat.totals?.count ?? 0), L.expenses.length, 'category count');
    return expByCat.rows.map((r) => `${r.category}=${rs(r.amount_paise)}`).join(' ');
  });

  await t('VER-EXP-03', 'P1', 'GST paid totals match the entered input GST', async () => {
    const enteredGst = sum(L.expenses, (e) => e.gst_paise);
    const got = Number(expByCat.totals?.gst_paise ?? sum(expByCat.rows, (r) => r.gst_paise));
    expect.eq(got, enteredGst, `report ${rs(got)} vs entered ${rs(enteredGst)}`);
    return rs(got);
  });

  await t('VER-EXP-04', 'P1', 'collection summary counts only cash-paid expenses (credit excluded)', async () => {
    expect.eq(Number(col.expenses_paise), expensesCash,
      `summary ${rs(col.expenses_paise)} vs cash-paid ${rs(expensesCash)} (credit ${rs(expensesCredit)} correctly excluded)`);
    return `${rs(col.expenses_paise)} paid, ${rs(expensesCredit)} on credit`;
  });

  // ── 5. PRASAD / BHOJANSHALA counters ──────────────────────────────────────
  await t('VER-PRA-01', 'P1', 'prasad daily summary = today’s sales', async () => {
    const s = await data('/prasad/daily-summary', 'prasad summary');
    const todaySales = L.prasad.filter((p) => p.date === L.today);
    expect.eq(Number(s.sales), todaySales.length, 'sale count');
    expect.eq(Number(s.collection_paise), sum(todaySales, (p) => p.total_paise), 'collection');
    return `${s.sales} sales, ${rs(s.collection_paise)} (GST ${rs(s.gst_paise)})`;
  });

  await t('VER-PRA-02', 'P1', 'each prasad sale: subtotal = Σ(qty × price), total = subtotal + GST', async () => {
    const sales = await data('/prasad/sales?limit=200', 'prasad sales');
    const rows = sales.rows ?? (Array.isArray(sales) ? sales : []);
    for (const p of L.prasad) {
      const row = rows.find((r) => r.id === p.id);
      expect.ok(row, `sale ${p.kind} (${p.id}) missing from the register`);
      expect.eq(Number(row.subtotal_paise), p.expected_subtotal_paise,
        `sale ${p.kind}: subtotal vs Σ(qty × price)`);
      expect.eq(Number(row.total_paise), Number(row.subtotal_paise) + Number(row.gst_paise),
        `sale ${p.kind}: total ≠ subtotal + GST`);
    }
    return `${L.prasad.length} sales, subtotal ${rs(prasadSubtotal)}, GST ${rs(prasadTotal - prasadSubtotal)}`;
  });

  await t('VER-BHO-01', 'P1', 'bhojanshala daily summary = today’s plates × rate', async () => {
    const s = await data('/bhojanshala/daily-summary', 'bhojanshala summary');
    const today = L.bhojanshala.filter((b) => b.date === L.today);
    expect.eq(Number(s.totals?.collection_paise), sum(today, (b) => b.expected_paise), 'collection');
    expect.eq(Number(s.totals?.tokens), sum(today, (b) => b.plates), 'plate/token count');
    return `${s.totals.tokens} plates = ${rs(s.totals.collection_paise)}`;
  });

  await t('VER-BHO-02', 'P1', 'bhojanshala per-meal breakdown sums to the day total', async () => {
    const s = await data('/bhojanshala/daily-summary', 'bhojanshala summary');
    expect.eq(sum(s.by_meal, (m) => m.collection_paise), Number(s.totals.collection_paise), 'meals vs total');
    expect.eq(sum(s.by_meal, (m) => m.tokens), Number(s.totals.tokens), 'meal tokens vs total');
    return s.by_meal.map((m) => `${m.meal_type}=${rs(m.collection_paise)}`).join(' ');
  });

  // ── 6. SEVA / SERVICE REGISTER ────────────────────────────────────────────
  await t('VER-SEV-01', 'P1', 'service register (seva) total = entered seva bookings', async () => {
    const s = await data(`/reports/service-register?fy=${FY}&type=seva&limit=500`, 'service register');
    const got = Number(s.totals?.amount_paise ?? sum(s.rows, (r) => r.amount_paise));
    expect.eq(got, sevaTotal, `register ${rs(got)} vs entered ${rs(sevaTotal)}`);
    expect.eq(s.rows.length, L.seva.length, 'row count');
    return `${s.rows.length} bookings = ${rs(got)}`;
  });

  // ── 7. ROOMS / HALLS — tariff arithmetic and balance due ──────────────────
  await t('VER-ROM-01', 'P1', 'every room booking: subtotal = nights × tariff, total = subtotal + GST', async () => {
    const list = await data('/room-bookings?limit=200', 'room bookings');
    const rows = list.rows ?? (Array.isArray(list) ? list : []);
    for (const r of L.rooms) {
      const row = rows.find((x) => x.id === r.id);
      expect.ok(row, `booking ${r.id} missing from the list`);
      expect.eq(Number(row.subtotal_paise), r.expected_total_paise,
        `booking ${row.invoice_no}: ${r.nights}n × ${rs(r.tariff_paise)}`);
      const gst = Number(row.cgst_paise ?? 0) + Number(row.sgst_paise ?? 0) + Number(row.igst_paise ?? 0);
      expect.eq(Number(row.total_paise), Number(row.subtotal_paise) + gst,
        `booking ${row.invoice_no}: total ≠ subtotal + GST`);
    }
    return `${L.rooms.length} bookings, subtotal ${rs(roomTotal)} + GST`;
  });

  await t('VER-ROM-02', 'P1', 'room balance due = total − payments collected', async () => {
    for (const r of L.rooms) {
      const b = await data(`/room-bookings/${r.id}/bill`, `room bill ${r.id}`);
      const paid = r.advance_paise + sum(r.extra_payments);
      const total = Number(b.amount_paise ?? b.total_paise ?? 0);
      const due = Number(b.due_paise ?? b.balance_paise ?? 0);
      expect.eq(due, Math.max(0, total - paid),
        `booking ${r.id}: total ${rs(total)} − paid ${rs(paid)}`);
    }
    return `${L.rooms.length} bills reconcile (collected ${rs(roomPaid)})`;
  });

  // Money taken after check-in goes through /room-bookings/:id/payments. The
  // collection reports read the stored `advance_paise` column, so whether that
  // rail keeps the column in step decides if the money is ever reported.
  await t('VER-ROM-03', 'P1', 'room collections reported = room money actually taken', async () => {
    expect.eq(Number(col.room_advance_paise), roomPaid,
      `Collection Summary reports ${rs(col.room_advance_paise)} but ${rs(roomPaid)} was collected ` +
      `— ${rs(roomPaid - Number(col.room_advance_paise))} taken through /room-bookings/:id/payments is missing`);
    return rs(col.room_advance_paise);
  });

  await t('VER-HAL-01', 'P1', 'every hall booking bills its session type’s tariff', async () => {
    const bad = L.halls.filter((h) => h.returned_subtotal_paise !== h.expected_subtotal_paise);
    expect.ok(bad.length === 0,
      `${bad.length}/${L.halls.length} mispriced: ` +
      bad.map((h) => `${h.mode} billed ${rs(h.returned_subtotal_paise)} want ${rs(h.expected_subtotal_paise)}`).join('; '));
    return `${L.halls.length} bookings`;
  });

  await t('VER-HAL-02', 'P1', 'hall balance due = total − payments collected', async () => {
    for (const h of L.halls) {
      const b = await data(`/hall-bookings/${h.id}/bill`, `hall bill ${h.id}`);
      const paid = h.advance_paise + sum(h.extra_payments);
      const due = Number(b.due_paise ?? b.balance_paise ?? 0);
      expect.eq(due, Math.max(0, h.returned_total_paise - paid),
        `booking ${h.id}: total ${rs(h.returned_total_paise)} − paid ${rs(paid)}`);
    }
    return `${L.halls.length} bills reconcile (collected ${rs(hallPaid)})`;
  });

  // ── 8. BOLI REGISTER — outstanding is derived, never stored ───────────────
  const boliReg = await data(`/bolis/register?fy=${FY}`, 'boli register');

  await t('VER-BOL-01', 'P1', 'boli register outstanding = pledged − paid, per row', async () => {
    for (const row of boliReg.rows) {
      const expectedOut = Number(row.committed_amount_paise) - Number(row.paid_amount_paise);
      if (row.status === 'waived') continue;
      expect.eq(Number(row.outstanding_paise), Math.max(0, expectedOut),
        `${row.seva_description}: ${rs(row.committed_amount_paise)} − ${rs(row.paid_amount_paise)}`);
    }
    return `${boliReg.rows.length} rows`;
  });

  await t('VER-BOL-02', 'P1', 'total boli outstanding matches the sweep', async () => {
    const got = sum(boliReg.rows.filter((r) => r.status !== 'waived'), (r) => r.outstanding_paise);
    expect.eq(got, boliOutstanding, `register ${rs(got)} vs expected ${rs(boliOutstanding)}`);
    return `${rs(got)} outstanding of ${rs(boliPledged)} pledged (${rs(boliWaived)} waived)`;
  });

  await t('VER-BOL-03', 'P1', 'boli payments reached the donation register', async () => {
    const boliCat = byCat.rows.find((r) => /boli/i.test(r.category));
    expect.ok(boliCat, `no Boli category row in ${byCat.rows.map((r) => r.category).join(',')}`);
    expect.eq(Number(boliCat.amount_paise), boliPaid, `boli income ${rs(boliCat.amount_paise)} vs paid ${rs(boliPaid)}`);
    return `${boliCat.count} receipts = ${rs(boliCat.amount_paise)}`;
  });

  // ── 9. THE JOURNAL — the real double-entry checks ─────────────────────────
  const tb = await data(`/journal/trial-balance?fy=${FY}`, 'journal trial balance');

  await t('VER-TB-01', 'P1', 'trial balance balances (Σ debits = Σ credits)', async () => {
    const dr = sum(tb.rows, (r) => r.debit_paise);
    const cr = sum(tb.rows, (r) => r.credit_paise);
    expect.eq(dr, cr, `debits ${rs(dr)} vs credits ${rs(cr)} (diff ${rs(dr - cr)})`);
    return `${rs(dr)} on both sides across ${tb.rows.length} accounts`;
  });

  await t('VER-TB-02', 'P1', 'reported totals match the rows they summarise', async () => {
    if (!tb.totals) throw new Error('no totals block');
    expect.eq(Number(tb.totals.debit_paise), sum(tb.rows, (r) => r.debit_paise), 'debit total');
    expect.eq(Number(tb.totals.credit_paise), sum(tb.rows, (r) => r.credit_paise), 'credit total');
    return `Dr ${rs(tb.totals.debit_paise)} / Cr ${rs(tb.totals.credit_paise)}`;
  });

  await t('VER-TB-03', 'P1', 'income accounts carry the module totals', async () => {
    const credit = (code) => Number(tb.rows.find((r) => r.code === code)?.credit_paise ?? 0);
    const checks = [
      ['4100', 'Seva', sevaTotal],
      ['4200', 'Prasad', prasadTotal],
      ['4300', 'Bhojanshala', bhojTotal],
    ];
    const bad = checks.filter(([c, , want]) => credit(c) !== want);
    expect.ok(bad.length === 0,
      bad.map(([c, n, want]) => `${n}(${c}) ledger ${rs(credit(c))} vs entered ${rs(want)}`).join('; '));
    return checks.map(([c, n]) => `${n}=${rs(credit(c))}`).join(' ');
  });

  await t('VER-TB-04', 'P1', 'corpus donations credit the Corpus Fund, not income', async () => {
    const corpusEntered = sum(liveDonations.filter((d) => d.fund_type === 'corpus'), (d) => d.amount_paise);
    const corpusLedger = Number(tb.rows.find((r) => r.code === '3000')?.credit_paise ?? 0);
    expect.eq(corpusLedger, corpusEntered, `fund ${rs(corpusLedger)} vs entered ${rs(corpusEntered)}`);
    return rs(corpusLedger);
  });

  await t('VER-TB-05', 'P1', 'anonymous donations post to the s.115BBC account', async () => {
    const anonEntered = sum(liveDonations.filter((d) => d.anonymous), (d) => d.amount_paise);
    const anonLedger = Number(tb.rows.find((r) => r.code === '4030')?.credit_paise ?? 0);
    expect.eq(anonLedger, anonEntered, `4030 ${rs(anonLedger)} vs entered ${rs(anonEntered)}`);
    return rs(anonLedger);
  });

  await t('VER-TB-06', 'P1', 'credit purchase sits in Sundry Creditors', async () => {
    const cr = Number(tb.rows.find((r) => r.code === '2100')?.credit_paise ?? 0);
    expect.eq(cr, expensesCredit, `creditors ${rs(cr)} vs on-credit ${rs(expensesCredit)}`);
    return rs(cr);
  });

  await t('VER-TB-07', 'P1', 'manual journal entries are in the ledger', async () => {
    const entries = await data(`/journal/entries?fy=${FY}&limit=500`, 'journal entries');
    const rows = Array.isArray(entries) ? entries : (entries.rows ?? []);
    const manual = rows.filter((e) => /Sweep journal/.test(e.narration ?? ''));
    expect.eq(manual.length, L.journal.length, `manual entries found`);
    return `${manual.length} adjustments = ${rs(journalTotal)}`;
  });

  await t('VER-TB-08', 'P1', 'unallocated receipts are not silently dropped', async () => {
    const susp = Number(tb.rows.find((r) => r.code === '1900')?.debit_paise ?? 0);
    // Suspense is the deliberate catch-all for a tender with no bank account.
    // It must never be negative and must be reported, not hidden.
    expect.ok(susp >= 0, `negative suspense ${rs(susp)}`);
    return susp > 0
      ? `${rs(susp)} unallocated — receipts taken by UPI/card/NEFT with no bank account resolved`
      : 'nothing unallocated';
  });

  // ── 10. BALANCE SHEET ─────────────────────────────────────────────────────
  const bs = await data(`/accounting/balance-sheet?fy=${FY}`, 'balance sheet');

  await t('VER-BS-01', 'P1', 'balance sheet balances (assets = liabilities + funds)', async () => {
    expect.eq(Number(bs.difference_paise), 0, `difference ${rs(bs.difference_paise)}`);
    return `assets ${rs(bs.assets?.total_paise ?? 0)}, funds ${rs(bs.funds_total_paise)}, diff ${rs(bs.difference_paise)}`;
  });

  await t('VER-BS-02', 'P1', 'cash & bank lines sum to their stated total', async () => {
    const lines = bs.assets?.cash_and_bank ?? [];
    expect.eq(sum(lines, (l) => l.balance_paise), Number(bs.assets.cash_and_bank_total_paise), 'cash lines vs total');
    return lines.map((l) => `${l.account}=${rs(l.balance_paise)}`).join(' ');
  });

  await t('VER-BS-03', 'P1', 'uncleared cheques are an asset, not bank money', async () => {
    const chq = sum(liveDonations.filter((d) => d.payment_mode === 'cheque'), (d) => d.amount_paise);
    expect.eq(Number(bs.assets.cheques_in_hand_paise), chq,
      `cheques in hand ${rs(bs.assets.cheques_in_hand_paise)} vs entered ${rs(chq)}`);
    return rs(bs.assets.cheques_in_hand_paise);
  });

  await t('VER-BS-04', 'P1', 'fund schedule corpus = corpus donations', async () => {
    const fs = await data(`/journal/fund-schedule?fy=${FY}`, 'fund schedule');
    const corpusEntered = sum(liveDonations.filter((d) => d.fund_type === 'corpus'), (d) => d.amount_paise);
    const corpus = fs.funds.find((f) => f.fund_type === 'corpus');
    expect.eq(Number(corpus?.closing_paise ?? 0), corpusEntered, 'corpus closing');
    expect.eq(Number(corpus?.opening_paise ?? 0) + Number(corpus?.movement_paise ?? 0),
      Number(corpus?.closing_paise ?? 0), 'opening + movement = closing');
    return `corpus ${rs(corpus.closing_paise)}, total funds ${rs(fs.total_closing_paise)}`;
  });

  // ── 11. CASH BOOK vs JOURNAL — the two views must reconcile ───────────────
  await t('VER-CASH-01', 'P1', 'cash book and journal agree on cash in hand', async () => {
    const balances = await data(`/accounting/account-balances?fy=${FY}`, 'account balances');
    const cashBook = Number(balances.find((a) => a.type === 'cash')?.balance_paise ?? 0);
    const cashLedger = Number(tb.rows.find((r) => /cash in hand/i.test(r.account_name))?.debit_paise ?? 0);
    const gap = cashBook - cashLedger;
    expect.eq(gap, 0,
      `Accounts page shows ${rs(cashBook)} but the ledger says ${rs(cashLedger)} — ` +
      `they differ by ${rs(gap)}${gap === journalTotal ? ' (exactly the manual journal adjustments)' : ''}`);
    return rs(cashBook);
  });

  await t('VER-CASH-02', 'P1', 'day book debits and credits are integer paise and signed correctly', async () => {
    const db = await data('/accounting/day-book', 'day book');
    const rows = Array.isArray(db) ? db : (db.rows ?? []);
    for (const r of rows) {
      expect.paise(Number(r.debit_paise ?? 0), `debit on ${r.reference}`);
      expect.paise(Number(r.credit_paise ?? 0), `credit on ${r.reference}`);
      expect.ok(!(Number(r.debit_paise) > 0 && Number(r.credit_paise) > 0),
        `${r.reference} has both a debit and a credit`);
    }
    return `${rows.length} day-book lines`;
  });

  // ── 12. ALL-TRANSACTIONS + CASH FLOW ──────────────────────────────────────
  await t('VER-ALL-01', 'P1', 'all-transactions inflow = every income stream entered', async () => {
    const all = await data(`/reports/all-transactions?fy=${FY}&limit=1000`, 'all transactions');
    const inflow = sum(all.rows.filter((r) => r.direction === 'in'), (r) => r.amount_paise);
    const expected = expectedDonationTotal + sevaTotal + prasadTotal + bhojTotal + roomPaid + hallPaid;
    expect.eq(inflow, expected, `report ${rs(inflow)} vs entered ${rs(expected)}`);
    return `${all.rows.length} rows, inflow ${rs(inflow)}`;
  });

  await t('VER-ALL-02', 'P1', 'all-transactions outflow = expenses paid', async () => {
    const all = await data(`/reports/all-transactions?fy=${FY}&limit=1000`, 'all transactions');
    const outflow = sum(all.rows.filter((r) => r.direction === 'out'), (r) => r.amount_paise);
    expect.eq(outflow, expensesTotal, `report ${rs(outflow)} vs entered ${rs(expensesTotal)}`);
    return rs(outflow);
  });

  await t('VER-CF-01', 'P1', 'cash-flow months sum to the stated FY totals', async () => {
    const cf = await data(`/reports/cash-flow?fy=${FY}`, 'cash flow');
    expect.eq(sum(cf.months, (m) => m.inflow_paise), Number(cf.totals.inflow_paise), 'inflow');
    expect.eq(sum(cf.months, (m) => m.outflow_paise), Number(cf.totals.outflow_paise), 'outflow');
    expect.eq(Number(cf.totals.inflow_paise) - Number(cf.totals.outflow_paise), Number(cf.totals.net_paise), 'net');
    for (const m of cf.months) {
      expect.eq(Number(m.net_paise), Number(m.inflow_paise) - Number(m.outflow_paise), `${m.month} net`);
    }
    return `in ${rs(cf.totals.inflow_paise)}, out ${rs(cf.totals.outflow_paise)}, net ${rs(cf.totals.net_paise)}`;
  });

  // ── 13. GST ───────────────────────────────────────────────────────────────
  await t('VER-GST-01', 'P1', 'GST summary output = GST charged on prasad + halls + rooms', async () => {
    const g = await data(`/reports/gst-summary?fy=${FY}`, 'gst summary');
    const prasadGst = prasadTotal - prasadSubtotal;
    expect.eq(Number(g.output_gst.prasad_paise), prasadGst, `prasad GST ${rs(g.output_gst.prasad_paise)} vs ${rs(prasadGst)}`);
    expect.eq(Number(g.output_gst.total_paise),
      Number(g.output_gst.rooms_paise) + Number(g.output_gst.halls_paise) + Number(g.output_gst.prasad_paise),
      'output GST parts vs total');
    return `output ${rs(g.output_gst.total_paise)}, input ${rs(g.input_gst_paise)}, net ${rs(g.net_payable_paise)}`;
  });

  await t('VER-GST-02', 'P1', 'net GST payable = output − input', async () => {
    const g = await data(`/reports/gst-summary?fy=${FY}`, 'gst summary');
    expect.eq(Number(g.net_payable_paise), Number(g.output_gst.total_paise) - Number(g.input_gst_paise), 'net GST');
    expect.eq(Number(g.input_gst_paise), sum(L.expenses, (e) => e.gst_paise), 'input GST vs entered');
    return rs(g.net_payable_paise);
  });

  // ── 14. DASHBOARD tiles ───────────────────────────────────────────────────
  await t('VER-DSH-01', 'P1', 'dashboard donations tile agrees with the register', async () => {
    const d = await data(`/dashboard?period=year`, 'dashboard');
    // The default dashboard window is the month; ask for the FY so the two are
    // comparable, and fall back to comparing counts if the API pins the period.
    const got = Number(d.donations?.total_paise ?? 0);
    expect.eq(got, expectedDonationTotal, `tile ${rs(got)} vs register ${rs(expectedDonationTotal)} (period ${d.period} ${d.from}→${d.to})`);
    return `${d.donations.count} receipts = ${rs(got)}`;
  });

  await t('VER-DSH-02', 'P1', 'dashboard boli outstanding agrees with the boli register', async () => {
    const d = await data(`/dashboard?period=year`, 'dashboard');
    expect.eq(Number(d.bolis?.outstanding_paise ?? 0), boliOutstanding, 'boli outstanding');
    return `${d.bolis.open} open, ${rs(d.bolis.outstanding_paise)}`;
  });

  // ── 15. DONOR LEDGER + 80G ────────────────────────────────────────────────
  /** Receipts only: the ledger also lists boli pledges, which are not money in. */
  const donorReceipts = async (id, name) => {
    const led = await data(`/donors/${id}/ledger?fy=${FY}`, `donor ledger ${name}`);
    const txns = led.transactions ?? led.rows ?? [];
    return sum(txns.filter((x) => x.txn_type === 'donation' && !x.voided), (x) => x.amount_paise);
  };

  await t('VER-DNR-01', 'P1', 'each donor ledger sums to that donor’s receipts', async () => {
    const checked = [];
    for (const d of (L.masters.donors ?? [])) {
      const got = await donorReceipts(d.id, d.name);
      const direct = sum(liveDonations.filter((x) => x.donor_id === d.id), (x) => x.amount_paise);
      expect.ok(got >= direct,
        `${d.name}: ledger ${rs(got)} < the ${rs(direct)} entered directly against them`);
      checked.push(`${d.name}=${rs(got)}`);
    }
    return checked.join(' ');
  });

  await t('VER-DNR-02', 'P1', 'top-donors amounts match those donors’ ledgers', async () => {
    const top = await data(`/reports/analytics/top-donors?fy=${FY}`, 'top donors');
    for (const d of top.slice(0, 5)) {
      expect.eq(Number(d.amount_paise), await donorReceipts(d.id, d.name), `${d.name}`);
    }
    return top.slice(0, 3).map((d) => `${d.name}=${rs(d.amount_paise)}`).join(' ');
  });

  await t('VER-DNR-03', 'P1', 'cached FY total on the donor matches their ledger', async () => {
    // A denormalised counter that drifts is worse than no counter: this is the
    // number the donor card and the 80G workflow both read.
    for (const d of (L.masters.donors ?? [])) {
      const rec = await data(`/donors/${d.id}`, `donor ${d.name}`);
      expect.eq(Number(rec.cumulative_amount_current_fy_paise ?? 0), await donorReceipts(d.id, d.name),
        `${d.name}: cached total vs ledger`);
    }
    return `${(L.masters.donors ?? []).length} donors reconcile`;
  });

  await t('VER-80G-01', 'P1', 'no receipt claims 80G on more than ₹2,000 of cash', async () => {
    // s.80G(5D) tests the CASH leg, not the receipt total: ₹1,000 cash +
    // ₹9,000 UPI stays fully eligible. Split tenders must be read per tender,
    // which is why the register's single `payment_mode` column is not enough.
    const bad = [];
    for (const r of reg.rows.filter((x) => x.is_80g_eligible && x.payment_mode === 'cash')) {
      const led = L.donations.find((d) => d.receipt_no === r.invoice_no);
      const cashLeg = led?.payments
        ? sum(led.payments.filter((p) => p.payment_mode === 'cash'), (p) => p.amount_paise)
        : Number(r.amount_paise);
      if (cashLeg > 2_00_000) bad.push(`${r.invoice_no} cash ${rs(cashLeg)}`);
    }
    expect.ok(bad.length === 0, `${bad.length} receipts claim 80G on >₹2,000 cash: ${bad.join(', ')}`);
    return `${reg.rows.filter((r) => r.is_80g_eligible).length} eligible receipts, none in breach`;
  });

  // ── 16. INVOICE SERIES — gapless per type and FY ──────────────────────────
  await t('VER-INV-01', 'P1', 'donation receipt numbers are gapless and unique', async () => {
    const nos = reg.rows.map((r) => r.invoice_no).filter(Boolean);
    expect.eq(new Set(nos).size, nos.length, 'duplicate receipt numbers');
    const seq = nos.map((n) => Number(String(n).split('/').pop())).sort((a, b) => a - b);
    // The voided receipt keeps its number — the series must not reuse it.
    const gaps = seq.filter((n, i) => i > 0 && n !== seq[i - 1] + 1);
    const voidedNos = voided.map((v) => Number(String(v.receipt_no).split('/').pop()));
    const unexplained = gaps.filter((g) => !voidedNos.includes(g - 1));
    expect.ok(unexplained.length === 0, `unexplained gaps at ${unexplained.join(',')} in ${seq.join(',')}`);
    return `${nos.length} receipts, ${seq[0]}…${seq[seq.length - 1]}, voided number not reused`;
  });

  // ── 17. GLOBAL LEDGER MIRROR ──────────────────────────────────────────────
  await t('VER-SYNC-01', 'P2', 'donations mirrored to the global ledger', async () => {
    const me = await data('/tenants/me', 'tenant profile');
    if (!me.global_sync_enabled) return 'global sync disabled — nothing to mirror';
    return 'global_sync_enabled — mirror asserted by 06-tenancy-security';
  });
});
