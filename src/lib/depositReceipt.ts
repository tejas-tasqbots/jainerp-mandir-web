/**
 * The security deposit receipt (tenant migration 061).
 *
 * Asked for 2026-10-08, from a dharamshala the client stayed at: they took
 * ₹1,500 at check-in — ₹500 for the room and ₹1,000 as security — handed over
 * a note for the ₹1,000, took the note back at checkout, had the guest sign
 * that the ₹1,000 came back, and gave a receipt for the ₹500 only. This is
 * that note:
 *
 *   - its own number (SD/FY/NNNNNN), so it is never mistaken for a bill or a
 *     donation and can be asked for back at the desk;
 *   - who, which room, which nights, how much and how it was paid;
 *   - that it is REFUNDABLE and must be returned at checkout;
 *   - the cashier's signature (received by) and the guest's.
 *
 * The return is the refund voucher (paymentVoucher.ts, variant
 * 'deposit_refund'). The stay's own bill no longer shows the deposit at all:
 * it is not part of what the room cost.
 *
 * Prints on the paper the trust's room receipts use, roll or sheet. A roll
 * page is two explicit lengths: `size: <length> auto` is invalid CSS and is
 * silently dropped (see ROLL in receiptTemplates.ts).
 */
import { amountInWords } from './receiptDocument'
import { receiptLabelsFor } from './receiptLabels'

export interface DepositReceiptData {
  receipt_no: string
  date: string
  received_at?: string | null
  guest: { name: string | null; mobile: string | null }
  booking: { invoice_no?: string | null; room_number?: string | null; building?: string | null; check_in?: string | null; check_out?: string | null }
  amount_paise: number
  tenders: { payment_mode: string; amount_paise: number; reference_no?: string | null; account_name?: string | null }[]
  received_by?: string | null
  total_taken_paise: number
  held_paise: number
  settled: boolean
  refund_voucher_no?: string | null
  mandir?: {
    name?: string; address?: string; mobile?: string | null; pan?: string | null; registration_number?: string | null
    logo_base64?: string | null; logo_cdn_url?: string | null; show_logo?: boolean
    signature_image?: string | null; receipt_paper?: string | null; receipt_language?: string | null
    label_overrides?: unknown
  } | null
}

const ROLL: Record<string, { page: string; width: string }> = {
  thermal58: { page: '58mm 200mm', width: '48mm' },
  thermal80: { page: '80mm 200mm', width: '72mm' },
  thermal112: { page: '112mm 200mm', width: '104mm' },
}
const MODES: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', cheque: 'Cheque', netbanking: 'Net banking', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS',
  card: 'Card', online: 'Online', bank_transfer: 'Bank transfer',
}

const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rs = (p: number): string => (Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00+05:30` : String(iso))
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function buildDepositReceiptHtml(r: DepositReceiptData): string {
  const m = r.mandir ?? {}
  const L = receiptLabelsFor(m.receipt_language ?? 'en', m.label_overrides)
  const roll = ROLL[m.receipt_paper ?? '']
  const a5 = m.receipt_paper === 'a5'
  const logo = m.show_logo !== false ? (m.logo_base64 || m.logo_cdn_url || '') : ''
  const mode = r.tenders.map(t =>
    `${esc(MODES[t.payment_mode] ?? t.payment_mode)}${r.tenders.length > 1 ? ` ₹${rs(t.amount_paise)}` : ''}${t.reference_no ? ` (${esc(t.reference_no)})` : ''}`,
  ).join(' + ')
  const row = (k: string, v: string, strong = false) =>
    `<tr${strong ? ' class="s"' : ''}><td>${esc(k)}</td><td>${v}</td></tr>`
  const page = roll ? `size: ${roll.page}; margin: 3mm` : `size: ${a5 ? 'A5' : 'A4'}; margin: ${a5 ? 8 : 12}mm`
  const font = roll ? (m.receipt_paper === 'thermal58' ? 10 : 11) : (a5 ? 11 : 12)

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(L.depositReceipt)} ${esc(r.receipt_no)}</title>
<style>
  @page { ${page}; }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Noto Sans','Segoe UI',Arial,sans-serif;color:#111;font-size:${font}px;font-variant-numeric:tabular-nums;background:#fff;}
  .v{${roll ? `width:${roll.width};margin:0 auto;` : `max-width:${a5 ? '128mm' : '170mm'};margin:0 auto;border:1.5px solid #111;padding:${a5 ? '10px 12px' : '14px 18px'};`}}
  .head{text-align:center;border-bottom:1.5px solid #111;padding-bottom:6px;}
  .head img{max-height:${roll ? 30 : 42}px;max-width:90px;object-fit:contain;filter:grayscale(1);}
  .head .n{font-size:${font + 4}px;font-weight:800;} .head .a{font-size:${font - 2}px;color:#333;}
  h1{font-size:${font + 2}px;letter-spacing:1.5px;text-align:center;margin:7px 0 2px;}
  .no{text-align:center;font-family:'Courier New',monospace;font-weight:700;font-size:${font + 1}px;}
  .dt{text-align:center;font-size:${font - 2}px;color:#333;margin-bottom:6px;}
  table{width:100%;border-collapse:collapse;}
  td{padding:3px 4px;border-bottom:1px dotted #999;vertical-align:top;}
  td:first-child{color:#333;width:42%;} td:last-child{text-align:right;}
  tr.s td{font-weight:800;font-size:${font + 3}px;border-bottom:1.5px solid #111;}
  .words{font-style:italic;margin:5px 0;font-size:${font - 1}px;}
  .note{border:1.5px dashed #111;padding:6px 8px;margin-top:6px;font-weight:600;font-size:${font - 1}px;line-height:1.45;}
  .sign{display:flex;gap:10px;margin-top:${roll ? 26 : 34}px;}
  .sign>div{flex:1;text-align:center;} .sign .line{border-top:1px solid #111;padding-top:3px;font-size:${font - 2}px;}
  .sign img{max-height:30px;max-width:110px;object-fit:contain;filter:grayscale(1);}
  .settled{margin-top:6px;text-align:center;font-weight:800;border:1px solid #111;padding:3px;}
</style></head><body>
<div class="v" data-deposit-receipt="${esc(r.receipt_no)}">
  <div class="head">
    ${logo ? `<img src="${esc(logo)}" alt=""><br>` : ''}
    <div class="n">${esc(m.name ?? '')}</div>
    <div class="a">${esc(m.address ?? '')}${m.mobile ? ` · ${esc(m.mobile)}` : ''}</div>
  </div>
  <h1>${esc(L.depositReceipt)}</h1>
  <div class="no" data-testid="deposit-receipt-no">${esc(r.receipt_no)}</div>
  <div class="dt">${esc(day(r.date))}</div>
  <table>
    ${row(L.guest, `<b>${esc(r.guest.name ?? '—')}</b>${r.guest.mobile ? `<br>${esc(r.guest.mobile)}` : ''}`)}
    ${row(L.room, `${esc(r.booking.room_number ?? '—')}${r.booking.building ? ` · ${esc(r.booking.building)}` : ''}`)}
    ${r.booking.check_in ? row(L.checkIn, esc(day(r.booking.check_in))) : ''}
    ${r.booking.check_out ? row(L.checkOut, esc(day(r.booking.check_out))) : ''}
    ${row(L.paymentMode, mode || '—')}
    ${row(L.depositHeld, `₹ ${rs(r.amount_paise)}`, true)}
  </table>
  <div class="words">${esc(L.amountInWords)}: ${esc(amountInWords(r.amount_paise))}</div>
  <div class="note">${esc(L.depositRefundNote)}</div>
  ${r.settled ? `<div class="settled">${esc(r.refund_voucher_no ?? '')} ✓</div>` : ''}
  <div class="sign">
    <div><div class="line">${esc(r.received_by ?? '')}<br>${esc(L.authorised)}</div></div>
    <div><div class="line">${esc(L.guest)}</div></div>
  </div>
</div>
</body></html>`
}
