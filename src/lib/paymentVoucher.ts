/**
 * The payment voucher: what the trust hands a vendor to sign when it pays
 * (tenant migration 060).
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Asked for 2026-09-26: "if the trust has given the money they will take the
 * sign from the vendor that money is given ... part payment voucher and full
 * voucher ... to keep the verification record from the vendor payments". It is
 * the document every accounting package prints for money going OUT - Tally's
 * Payment Voucher, Vyapar's Payment-Out, Zoho's Payment Made - and it carries
 * what they all carry:
 *
 *   - a voucher number from its own consecutive series (PV/2026-27/000001),
 *     one per payment, so each part payment has its own signed record;
 *   - who was paid and what for (the bill, its number and date);
 *   - where the bill stands: total, paid before, THIS payment, balance after -
 *     so a part voucher shows the vendor what is still owed, and the final one
 *     that nothing is;
 *   - how it was paid: mode, account, UTR / cheque, and the amount in words;
 *   - three signatures - prepared by, authorised by, and the RECEIVER'S, which
 *     is the point of the document - and, for cash of Rs 5,000 or more, a box
 *     for the revenue stamp an Indian cash receipt of that size needs.
 *
 * Pure CSS on A4 or A5, like the receipts: the desktop prints with scripts off.
 * Black-and-white friendly whatever the trust's print colour, because a
 * voucher is an office record photocopied and filed.
 */
import { amountInWords } from './receiptDocument'

export interface PaymentVoucherData {
  voucher_no: string | null
  date: string
  kind: 'full' | 'part' | 'final'
  payee: { name: string | null; mobile?: string | null; gstin?: string | null; pan?: string | null; contact?: string | null }
  against: { description: string | null; category?: string | null; bill_number?: string | null; bill_date?: string | null }
  bill_paise: number
  tds_paise?: number
  tds_section?: string | null
  paid_before_paise: number
  amount_paise: number
  balance_after_paise: number
  payment_mode: string | null
  account_name?: string | null
  reference_no?: string | null
  cheque?: { number?: string | null; bank?: string | null; date?: string | null } | null
  narration?: string | null
  prepared_by?: string | null
  installments?: { voucher_no: string | null; date: string; amount_paise: number }[]
  mandir?: {
    name?: string; address?: string; mobile?: string | null; email?: string | null
    pan?: string | null; gstin?: string | null; show_gstin?: boolean
    registration_number?: string | null
    logo_base64?: string | null; logo_cdn_url?: string | null; show_logo?: boolean
    signature_image?: string | null
    receipt_paper?: string | null
    receipt_language?: string | null
  } | null
}

/** Cash of this much or more needs a revenue stamp on the receipt (Indian Stamp Act). */
export const REVENUE_STAMP_FROM_PAISE = 500000

type Words = Record<
  'title' | 'full' | 'part' | 'final' | 'voucherNo' | 'date' | 'paidTo' | 'mobile' | 'gstin' | 'pan' | 'against' | 'billNo'
  | 'billDate' | 'category' | 'billAmount' | 'tds' | 'paidBefore' | 'thisPayment' | 'balance' | 'settled' | 'inWords'
  | 'mode' | 'account' | 'reference' | 'cheque' | 'narration' | 'history' | 'preparedBy' | 'authorised' | 'receiver'
  | 'receiverLine' | 'stamp' | 'regNo', string>

const EN: Words = {
  title: 'PAYMENT VOUCHER', full: 'Full payment', part: 'Part payment', final: 'Final payment',
  voucherNo: 'Voucher No.', date: 'Date', paidTo: 'Paid to', mobile: 'Mobile', gstin: 'GSTIN', pan: 'PAN',
  against: 'Against', billNo: 'Bill No.', billDate: 'Bill date', category: 'Head', billAmount: 'Bill amount',
  tds: 'TDS deducted', paidBefore: 'Paid earlier', thisPayment: 'Paid by this voucher', balance: 'Balance due after this',
  settled: 'Fully settled', inWords: 'Amount in words', mode: 'Mode', account: 'From account', reference: 'UTR / Ref. No.',
  cheque: 'Cheque', narration: 'Narration', history: 'Payments against this bill', preparedBy: 'Prepared by',
  authorised: 'Authorised signatory', receiver: "Receiver's signature",
  receiverLine: 'Received the above amount in full for this payment.', stamp: 'Revenue stamp', regNo: 'Reg. No.',
}
const HI: Words = {
  title: 'भुगतान वाउचर', full: 'पूर्ण भुगतान', part: 'आंशिक भुगतान', final: 'अंतिम भुगतान',
  voucherNo: 'वाउचर क्रमांक', date: 'दिनांक', paidTo: 'भुगतान प्राप्तकर्ता', mobile: 'मोबाइल', gstin: 'GSTIN', pan: 'PAN',
  against: 'किस हेतु', billNo: 'बिल क्रमांक', billDate: 'बिल दिनांक', category: 'मद', billAmount: 'बिल राशि',
  tds: 'TDS कटौती', paidBefore: 'पहले भुगतान', thisPayment: 'इस वाउचर से भुगतान', balance: 'इसके बाद शेष',
  settled: 'पूर्ण चुकता', inWords: 'शब्दों में राशि', mode: 'माध्यम', account: 'खाते से', reference: 'UTR / संदर्भ क्र.',
  cheque: 'चेक', narration: 'विवरण', history: 'इस बिल पर भुगतान', preparedBy: 'तैयारकर्ता',
  authorised: 'अधिकृत हस्ताक्षरकर्ता', receiver: 'प्राप्तकर्ता के हस्ताक्षर',
  receiverLine: 'उपरोक्त राशि इस भुगतान हेतु पूर्ण रूप से प्राप्त की।', stamp: 'रेवेन्यू स्टाम्प', regNo: 'पंजीकरण क्र.',
}
const MR: Words = {
  ...HI,
  title: 'भरणा व्हाउचर', full: 'पूर्ण भरणा', part: 'अंशतः भरणा', final: 'अंतिम भरणा',
  voucherNo: 'व्हाउचर क्रमांक', paidTo: 'रक्कम प्राप्तकर्ता', against: 'कशासाठी', billNo: 'बिल क्रमांक', billDate: 'बिल दिनांक',
  category: 'खाते', billAmount: 'बिलाची रक्कम', paidBefore: 'आधी भरलेले', thisPayment: 'या व्हाउचरने भरलेले',
  balance: 'यानंतर बाकी', settled: 'पूर्ण फेड', inWords: 'अक्षरी रक्कम', mode: 'पद्धत', account: 'खात्यातून', narration: 'तपशील',
  history: 'या बिलावरील भरणा', preparedBy: 'तयार करणारे', authorised: 'अधिकृत स्वाक्षरी',
  receiver: 'प्राप्तकर्त्याची स्वाक्षरी', receiverLine: 'वरील रक्कम या भरण्यासाठी पूर्ण मिळाली.', regNo: 'नोंदणी क्र.',
}
const WORDS: Record<string, Words> = { en: EN, hi: HI, mr: MR }

const MODES: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS',
  cheque: 'Cheque', card: 'Card', dd: 'Demand draft', online: 'Online', netbanking: 'Net banking',
}

const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rs = (paise: number): string => (Number(paise || 0) / 100)
  .toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00+05:30` : String(iso))
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function buildPaymentVoucherHtml(v: PaymentVoucherData): string {
  const L = WORDS[v.mandir?.receipt_language ?? 'en'] ?? EN
  const m = v.mandir ?? {}
  // A voucher is a sheet document: A5 when the trust prints receipts on A5,
  // A4 otherwise (a roll is no place for three signatures).
  const a5 = m.receipt_paper === 'a5'
  const logo = m.show_logo !== false ? (m.logo_base64 || m.logo_cdn_url || '') : ''
  const cash = (v.payment_mode ?? '').toLowerCase() === 'cash'
  const stamp = cash && v.amount_paise >= REVENUE_STAMP_FROM_PAISE
  const kindWord = v.kind === 'part' ? L.part : v.kind === 'final' ? L.final : L.full
  const ref = v.reference_no || (v.cheque?.number ? `${L.cheque} ${v.cheque.number}${v.cheque.bank ? `, ${v.cheque.bank}` : ''}${v.cheque.date ? `, ${day(v.cheque.date)}` : ''}` : '')
  const row = (k: string, val: string, strong = false) =>
    `<tr${strong ? ' class="strong"' : ''}><td>${esc(k)}</td><td>${val}</td></tr>`
  const ids = [
    m.pan ? `PAN ${esc(m.pan)}` : '',
    m.show_gstin && m.gstin ? `GSTIN ${esc(m.gstin)}` : '',
    m.registration_number ? `${esc(L.regNo)} ${esc(m.registration_number)}` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ')
  const history = (v.installments ?? []).length > 1
    ? `<div class="hist"><div class="k">${esc(L.history)}</div><table>${(v.installments ?? []).map((i) =>
      `<tr${i.voucher_no === v.voucher_no ? ' class="me"' : ''}><td>${esc(i.voucher_no ?? '—')}</td><td>${esc(day(i.date))}</td><td class="n">₹ ${rs(i.amount_paise)}</td></tr>`).join('')}</table></div>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(L.title)} ${esc(v.voucher_no ?? '')}</title>
<style>
  @page { size: ${a5 ? 'A5' : 'A4'}; margin: ${a5 ? 7 : 10}mm; }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Noto Sans','Segoe UI',Arial,sans-serif;color:#111;font-size:${a5 ? 10 : 11.5}px;
       font-variant-numeric:tabular-nums lining-nums;background:#fff;}
  .v{border:1.5px solid #111;padding:${a5 ? '10px 12px' : '16px 20px'};}
  .head{display:flex;gap:10px;align-items:center;border-bottom:1.5px solid #111;padding-bottom:8px;}
  .head img{max-height:${a5 ? 34 : 46}px;max-width:90px;object-fit:contain;filter:grayscale(1);}
  .head .t{flex:1;text-align:center;}
  .head .n{font-size:${a5 ? 14 : 18}px;font-weight:800;}
  .head .a{font-size:${a5 ? 8.5 : 10}px;color:#333;}
  .head .i{font-size:${a5 ? 8 : 9.5}px;color:#333;margin-top:2px;}
  .title{display:flex;justify-content:space-between;align-items:center;margin:8px 0;}
  .title h1{font-size:${a5 ? 13 : 16}px;letter-spacing:2px;}
  .kind{border:1px solid #111;border-radius:3px;padding:2px 8px;font-weight:700;font-size:${a5 ? 9 : 10.5}px;}
  .meta{display:flex;justify-content:space-between;border:1px solid #999;padding:5px 8px;margin-bottom:8px;}
  .meta b{font-size:${a5 ? 11 : 13}px;}
  table{width:100%;border-collapse:collapse;}
  .grid td{padding:${a5 ? '3px 6px' : '5px 8px'};border:1px solid #bbb;vertical-align:top;}
  .grid td:first-child{width:36%;color:#333;}
  .grid tr.strong td{font-weight:800;font-size:${a5 ? 11.5 : 13.5}px;background:#f2f2f2;}
  .words{margin:6px 0 2px;font-style:italic;}
  .hist{margin-top:8px;}
  .hist .k{font-weight:700;margin-bottom:3px;}
  .hist td{padding:2px 6px;border-bottom:1px dotted #aaa;}
  .hist td.n{text-align:right;}
  .hist tr.me td{font-weight:800;}
  .narr{margin-top:6px;border:1px dashed #999;padding:4px 8px;}
  .sign{display:flex;gap:${a5 ? 8 : 14}px;margin-top:${a5 ? 18 : 30}px;align-items:flex-end;}
  .sign > div{flex:1;text-align:center;}
  .sign .line{border-top:1px solid #111;padding-top:3px;font-size:${a5 ? 9 : 10.5}px;}
  .sign .who{min-height:${a5 ? 14 : 18}px;font-size:${a5 ? 9 : 10.5}px;}
  .sign img{max-height:${a5 ? 30 : 40}px;max-width:120px;object-fit:contain;filter:grayscale(1);}
  .recv{flex:1.4 !important;}
  .recv .note{font-size:${a5 ? 8.5 : 9.5}px;margin-bottom:${a5 ? 14 : 22}px;text-align:left;}
  .stamp{width:${a5 ? 52 : 64}px;height:${a5 ? 58 : 70}px;border:1px dashed #111;font-size:${a5 ? 7.5 : 8.5}px;
         display:flex;align-items:center;justify-content:center;text-align:center;flex:none !important;}
</style></head><body>
<div class="v" data-voucher="${esc(v.voucher_no ?? '')}">
  <div class="head">
    ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
    <div class="t">
      <div class="n">${esc(m.name ?? '')}</div>
      <div class="a">${esc(m.address ?? '')}${m.mobile ? ` · ${esc(m.mobile)}` : ''}</div>
      ${ids ? `<div class="i">${ids}</div>` : ''}
    </div>
  </div>
  <div class="title"><h1>${esc(L.title)}</h1><span class="kind" data-kind="${esc(v.kind)}">${esc(kindWord)}</span></div>
  <div class="meta"><span>${esc(L.voucherNo)} <b>${esc(v.voucher_no ?? '—')}</b></span><span>${esc(L.date)} <b>${esc(day(v.date))}</b></span></div>
  <table class="grid">
    ${row(L.paidTo, `<b>${esc(v.payee.name ?? '—')}</b>${v.payee.mobile ? ` &nbsp;·&nbsp; ${esc(L.mobile)} ${esc(v.payee.mobile)}` : ''}${v.payee.gstin ? `<br>${esc(L.gstin)} ${esc(v.payee.gstin)}` : ''}${v.payee.pan ? `${v.payee.gstin ? ' &nbsp;·&nbsp; ' : '<br>'}${esc(L.pan)} ${esc(v.payee.pan)}` : ''}`)}
    ${row(L.against, `${esc(v.against.description ?? '—')}${v.against.category ? ` <span style="color:#444">(${esc(L.category)}: ${esc(v.against.category)})</span>` : ''}${v.against.bill_number ? `<br>${esc(L.billNo)} ${esc(v.against.bill_number)}` : ''}${v.against.bill_date ? ` &nbsp;·&nbsp; ${esc(L.billDate)} ${esc(day(v.against.bill_date))}` : ''}`)}
    ${row(L.billAmount, `₹ ${rs(v.bill_paise)}`)}
    ${v.tds_paise ? row(`${L.tds}${v.tds_section ? ` (${v.tds_section})` : ''}`, `₹ ${rs(v.tds_paise)}`) : ''}
    ${v.paid_before_paise ? row(L.paidBefore, `₹ ${rs(v.paid_before_paise)}`) : ''}
    ${row(L.thisPayment, `₹ ${rs(v.amount_paise)}`, true)}
    ${row(L.balance, v.balance_after_paise > 0 ? `₹ ${rs(v.balance_after_paise)}` : `₹ 0.00 &nbsp;(${esc(L.settled)})`)}
    ${row(L.mode, `${esc(MODES[(v.payment_mode ?? '').toLowerCase()] ?? v.payment_mode ?? '—')}${v.account_name ? ` &nbsp;·&nbsp; ${esc(L.account)}: ${esc(v.account_name)}` : ''}`)}
    ${ref ? row(L.reference, esc(ref)) : ''}
  </table>
  <div class="words">${esc(L.inWords)}: ${esc(amountInWords(v.amount_paise))}</div>
  ${v.narration ? `<div class="narr"><b>${esc(L.narration)}:</b> ${esc(v.narration)}</div>` : ''}
  ${history}
  <div class="sign">
    <div><div class="who">${esc(v.prepared_by ?? '')}</div><div class="line">${esc(L.preparedBy)}</div></div>
    <div><div class="who">${m.signature_image ? `<img src="${esc(m.signature_image)}" alt="">` : ''}</div><div class="line">${esc(L.authorised)}</div></div>
    <div class="recv"><div class="note">${esc(L.receiverLine)}</div><div class="line">${esc(L.receiver)}${v.payee.name ? ` — ${esc(v.payee.name)}` : ''}</div></div>
    ${stamp ? `<div class="stamp" data-testid="revenue-stamp">${esc(L.stamp)}</div>` : ''}
  </div>
</div>
</body></html>`
}
