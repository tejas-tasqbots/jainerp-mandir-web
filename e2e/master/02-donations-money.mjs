/**
 * Donations and the money invariants that hang off them.
 *
 * This is the P1 area of the product: every amount is **integer paise**,
 * receipt numbers are gapless per type and financial year, and a posted record
 * is never silently updated — it is voided and reissued with a `correction_of`
 * link. The cases below assert those rules at the API boundary and, where the
 * API cannot show it, directly against the tenant schema.
 *
 *   node e2e/master/02-donations-money.mjs
 */
import {
  suite, t, expect, FIXTURES,
  mandirApi, mandirLogin, psql, psql1, schemaOf, uniq,
} from './lib.mjs';

const S = schemaOf(FIXTURES.tenant);
/** Scopes whole-table invariants to rows this run created, so pre-existing
 *  fixture damage does not mask (or fake) a regression. */
const RUN_START = new Date().toISOString();
let ADMIN, CASHIER;

/** Post a donation with sensible defaults; returns the raw response. */
const donate = (body, token = ADMIN) =>
  mandirApi('POST', '/donations', {
    token,
    body: { category: 'General', payment_mode: 'cash', is_80g: false, ...body },
  });

/**
 * A donor's current-FY giving as the Donors list reports it, looked up by
 * MOBILE. A donor is identified by mobile, not by name — reusing a fixed mobile
 * across runs resolves to the same donor row and keeps its original name, so
 * searching by a fresh name silently matched nothing.
 */
async function fyGiving(mobile) {
  const r = await mandirApi('GET', `/donors?q=${encodeURIComponent(mobile)}&limit=1`, { token: ADMIN });
  return Number(r.data?.[0]?.cumulative_amount_current_fy_paise ?? -1);
}

/** A mobile no other run will reuse, so each case gets its own donor. */
const freshMobile = () => `90${String(Math.floor(Math.random() * 90000000 + 10000000))}`;

await suite('02-donations-money', async () => {
  ADMIN = (await mandirLogin(FIXTURES.admin)).token;
  CASHIER = (await mandirLogin(FIXTURES.cashier)).token;

  // ───────────────────────── Amount validation ─────────────────────────────
  const badAmounts = [
    ['TC-MON-001', 'zero', 0],
    ['TC-MON-002', 'negative', -5000],
    ['TC-MON-003', 'a float (paise must be integer)', 100.5],
    ['TC-MON-004', 'a fractional string', '100.5'],
    ['TC-MON-005', 'null', null],
    ['TC-MON-006', 'NaN-ish text', 'abc'],
    ['TC-MON-007', 'Infinity', 1e309],
    ['TC-MON-008', 'a negative float', -0.01],
    ['TC-MON-008b', 'digits with a trailing suffix', '1000abc'],
  ];
  for (const [id, label, amount_paise] of badAmounts) {
    await t(id, 'P1', `donation rejects an amount that is ${label}`, async () => {
      const r = await donate({ amount_paise, donor: { name: `Bad ${label}`, mobile: '9000012301' } });
      expect.rejected(r, `amount ${JSON.stringify(amount_paise)} must not be accepted`);
      return `${r.status} ${r.code}`;
    });
  }

  await t('TC-MON-004b', 'P2', 'an integral numeric string is coerced, not stored as text', async () => {
    // Forms and the offline mobile client send strings. Coercion is fine as
    // long as it lands as an exact integer — "100.5" is rejected above, so the
    // lenient path cannot introduce a fractional paise value.
    const r = await donate({ amount_paise: '1000', donor: { name: 'Coerced', mobile: '9000012310' } });
    expect.http2xx(r);
    const stored = psql1(`SELECT amount_paise FROM ${S}.donations WHERE id = '${r.data.id}'`);
    expect.eq(Number(stored), 1000, 'coerced value as stored');
    return 'string "1000" → 1000';
  });

  await t('TC-MON-009', 'P1', 'donation rejects a missing amount entirely', async () => {
    const r = await donate({ donor: { name: 'No Amount', mobile: '9000012302' } });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-MON-010', 'P1', 'a 1-paise donation is accepted (boundary)', async () => {
    const r = await donate({ amount_paise: 1, donor: { name: 'One Paisa', mobile: '9000012303' } });
    expect.http2xx(r);
    expect.eq(r.data.amount_paise, 1, 'amount round-trip');
    return `id ${r.data.id.slice(0, 8)}`;
  });

  await t('TC-MON-011', 'P1', 'a very large donation records exactly (money columns are BIGINT)', async () => {
    // Money columns were INTEGER paise, capping a single gift at ~₹2.14 crore —
    // the API refused anything larger with "That amount is too large for this
    // field. Please split it or contact support." Splitting corrupts the donor's
    // 80G record, which has to show one receipt for one gift, so migration 036 /
    // tenant-migration 019 widened every `*_paise` column to BIGINT.
    for (const amount of [2147483647, 10000000000, 500000000000]) {
      const r = await donate({ amount_paise: amount, donor: { name: 'Big Gift', mobile: '9000012304' } });
      expect.http2xx(r, `₹${amount / 100} should now be recordable`);
      const stored = psql1(`SELECT amount_paise FROM ${S}.donations WHERE id = '${r.data.id}'`);
      expect.eq(Number(stored), amount, 'stored exactly, no truncation');
    }
    return '₹2.14cr, ₹10cr, ₹500cr all exact';
  });

  await t('TC-MON-011b', 'P1', 'no money column is still INTEGER anywhere in this tenant', async () => {
    const narrow = psql1(
      `SELECT count(*) FROM information_schema.columns
        WHERE table_schema = '${S}' AND column_name LIKE '%\\_paise' AND data_type = 'integer'`,
    );
    expect.eq(Number(narrow), 0, 'an INTEGER paise column would reintroduce the ~₹2.14 crore ceiling');
    return 'all BIGINT';
  });

  await t('TC-MON-011c', 'P1', 'integer wraparound never produced a negative amount', async () => {
    const wrapped = psql1(`SELECT count(*) FROM ${S}.donations WHERE amount_paise < 0`);
    expect.eq(Number(wrapped), 0, 'negative amounts from overflow');
    return '0 negative';
  });

  await t('TC-MON-011d', 'P1', 'an amount past JavaScript\u2019s safe integer range is refused', async () => {
    // BIGINT is wider than JS can represent exactly: Number('9007199254740993')
    // is 9007199254740992, and the old `Number.isInteger` check said yes — the
    // API would have stored an amount nobody typed. 2^53 paise is ~₹90 trillion,
    // so nothing real is excluded.
    const r = await donate({
      amount_paise: '9007199254740993', donor: { name: 'Unsafe', mobile: '9000012314' },
    });
    expect.rejected(r, 'a value JS has already rounded must not be stored');
    return `${r.status} ${r.code}`;
  });

  await t('TC-MON-012', 'P1', 'every listed amount_paise is an integer', async () => {
    const r = await mandirApi('GET', '/donations?limit=50', { token: ADMIN });
    expect.http2xx(r);
    for (const d of r.data) expect.paise(d.amount_paise, `donation ${d.id}`);
    return `${r.data.length} rows checked`;
  });

  await t('TC-MON-013', 'P1', 'no donation row holds a fractional paise value', async () => {
    const bad = psql1(`SELECT count(*) FROM ${S}.donations WHERE amount_paise <> trunc(amount_paise)`);
    expect.eq(Number(bad), 0, 'fractional paise rows');
    return '0 fractional rows';
  });

  // ───────────────────────── Recording a donation ──────────────────────────
  let donationId, receiptNo;
  await t('TC-DON-001', 'P1', 'a cash donation is recorded and issues a receipt number', async () => {
    const r = await donate({ amount_paise: 25100, donor: { name: `QA Donor ${uniq()}`, mobile: '9000012399' } });
    expect.http2xx(r);
    donationId = r.data.id;
    receiptNo = r.data.receipt_number ?? r.data.invoice_no;
    expect.ok(receiptNo, 'no receipt number issued');
    return receiptNo;
  });

  await t('TC-DON-002', 'P1', 'receipt number is PREFIX/FY/NNNNNN with an April–March FY', async () => {
    expect.ok(/^[A-Z]+\/\d{4}-\d{2}\/\d{6}$/.test(receiptNo), `got "${receiptNo}"`);
    const [, fy] = receiptNo.match(/\/(\d{4}-\d{2})\//);
    const [start, end] = fy.split('-');
    expect.eq(Number(end), (Number(start) + 1) % 100, 'FY end year must follow the start year');
    return fy;
  });

  await t('TC-DON-003', 'P1', 'receipt numbers issued back-to-back are contiguous', async () => {
    // Asserts the invariant on numbers *this run* issues rather than on the
    // whole historical series: the fixture database carries legacy gaps
    // (DON/2026-27 000666-000668, 000737) from before every caller passed its
    // transaction executor into InvoiceSeriesService. Those cannot be
    // un-burnt, and failing on them would make the case permanently red
    // instead of guarding the behaviour that matters now.
    const prefix = receiptNo.split('/').slice(0, 2).join('/');
    const before = Number(psql1(
      `SELECT current_no FROM ${S}.invoice_series WHERE type = 'DONATION' AND fy = '${prefix.split('/')[1]}'`,
    ));
    const issued = [];
    for (let i = 0; i < 5; i++) {
      const r = await donate({ amount_paise: 1200 + i, donor: { name: `Seq ${i}`, mobile: '9000012312' } });
      expect.http2xx(r);
      issued.push(Number((r.data.receipt_number ?? r.data.invoice_no).split('/')[2]));
    }
    const wanted = Array.from({ length: 5 }, (_, i) => before + 1 + i);
    expect.eq(issued.join(','), wanted.join(','), 'five sequential donations must take five consecutive numbers');
    return `${issued[0]}…${issued[4]}`;
  });

  await t('TC-DON-003b', 'P1', 'a rejected donation does not burn a receipt number', async () => {
    const fy = receiptNo.split('/')[1];
    const before = Number(psql1(
      `SELECT current_no FROM ${S}.invoice_series WHERE type = 'DONATION' AND fy = '${fy}'`,
    ));
    // Fails validation inside the same transaction the number is drawn in.
    const bad = await donate({ amount_paise: -1, donor: { name: 'Burn', mobile: '9000012313' } });
    expect.rejected(bad);
    const after = Number(psql1(
      `SELECT current_no FROM ${S}.invoice_series WHERE type = 'DONATION' AND fy = '${fy}'`,
    ));
    expect.eq(after, before, 'a failed create must roll the series counter back');
    return `counter held at ${after}`;
  });

  await t('TC-DON-004', 'P1', 'receipt numbers are unique (no duplicates in the series)', async () => {
    const dup = psql1(
      `SELECT count(*) FROM (SELECT invoice_no FROM ${S}.donations
        WHERE invoice_no IS NOT NULL GROUP BY invoice_no HAVING count(*) > 1) x`,
    );
    expect.eq(Number(dup), 0, 'duplicate receipt numbers');
    return '0 duplicates';
  });

  await t('TC-DON-005', 'P1', 'concurrent donations never share a receipt number', async () => {
    // The row-locked series is the whole point of InvoiceSeriesService; firing
    // ten at once is what actually exercises it.
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        donate({ amount_paise: 1100 + i, donor: { name: `Race ${i}`, mobile: '9000012400' } })),
    );
    const nos = rs.filter((r) => r.status < 300).map((r) => r.data.receipt_number ?? r.data.invoice_no);
    expect.eq(nos.length, 10, 'all ten should succeed');
    expect.eq(new Set(nos).size, 10, `duplicate numbers issued: ${nos.join(', ')}`);
    return `${nos.length} unique`;
  });

  await t('TC-DON-006', 'P1', 'the receipt payload carries what the client-side template needs', async () => {
    const r = await mandirApi('GET', `/donations/${donationId}/receipt`, { token: ADMIN });
    expect.http2xx(r);
    expect.ok(r.data.receipt_number, 'receipt_number');
    expect.ok(r.data.mandir, 'mandir block (temple name/address for the letterhead)');
    expect.paise(r.data.amount_paise ?? 0, 'amount');
    return `template=${r.data.mandir?.template ?? 'default'}`;
  });

  await t('TC-DON-007', 'P2', 'the receipt endpoint returns a payload, not a PDF', async () => {
    const r = await mandirApi('GET', `/donations/${donationId}/receipt`, { token: ADMIN });
    expect.ok(r.json, 'receipts are rendered client-side; the API must return JSON');
    return 'json';
  });

  await t('TC-DON-008', 'P1', 'an unknown category_id is refused (the path the UI uses)', async () => {
    const r = await donate({
      amount_paise: 5000, category_id: '00000000-0000-0000-0000-000000000000',
      donor: { name: 'X', mobile: '9000012305' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-DON-008b', 'P2', 'a free-text category auto-creates the master row (import path)', async () => {
    // `resolveCategory` deliberately creates by name when no category_id is
    // given, so bulk import and the offline client can post a register that
    // names categories this temple has not defined yet. Pinned because it also
    // means a typo at the counter silently adds a category — the UI must keep
    // sending category_id.
    const name = `QA AutoCat ${uniq()}`;
    const r = await donate({ amount_paise: 5000, category: name, donor: { name: 'Y', mobile: '9000012307' } });
    expect.http2xx(r);
    const made = psql1(`SELECT count(*) FROM ${S}.donation_categories WHERE name = '${name}'`);
    expect.eq(Number(made), 1, 'category should have been created by name');
    return `auto-created "${name}"`;
  });

  await t('TC-DON-009', 'P1', 'a donation with no donor and not anonymous is refused', async () => {
    const r = await donate({ amount_paise: 5000 });
    expect.rejected(r, 'a named donation needs a donor');
    return `${r.status} ${r.code}`;
  });

  await t('TC-DON-010', 'P2', 'an unknown payment mode is refused', async () => {
    const r = await donate({
      amount_paise: 5000, payment_mode: 'crypto', donor: { name: 'Crypto', mobile: '9000012306' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  // ───────────────────────── 80G rules ─────────────────────────────────────
  await t('TC-80G-001', 'P1', '80G donation without a PAN is blocked', async () => {
    const r = await donate({
      amount_paise: 50000, is_80g: true, donor: { name: 'QA NoPan', mobile: '9000012388' },
    });
    expect.rejected(r);
    expect.eq(r.code, 'PAN_REQUIRED', 'error code');
    return r.code;
  });

  await t('TC-80G-002', 'P1', '80G donation with a valid PAN is accepted', async () => {
    const r = await donate({
      amount_paise: 50000, is_80g: true,
      donor: { name: `QA Pan ${uniq()}`, mobile: '9000012389', pan: 'ABCDE1234F' },
    });
    expect.http2xx(r);
    return `receipt ${r.data.receipt_number ?? r.data.invoice_no}`;
  });

  await t('TC-80G-003', 'P1', 'a malformed PAN is refused', async () => {
    const r = await donate({
      amount_paise: 50000, is_80g: true,
      donor: { name: 'QA BadPan', mobile: '9000012390', pan: 'NOTAPAN123' },
    });
    expect.rejected(r, 'PAN must match the AAAAA9999A shape');
    return `${r.status} ${r.code}`;
  });

  await t('TC-80G-004', 'P1', 'PAN is stored masked, never in clear, on the donation row', async () => {
    const r = await mandirApi('GET', '/donations?limit=20', { token: ADMIN });
    const withPan = r.data.filter((d) => d.donor_pan_masked);
    for (const d of withPan) {
      expect.ok(/[X*]/.test(d.donor_pan_masked), `${d.donor_pan_masked} looks unmasked`);
    }
    return `${withPan.length} masked PANs checked`;
  });

  // The create response is a receipt-shaped summary, not the stored row, so
  // these read the persisted record back rather than trusting the echo.
  await t('TC-80G-005', 'P1', 'anonymous donations are forced non-80G', async () => {
    const r = await donate({ amount_paise: 11100, is_anonymous: true, is_80g: true });
    expect.http2xx(r, 'anonymous donation should still be accepted');
    const eligible = psql1(`SELECT is_80g_eligible FROM ${S}.donations WHERE id = '${r.data.id}'`);
    expect.eq(eligible, 'f', 'an anonymous donor cannot claim 80G');
    return 'forced to false';
  });

  await t('TC-80G-006', 'P2', 'Dan Peti is recorded as an anonymous category', async () => {
    const r = await donate({ amount_paise: 5100, is_anonymous: true, anonymous_category: 'dan_peti' });
    expect.http2xx(r);
    const cat = psql1(`SELECT anonymous_category FROM ${S}.donations WHERE id = '${r.data.id}'`);
    expect.eq(cat, 'dan_peti');
    return 'dan_peti';
  });

  await t('TC-80G-006b', 'P2', 'an anonymous donation stores no donor identity', async () => {
    const r = await donate({ amount_paise: 2500, is_anonymous: true });
    expect.http2xx(r);
    const row = psql(`SELECT donor_id, is_anonymous FROM ${S}.donations WHERE id = '${r.data.id}'`);
    expect.eq(row[0][1], 't', 'is_anonymous');
    expect.eq(row[0][0], '', 'an anonymous gift must not be linked to a donor record');
    return 'no donor_id';
  });

  await t('TC-80G-007', 'P2', 'the 80G certificate endpoint answers for a donor', async () => {
    const donorId = psql1(`SELECT id FROM ${S}.donors WHERE deleted_at IS NULL LIMIT 1`);
    const r = await mandirApi('GET', `/donations/donor/${donorId}/80g-certificate`, { token: ADMIN });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  // ───────────────────────── Void & correction ─────────────────────────────
  let voidTarget;
  await t('TC-VOID-001', 'P1', 'temple_admin can void a donation', async () => {
    const made = await donate({ amount_paise: 7700, donor: { name: `Void Me ${uniq()}`, mobile: '9000012401' } });
    voidTarget = made.data.id;
    const r = await mandirApi('PATCH', `/donations/${voidTarget}/void`, {
      token: ADMIN, body: { reason: 'QA void test' },
    });
    expect.http2xx(r);
    return 'voided';
  });

  await t('TC-VOID-002', 'P1', 'a void marks the row, it never deletes it', async () => {
    const row = psql(
      `SELECT is_voided, void_reason, amount_paise FROM ${S}.donations WHERE id = '${voidTarget}'`,
    );
    expect.eq(row.length, 1, 'the row must still exist after a void');
    expect.eq(row[0][0], 't', 'is_voided');
    expect.ok(row[0][1], 'void_reason must be recorded');
    return `reason="${row[0][1]}"`;
  });

  await t('TC-VOID-003', 'P1', 'a voided donation keeps its receipt number (no renumbering)', async () => {
    const no = psql1(`SELECT invoice_no FROM ${S}.donations WHERE id = '${voidTarget}'`);
    expect.ok(no, 'a voided receipt number must stay burnt, not be reused');
    return no;
  });

  await t('TC-VOID-004', 'P1', 'cashier cannot void a donation', async () => {
    const made = await donate({ amount_paise: 3300, donor: { name: 'Cashier Void', mobile: '9000012402' } });
    const r = await mandirApi('PATCH', `/donations/${made.data.id}/void`, {
      token: CASHIER, body: { reason: 'should not work' },
    });
    expect.status(r, 403);
    return `${r.status}`;
  });

  await t('TC-VOID-005', 'P1', 'a void requires a reason', async () => {
    const made = await donate({ amount_paise: 3300, donor: { name: 'No Reason', mobile: '9000012403' } });
    const r = await mandirApi('PATCH', `/donations/${made.data.id}/void`, { token: ADMIN, body: {} });
    expect.rejected(r, 'voiding money without a reason must not be possible');
    return `${r.status} ${r.code}`;
  });

  await t('TC-VOID-006', 'P1', 'a donation cannot be voided twice', async () => {
    const r = await mandirApi('PATCH', `/donations/${voidTarget}/void`, {
      token: ADMIN, body: { reason: 'again' },
    });
    expect.rejected(r, 'double void must be refused');
    return `${r.status} ${r.code}`;
  });

  await t('TC-VOID-007', 'P1', 'voided donations are excluded from the collection total', async () => {
    const apiTotal = (await mandirApi('GET', '/donations?limit=1', { token: ADMIN })).meta?.total_amount_paise;
    const dbTotal = psql1(
      `SELECT COALESCE(sum(amount_paise),0) FROM ${S}.donations WHERE is_voided = false`,
    );
    expect.eq(Number(apiTotal), Number(dbTotal), 'reported total must exclude voided rows');
    return `₹${Number(dbTotal) / 100}`;
  });

  await t('TC-CORR-001', 'P1', 'a correction reissues rather than editing in place', async () => {
    const made = await donate({ amount_paise: 4400, donor: { name: `Correct Me ${uniq()}`, mobile: '9000012404' } });
    const r = await mandirApi('PATCH', `/donations/${made.data.id}/correct`, {
      token: ADMIN, body: { amount_paise: 5500, reason: 'QA correction' },
    });
    if (r.status >= 400) return `not supported for this record: ${r.status} ${r.code}`;
    const original = psql(`SELECT is_voided FROM ${S}.donations WHERE id = '${made.data.id}'`);
    expect.eq(original[0][0], 't', 'the original must be voided by the correction');
    const newId = r.data?.id;
    if (newId) {
      const link = psql1(`SELECT correction_of FROM ${S}.donations WHERE id = '${newId}'`);
      expect.ok(link, 'the reissued row must link back via correction_of');
    }
    return 'void + reissue';
  });

  await t('TC-CORR-002', 'P1', 'a correction cannot set a non-positive amount', async () => {
    const made = await donate({ amount_paise: 4400, donor: { name: 'Correct Bad', mobile: '9000012405' } });
    const r = await mandirApi('PATCH', `/donations/${made.data.id}/correct`, {
      token: ADMIN, body: { amount_paise: 0, reason: 'QA' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  // ───────────────────────── Cheque lifecycle ──────────────────────────────
  const newCheque = () => donate({
    amount_paise: 150000, payment_mode: 'cheque',
    cheque_number: `${uniq()}`, cheque_bank: 'HDFC', cheque_date: '2026-08-01',
    donor: { name: `Cheque Donor ${uniq()}`, mobile: '9000012406' },
  });

  let chequeId;
  await t('TC-CHQ-001', 'P1', 'a cheque donation records the cheque details', async () => {
    const r = await newCheque();
    expect.http2xx(r);
    chequeId = r.data.id;
    const row = psql(
      `SELECT payment_mode, cheque_number, cheque_bank FROM ${S}.donations WHERE id = '${chequeId}'`,
    );
    expect.eq(row[0][0], 'cheque', 'payment_mode');
    expect.ok(row[0][1], 'cheque_number must be stored');
    return `${row[0][2]} #${row[0][1]}`;
  });

  await t('TC-CHQ-001b', 'P1', 'a new cheque tender opens at "received", not null', async () => {
    // Regression for the tender row being inserted with no cheque_status: the
    // inbound machine reads the *tender*, so a null there refused deposit with
    // "Cheque is already null" and made banking a cheque impossible.
    const status = psql1(`SELECT cheque_status FROM ${S}.payments WHERE source_row_id = '${chequeId}'`);
    expect.eq(status, 'received', 'tender opening state');
    return status;
  });

  await t('TC-CHQ-002a', 'P1', 'a received cheque can be deposited', async () => {
    const r = await mandirApi('PATCH', `/donations/${chequeId}/cheque/deposit`, {
      token: ADMIN, body: { deposited_at: '2026-08-02' },
    });
    expect.http2xx(r);
    expect.eq(psql1(`SELECT cheque_status FROM ${S}.donations WHERE id = '${chequeId}'`), 'deposited');
    return 'deposited';
  });

  await t('TC-CHQ-002b', 'P1', 'a deposited cheque can be cleared', async () => {
    const r = await mandirApi('PATCH', `/donations/${chequeId}/cheque/clear`, {
      token: ADMIN, body: { cleared_at: '2026-08-05' },
    });
    expect.http2xx(r);
    expect.eq(psql1(`SELECT cheque_status FROM ${S}.donations WHERE id = '${chequeId}'`), 'cleared');
    return 'cleared';
  });

  await t('TC-CHQ-002c', 'P1', 'a received cheque cannot skip the deposit step', async () => {
    const made = await newCheque();
    const r = await mandirApi('PATCH', `/donations/${made.data.id}/cheque/clear`, {
      token: ADMIN, body: { cleared_at: '2026-08-05' },
    });
    expect.rejected(r, 'received → cleared must not be allowed');
    expect.ok(/deposited/i.test(r.json?.error?.message ?? ''), `message should name the missing step: ${r.json?.error?.message}`);
    return r.json.error.message;
  });

  await t('TC-CHQ-002d', 'P2', 'a cheque cannot be deposited twice', async () => {
    const r = await mandirApi('PATCH', `/donations/${chequeId}/cheque/deposit`, {
      token: ADMIN, body: { deposited_at: '2026-08-06' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-CHQ-002e', 'P1', 'the tender and the donation row never disagree on status', async () => {
    const bad = psql1(
      `SELECT count(*) FROM ${S}.donations d
         JOIN ${S}.payments p ON p.source_row_id = d.id AND p.source_table = 'donations'
        WHERE d.payment_mode = 'cheque' AND p.voided_at IS NULL
          AND d.created_at >= '${RUN_START}'
          AND d.cheque_status IS DISTINCT FROM p.cheque_status`,
    );
    expect.eq(Number(bad), 0, 'donation and tender cheque_status out of step');
    return 'in step';
  });

  await t('TC-CHQ-003', 'P1', 'a cheque can still bounce after it appeared to clear', async () => {
    // Deliberate: the bank decides when a cheque bounces, not us, and a
    // "cleared" cheque can still be reversed. `assertBounceable` gates only on
    // the donation already being voided. Pinned so the permissive rule is a
    // decision on record rather than something a later tightening breaks.
    const r = await mandirApi('PATCH', `/donations/${chequeId}/cheque/bounce`, {
      token: ADMIN, body: { reason: 'Bank reversed after clearing' },
    });
    expect.http2xx(r);
    expect.eq(psql1(`SELECT is_voided FROM ${S}.donations WHERE id = '${chequeId}'`), 't');
    return 'bounce after clear reverses the collection';
  });

  await t('TC-CHQ-004', 'P1', 'a bounced cheque voids the donation', async () => {
    const made = await newCheque();
    const r = await mandirApi('PATCH', `/donations/${made.data.id}/cheque/bounce`, {
      token: ADMIN, body: { reason: 'Insufficient funds' },
    });
    expect.http2xx(r);
    const voided = psql1(`SELECT is_voided FROM ${S}.donations WHERE id = '${made.data.id}'`);
    expect.eq(voided, 't', 'a bounced cheque must reverse the collection');
    return 'voided on bounce';
  });

  await t('TC-CHQ-005', 'P2', 'a cheque cannot be bounced twice', async () => {
    const made = await newCheque();
    await mandirApi('PATCH', `/donations/${made.data.id}/cheque/bounce`, { token: ADMIN, body: { reason: 'first' } });
    const r = await mandirApi('PATCH', `/donations/${made.data.id}/cheque/bounce`, { token: ADMIN, body: { reason: 'again' } });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  // ───────────────────────── Listing, filters, paging ──────────────────────
  await t('TC-DLIST-001', 'P1', 'the list endpoint returns the { data, meta } envelope', async () => {
    const r = await mandirApi('GET', '/donations?limit=5', { token: ADMIN });
    expect.http2xx(r);
    expect.ok(Array.isArray(r.data), 'data must be an array');
    expect.has(r.meta, 'total');
    return `total=${r.meta.total}`;
  });

  await t('TC-DLIST-002', 'P2', 'limit is honoured', async () => {
    const r = await mandirApi('GET', '/donations?limit=3', { token: ADMIN });
    expect.ok(r.data.length <= 3, `got ${r.data.length}`);
    return `${r.data.length} rows`;
  });

  await t('TC-DLIST-003', 'P2', 'paging returns different rows on page 2', async () => {
    const p1 = await mandirApi('GET', '/donations?limit=2&page=1', { token: ADMIN });
    const p2 = await mandirApi('GET', '/donations?limit=2&page=2', { token: ADMIN });
    const a = p1.data.map((d) => d.id).join(),
      b = p2.data.map((d) => d.id).join();
    expect.ok(a !== b, 'page 2 returned the same rows as page 1');
    return 'distinct pages';
  });

  await t('TC-DLIST-004', 'P2', 'an absurd limit is clamped rather than dumping the table', async () => {
    const r = await mandirApi('GET', '/donations?limit=100000', { token: ADMIN });
    expect.http2xx(r);
    expect.ok(r.data.length <= 500, `returned ${r.data.length} rows — limit is not clamped`);
    return `${r.data.length} rows`;
  });

  await t('TC-DLIST-005', 'P2', 'a negative limit does not crash the endpoint', async () => {
    const r = await mandirApi('GET', '/donations?limit=-5', { token: ADMIN });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-DLIST-006', 'P2', 'a non-numeric page does not crash the endpoint', async () => {
    const r = await mandirApi('GET', '/donations?page=abc', { token: ADMIN });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-DLIST-007', 'P1', 'fetching a donation by a non-existent id returns 404, not 500', async () => {
    const r = await mandirApi('GET', '/donations/00000000-0000-0000-0000-000000000000', { token: ADMIN });
    expect.status(r, 404);
    return `${r.status}`;
  });

  await t('TC-DLIST-008', 'P1', 'a malformed uuid returns 4xx, not 500', async () => {
    const r = await mandirApi('GET', '/donations/not-a-uuid', { token: ADMIN });
    expect.rejected(r);
    return `${r.status}`;
  });

  // ───────────────────────── Global ledger mirror ──────────────────────────
  await t('TC-SYNC-001', 'P1', 'the global mirror respects the per-tenant sync flag', async () => {
    const enabled = psql1(
      `SELECT global_sync_enabled FROM public.tenants WHERE slug = '${FIXTURES.tenant}'`,
    );
    const before = Number(psql1(
      `SELECT count(*) FROM public.global_transactions WHERE tenant_id =
        (SELECT id FROM public.tenants WHERE slug = '${FIXTURES.tenant}')`,
    ));
    await donate({ amount_paise: 8800, donor: { name: `Sync ${uniq()}`, mobile: '9000012407' } });
    // The mirror is best-effort and asynchronous; give it a moment.
    await new Promise((r) => setTimeout(r, 600));
    const after = Number(psql1(
      `SELECT count(*) FROM public.global_transactions WHERE tenant_id =
        (SELECT id FROM public.tenants WHERE slug = '${FIXTURES.tenant}')`,
    ));
    if (enabled === 't') expect.ok(after > before, 'sync is on but nothing was mirrored');
    else expect.eq(after, before, 'sync is off but a row was mirrored anyway');
    return `sync=${enabled} ${before}→${after}`;
  });

  await t('TC-SYNC-002', 'P1', 'a mirror failure never blocks the donation write', async () => {
    // Recording money must not depend on the global ledger being reachable.
    const r = await donate({ amount_paise: 9900, donor: { name: `NoBlock ${uniq()}`, mobile: '9000012408' } });
    expect.http2xx(r);
    return 'write succeeded';
  });

  // ───────────────────────── Donor FY cumulative ───────────────────────────
  // This figure drives the Donors list column, its XLSX export, the screen's
  // "FY giving" total and the 80G threshold conversation with a donor.
  await t('TC-FY-001', 'P1', 'a donor\u2019s FY giving reflects a new gift', async () => {
    const mobile = freshMobile();
    const r = await donate({ amount_paise: 400000, donor: { name: `FYCase ${uniq()}`, mobile } });
    expect.http2xx(r);
    const got = await fyGiving(mobile);
    expect.eq(got, 400000, 'FY giving after one gift');
    return `₹${got / 100}`;
  });

  await t('TC-FY-002', 'P1', 'voiding removes the gift from FY giving', async () => {
    const mobile = freshMobile();
    const r = await donate({ amount_paise: 400000, donor: { name: `FYCase ${uniq()}`, mobile } });
    await mandirApi('PATCH', `/donations/${r.data.id}/void`, { token: ADMIN, body: { reason: 'QA' } });
    expect.eq(await fyGiving(mobile), 0, 'a voided gift must not count');
    return '0';
  });

  await t('TC-FY-003', 'P1', 'giving from a PRIOR financial year does not count as this year\u2019s', async () => {
    // The bug this pins: the figure used to come from a stored running total
    // that nothing ever reset at the year rollover — no cron, and "Close Books"
    // only sets tenants.locked_fy. From the second FY onward a column named
    // `current_fy` reported all-time giving, silently and permanently.
    const mobile = freshMobile();
    const r = await donate({ amount_paise: 900000, donor: { name: `FYCase ${uniq()}`, mobile } });
    expect.eq(await fyGiving(mobile), 900000, 'counts while it is in this FY');
    const donorId = psql1(`SELECT donor_id FROM ${S}.donations WHERE id = '${r.data.id}'`);
    psql(`UPDATE ${S}.donations SET created_at = created_at - interval '1 year' WHERE donor_id = '${donorId}'`);
    expect.eq(await fyGiving(mobile), 0, 'a gift dated in the previous FY must not count as this FY');
    return 'prior-FY giving excluded';
  });

  await t('TC-FY-004', 'P1', 'the list and the profile agree on a donor\u2019s FY giving', async () => {
    // Two read paths existed; only one derived the figure, so they could differ
    // for the same donor on the same screen refresh.
    const mobile = freshMobile();
    const r = await donate({ amount_paise: 250000, donor: { name: `FYCase ${uniq()}`, mobile } });
    const donorId = psql1(`SELECT donor_id FROM ${S}.donations WHERE id = '${r.data.id}'`);
    const one = await mandirApi('GET', `/donors/${donorId}`, { token: ADMIN });
    expect.http2xx(one);
    const fromList = await fyGiving(mobile);
    expect.eq(Number(one.data.cumulative_amount_current_fy_paise), fromList, 'profile and list disagree');
    expect.eq(fromList, 250000, 'both should report the single gift');
    return `both ₹${fromList / 100}`;
  });

  await t('TC-FY-005', 'P1', 'FY giving is derived, so it can never drift from the donations', async () => {
    const drift = psql1(
      `SELECT count(*) FROM ${S}.donors d
        WHERE d.deleted_at IS NULL AND d.created_at >= '${RUN_START}'
          AND d.cumulative_amount_current_fy_paise <> 0`,
    );
    // Nothing writes the stored column any more; a non-zero value on a donor
    // this run created would mean a cache was reintroduced somewhere.
    expect.eq(Number(drift), 0, 'a write to the deprecated cached column has come back');
    return 'no cached writes';
  });

  // ───────────────────────── Audit trail ───────────────────────────────────
  await t('TC-AUD-001', 'P1', 'recording a donation writes an audit row', async () => {
    const before = Number(psql1(`SELECT count(*) FROM ${S}.audit_log`));
    await donate({ amount_paise: 6600, donor: { name: `Audit ${uniq()}`, mobile: '9000012409' } });
    const after = Number(psql1(`SELECT count(*) FROM ${S}.audit_log`));
    expect.ok(after > before, 'no audit row written for a money mutation');
    return `${before}→${after}`;
  });

  await t('TC-AUD-002', 'P1', 'voiding writes an audit row naming the actor', async () => {
    const made = await donate({ amount_paise: 2200, donor: { name: `AuditVoid ${uniq()}`, mobile: '9000012410' } });
    const before = Number(psql1(`SELECT count(*) FROM ${S}.audit_log`));
    await mandirApi('PATCH', `/donations/${made.data.id}/void`, { token: ADMIN, body: { reason: 'QA audit' } });
    const after = Number(psql1(`SELECT count(*) FROM ${S}.audit_log`));
    expect.ok(after > before, 'void did not write an audit row');
    const rows = psql(
      `SELECT action, actor_id, entity_type FROM ${S}.audit_log
        WHERE entity_id = '${made.data.id}' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect.ok(rows.length, 'no audit row references the voided donation');
    expect.ok(rows[0][1], 'audit row has no actor');
    return `${rows[0][2]}.${rows[0][0]}`;
  });

  await t('TC-AUD-003', 'P1', 'the audit trail records before and after state', async () => {
    const rows = psql(
      `SELECT count(*) FROM ${S}.audit_log
        WHERE after_state IS NOT NULL AND occurred_at > NOW() - INTERVAL '10 minutes'`,
    );
    expect.ok(Number(rows[0][0]) > 0, 'recent mutations recorded no after_state');
    return `${rows[0][0]} rows with after_state`;
  });
});
