/**
 * The payslip (tenant migration 061): what an employee is handed with their
 * salary.
 *
 * Asked for 2026-10-08 — "the advance salary is given to one employee but it
 * is not deducting and not showing the calculations". A payslip is where the
 * calculation lives in every payroll package (Tally, Zoho Payroll, Keka):
 *
 *   - the rate, the month's days, the loss-of-pay days and the days paid for,
 *     so "why ₹18,387 and not ₹20,000" is answered on the paper;
 *   - earnings and deductions side by side, each advance deduction naming the
 *     advance (its voucher number and date) it came from;
 *   - net pay, in figures and words, and how it was paid (mode, UTR);
 *   - every advance still open after this month — what is still owed;
 *   - the employee's signature that the net was received.
 *
 * Pure CSS on A4 or A5, black-and-white friendly, like the payment voucher.
 */
import { amountInWords } from './receiptDocument'

export interface PayslipData {
  month: string
  status: 'paid' | 'computed'
  employee: {
    name: string; designation?: string | null; department?: string | null; mobile?: string | null
    joining_date?: string | null; bank_account_last4?: string | null
  }
  salary_type: 'monthly' | 'daily' | string
  rate_paise: number
  days_in_month: number
  days_present: number
  days_absent: number
  payable_days: number | null
  loss_of_pay_days: number | null
  gross_paise: number
  advance_recovered_paise: number
  other_deductions_paise: number
  deductions_paise: number
  net_paise: number
  deductions: { advance_id: string; advance_date: string | null; voucher_no: string | null; advance_paise: number; reason?: string | null; amount_paise: number }[]
  advances: { id: string; advance_date: string | null; voucher_no: string | null; amount_paise: number; recovered_paise: number; outstanding_paise: number }[]
  paid_on: string | null
  payment_mode: string | null
  payment_account_name?: string | null
  reference_no: string | null
  voucher_no: string | null
  paid_by?: string | null
  mandir?: {
    name?: string; address?: string; mobile?: string | null
    pan?: string | null; registration_number?: string | null
    logo_base64?: string | null; logo_cdn_url?: string | null; show_logo?: boolean
    signature_image?: string | null; receipt_paper?: string | null; receipt_language?: string | null
  } | null
}

type W = Record<
  'title' | 'for' | 'employee' | 'designation' | 'joined' | 'bank' | 'rate' | 'perMonth' | 'perDay' | 'days' | 'daysInMonth'
  | 'lop' | 'paidDays' | 'earnings' | 'deductions' | 'basic' | 'advance' | 'other' | 'totalEarn' | 'totalDed' | 'net'
  | 'inWords' | 'paidOn' | 'mode' | 'ref' | 'voucher' | 'notPaid' | 'openAdv' | 'given' | 'recovered' | 'owed' | 'none'
  | 'preparedBy' | 'authorised' | 'received' | 'receivedLine' | 'working' | 'present' | 'absent' | 'date' | 'advAmt', string>

const EN: W = {
  title: 'SALARY SLIP', for: 'for', employee: 'Employee', designation: 'Designation', joined: 'Joined', bank: 'Bank A/c',
  rate: 'Salary', perMonth: 'per month', perDay: 'per day', days: 'Days', daysInMonth: 'Days in month', lop: 'Loss of pay',
  paidDays: 'Days paid', earnings: 'Earnings', deductions: 'Deductions', basic: 'Salary for the days paid',
  advance: 'Advance recovery', other: 'Other deductions', totalEarn: 'Total earnings', totalDed: 'Total deductions',
  net: 'Net pay', inWords: 'In words', paidOn: 'Paid on', mode: 'Mode', ref: 'UTR / Ref.', voucher: 'Voucher No.',
  notPaid: 'Computed — not yet paid', openAdv: 'Advances after this salary', given: 'Given', recovered: 'Recovered',
  owed: 'Still owed', none: 'No advance outstanding.', preparedBy: 'Prepared by', authorised: 'Authorised signatory',
  received: "Employee's signature", receivedLine: 'Received the net pay above.', working: 'Working',
  present: 'Present', absent: 'Absent', date: 'Date', advAmt: 'Advance',
}
const HI: W = {
  title: 'वेतन पर्ची', for: 'माह', employee: 'कर्मचारी', designation: 'पद', joined: 'नियुक्ति', bank: 'बैंक खाता',
  rate: 'वेतन', perMonth: 'प्रति माह', perDay: 'प्रति दिन', days: 'दिन', daysInMonth: 'माह के दिन', lop: 'वेतन कटौती के दिन',
  paidDays: 'भुगतान के दिन', earnings: 'आय', deductions: 'कटौती', basic: 'भुगतान के दिनों का वेतन',
  advance: 'अग्रिम वसूली', other: 'अन्य कटौती', totalEarn: 'कुल आय', totalDed: 'कुल कटौती',
  net: 'शुद्ध वेतन', inWords: 'शब्दों में', paidOn: 'भुगतान दिनांक', mode: 'माध्यम', ref: 'UTR / संदर्भ', voucher: 'वाउचर क्र.',
  notPaid: 'गणना हुई — भुगतान शेष', openAdv: 'इस वेतन के बाद अग्रिम', given: 'दिया', recovered: 'वसूला',
  owed: 'शेष', none: 'कोई अग्रिम शेष नहीं।', preparedBy: 'तैयारकर्ता', authorised: 'अधिकृत हस्ताक्षरकर्ता',
  received: 'कर्मचारी के हस्ताक्षर', receivedLine: 'उपरोक्त शुद्ध वेतन प्राप्त किया।', working: 'गणना',
  present: 'उपस्थित', absent: 'अनुपस्थित', date: 'दिनांक', advAmt: 'अग्रिम',
}
const MR: W = {
  ...HI,
  title: 'पगार पावती', for: 'महिना', employee: 'कर्मचारी', designation: 'पद', rate: 'पगार', perMonth: 'दरमहा', perDay: 'प्रतिदिन',
  daysInMonth: 'महिन्याचे दिवस', lop: 'पगार कपात दिवस', paidDays: 'पगाराचे दिवस', earnings: 'मिळकत', deductions: 'कपात',
  basic: 'दिवसांचा पगार', advance: 'उचल वसुली', other: 'इतर कपात', totalEarn: 'एकूण मिळकत', totalDed: 'एकूण कपात',
  net: 'निव्वळ पगार', inWords: 'अक्षरी', paidOn: 'दिल्याची तारीख', mode: 'पद्धत', voucher: 'व्हाउचर क्र.',
  notPaid: 'गणना झाली — पगार दिलेला नाही', openAdv: 'या पगारानंतर उचल', given: 'दिली', recovered: 'वसूल', owed: 'बाकी',
  none: 'कोणतीही उचल बाकी नाही.', received: 'कर्मचाऱ्याची स्वाक्षरी', receivedLine: 'वरील निव्वळ पगार मिळाला.',
  working: 'गणना', present: 'हजर', absent: 'गैरहजर', date: 'तारीख', advAmt: 'उचल',
}
const WORDS: Record<string, W> = { en: EN, hi: HI, mr: MR }
const MODES: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS',
  cheque: 'Cheque', netbanking: 'Net banking', online: 'Online',
}

const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rs = (p: number): string => (Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00+05:30` : String(iso))
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
const monthName = (m: string): string => {
  const d = new Date(`${m}-01T00:00:00+05:30`)
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}
const n = (x: number | null | undefined) => (x == null ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(1))

/** The one-line arithmetic: "₹20,000 ÷ 31 × 28.5 days = ₹18,387.10". */
export function payslipWorking(p: PayslipData): string {
  if (p.salary_type === 'daily') return `₹ ${rs(p.rate_paise)} × ${n(p.payable_days)} = ₹ ${rs(p.gross_paise)}`
  if (p.payable_days != null && p.payable_days >= p.days_in_month) return `₹ ${rs(p.rate_paise)} (${p.days_in_month}/${p.days_in_month})`
  return `₹ ${rs(p.rate_paise)} ÷ ${p.days_in_month} × ${n(p.payable_days)} = ₹ ${rs(p.gross_paise)}`
}

export function buildPayslipHtml(p: PayslipData): string {
  const L = WORDS[p.mandir?.receipt_language ?? 'en'] ?? EN
  const m = p.mandir ?? {}
  const a5 = m.receipt_paper === 'a5'
  const logo = m.show_logo !== false ? (m.logo_base64 || m.logo_cdn_url || '') : ''
  const ids = [m.pan ? `PAN ${esc(m.pan)}` : '', m.registration_number ? esc(m.registration_number) : ''].filter(Boolean).join(' · ')
  const earnRows = [[`${L.basic}`, p.gross_paise]]
  const dedRows: Array<[string, number]> = p.deductions.map((d) => [
    `${L.advance}${d.voucher_no ? ` — ${d.voucher_no}` : ''}${d.advance_date ? ` (${day(d.advance_date)})` : ''}`, d.amount_paise,
  ])
  if (p.other_deductions_paise) dedRows.push([L.other, p.other_deductions_paise])
  const rowsN = Math.max(earnRows.length, dedRows.length, 1)
  const body = Array.from({ length: rowsN }, (_, i) => {
    const e = earnRows[i]; const d = dedRows[i]
    return `<tr><td>${e ? esc(e[0]) : ''}</td><td class="n">${e ? `₹ ${rs(e[1] as number)}` : ''}</td><td>${d ? esc(d[0]) : (i === 0 ? '—' : '')}</td><td class="n">${d ? `₹ ${rs(d[1])}` : ''}</td></tr>`
  }).join('')
  const adv = p.advances.length
    ? `<table class="adv"><tr><th>${esc(L.voucher)}</th><th>${esc(L.date)}</th><th class="n">${esc(L.advAmt)} ₹</th><th class="n">${esc(L.recovered)} ₹</th><th class="n">${esc(L.owed)} ₹</th></tr>${p.advances.map((a) =>
      `<tr><td>${esc(a.voucher_no ?? '—')}</td><td>${esc(day(a.advance_date))}</td><td class="n">${rs(a.amount_paise)}</td><td class="n">${rs(a.recovered_paise)}</td><td class="n"><b>${rs(a.outstanding_paise)}</b></td></tr>`).join('')}</table>`
    : `<p class="muted">${esc(L.none)}</p>`
  const paid = p.status === 'paid'

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(L.title)} ${esc(p.employee.name)} ${esc(p.month)}</title>
<style>
  @page { size: ${a5 ? 'A5' : 'A4'}; margin: ${a5 ? 7 : 10}mm; }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Noto Sans','Segoe UI',Arial,sans-serif;color:#111;font-size:${a5 ? 9.5 : 11}px;font-variant-numeric:tabular-nums;background:#fff;}
  .v{border:1.5px solid #111;padding:${a5 ? '10px 12px' : '14px 18px'};}
  .head{display:flex;gap:10px;align-items:center;border-bottom:1.5px solid #111;padding-bottom:8px;}
  .head img{max-height:${a5 ? 34 : 44}px;max-width:90px;object-fit:contain;filter:grayscale(1);}
  .head .t{flex:1;text-align:center;} .head .nm{font-size:${a5 ? 14 : 17}px;font-weight:800;} .head .a{font-size:${a5 ? 8.5 : 9.5}px;color:#333;}
  h1{font-size:${a5 ? 12.5 : 15}px;letter-spacing:2px;text-align:center;margin:8px 0 6px;}
  .facts{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;border:1px solid #999;padding:6px 8px;margin-bottom:8px;}
  .facts div{display:flex;justify-content:space-between;gap:8px;} .facts span{color:#444;}
  table{width:100%;border-collapse:collapse;}
  .ed th,.ed td{border:1px solid #bbb;padding:${a5 ? '3px 6px' : '5px 8px'};text-align:left;vertical-align:top;}
  .ed th{background:#f2f2f2;} .n{text-align:right;white-space:nowrap;}
  .ed tr.tot td{font-weight:700;background:#fafafa;}
  .net{display:flex;justify-content:space-between;align-items:center;border:1.5px solid #111;padding:6px 10px;margin-top:8px;font-size:${a5 ? 12 : 14}px;font-weight:800;}
  .words{font-style:italic;margin:4px 0 6px;}
  .working{border:1px dashed #999;padding:4px 8px;margin-bottom:8px;}
  .pay{border:1px solid #999;padding:5px 8px;margin-top:6px;}
  .adv{margin-top:4px;} .adv th,.adv td{border-bottom:1px dotted #999;padding:2px 5px;text-align:left;} .adv th{font-weight:700;}
  .k{font-weight:700;margin-top:8px;} .muted{color:#555;margin-top:2px;}
  .sign{display:flex;gap:12px;margin-top:${a5 ? 18 : 28}px;align-items:flex-end;} .sign>div{flex:1;text-align:center;}
  .sign .line{border-top:1px solid #111;padding-top:3px;} .sign .who{min-height:16px;}
  .sign img{max-height:36px;max-width:120px;object-fit:contain;filter:grayscale(1);}
  .recv{flex:1.4 !important;} .recv .note{text-align:left;margin-bottom:${a5 ? 12 : 20}px;font-size:${a5 ? 8.5 : 9.5}px;}
</style></head><body>
<div class="v" data-payslip="${esc(p.month)}">
  <div class="head">
    ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
    <div class="t"><div class="nm">${esc(m.name ?? '')}</div><div class="a">${esc(m.address ?? '')}${m.mobile ? ` · ${esc(m.mobile)}` : ''}</div>${ids ? `<div class="a">${ids}</div>` : ''}</div>
  </div>
  <h1>${esc(L.title)} — ${esc(monthName(p.month))}</h1>
  <div class="facts">
    <div><span>${esc(L.employee)}</span><b>${esc(p.employee.name)}</b></div>
    <div><span>${esc(L.designation)}</span><b>${esc(p.employee.designation ?? '—')}</b></div>
    <div><span>${esc(L.rate)}</span><b>₹ ${rs(p.rate_paise)} ${esc(p.salary_type === 'daily' ? L.perDay : L.perMonth)}</b></div>
    <div><span>${esc(L.daysInMonth)}</span><b>${p.days_in_month}</b></div>
    <div><span>${esc(L.lop)}</span><b>${n(p.loss_of_pay_days)}</b></div>
    <div><span>${esc(L.paidDays)}</span><b>${n(p.payable_days)}</b></div>
    ${p.employee.joining_date ? `<div><span>${esc(L.joined)}</span><b>${esc(day(p.employee.joining_date))}</b></div>` : ''}
    ${p.employee.bank_account_last4 ? `<div><span>${esc(L.bank)}</span><b>•••• ${esc(p.employee.bank_account_last4)}</b></div>` : ''}
  </div>
  <div class="working"><b>${esc(L.working)}:</b> ${esc(payslipWorking(p))}</div>
  <table class="ed">
    <tr><th>${esc(L.earnings)}</th><th class="n">₹</th><th>${esc(L.deductions)}</th><th class="n">₹</th></tr>
    ${body}
    <tr class="tot"><td>${esc(L.totalEarn)}</td><td class="n">₹ ${rs(p.gross_paise)}</td><td>${esc(L.totalDed)}</td><td class="n">₹ ${rs(p.deductions_paise)}</td></tr>
  </table>
  <div class="net"><span>${esc(L.net)}</span><span data-testid="payslip-net">₹ ${rs(p.net_paise)}</span></div>
  <div class="words">${esc(L.inWords)}: ${esc(amountInWords(p.net_paise))}</div>
  <div class="pay">${paid
    ? `${esc(L.paidOn)} <b>${esc(day(p.paid_on))}</b> · ${esc(L.mode)} <b>${esc(MODES[(p.payment_mode ?? '').toLowerCase()] ?? p.payment_mode ?? '—')}</b>${p.payment_account_name ? ` (${esc(p.payment_account_name)})` : ''}${p.reference_no ? ` · ${esc(L.ref)} <b>${esc(p.reference_no)}</b>` : ''}${p.voucher_no ? ` · ${esc(L.voucher)} <b>${esc(p.voucher_no)}</b>` : ''}`
    : `<b>${esc(L.notPaid)}</b>`}</div>
  <div class="k">${esc(L.openAdv)}</div>
  ${adv}
  <div class="sign">
    <div><div class="who">${esc(p.paid_by ?? '')}</div><div class="line">${esc(L.preparedBy)}</div></div>
    <div><div class="who">${m.signature_image ? `<img src="${esc(m.signature_image)}" alt="">` : ''}</div><div class="line">${esc(L.authorised)}</div></div>
    <div class="recv"><div class="note">${esc(L.receivedLine)}</div><div class="line">${esc(L.received)} — ${esc(p.employee.name)}</div></div>
  </div>
</div>
</body></html>`
}
