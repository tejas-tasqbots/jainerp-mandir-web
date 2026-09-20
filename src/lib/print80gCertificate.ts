import { api } from './api'
import { receiptLabelsFor } from './receiptLabels'
import { printReceiptHtml } from './printReceipt'

interface Cert80gLine {
  invoice_no: string
  amount_paise: number
  payment_mode: string
  created_at: string
  category?: string | null
}

interface Cert80gData {
  fy: string
  period: { from: string; to: string }
  donor: {
    name: string
    mobile?: string | null
    pan_masked?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
  }
  mandir: {
    name: string
    address: string
    mobile?: string | null
    email?: string | null
    pan?: string | null
    reg_80g_number?: string | null
    reg_80g_urn?: string | null
    reg_80g_valid_upto?: string | null
    reg_12a_number?: string | null
    reg_12ab_number?: string | null
    logo_base64?: string | null
    logo_cdn_url?: string | null
    primary_color?: string
    footer?: string | null
    /**
     * The trust's receipt language and its own printed words (tenant migration
     * 046). This certificate is filed with an assessing officer by the donor, so
     * it reads the trust's vocabulary like every receipt does - it was hardcoded
     * English until now.
     */
    receipt_language?: string | null
    label_overrides?: unknown
  } | null
  lines: Cert80gLine[]
  total_paise: number
}

function fmtRs(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  function convert(n: number): string {
    if (n === 0) return ''
    if (n < 20) return ones[n] + ' '
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' '
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred ' + convert(n % 100)
    if (n < 100000) return convert(Math.floor(n / 1000)) + 'Thousand ' + convert(n % 1000)
    if (n < 10000000) return convert(Math.floor(n / 100000)) + 'Lakh ' + convert(n % 100000)
    return convert(Math.floor(n / 10000000)) + 'Crore ' + convert(n % 10000000)
  }
  const words = convert(rupees).trim()
  return words ? words + ' Rupees Only' : 'Zero Rupees'
}

function modeName(mode: string): string {
  const map: Record<string, string> = {
    cash: 'Cash', upi: 'UPI', cheque: 'Cheque', netbanking: 'Net Banking', online: 'Online',
  }
  return map[mode] || mode
}

function buildCert80gHtml(d: Cert80gData): string {
  // The TRUST'S printed vocabulary, not the operator's UI language. This
  // certificate is filed with an assessing officer by the donor, so every word
  // on it is the trust's - and it was hardcoded English, which meant a trust
  // that renamed a word saw it on its receipts and not on the certificate they
  // are summarised on ("many receipts are not beening udpated as per the new
  // wording sets"). `section80g5` is locked in the label table: the Act's own
  // reference is not a phrase a trust restates.
  const L = receiptLabelsFor(d.mandir?.receipt_language, d.mandir?.label_overrides)
  const m = d.mandir ?? { name: 'Mandir', address: '', primary_color: '#0D1B2E' }
  const color = m.primary_color || '#0D1B2E'
  const logo = m.logo_base64 || m.logo_cdn_url
  const fyEnd = Number(d.fy.slice(0, 4)) + 1

  const validUpto = m.reg_80g_valid_upto ? fmtDate(m.reg_80g_valid_upto) : null
  const regParts: string[] = []
  if (m.reg_80g_number) regParts.push(`80G Reg. No.: <b>${m.reg_80g_number}</b>`)
  if (m.reg_80g_urn && m.reg_80g_urn !== m.reg_80g_number) regParts.push(`80G URN: <b>${m.reg_80g_urn}</b>`)
  if (validUpto) regParts.push(`Valid upto: <b>${validUpto}</b>`)
  if (m.reg_12ab_number) regParts.push(`12AB: <b>${m.reg_12ab_number}</b>`)
  else if (m.reg_12a_number) regParts.push(`12A: <b>${m.reg_12a_number}</b>`)
  if (m.pan) regParts.push(`PAN: <b>${m.pan}</b>`)

  const rows = d.lines.map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${fmtDate(l.created_at)}</td>
      <td>${l.invoice_no}</td>
      <td>${l.category || '—'}</td>
      <td>${modeName(l.payment_mode)}</td>
      <td style="text-align:right">₹ ${fmtRs(l.amount_paise)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>80G Certificate — ${d.donor.name}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Times New Roman',serif;background:#f0f2f5;color:#1a1a1a;}
    .page{max-width:780px;margin:24px auto;background:#fff;border:2px solid ${color};border-radius:4px;overflow:hidden;}
    .header{padding:24px 36px;border-bottom:2px solid ${color};display:flex;align-items:center;gap:18px;}
    .logo{height:62px;width:auto;object-fit:contain;}
    .header h1{font-size:22px;font-weight:700;color:${color};}
    .header p{font-size:11px;color:#555;line-height:1.6;margin-top:2px;}
    .reg{font-size:10.5px;color:#444;margin-top:6px;line-height:1.8;}
    .title{text-align:center;padding:16px;background:${color}10;border-bottom:1px solid #e2e8f0;}
    .title h2{font-size:16px;letter-spacing:1px;text-transform:uppercase;color:${color};}
    .title .sub{font-size:11px;color:#666;margin-top:3px;}
    .body{padding:24px 36px;}
    .donor{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 18px;margin-bottom:18px;font-size:13px;line-height:1.9;}
    .donor b{color:#111;}
    table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12.5px;}
    th{background:${color};color:#fff;padding:8px 10px;text-align:left;font-size:11px;}
    th:last-child{text-align:right;}
    td{padding:7px 10px;border-bottom:1px solid #eef2f7;}
    tfoot td{font-weight:700;font-size:14px;border-top:2px solid ${color};background:${color}08;}
    .words{font-size:11px;font-style:italic;color:#444;margin-bottom:18px;}
    .declaration{font-size:11.5px;color:#374151;line-height:1.8;border-top:1px dashed #cbd5e1;padding-top:14px;margin-top:8px;}
    .sign{margin-top:48px;display:flex;justify-content:flex-end;}
    .sign .box{text-align:center;font-size:11px;color:#555;}
    .sign .line{border-top:1px solid #333;width:200px;padding-top:4px;margin-top:40px;}
    .footer-note{font-size:10.5px;color:#888;text-align:center;font-style:italic;margin-top:18px;padding-top:10px;border-top:1px solid #e2e8f0;}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    @media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}body{background:#fff;}.page{border-color:#999;margin:0;}}
  </style></head><body>
  <div class="page">
    <div class="header">
      ${logo ? `<img class="logo" src="${logo}" alt="logo"/>` : ''}
      <div>
        <h1>${m.name}</h1>
        <p>${m.address}</p>
        ${regParts.length ? `<div class="reg">${regParts.join(' &nbsp;|&nbsp; ')}</div>` : ''}
      </div>
    </div>
    <div class="title">
      <h2>80G Donation Certificate</h2>
      <div class="sub">Financial Year ${d.fy.slice(0, 4)}–${String(fyEnd).slice(2)} &nbsp;(${fmtDate(d.period.from)} to ${fmtDate(d.period.to)})</div>
    </div>
    <div class="body">
      <div class="donor">
        <div><b>Donor:</b> ${d.donor.name}</div>
        ${d.donor.mobile ? `<div><b>Mobile:</b> ${d.donor.mobile}</div>` : ''}
        ${d.donor.pan_masked ? `<div><b>PAN:</b> ${d.donor.pan_masked}</div>` : '<div style="color:#b91c1c"><b>PAN:</b> Not provided</div>'}
        ${[d.donor.address, d.donor.city, d.donor.state].filter(Boolean).length ? `<div><b>Address:</b> ${[d.donor.address, d.donor.city, d.donor.state].filter(Boolean).join(', ')}</div>` : ''}
      </div>
      <table>
        <thead><tr><th>#</th><th>${L.date}</th><th>${L.receiptNo}</th><th>${L.category}</th><th>${L.mode}</th><th>${L.amount}</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5">${L.total80gEligible}</td><td style="text-align:right">₹ ${fmtRs(d.total_paise)}</td></tr></tfoot>
      </table>
      <div class="words">${L.amountInWords}: ${amountInWords(d.total_paise)}</div>
      <div class="declaration">
        This is to certify that the above donation(s) have been received by <b>${m.name}</b> and are eligible
        for deduction under <b>${L.section80g5}</b> of the Income Tax Act, 1961${m.reg_80g_number ? `, vide registration/approval no. <b>${m.reg_80g_number}</b>` : ''}${validUpto ? `, valid up to <b>${validUpto}</b>` : ''}.
        No goods or services were provided in return for this donation.
      </div>
      <div class="sign">
        <div class="box"><div class="line">${L.authorisedSignatory}</div></div>
      </div>
      ${m.footer ? `<div class="footer-note">${m.footer}</div>` : ''}
    </div>
  </div></body></html>`
}

/** Fetch a donor's annual 80G certificate and open the print dialog. */
export async function print80gCertificate(donorId: string, fy?: string): Promise<void> {
  const { data } = await api.get(`/donations/donor/${donorId}/80g-certificate`, { params: fy ? { fy } : {} })
  const html = buildCert80gHtml(data.data as Cert80gData)
  printReceiptHtml(html)
}
