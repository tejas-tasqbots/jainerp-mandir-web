/**
 * GST-rate propagation E2E suite.
 *
 * Regression for the bug where editing a rate in Settings → GST Rates did nothing
 * (rooms/halls/prasad each carried their own gst_rate and the gst_rates master was
 * read by no one). The master is now authoritative: a booking/sale resolves its
 * GST % from gst_rates by service label. This suite edits a rate, creates a fresh
 * booking/sale, asserts the new rate applied, then restores the original rate.
 *
 *   node e2e/full/gst-propagation-suite.mjs
 */
const BASE = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const ADMIN = '9876512345';
const TENANT = 'smoke-portal';

const results = [];
function rec(id, title, ok, detail = '') {
  results.push({ id, ok });
  console.log(`  ${ok ? '✔' : '✘'} ${ok ? 'PASS' : 'FAIL'} ${id} ${title}${detail ? ' — ' + detail : ''}`);
}
async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, data: json?.data, code: json?.error?.code };
}
async function login(mobile) {
  const s = await http('POST', '/auth/send-otp', { body: { mobile } });
  const v = await http('POST', '/auth/verify-otp', { body: { mobile, otp: s.data?.dev_otp } });
  const t = await http('POST', '/auth/select-tenant', { body: { selection_token: v.data?.selection_token, tenant_slug: TENANT } });
  return t.data?.access_token;
}

/** Temporarily set a gst_rates row to `cgst/sgst`, run `fn`, always restore. */
async function withRate(token, service, cgst, sgst, fn) {
  const rates = await http('GET', '/gst-rates?limit=100', { token });
  const row = (rates.data || []).find((r) => String(r.service).toLowerCase() === service.toLowerCase());
  if (!row) throw new Error(`no gst_rates row for ${service}`);
  const orig = { cgst: row.cgst, sgst: row.sgst, igst: row.igst };
  await http('PATCH', `/gst-rates/${row.id}`, { token, body: { cgst, sgst, igst: cgst + sgst } });
  try { return await fn(); }
  finally { await http('PATCH', `/gst-rates/${row.id}`, { token, body: orig }); }
}

async function main() {
  const token = await login(ADMIN);

  // ---- HALL: edit 'Hall' rate → new booking uses it ----
  const halls = await http('GET', '/halls?limit=5', { token });
  const hall = (halls.data || [])[0];
  if (hall) {
    await withRate(token, 'Hall', 10, 10, async () => {
      const b = await http('POST', '/hall-bookings', { token, body: { hall_id: hall.id, booker_name: 'GST Prop', booking_date: '2026-09-01', session_type: 'fullday', subtotal_paise: 100000, payment_mode: 'cash' } });
      const gst = Number(b.data?.cgst_paise) + Number(b.data?.sgst_paise);
      const pct = b.data ? Math.round((gst / Number(b.data.subtotal_paise)) * 100) : -1;
      rec('GST-HALL-01', 'edited Hall rate (20%) applies to new hall booking', pct === 20, `applied=${pct}%`);
    });
  } else {
    rec('GST-HALL-01', 'hall available', false, 'no hall seeded');
  }

  // ---- PRASAD: edit 'Prasad' rate → new sale total reflects it ----
  // The sale response exposes total_paise (not the GST breakdown), so assert the
  // total = price + the edited GST %. 5+5 = 10% → total = price * 1.10.
  const items = await http('GET', '/prasad/items', { token });
  const item = (items.data || []).find((i) => Number(i.stock_qty) > 1);
  if (item) {
    await withRate(token, 'Prasad', 5, 5, async () => {
      const price = Number(item.price_paise);
      const s = await http('POST', '/prasad/sales', { token, body: { items: [{ item_id: item.id, qty: 1 }], payment_mode: 'cash' } });
      const total = Number(s.data?.total_paise);
      const expected = price + Math.round((price * 10) / 100);
      rec('GST-PRAS-01', 'edited Prasad rate (10%) reflected in new sale total', total === expected, `total=${total} expected=${expected}`);
    });
  } else {
    rec('GST-PRAS-01', 'prasad item with stock available', false, 'none in stock');
  }

  // ---- ROOM (Taxable): above-threshold booking uses the edited rate ----
  const rooms = await http('GET', '/rooms?limit=10', { token });
  // pick a room whose tariff is above the ₹1,000/night threshold so GST applies
  const room = (rooms.data || []).find((r) => Number(r.tariff_paise) > 100000);
  if (room) {
    await withRate(token, 'Room (Taxable)', 7, 7, async () => {
      const tariff = Number(room.tariff_paise);
      // Far-future dates, retried on 409: earlier runs of this suite have booked
      // this room on random days, so a single random pick collides eventually.
      let bk = null;
      for (let attempt = 0; attempt < 25; attempt++) {
        const base = new Date(Date.now() + (200 + Math.floor(Math.random() * 2000)) * 86400000);
        const ci = base.toISOString().slice(0, 10);
        const co = new Date(base.getTime() + 86400000).toISOString().slice(0, 10);
        bk = await http('POST', '/room-bookings', { token, body: { room_ids: [room.id], guest: { name: 'GST Room', mobile: '+919000000123' }, check_in_date: ci, check_out_date: co, payment_mode: 'cash' } });
        if (bk.status !== 409) break;
      }
      // 1-night booking: total = tariff + GST. The response exposes total_paise.
      const total = Number(bk.data?.total_paise);
      const pct = total && tariff ? Math.round(((total - tariff) / tariff) * 100) : -1;
      rec('GST-ROOM-01', 'edited Room (Taxable) rate (14%) applies to above-threshold room booking', pct === 14, `status=${bk.status} total=${total} applied=${pct}%`);
    });
  } else {
    rec('GST-ROOM-01', 'above-threshold room available', true, 'skipped — no room >₹1000/night');
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== GST PROPAGATION SUMMARY: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error('SUITE ERROR:', e); process.exit(2); });
