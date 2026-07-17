import { api } from './api'

export interface ReceiptData {
  receipt_number: string
  date: string
  mandir: {
    name: string
    address: string
    mobile?: string | null
    email?: string | null
    website?: string | null
    gstin?: string | null
    pan?: string | null
    tan?: string | null
    is_gst_registered?: boolean
    reg_80g_number?: string | null
    reg_80g_urn?: string | null
    reg_80g_valid_upto?: string | null
    reg_12a_number?: string | null
    reg_12ab_number?: string | null
    upi_id?: string | null
    bank_account_name?: string | null
    bank_account_no?: string | null
    bank_ifsc?: string | null
    bank_name?: string | null
    logo_cdn_url?: string | null
    logo_base64?: string | null
    show_logo?: boolean
    show_80g?: boolean
    show_gstin?: boolean
    footer?: string | null
    template?: string
    primary_color?: string
  } | null
  donor: {
    name?: string | null
    mobile?: string | null
    pan_masked?: string | null
    // Full PAN — sent by the API only for 80G-eligible receipts, where it is
    // legally required. Absent (null) on non-80G receipts.
    pan_full?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    pincode?: string | null
  }
  category: string
  amount_paise: number
  payment_mode: string
  is_80g_eligible: boolean
  is_voided: boolean
}

function fmtRs(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function modeName(mode: string): string {
  const map: Record<string, string> = {
    cash: 'Cash', upi: 'UPI', cheque: 'Cheque',
    netbanking: 'Net Banking', online: 'Online / Card',
  }
  return map[mode] || mode
}

function amountInWords(paise: number): string {
  // Guard against a missing/NaN amount — without this, convert(NaN) recurses
  // forever (every comparison is false) and overflows the stack.
  if (!Number.isFinite(paise)) return 'Zero Rupees'
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

function logoTag(mandir: ReceiptData['mandir']): string {
  if (!mandir?.show_logo) return ''
  const src = mandir.logo_base64 || mandir.logo_cdn_url
  if (!src) return ''
  return `<img class="logo" src="${src}" alt="Logo" />`
}

function regBlock(mandir: ReceiptData['mandir']): string {
  if (!mandir?.show_80g) return ''
  const parts: string[] = []
  if (mandir.reg_80g_number) parts.push(`80G: <b>${mandir.reg_80g_number}</b>`)
  if (mandir.reg_12a_number) parts.push(`12A: <b>${mandir.reg_12a_number}</b>`)
  if (mandir.reg_12ab_number) parts.push(`12AB: <b>${mandir.reg_12ab_number}</b>`)
  if (mandir.pan) parts.push(`PAN: <b>${mandir.pan}</b>`)
  if (!parts.length) return ''
  return `<div class="reg-block">${parts.join(' &nbsp;|&nbsp; ')}</div>`
}

function paymentBlock(mandir: ReceiptData['mandir']): string {
  const parts: string[] = []
  if (mandir?.upi_id) parts.push(`UPI: <b>${mandir.upi_id}</b>`)
  if (mandir?.bank_account_no) {
    const bankLine = [mandir.bank_account_name, mandir.bank_account_no, mandir.bank_ifsc, mandir.bank_name].filter(Boolean).join(' | ')
    parts.push(`Bank: <b>${bankLine}</b>`)
  }
  if (!parts.length) return ''
  return `<div class="payment-block"><span class="pay-label">Payment Details:</span> ${parts.join(' &nbsp;&nbsp; ')}</div>`
}

function voidedBanner(is_voided: boolean): string {
  return is_voided ? '<div class="voided">⚠ THIS RECEIPT HAS BEEN VOIDED</div>' : ''
}

/**
 * Donor PAN text for the receipt. Only ever shown when the donation is
 * 80G-eligible — a non-80G receipt never shows the donor PAN.
 *
 * On an 80G receipt the FULL PAN is printed, because Indian income-tax rules
 * require the donor's PAN on the 80G receipt (it is what the donor reconciles
 * against Form 10BD/10BE; a masked value can't be matched). The API returns the
 * full PAN (`pan_full`) only for 80G receipts; everywhere else in the app PAN
 * stays masked. If the full PAN is unavailable (e.g. decrypt failure) we fall
 * back to the masked value rather than dropping it entirely.
 * Returns '' when there is nothing to show, so callers can drop it inline.
 */
function donorPan(r: ReceiptData): string {
  if (!r.is_80g_eligible) return ''
  return r.donor?.pan_full || r.donor?.pan_masked || ''
}

// ── TEMPLATE 1: Classic ─────────────────────────────────────────────────────
function buildClassic(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  return `
  <style>
    body { font-family: 'Arial', sans-serif; background:#f0f2f5; }
    .page { max-width:700px; margin:24px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.12); }
    .header { background:${color}; color:#fff; padding:24px 32px; display:flex; align-items:center; gap:20px; }
    .logo { height:60px; width:auto; object-fit:contain; border-radius:4px; background:#fff; padding:4px; }
    .header-text h1 { font-size:20px; font-weight:700; margin-bottom:3px; }
    .header-text p { font-size:11px; opacity:.85; line-height:1.6; }
    .receipt-badge { margin-left:auto; text-align:right; }
    .receipt-badge .label { font-size:10px; opacity:.7; letter-spacing:1px; text-transform:uppercase; }
    .receipt-badge .rno { font-size:18px; font-weight:700; font-family:monospace; }
    .receipt-badge .date { font-size:11px; opacity:.8; margin-top:2px; }
    .body { padding:28px 32px; }
    ${voidedBanner(r.is_voided) ? '.voided { background:#fee2e2; border:2px solid #f87171; color:#991b1b; padding:10px; border-radius:6px; text-align:center; font-weight:700; font-size:13px; margin-bottom:20px; }' : ''}
    .section-label { font-size:10px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:${color}; margin-bottom:8px; }
    .donor-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:14px 18px; margin-bottom:20px; }
    .donor-name { font-size:18px; font-weight:700; color:#111; }
    .donor-mobile { font-size:12px; color:#6b7280; margin-top:2px; }
    .amount-box { background:${color}12; border:1.5px solid ${color}40; border-radius:6px; padding:16px 18px; margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; }
    .amount-label { font-size:12px; color:${color}; font-weight:600; }
    .amount-value { font-size:28px; font-weight:800; color:${color}; font-family:monospace; }
    .amount-words { font-size:11px; color:#374151; margin-top:4px; font-style:italic; }
    table { width:100%; border-collapse:collapse; margin-bottom:16px; }
    td { padding:9px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; }
    td:first-child { color:#6b7280; font-weight:600; width:38%; }
    td:last-child { color:#111; font-weight:500; }
    .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; }
    .badge-green { background:#dcfce7; color:#15803d; }
    .badge-red { background:#fee2e2; color:#991b1b; }
    .reg-block { font-size:10.5px; color:#374151; border-top:1px dashed #e2e8f0; padding-top:10px; margin-top:4px; line-height:1.9; }
    .payment-block { font-size:10.5px; color:#374151; padding-top:8px; line-height:1.9; }
    .pay-label { font-weight:700; color:${color}; }
    .footer-note { font-size:11px; color:#6b7280; margin-top:16px; padding-top:12px; border-top:1px solid #e2e8f0; text-align:center; font-style:italic; }
    .print-hint { font-size:11px; color:#9ca3af; text-align:center; margin-top:14px; padding-bottom:8px; }
    @media print { body{background:#fff;} .page{box-shadow:none;margin:0;border-radius:0;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="header">
      ${logoTag(mandir)}
      <div class="header-text">
        <h1>${mandir.name}</h1>
        <p>${mandir.address}${mandir.mobile ? '<br>'+mandir.mobile : ''}${mandir.show_gstin && mandir.gstin ? '<br>GSTIN: '+mandir.gstin : ''}</p>
      </div>
      <div class="receipt-badge">
        <div class="label">Donation Receipt</div>
        <div class="rno">${r.receipt_number}</div>
        <div class="date">${dateStr}</div>
      </div>
    </div>
    <div class="body">
      ${voidedBanner(r.is_voided)}
      <div class="section-label">Received From</div>
      <div class="donor-box">
        <div class="donor-name">${r.donor?.name || 'Anonymous'}</div>
        ${r.donor?.mobile ? `<div class="donor-mobile">${r.donor.mobile}</div>` : ''}
        ${donorPan(r) ? `<div class="donor-mobile">PAN: ${donorPan(r)}</div>` : ''}
      </div>
      <div class="amount-box">
        <div>
          <div class="amount-label">Donation Amount</div>
          <div class="amount-words">${amountInWords(r.amount_paise)}</div>
        </div>
        <div class="amount-value">₹ ${fmtRs(r.amount_paise)}</div>
      </div>
      <table>
        <tr><td>Category</td><td>${r.category || '—'}</td></tr>
        <tr><td>Payment Mode</td><td>${modeName(r.payment_mode)}</td></tr>
        <tr><td>80G Eligible</td><td><span class="${r.is_80g_eligible ? 'badge badge-green' : 'badge badge-red'}">${r.is_80g_eligible ? 'Yes' : 'No'}</span></td></tr>
      </table>
      ${regBlock(mandir)}
      ${paymentBlock(mandir)}
      ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
      <div class="print-hint">Ctrl+P to print or save as PDF</div>
    </div>
  </div>`
}

// ── TEMPLATE 2: Minimal ─────────────────────────────────────────────────────
function buildMinimal(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  return `
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background:#fff; }
    .page { max-width:640px; margin:32px auto; padding:40px 44px; border:1px solid #d1d5db; }
    .top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:28px; padding-bottom:20px; border-bottom:2px solid ${color}; }
    .logo { height:48px; width:auto; object-fit:contain; }
    .mandir-info h1 { font-size:16px; font-weight:700; color:#111; }
    .mandir-info p { font-size:10px; color:#6b7280; line-height:1.7; margin-top:2px; }
    .rhs { text-align:right; }
    .rhs .rtitle { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:${color}; font-weight:700; }
    .rhs .rno { font-size:15px; font-weight:700; font-family:monospace; color:#111; margin-top:3px; }
    .rhs .rdate { font-size:11px; color:#6b7280; margin-top:2px; }
    ${voidedBanner(r.is_voided) ? '.voided{border:1px solid #f87171;background:#fff5f5;color:#b91c1c;padding:8px 12px;text-align:center;font-weight:700;font-size:12px;margin-bottom:20px;}' : ''}
    .field { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #f3f4f6; font-size:13px; }
    .field .k { color:#6b7280; }
    .field .v { font-weight:600; color:#111; text-align:right; }
    .amount-row .k { font-weight:700; color:#111; font-size:15px; }
    .amount-row .v { font-size:24px; font-weight:800; color:${color}; font-family:monospace; }
    .words { font-size:10.5px; color:#6b7280; font-style:italic; text-align:right; padding-bottom:12px; border-bottom:1px solid #f3f4f6; margin-bottom:4px; }
    .reg-block { font-size:10px; color:#6b7280; margin-top:20px; line-height:2; }
    .payment-block { font-size:10px; color:#6b7280; line-height:2; }
    .pay-label { color:${color}; font-weight:700; }
    .footer-note { font-size:11px; color:#9ca3af; text-align:center; margin-top:24px; font-style:italic; }
    .print-hint { font-size:10px; color:#d1d5db; text-align:center; margin-top:12px; }
    @media print { .page{border:none;margin:0;padding:28px;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="top">
      <div class="mandir-info">
        ${logoTag(mandir)}
        <h1>${mandir.name}</h1>
        <p>${mandir.address}${mandir.show_gstin && mandir.gstin ? '<br>GSTIN: '+mandir.gstin : ''}</p>
      </div>
      <div class="rhs">
        <div class="rtitle">Donation Receipt</div>
        <div class="rno">${r.receipt_number}</div>
        <div class="rdate">${dateStr}</div>
      </div>
    </div>
    ${voidedBanner(r.is_voided)}
    <div class="field"><span class="k">Received From</span><span class="v">${r.donor?.name || 'Anonymous'}${r.donor?.mobile ? '<br><span style="font-weight:400;font-size:11px;color:#6b7280">'+r.donor.mobile+'</span>' : ''}</span></div>
    ${donorPan(r) ? `<div class="field"><span class="k">Donor PAN</span><span class="v">${donorPan(r)}</span></div>` : ''}
    <div class="field"><span class="k">Category</span><span class="v">${r.category || '—'}</span></div>
    <div class="field"><span class="k">Payment Mode</span><span class="v">${modeName(r.payment_mode)}</span></div>
    <div class="field"><span class="k">80G Eligible</span><span class="v">${r.is_80g_eligible ? '✓ Yes' : '✗ No'}</span></div>
    <div class="field amount-row"><span class="k">Amount</span><span class="v">₹ ${fmtRs(r.amount_paise)}</span></div>
    <div class="words">${amountInWords(r.amount_paise)}</div>
    ${regBlock(mandir)}
    ${paymentBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    <div class="print-hint">Ctrl+P to print or save as PDF</div>
  </div>`
}

// ── TEMPLATE 3: Modern ──────────────────────────────────────────────────────
function buildModern(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  return `
  <style>
    body { font-family: 'Arial', sans-serif; background:#f8fafc; }
    .page { max-width:700px; margin:24px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,.15); }
    .stripe { height:6px; background:linear-gradient(90deg,${color},${color}99); }
    .header { padding:28px 36px; display:flex; align-items:center; gap:20px; border-bottom:1px solid #f1f5f9; }
    .logo { height:54px; width:auto; object-fit:contain; }
    .mandir-info h1 { font-size:19px; font-weight:800; color:#0f172a; letter-spacing:-.3px; }
    .mandir-info p { font-size:11px; color:#64748b; margin-top:3px; line-height:1.6; }
    .receipt-id { margin-left:auto; text-align:right; }
    .receipt-id .tag { display:inline-block; background:${color}15; color:${color}; font-size:10px; font-weight:700; letter-spacing:1px; padding:3px 10px; border-radius:999px; margin-bottom:6px; }
    .receipt-id .num { font-size:17px; font-weight:700; font-family:monospace; color:#0f172a; }
    .receipt-id .dt { font-size:11px; color:#94a3b8; margin-top:2px; }
    ${voidedBanner(r.is_voided) ? '.voided{background:#fef2f2;border-left:4px solid #ef4444;color:#b91c1c;padding:10px 16px;font-weight:700;font-size:12px;margin:16px 36px;}' : ''}
    .body { padding:24px 36px 32px; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
    .info-card { background:#f8fafc; border-radius:8px; padding:14px 16px; }
    .info-card .label { font-size:10px; color:#94a3b8; font-weight:700; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
    .info-card .value { font-size:14px; font-weight:700; color:#0f172a; }
    .info-card .sub { font-size:11px; color:#64748b; margin-top:2px; }
    .amount-hero { background:linear-gradient(135deg,${color},${color}cc); border-radius:10px; padding:20px 24px; color:#fff; display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
    .amount-hero .lbl { font-size:11px; opacity:.8; font-weight:600; letter-spacing:.5px; }
    .amount-hero .amt { font-size:32px; font-weight:900; font-family:monospace; }
    .amount-hero .words { font-size:10.5px; opacity:.8; margin-top:4px; font-style:italic; }
    .details { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px; }
    .detail-item .k { font-size:10px; color:#94a3b8; font-weight:700; letter-spacing:.5px; text-transform:uppercase; margin-bottom:2px; }
    .detail-item .v { font-size:13px; font-weight:600; color:#0f172a; }
    .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; }
    .badge-yes { background:#dcfce7; color:#15803d; }
    .badge-no { background:#fee2e2; color:#991b1b; }
    .reg-block { font-size:10.5px; color:#475569; background:#f8fafc; border-radius:6px; padding:10px 14px; margin-bottom:12px; line-height:2; }
    .payment-block { font-size:10.5px; color:#475569; background:#f8fafc; border-radius:6px; padding:10px 14px; margin-bottom:12px; line-height:2; }
    .pay-label { color:${color}; font-weight:700; }
    .footer-note { font-size:11px; color:#94a3b8; text-align:center; font-style:italic; padding-top:16px; border-top:1px solid #f1f5f9; margin-top:8px; }
    .print-hint { font-size:10px; color:#cbd5e1; text-align:center; margin-top:10px; }
    @media print { body{background:#fff;} .page{box-shadow:none;border-radius:0;margin:0;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="stripe"></div>
    <div class="header">
      ${logoTag(mandir)}
      <div class="mandir-info">
        <h1>${mandir.name}</h1>
        <p>${mandir.address}${mandir.show_gstin && mandir.gstin ? '<br>GSTIN: '+mandir.gstin : ''}</p>
      </div>
      <div class="receipt-id">
        <div class="tag">DONATION RECEIPT</div>
        <div class="num">${r.receipt_number}</div>
        <div class="dt">${dateStr}</div>
      </div>
    </div>
    ${voidedBanner(r.is_voided)}
    <div class="body">
      <div class="grid2">
        <div class="info-card">
          <div class="label">Received From</div>
          <div class="value">${r.donor?.name || 'Anonymous'}</div>
          ${r.donor?.mobile ? `<div class="sub">${r.donor.mobile}</div>` : ''}
          ${donorPan(r) ? `<div class="sub">PAN: ${donorPan(r)}</div>` : ''}
        </div>
        <div class="info-card">
          <div class="label">Category</div>
          <div class="value">${r.category || '—'}</div>
        </div>
      </div>
      <div class="amount-hero">
        <div>
          <div class="lbl">Donation Amount</div>
          <div class="words">${amountInWords(r.amount_paise)}</div>
        </div>
        <div class="amt">₹ ${fmtRs(r.amount_paise)}</div>
      </div>
      <div class="details">
        <div class="detail-item"><div class="k">Payment Mode</div><div class="v">${modeName(r.payment_mode)}</div></div>
        <div class="detail-item"><div class="k">80G Eligible</div><div class="v"><span class="${r.is_80g_eligible ? 'badge badge-yes' : 'badge badge-no'}">${r.is_80g_eligible ? 'Yes ✓' : 'No'}</span></div></div>
      </div>
      ${regBlock(mandir)}
      ${paymentBlock(mandir)}
      ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
      <div class="print-hint">Ctrl+P to print or save as PDF</div>
    </div>
  </div>`
}

// ── TEMPLATE 4: Traditional (Saffron) ───────────────────────────────────────
function buildTraditional(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>): string {
  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tiro+Devanagari+Sanskrit&display=swap');
    body { font-family: 'Times New Roman', serif; background:#fffbf0; }
    .page { max-width:680px; margin:24px auto; background:#fffef9; border:2px solid #c97b22; border-radius:4px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.1); }
    .top-border { height:8px; background:linear-gradient(90deg,#c97b22,#f59e0b,#c97b22); }
    .header { padding:24px 32px; text-align:center; border-bottom:2px solid #f59e0b; background:linear-gradient(180deg,#fef3c7,#fffef9); }
    .aum { font-size:28px; color:#c97b22; margin-bottom:4px; }
    .logo { height:56px; width:auto; object-fit:contain; margin-bottom:8px; }
    .mandir-name { font-size:22px; font-weight:700; color:#92400e; letter-spacing:.5px; }
    .mandir-address { font-size:11px; color:#78350f; margin-top:3px; line-height:1.7; }
    .receipt-title { font-size:13px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#c97b22; margin-top:10px; border-top:1px dashed #f59e0b; padding-top:8px; }
    .meta { display:flex; justify-content:space-between; padding:12px 32px; background:#fef9ee; border-bottom:1px solid #fde68a; font-size:12px; color:#78350f; font-weight:600; }
    ${voidedBanner(r.is_voided) ? '.voided{background:#fee2e2;border:2px solid #f87171;color:#991b1b;padding:8px;text-align:center;font-weight:700;font-size:13px;margin:12px 32px;}' : ''}
    .body { padding:20px 32px 28px; }
    .received { font-size:12px; color:#78350f; margin-bottom:6px; font-style:italic; }
    .donor-name { font-size:20px; font-weight:700; color:#92400e; margin-bottom:2px; }
    .donor-mobile { font-size:12px; color:#a16207; margin-bottom:16px; }
    .divider { border:none; border-top:1px dashed #f59e0b; margin:14px 0; }
    table { width:100%; border-collapse:collapse; }
    td { padding:9px 12px; border-bottom:1px solid #fef3c7; font-size:13px; }
    td:first-child { color:#78350f; font-weight:600; width:38%; }
    td:last-child { color:#1c1917; font-weight:500; }
    .amount-td { font-size:22px; font-weight:800; color:#c97b22; font-family:monospace; }
    .words-row td { font-size:10.5px; color:#a16207; font-style:italic; }
    .reg-block { font-size:10.5px; color:#78350f; margin-top:16px; line-height:2; padding-top:12px; border-top:1px dashed #f59e0b; }
    .payment-block { font-size:10.5px; color:#78350f; line-height:2; padding-top:6px; }
    .pay-label { color:#c97b22; font-weight:700; }
    .footer-note { font-size:11px; color:#a16207; text-align:center; margin-top:16px; font-style:italic; }
    .bottom-border { height:8px; background:linear-gradient(90deg,#c97b22,#f59e0b,#c97b22); margin-top:20px; }
    .print-hint { font-size:10px; color:#d97706; text-align:center; padding:8px; background:#fef9ee; }
    @media print { body{background:#fff;} .page{border-color:#999;box-shadow:none;margin:0;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="top-border"></div>
    <div class="header">
      <div class="aum">🕉</div>
      ${logoTag(mandir)}
      <div class="mandir-name">${mandir.name}</div>
      <div class="mandir-address">${mandir.address}${mandir.mobile ? '<br>'+mandir.mobile : ''}${mandir.show_gstin && mandir.gstin ? '<br>GSTIN: '+mandir.gstin : ''}</div>
      <div class="receipt-title">Donation Receipt / दान रसीद</div>
    </div>
    <div class="meta">
      <span>Receipt No: ${r.receipt_number}</span>
      <span>Date: ${dateStr}</span>
    </div>
    ${voidedBanner(r.is_voided)}
    <div class="body">
      <div class="received">Received with gratitude from:</div>
      <div class="donor-name">${r.donor?.name || 'Anonymous Donor'}</div>
      ${r.donor?.mobile ? `<div class="donor-mobile">${r.donor.mobile}</div>` : ''}
      ${donorPan(r) ? `<div class="donor-mobile">PAN: ${donorPan(r)}</div>` : ''}
      <hr class="divider">
      <table>
        <tr><td>Category</td><td>${r.category || '—'}</td></tr>
        <tr><td>Payment Mode</td><td>${modeName(r.payment_mode)}</td></tr>
        <tr><td>80G Eligible</td><td>${r.is_80g_eligible ? '✓ Yes' : 'No'}</td></tr>
        <tr><td>Amount</td><td class="amount-td">₹ ${fmtRs(r.amount_paise)}</td></tr>
        <tr class="words-row"><td></td><td>${amountInWords(r.amount_paise)}</td></tr>
      </table>
      ${regBlock(mandir)}
      ${paymentBlock(mandir)}
      ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    </div>
    <div class="bottom-border"></div>
    <div class="print-hint">Ctrl+P to print or save as PDF</div>
  </div>`
}

// ── TEMPLATE 5: Elegant (Premium) ───────────────────────────────────────────
function buildElegant(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  return `
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; background:#f5f5f5; }
    .page { max-width:700px; margin:24px auto; background:#fff; border-radius:2px; overflow:hidden; box-shadow:0 2px 20px rgba(0,0,0,.12); }
    .accent-bar { height:4px; background:${color}; }
    .header { display:grid; grid-template-columns:1fr auto; align-items:start; gap:24px; padding:32px 40px 24px; border-bottom:1px solid #e5e7eb; }
    .logo { height:52px; width:auto; object-fit:contain; display:block; margin-bottom:12px; }
    .mandir-name { font-size:20px; font-weight:700; color:#111; letter-spacing:-.2px; margin-bottom:4px; }
    .mandir-address { font-size:11px; color:#6b7280; line-height:1.8; }
    .receipt-meta { text-align:right; }
    .receipt-meta .rt { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:${color}; font-weight:700; margin-bottom:8px; }
    .receipt-meta .rn { font-size:18px; font-weight:700; font-family:'Courier New',monospace; color:#111; }
    .receipt-meta .rd { font-size:11px; color:#9ca3af; margin-top:4px; }
    ${voidedBanner(r.is_voided) ? '.voided{border:1px solid #fca5a5;background:#fff5f5;color:#b91c1c;padding:10px 16px;font-weight:700;text-align:center;font-size:12px;margin:16px 40px;}' : ''}
    .body { padding:28px 40px 36px; }
    .sec { margin-bottom:24px; }
    .sec-title { font-size:9px; letter-spacing:2px; text-transform:uppercase; color:${color}; font-weight:700; padding-bottom:6px; border-bottom:1px solid #f3f4f6; margin-bottom:12px; }
    .donor-name { font-size:20px; font-weight:700; color:#111; }
    .donor-sub { font-size:12px; color:#6b7280; margin-top:3px; }
    .amount-line { display:flex; align-items:baseline; gap:12px; margin:12px 0; }
    .amount-num { font-size:36px; font-weight:700; color:${color}; font-family:'Courier New',monospace; letter-spacing:-1px; }
    .amount-cur { font-size:20px; font-weight:700; color:${color}; }
    .amount-words { font-size:11px; color:#6b7280; font-style:italic; margin-top:2px; }
    .dl { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .dt { font-size:10px; color:#9ca3af; font-weight:700; letter-spacing:.5px; text-transform:uppercase; margin-bottom:3px; }
    .dd { font-size:13px; color:#111; font-weight:600; }
    .elig-yes { color:#15803d; } .elig-no { color:#b91c1c; }
    .reg-block { font-size:10.5px; color:#374151; border-top:1px solid #f3f4f6; padding-top:12px; margin-top:8px; line-height:2.1; }
    .payment-block { font-size:10.5px; color:#374151; line-height:2.1; }
    .pay-label { color:${color}; font-weight:700; }
    .footer-note { font-size:11px; color:#9ca3af; text-align:center; margin-top:20px; font-style:italic; }
    .bottom { height:4px; background:${color}20; margin-top:28px; position:relative; }
    .bottom::before { content:''; position:absolute; left:0; top:0; height:100%; width:30%; background:${color}; }
    .print-hint { font-size:10px; color:#d1d5db; text-align:center; padding:10px; }
    @media print { body{background:#fff;} .page{box-shadow:none;margin:0;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="accent-bar"></div>
    <div class="header">
      <div>
        ${logoTag(mandir)}
        <div class="mandir-name">${mandir.name}</div>
        <div class="mandir-address">${mandir.address}${mandir.mobile ? '<br>'+mandir.mobile : ''}${mandir.show_gstin && mandir.gstin ? '<br>GSTIN: '+mandir.gstin : ''}</div>
      </div>
      <div class="receipt-meta">
        <div class="rt">Donation Receipt</div>
        <div class="rn">${r.receipt_number}</div>
        <div class="rd">${dateStr}</div>
      </div>
    </div>
    ${voidedBanner(r.is_voided)}
    <div class="body">
      <div class="sec">
        <div class="sec-title">Received From</div>
        <div class="donor-name">${r.donor?.name || 'Anonymous'}</div>
        ${r.donor?.mobile ? `<div class="donor-sub">${r.donor.mobile}</div>` : ''}
        ${donorPan(r) ? `<div class="donor-sub">PAN: ${donorPan(r)}</div>` : ''}
      </div>
      <div class="sec">
        <div class="sec-title">Donation Amount</div>
        <div class="amount-line">
          <span class="amount-cur">₹</span>
          <span class="amount-num">${fmtRs(r.amount_paise)}</span>
        </div>
        <div class="amount-words">${amountInWords(r.amount_paise)}</div>
      </div>
      <div class="sec">
        <div class="sec-title">Details</div>
        <div class="dl">
          <div><div class="dt">Category</div><div class="dd">${r.category || '—'}</div></div>
          <div><div class="dt">Payment Mode</div><div class="dd">${modeName(r.payment_mode)}</div></div>
          <div><div class="dt">80G Eligible</div><div class="dd ${r.is_80g_eligible ? 'elig-yes' : 'elig-no'}">${r.is_80g_eligible ? '✓ Yes' : '✗ No'}</div></div>
        </div>
      </div>
      ${regBlock(mandir)}
      ${paymentBlock(mandir)}
      ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    </div>
    <div class="bottom"></div>
    <div class="print-hint">Ctrl+P to print or save as PDF</div>
  </div>`
}

// ── TEMPLATE 6: Temple (Shri Ram style — two-column, orange bar) ────────────
function buildTemple(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  const hasBank = mandir.bank_account_no || mandir.upi_id
  const hasReg = mandir.show_80g && (mandir.reg_80g_number || mandir.pan)
  return `
  <style>
    body { font-family: Arial, sans-serif; background:#f5f5f5; font-size:12px; }
    .page { max-width:740px; margin:20px auto; background:#fff; border:1.5px solid #ccc; box-shadow:0 2px 12px rgba(0,0,0,.1); }
    .top-bar { background:${color}; color:#fff; display:flex; align-items:center; gap:16px; padding:12px 20px; }
    .logo { height:64px; width:64px; object-fit:contain; border-radius:50%; background:#fff; padding:4px; flex-shrink:0; }
    .top-bar-text { flex:1; text-align:center; }
    .top-bar-text h1 { font-size:20px; font-weight:900; letter-spacing:.5px; text-transform:uppercase; margin-bottom:2px; }
    .top-bar-text .sub { font-size:11px; font-style:italic; opacity:.9; }
    .top-bar-text .addr { font-size:10px; opacity:.8; margin-top:4px; line-height:1.6; }
    .orange-line { height:5px; background:linear-gradient(90deg,#f97316,${color},#f97316); }
    ${hasReg ? '.tax-row { background:#fff8f0; border-bottom:1px solid #fde8cc; padding:6px 20px; font-size:11px; color:#92400e; display:flex; justify-content:space-between; }' : ''}
    .receipt-meta { display:flex; justify-content:flex-end; gap:32px; padding:8px 20px; border-bottom:1px solid #e5e7eb; font-size:11px; }
    .receipt-meta .label { color:#6b7280; }
    .receipt-meta .val { font-weight:700; color:#111; }
    ${r.is_voided ? '.voided{background:#fef2f2;border-bottom:2px solid #ef4444;color:#b91c1c;padding:8px 20px;font-weight:700;text-align:center;}' : ''}
    .two-col { display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid #e5e7eb; }
    .col-left { padding:16px 20px; border-right:1px solid #e5e7eb; }
    .col-right { padding:16px 20px; }
    .sec-hdr { background:${color}; color:#fff; font-size:10px; font-weight:700; letter-spacing:1px; padding:4px 10px; margin:-16px -20px 12px; text-transform:uppercase; }
    .field { margin-bottom:8px; }
    .field .k { font-size:10px; color:#6b7280; font-weight:600; margin-bottom:1px; }
    .field .v { font-size:13px; font-weight:700; color:#111; }
    .field .v.amount { font-size:20px; color:${color}; font-family:monospace; }
    .notes-section { padding:12px 20px; border-bottom:1px solid #e5e7eb; background:#fafafa; }
    .notes-section ul { list-style:disc; padding-left:18px; }
    .notes-section ul li { font-size:10px; color:#374151; line-height:1.7; }
    .footer-row { display:flex; justify-content:space-between; align-items:flex-end; padding:12px 20px 16px; }
    .sig-block { text-align:right; }
    .sig-block .for { font-size:11px; color:#6b7280; }
    .sig-block .entity { font-size:12px; font-weight:700; color:#111; margin-top:2px; }
    .sig-block .auth { font-size:10px; color:#6b7280; margin-top:20px; border-top:1px solid #9ca3af; padding-top:4px; }
    .bank-box { border:1px solid #d1d5db; border-radius:4px; padding:8px 12px; font-size:10px; color:#374151; line-height:1.8; }
    .print-hint { font-size:10px; color:#9ca3af; text-align:center; padding:6px; background:#f9fafb; }
    @media print { body{background:#fff;} .page{box-shadow:none;margin:0;border:none;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="top-bar">
      ${mandir.show_logo ? logoTag(mandir) : ''}
      <div class="top-bar-text">
        <h1>${mandir.name}</h1>
        ${mandir.email ? `<div class="sub">by ${mandir.email.split('@')[1] || mandir.name}</div>` : ''}
        <div class="addr">${mandir.address}${mandir.mobile ? ' &nbsp;|&nbsp; ' + mandir.mobile : ''}${mandir.email ? '<br>Email: ' + mandir.email : ''}</div>
      </div>
    </div>
    <div class="orange-line"></div>
    ${hasReg ? `<div class="tax-row">
      <span>Income Tax Exemption (80-G) Number: <b>${mandir.reg_80g_number || '—'}</b></span>
      ${mandir.pan ? `<span>PAN: <b>${mandir.pan}</b></span>` : ''}
    </div>` : ''}
    <div class="receipt-meta">
      <span><span class="label">Receipt No: </span><span class="val">${r.receipt_number}</span></span>
      <span><span class="label">Created: </span><span class="val">${dateStr}</span></span>
    </div>
    ${r.is_voided ? '<div class="voided">⚠ THIS RECEIPT HAS BEEN VOIDED</div>' : ''}
    <div class="two-col">
      <div class="col-left">
        <div class="sec-hdr">Donors Detail:</div>
        <div class="field"><div class="k">Received with Thanks</div><div class="v">From ${r.donor?.name || 'Anonymous Donor'}</div></div>
        ${r.donor?.mobile ? `<div class="field"><div class="k">Contact No.</div><div class="v">${r.donor.mobile}</div></div>` : ''}
        ${donorPan(r) ? `<div class="field"><div class="k">Donor PAN</div><div class="v">${donorPan(r)}</div></div>` : ''}
        <div class="field" style="margin-top:12px"><div class="k">Amount (INR)</div><div class="v amount">INR ${fmtRs(r.amount_paise)}</div></div>
        <div class="field"><div class="k">As donation for the cause</div><div class="v">${r.category || 'General Donation'}</div></div>
        ${hasBank ? `<div style="margin-top:12px"><div class="k" style="color:#6b7280;font-size:10px;font-weight:600;margin-bottom:4px">Bank / Payment Details</div><div class="bank-box">${mandir.upi_id ? 'UPI: <b>'+mandir.upi_id+'</b><br>' : ''}${mandir.bank_account_no ? 'A/C: <b>'+mandir.bank_account_no+'</b> &nbsp; IFSC: <b>'+mandir.bank_ifsc+'</b><br>'+mandir.bank_name : ''}</div></div>` : ''}
      </div>
      <div class="col-right">
        <div class="sec-hdr">Transaction Detail:</div>
        <div class="field"><div class="k">Donor Name</div><div class="v">${r.donor?.name || '—'}</div></div>
        <div style="margin:10px 0 6px"><div class="sec-hdr" style="margin:-4px -20px 10px">Purpose of Donation:</div>
          <div class="v">${r.category || 'General Donation'}</div>
        </div>
        <div style="margin-top:10px"><div class="sec-hdr" style="margin:-4px -20px 10px">Payment details:</div>
          <div class="v">${modeName(r.payment_mode)}</div>
        </div>
        <div style="margin-top:10px"><div class="sec-hdr" style="margin:-4px -20px 10px">Mode of Payment:</div>
          <div class="v">${modeName(r.payment_mode)}</div>
        </div>
        ${r.is_80g_eligible && mandir.show_80g ? `<div style="margin-top:10px;padding:6px 10px;background:#fef3c7;border:1px solid #fde68a;border-radius:3px;font-size:10px;color:#92400e"><b>80G Eligible</b> — Tax exemption certificate available</div>` : ''}
      </div>
    </div>
    ${mandir.footer ? `<div class="notes-section"><div style="font-size:10px;font-weight:700;margin-bottom:6px">Please Note:</div><ul><li>${mandir.footer}</li></ul></div>` : ''}
    <div class="footer-row">
      <div style="font-size:11px;color:#374151;max-width:300px;font-style:italic">${r.is_80g_eligible && mandir.show_80g ? 'This receipt is valid for 80G tax exemption purposes.' : 'Thank you for your generous donation.'}</div>
      <div class="sig-block">
        <div class="for">For ${mandir.name}</div>
        <div class="auth">Authorised Signatory</div>
      </div>
    </div>
    <div class="print-hint">Ctrl+P to print or save as PDF</div>
  </div>`
}

// ── TEMPLATE 7: Tabular (Saibaba Sansthan / Duplicate style) ────────────────
function buildTabular(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  return `
  <style>
    body { font-family: Arial, sans-serif; background:#fff; font-size:12px; }
    .page { max-width:700px; margin:20px auto; background:#fff; border:2px solid #333; }
    .header { text-align:center; padding:14px 20px 10px; border-bottom:2px solid #333; }
    .logo { height:52px; object-fit:contain; margin-bottom:6px; }
    .header h1 { font-size:18px; font-weight:900; text-transform:uppercase; color:#111; letter-spacing:.5px; }
    .header .ftr-no { font-size:10px; color:#555; margin-top:2px; }
    .header .addr { font-size:10px; color:#555; line-height:1.7; margin-top:3px; }
    .dup-banner { background:#f0f0f0; border-bottom:2px solid #333; text-align:center; font-size:13px; font-weight:900; letter-spacing:4px; padding:4px; color:#333; }
    ${r.is_voided ? '.voided-row{background:#fee2e2;text-align:center;font-weight:700;font-size:12px;color:#b91c1c;padding:8px;border-bottom:2px solid #333;}' : ''}
    .meta-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0; border-bottom:1px solid #999; }
    .meta-cell { padding:6px 14px; font-size:11px; border-right:1px solid #999; }
    .meta-cell:last-child { border-right:none; }
    .meta-cell .k { color:#555; font-size:10px; }
    .meta-cell .v { font-weight:700; color:#111; }
    .rcvd-row { padding:8px 14px; border-bottom:1px solid #999; font-size:12px; }
    .addr-row { display:grid; grid-template-columns:1fr 1fr; padding:6px 14px; border-bottom:1px solid #999; font-size:11px; gap:12px; }
    table.main { width:100%; border-collapse:collapse; border-top:2px solid #333; border-bottom:2px solid #333; }
    table.main th { background:#333; color:#fff; font-size:11px; padding:7px 14px; text-align:left; font-weight:700; letter-spacing:.5px; }
    table.main th:last-child { text-align:right; }
    table.main td { padding:10px 14px; border-bottom:1px solid #ddd; font-size:12px; }
    table.main td.amount-td { text-align:right; font-weight:700; font-family:monospace; font-size:14px; }
    table.main tr.total-row td { font-weight:900; border-top:2px solid #333; font-size:14px; }
    table.main tr.total-row td.amount-td { color:${color}; }
    .footer-section { padding:10px 14px; border-top:1px solid #ccc; background:#fafafa; font-size:10.5px; color:#374151; line-height:1.8; }
    .sig-row { display:flex; justify-content:space-between; align-items:flex-end; padding:10px 14px 14px; }
    .sig-block { text-align:center; }
    .sig-block .sig-line { width:120px; border-top:1px solid #333; margin:0 auto 3px; }
    .sig-block .sig-label { font-size:10px; color:#555; }
    .print-hint { font-size:10px; color:#9ca3af; text-align:center; padding:5px; background:#f9fafb; }
    @media print { body{background:#fff;} .page{margin:0;border:2px solid #333;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="header">
      ${mandir.show_logo ? logoTag(mandir) : ''}
      <h1>${mandir.name}</h1>
      ${(mandir.show_80g && mandir.reg_80g_number) || mandir.pan ? `<div class="ftr-no">${[mandir.reg_80g_number ? 'FTR No / 80G: '+mandir.reg_80g_number : '', mandir.pan ? 'PAN: '+mandir.pan : ''].filter(Boolean).join(' &nbsp;|&nbsp; ')}</div>` : ''}
      <div class="addr">${mandir.address}${mandir.mobile ? ' &nbsp;|&nbsp; Ph: '+mandir.mobile : ''}${mandir.show_gstin && mandir.gstin ? ' &nbsp;|&nbsp; GSTIN: '+mandir.gstin : ''}</div>
    </div>
    <div class="dup-banner">DONATION RECEIPT</div>
    ${r.is_voided ? '<div class="voided-row">⚠ THIS RECEIPT HAS BEEN VOIDED</div>' : ''}
    <div class="meta-row">
      <div class="meta-cell"><div class="k">Cont. No.</div><div class="v">${modeName(r.payment_mode).toUpperCase()}</div></div>
      <div class="meta-cell"><div class="k">Receipt Number</div><div class="v">${r.receipt_number}</div></div>
      <div class="meta-cell"><div class="k">Date</div><div class="v">${dateStr}</div></div>
    </div>
    <div class="rcvd-row">Received From: &nbsp;<b>${r.donor?.name || 'Anonymous Donor'}</b>${r.donor?.mobile ? ' &nbsp;&nbsp; Mobile: <b>'+r.donor.mobile+'</b>' : ''}${donorPan(r) ? ' &nbsp;&nbsp; PAN: <b>'+donorPan(r)+'</b>' : ''}</div>
    <div class="addr-row">
      <div>Category: <b>${r.category || 'General Donation'}</b></div>
      <div>Mode: <b>${modeName(r.payment_mode)}</b> &nbsp;|&nbsp; 80G: <b>${r.is_80g_eligible ? 'Yes' : 'No'}</b></div>
    </div>
    <table class="main">
      <thead><tr><th>Description</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td>${r.category || 'General Donation'}</td><td class="amount-td">₹ ${fmtRs(r.amount_paise)}</td></tr>
        <tr><td style="font-size:10px;color:#6b7280;font-style:italic">${amountInWords(r.amount_paise)}</td><td></td></tr>
      </tbody>
      <tfoot><tr class="total-row"><td><b>Total</b></td><td class="amount-td">₹ ${fmtRs(r.amount_paise)}</td></tr></tfoot>
    </table>
    ${(mandir.upi_id || mandir.bank_account_no) ? `<div class="footer-section">${mandir.upi_id ? 'UPI ID: <b>'+mandir.upi_id+'</b>' : ''} ${mandir.bank_account_no ? '&nbsp;|&nbsp; Bank A/C: <b>'+mandir.bank_account_no+'</b> IFSC: <b>'+mandir.bank_ifsc+'</b> — '+mandir.bank_name : ''}</div>` : ''}
    ${mandir.footer ? `<div class="footer-section" style="border-top:1px solid #ccc">${mandir.footer}</div>` : ''}
    <div class="sig-row">
      <div style="font-size:11px;color:#555">This is a computer-generated receipt.</div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">Authorised Signatory</div>
        <div style="font-size:10px;font-weight:700;color:#111;margin-top:2px">${mandir.name}</div>
      </div>
    </div>
    <div class="print-hint">Ctrl+P to print or save as PDF</div>
  </div>`
}

// ── TEMPLATE 8: Acknowledgement (Tirumala / Formal letter style) ─────────────
function buildAcknowledgement(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  return `
  <style>
    body { font-family: 'Times New Roman', Times, serif; background:#fff; font-size:13px; line-height:1.7; }
    .page { max-width:700px; margin:20px auto; background:#fff; border:2px double #333; padding:0; }
    .header { text-align:center; padding:16px 28px 12px; border-bottom:3px double #333; }
    .logo { height:60px; object-fit:contain; margin-bottom:6px; }
    .header h1 { font-size:20px; font-weight:900; text-transform:uppercase; letter-spacing:1px; color:#111; }
    .header h2 { font-size:13px; font-weight:700; color:#444; margin-top:2px; letter-spacing:.5px; }
    .header .addr { font-size:11px; color:#555; margin-top:4px; }
    .txn-row { display:flex; justify-content:space-between; padding:8px 28px; background:#f8f8f8; border-bottom:1px solid #ccc; font-size:11px; }
    .txn-row .lbl { color:#555; }
    .txn-row .val { font-weight:700; color:#111; }
    ${r.is_voided ? '.voided{text-align:center;font-weight:700;color:#b91c1c;padding:8px;border-bottom:2px solid #ccc;font-size:13px;}' : ''}
    .ack-title { text-align:center; font-size:15px; font-weight:900; letter-spacing:2px; text-transform:uppercase; padding:12px 28px; border-bottom:1px solid #ccc; background:${color}08; }
    .body { padding:20px 28px; }
    .recvd-para { margin-bottom:16px; }
    .recvd-para .amount-highlight { font-size:16px; font-weight:900; color:${color}; }
    table.details { width:100%; border-collapse:collapse; margin:16px 0; }
    table.details th { background:#333; color:#fff; font-size:11px; padding:6px 14px; text-align:left; }
    table.details td { padding:8px 14px; border:1px solid #ccc; font-size:12px; }
    table.details td.amt-col { font-weight:700; text-align:right; font-family:monospace; font-size:14px; }
    .certified { font-size:11px; color:#374151; background:#f9fafb; border:1px solid #e5e7eb; border-radius:3px; padding:10px 14px; margin:12px 0; line-height:1.8; }
    .contribution-line { font-style:italic; text-align:center; font-size:12px; color:#444; margin:12px 0; border-top:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb; padding:8px; }
    .address-block { margin-top:20px; }
    .address-block .to { font-size:11px; color:#555; margin-bottom:4px; }
    .address-block .donor-name { font-size:14px; font-weight:700; }
    .address-block .donor-addr { font-size:12px; color:#374151; margin-top:4px; line-height:1.7; }
    .sig-section { display:flex; justify-content:space-between; align-items:flex-end; margin-top:24px; padding-top:16px; border-top:1px solid #ccc; }
    .sig-left { font-size:11px; color:#555; }
    .sig-right { text-align:right; }
    .sig-right .role { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-top:24px; border-top:1px solid #333; padding-top:4px; }
    .sig-right .org { font-size:12px; font-weight:700; color:#111; }
    .footer-note { font-size:10px; color:#777; text-align:center; padding:8px 28px 12px; border-top:1px solid #ccc; font-style:italic; }
    .print-hint { font-size:10px; color:#9ca3af; text-align:center; padding:5px; background:#f9fafb; }
    @media print { body{background:#fff;} .page{margin:0;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="header">
      ${mandir.show_logo ? logoTag(mandir) : ''}
      <h1>${mandir.name}</h1>
      ${(mandir.show_80g && mandir.reg_80g_number) ? `<h2>${mandir.reg_80g_number}</h2>` : ''}
      <div class="addr">${mandir.address}${mandir.mobile ? '<br>Phone: '+mandir.mobile : ''}${mandir.email ? '<br>Email: '+mandir.email : ''}</div>
    </div>
    <div class="txn-row">
      <span><span class="lbl">Transaction ID: </span><span class="val">${r.receipt_number}</span></span>
      <span><span class="lbl">Status: </span><span class="val" style="color:#15803d">Received</span></span>
    </div>
    ${r.is_voided ? '<div class="voided">⚠ THIS RECEIPT HAS BEEN VOIDED</div>' : ''}
    <div class="ack-title">Acknowledgement Receipt</div>
    <div class="body">
      <div class="recvd-para">
        Received with thanks from <b>${r.donor?.name || 'Anonymous Donor'}</b>, an amount of
        <span class="amount-highlight">INR ${fmtRs(r.amount_paise)} / ${amountInWords(r.amount_paise)}</span>
        towards corpus donation on <b>${dateStr}</b>.
      </div>
      <table class="details">
        <thead><tr><th>Mode of Payment</th><th>Instrument No.</th><th>Instrument Date</th><th>Realized Amount</th></tr></thead>
        <tbody><tr>
          <td>${modeName(r.payment_mode)}</td>
          <td>${r.receipt_number}</td>
          <td>${dateStr}</td>
          <td class="amt-col">INR ${fmtRs(r.amount_paise)}</td>
        </tr></tbody>
      </table>
      ${r.is_80g_eligible && mandir.show_80g ? `<div class="certified">Certified that this donation is eligible for deduction U/S 80 G (5) (vi) of the Income Tax Act. ${mandir.reg_80g_number ? 'Reg No: <b>'+mandir.reg_80g_number+'</b>.' : ''} ${mandir.pan ? 'PAN: <b>'+mandir.pan+'</b>.' : ''}</div>` : ''}
      <div class="contribution-line">Your contribution towards "<b>${mandir.name}</b>" is one of the best charities.</div>
      ${mandir.footer ? `<div style="font-size:11px;color:#374151;font-style:italic;margin-top:8px">${mandir.footer}</div>` : ''}
      <div class="address-block">
        <div class="to">TO</div>
        <div class="donor-name">${r.donor?.name || 'Anonymous Donor'}</div>
        ${r.donor?.mobile ? `<div class="donor-addr">${r.donor.mobile}</div>` : ''}
        ${donorPan(r) ? `<div class="donor-addr">PAN: ${donorPan(r)}</div>` : ''}
      </div>
      <div class="sig-section">
        <div class="sig-left">This is an electronically generated document<br>and does not require any signature.</div>
        <div class="sig-right">
          <div class="org">${mandir.name}</div>
          <div class="role">Chief Accounts Officer</div>
        </div>
      </div>
    </div>
    <div class="footer-note">PLEASE SEE OVERLEAF FOR PARTICULARS OF THE TRUST</div>
    <div class="print-hint">Ctrl+P to print or save as PDF</div>
  </div>`
}

// ── TEMPLATE 9: Jain Tirth (Tally-style — bank box, signature) ──────────────
function buildJainTirth(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  const hasBank = mandir.bank_account_no
  return `
  <style>
    body { font-family: Arial, sans-serif; background:#fff; font-size:12px; }
    .page { max-width:720px; margin:20px auto; background:#fff; border:2.5px solid #333; }
    .header { padding:14px 20px 10px; border-bottom:2px solid #333; display:flex; gap:16px; align-items:flex-start; }
    .logo { height:68px; width:auto; object-fit:contain; }
    .header-center { flex:1; text-align:center; }
    .aum { font-size:12px; color:${color}; font-weight:700; margin-bottom:2px; }
    .header-center h1 { font-size:19px; font-weight:900; color:#111; text-transform:uppercase; letter-spacing:.5px; }
    .header-center .sub { font-size:11px; color:#444; margin-top:3px; line-height:1.6; }
    .reg-bar { font-size:10px; text-align:right; color:#555; }
    .reg-bar b { color:#111; }
    .title-bar { background:${color}; color:#fff; text-align:center; font-size:13px; font-weight:900; letter-spacing:2px; padding:5px 0; }
    .meta-row { display:flex; justify-content:space-between; padding:6px 16px; border-bottom:1px solid #ccc; font-size:11px; background:#fafafa; }
    ${r.is_voided ? '.voided{text-align:center;font-weight:700;color:#b91c1c;padding:8px;border-bottom:2px solid #ccc;}' : ''}
    .body { padding:14px 16px; }
    .field-row { display:flex; gap:8px; margin-bottom:8px; border-bottom:1px dotted #ccc; padding-bottom:7px; align-items:baseline; }
    .field-row .lbl { font-size:11px; font-weight:700; color:#333; min-width:140px; }
    .field-row .val { font-size:12px; color:#111; font-weight:600; }
    .field-row .val.big { font-size:16px; font-weight:900; color:${color}; font-family:monospace; }
    .bank-table { width:100%; border-collapse:collapse; margin-top:12px; }
    .bank-table td { border:1.5px solid #333; padding:8px 12px; font-size:11px; }
    .bank-table .amount-cell { font-size:16px; font-weight:900; font-family:monospace; color:${color}; text-align:right; }
    .bank-table .bank-info { font-size:10.5px; line-height:1.8; }
    .sig-row { display:flex; justify-content:flex-end; margin-top:20px; padding-top:12px; border-top:1px solid #ccc; }
    .sig-box { text-align:center; }
    .sig-box .sig-line { width:140px; border-top:1px solid #333; margin:0 auto 4px; }
    .sig-box .sig-lbl { font-size:11px; font-weight:700; }
    .reg-footer { font-size:10px; color:#555; padding:8px 16px; border-top:1px solid #ccc; background:#fafafa; }
    .print-hint { font-size:10px; color:#9ca3af; text-align:center; padding:5px; }
    @media print { body{background:#fff;} .page{margin:0;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="header">
      ${mandir.show_logo ? logoTag(mandir) : ''}
      <div class="header-center">
        <div class="aum">॥ श्री आदिनाथाय नमः ॥</div>
        <h1>${mandir.name}</h1>
        <div class="sub">${mandir.address}${mandir.mobile ? '<br>'+mandir.mobile : ''}</div>
      </div>
      <div class="reg-bar">
        ${mandir.show_80g && mandir.reg_80g_number ? `Reg. No: <b>${mandir.reg_80g_number}</b><br>` : ''}
        ${mandir.pan ? `PAN No: <b>${mandir.pan}</b>` : ''}
        <br>Date: <b>${dateStr}</b>
      </div>
    </div>
    <div class="title-bar">TRUST RECEIPT</div>
    <div class="meta-row">
      <span>Receipt No: <b>${r.receipt_number}</b></span>
      <span>Date: <b>${dateStr}</b></span>
    </div>
    ${r.is_voided ? '<div class="voided">⚠ VOID</div>' : ''}
    <div class="body">
      <div class="field-row"><span class="lbl">Donor Name Shri / Smt.</span><span class="val">${r.donor?.name || 'Anonymous Donor'}</span></div>
      ${r.donor?.mobile ? `<div class="field-row"><span class="lbl">Mobile Number</span><span class="val">${r.donor.mobile}</span></div>` : ''}
      ${donorPan(r) ? `<div class="field-row"><span class="lbl">Donor PAN</span><span class="val">${donorPan(r)}</span></div>` : ''}
      <div class="field-row"><span class="lbl">Amount in Words</span><span class="val">INR ${amountInWords(r.amount_paise)}</span></div>
      <div class="field-row"><span class="lbl">For Purpose of</span><span class="val">${r.category || 'General Donation'}</span></div>
      ${hasBank ? `
      <table class="bank-table">
        <tr>
          <td class="bank-info">
            Bank: <b>${mandir.bank_name || '—'}</b><br>
            A/C Name: <b>${mandir.bank_account_name || mandir.name}</b><br>
            A/C No.: <b>${mandir.bank_account_no}</b><br>
            IFS Code: <b>${mandir.bank_ifsc || '—'}</b>
            ${mandir.upi_id ? '<br>UPI: <b>'+mandir.upi_id+'</b>' : ''}
          </td>
          <td class="amount-cell">
            ${fmtRs(r.amount_paise)}<br>
            <span style="font-size:11px;font-weight:400;color:#6b7280">Mode: ${modeName(r.payment_mode)}</span>
          </td>
        </tr>
      </table>` : `
      <div class="field-row"><span class="lbl">Amount</span><span class="val big">₹ ${fmtRs(r.amount_paise)}</span></div>
      <div class="field-row"><span class="lbl">Mode of Payment</span><span class="val">${modeName(r.payment_mode)}</span></div>`}
      <div class="sig-row">
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-lbl">Signature</div>
        </div>
      </div>
    </div>
    ${mandir.show_80g && mandir.reg_80g_number ? `<div class="reg-footer">80G Exemption: <b>${mandir.reg_80g_number}</b>${mandir.pan ? ' &nbsp;|&nbsp; PAN: <b>'+mandir.pan+'</b>' : ''} — This donation is eligible for income tax deduction u/s 80G of Income Tax Act, 1961.</div>` : ''}
    ${mandir.footer ? `<div class="reg-footer" style="border-top:1px solid #ccc">${mandir.footer}</div>` : ''}
    <div class="print-hint">Ctrl+P to print or save as PDF</div>
  </div>`
}

// ── TEMPLATE 10: 80G Tax-Exemption Receipt (statutory) ──────────────────────
// A compliance-first donation receipt built for Section 80G claims: carries the
// trust's 80G registration + URN + validity + PAN, the donor's identification
// (name, address, masked PAN), and the standard 80G declaration. Modelled on the
// Form 10BE certificate layout that donors attach to their ITR.
function build80G(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  const d = r.donor || {}
  const donorAddress = [d.address, d.city, d.state, d.pincode].filter(Boolean).join(', ')
  const fyLabel = (() => {
    const dt = new Date(r.date)
    const y = dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1
    return `${y}–${String(y + 1).slice(-2)}`
  })()
  const validUpto = mandir.reg_80g_valid_upto
    ? new Date(mandir.reg_80g_valid_upto).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : null
  return `
  <style>
    body { font-family: 'Georgia','Times New Roman',serif; background:#eef2f7; color:#1a2233; font-size:13px; }
    .page { max-width:760px; margin:24px auto; background:#fff; border:1px solid #cbd5e1; border-radius:6px; overflow:hidden; box-shadow:0 6px 28px rgba(15,23,42,.12); }
    .ribbon { height:6px; background:linear-gradient(90deg,${color},${color}aa); }
    .header { display:flex; gap:18px; align-items:center; padding:22px 34px 16px; border-bottom:2px solid ${color}; }
    .logo { height:64px; width:auto; object-fit:contain; }
    .h-main { flex:1; }
    .h-main h1 { font-size:22px; font-weight:700; color:${color}; letter-spacing:-.2px; }
    .h-main .addr { font-size:11px; color:#5b6472; line-height:1.7; margin-top:3px; }
    .h-badge { text-align:right; }
    .h-badge .tag { display:inline-block; background:${color}; color:#fff; font-size:10px; font-weight:700; letter-spacing:1px; padding:4px 12px; border-radius:4px; }
    .h-badge .rno { font-family:'Courier New',monospace; font-size:15px; font-weight:700; margin-top:8px; color:#0f172a; }
    .h-badge .rdt { font-size:11px; color:#64748b; margin-top:2px; }
    .reg-strip { display:flex; flex-wrap:wrap; gap:0; background:${color}0c; border-bottom:1px solid #e2e8f0; }
    .reg-strip .cell { flex:1; min-width:150px; padding:9px 16px; border-right:1px solid #e2e8f0; }
    .reg-strip .cell:last-child { border-right:none; }
    .reg-strip .k { font-size:9.5px; text-transform:uppercase; letter-spacing:.6px; color:#7c8598; font-weight:700; }
    .reg-strip .v { font-size:12px; font-weight:700; color:#0f172a; margin-top:2px; font-family:'Courier New',monospace; }
    ${r.is_voided ? '.voided{background:#fee2e2;border:2px solid #f87171;color:#991b1b;padding:9px;text-align:center;font-weight:700;margin:14px 34px;border-radius:5px;}' : ''}
    .title { text-align:center; padding:14px; }
    .title h2 { font-size:16px; letter-spacing:2px; text-transform:uppercase; color:${color}; font-weight:700; }
    .title .sub { font-size:11px; color:#64748b; margin-top:3px; }
    .body { padding:6px 34px 26px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:18px; }
    .card { border:1px solid #e2e8f0; border-radius:6px; padding:14px 16px; }
    .card .lbl { font-size:9.5px; text-transform:uppercase; letter-spacing:.7px; color:#7c8598; font-weight:700; margin-bottom:6px; }
    .card .nm { font-size:15px; font-weight:700; color:#0f172a; }
    .card .li { font-size:12px; color:#475569; line-height:1.9; margin-top:2px; }
    .card .li b { color:#0f172a; }
    .amount-band { display:flex; align-items:center; justify-content:space-between; background:${color}; color:#fff; border-radius:8px; padding:18px 22px; margin-bottom:16px; }
    .amount-band .lbl { font-size:11px; opacity:.85; font-weight:600; letter-spacing:.4px; }
    .amount-band .words { font-size:11px; opacity:.9; font-style:italic; margin-top:4px; max-width:420px; }
    .amount-band .amt { font-size:30px; font-weight:800; font-family:'Courier New',monospace; }
    table.meta { width:100%; border-collapse:collapse; margin-bottom:16px; }
    table.meta td { padding:8px 12px; border-bottom:1px solid #eef2f7; font-size:12.5px; }
    table.meta td:first-child { color:#64748b; font-weight:600; width:34%; }
    table.meta td:last-child { color:#0f172a; font-weight:600; }
    .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; }
    .badge-green { background:#dcfce7; color:#15803d; }
    .declaration { font-size:11.5px; color:#374151; line-height:1.85; background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid ${color}; border-radius:5px; padding:13px 16px; }
    .declaration b { color:#0f172a; }
    .pay { font-size:10.5px; color:#475569; margin-top:12px; line-height:1.9; }
    .pay b { color:#0f172a; }
    .sign-row { display:flex; justify-content:space-between; align-items:flex-end; margin-top:30px; }
    .sign-note { font-size:10.5px; color:#94a3b8; font-style:italic; max-width:320px; }
    .sign-box { text-align:center; font-size:11px; color:#475569; }
    .sign-box .for { font-weight:700; color:#0f172a; margin-bottom:34px; }
    .sign-box .line { border-top:1px solid #94a3b8; padding-top:4px; min-width:190px; }
    .footer-note { font-size:11px; color:#94a3b8; text-align:center; font-style:italic; margin-top:16px; padding-top:12px; border-top:1px solid #e2e8f0; }
    .print-hint { font-size:10px; color:#cbd5e1; text-align:center; padding:8px; }
    @media print { body{background:#fff;} .page{box-shadow:none;border:none;margin:0;border-radius:0;} .print-hint{display:none;} }
  </style>
  <div class="page">
    <div class="ribbon"></div>
    <div class="header">
      ${mandir.show_logo ? logoTag(mandir) : ''}
      <div class="h-main">
        <h1>${mandir.name}</h1>
        <div class="addr">${mandir.address}${mandir.mobile ? '<br>Ph: ' + mandir.mobile : ''}${mandir.email ? ' &nbsp;·&nbsp; ' + mandir.email : ''}${mandir.show_gstin && mandir.gstin ? '<br>GSTIN: ' + mandir.gstin : ''}</div>
      </div>
      <div class="h-badge">
        <div class="tag">80G RECEIPT</div>
        <div class="rno">${r.receipt_number}</div>
        <div class="rdt">${dateStr}</div>
      </div>
    </div>
    <div class="reg-strip">
      ${mandir.reg_80g_number ? `<div class="cell"><div class="k">80G Registration</div><div class="v">${mandir.reg_80g_number}</div></div>` : ''}
      ${mandir.reg_80g_urn && mandir.reg_80g_urn !== mandir.reg_80g_number ? `<div class="cell"><div class="k">80G URN</div><div class="v">${mandir.reg_80g_urn}</div></div>` : ''}
      ${validUpto ? `<div class="cell"><div class="k">Valid Upto</div><div class="v">${validUpto}</div></div>` : ''}
      ${mandir.pan ? `<div class="cell"><div class="k">PAN of Trust</div><div class="v">${mandir.pan}</div></div>` : ''}
    </div>
    ${r.is_voided ? '<div class="voided">⚠ THIS RECEIPT HAS BEEN VOIDED</div>' : ''}
    <div class="title">
      <h2>Receipt for Donation u/s 80G</h2>
      <div class="sub">Income Tax Act, 1961 &nbsp;·&nbsp; Financial Year ${fyLabel}</div>
    </div>
    <div class="body">
      <div class="grid">
        <div class="card">
          <div class="lbl">Received With Thanks From</div>
          <div class="nm">${r.donor?.name || 'Anonymous Donor'}</div>
          ${r.donor?.mobile ? `<div class="li">Mobile: <b>${r.donor.mobile}</b></div>` : ''}
          ${donorAddress ? `<div class="li">${donorAddress}</div>` : ''}
          <div class="li">PAN: <b>${donorPan(r) || 'Not provided'}</b></div>
        </div>
        <div class="card">
          <div class="lbl">Donation Details</div>
          <div class="li">Category: <b>${r.category || 'General Donation'}</b></div>
          <div class="li">Payment Mode: <b>${modeName(r.payment_mode)}</b></div>
          <div class="li">Nature: <b>Voluntary donation (not corpus/anonymous)</b></div>
          <div class="li">80G Eligible: <span class="badge badge-green">Yes</span></div>
        </div>
      </div>
      <div class="amount-band">
        <div>
          <div class="lbl">Donation Amount</div>
          <div class="words">${amountInWords(r.amount_paise)}</div>
        </div>
        <div class="amt">₹ ${fmtRs(r.amount_paise)}</div>
      </div>
      <div class="declaration">
        Certified that <b>${mandir.name}</b> is registered under <b>Section 80G(5)</b> of the Income-tax Act, 1961${mandir.reg_80g_number ? ` vide registration/approval no. <b>${mandir.reg_80g_number}</b>` : ''}${validUpto ? `, valid up to <b>${validUpto}</b>` : ''}. Donations to this institution qualify for deduction under Section 80G. <b>No goods or services</b> were provided to the donor in consideration of this donation. This receipt should be retained for claiming the deduction.
      </div>
      ${paymentBlock(mandir)}
      <div class="sign-row">
        <div class="sign-note">This is a computer-generated receipt. Please verify the trust's 80G status and eligibility of your donation before claiming a deduction.</div>
        <div class="sign-box">
          <div class="for">For ${mandir.name}</div>
          <div class="line">Authorised Signatory</div>
        </div>
      </div>
      ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
      <div class="print-hint">Ctrl+P to print or save as PDF</div>
    </div>
  </div>`
}

export function buildReceiptHtml(r: ReceiptData): string {
  const dateStr = new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const mandir = r.mandir ?? { name: 'Mandir', address: '', template: 'classic', primary_color: '#0D1B2E' }
  // The 80G template makes a statutory tax-exemption claim, so it must never be
  // used for a donation that isn't 80G-eligible — fall back to Classic instead.
  let template = mandir.template || 'classic'
  if (template === '80g' && !r.is_80g_eligible) template = 'classic'
  const color = mandir.primary_color || '#0D1B2E'

  let body = ''
  if (template === 'minimal') body = buildMinimal(r, dateStr, mandir, color)
  else if (template === 'modern') body = buildModern(r, dateStr, mandir, color)
  else if (template === 'traditional') body = buildTraditional(r, dateStr, mandir)
  else if (template === 'elegant') body = buildElegant(r, dateStr, mandir, color)
  else if (template === 'temple') body = buildTemple(r, dateStr, mandir, color)
  else if (template === 'tabular') body = buildTabular(r, dateStr, mandir, color)
  else if (template === 'acknowledgement') body = buildAcknowledgement(r, dateStr, mandir, color)
  else if (template === 'jain_tirth') body = buildJainTirth(r, dateStr, mandir, color)
  else if (template === '80g') body = build80G(r, dateStr, mandir, color)
  else body = buildClassic(r, dateStr, mandir, color)

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt ${r.receipt_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}</style>
</head><body>${body}<script>window.onload=()=>{window.print()}</script></body></html>`
}

/**
 * Render the receipt HTML and trigger print. Uses a hidden iframe (no popup,
 * so it is not blocked by popup blockers); falls back to a new tab if the
 * iframe approach is unavailable.
 */
export function printReceiptHtml(html: string): void {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) {
    // Fallback to popup
    const win = window.open('', '_blank', 'width=800,height=960')
    if (!win) { alert('Popup blocked. Please allow popups for this site and try again.'); return }
    win.document.write(html)
    win.document.close()
    document.body.removeChild(iframe)
    return
  }

  // Strip the auto-print script from the HTML; we drive print() from the iframe load.
  doc.open()
  doc.write(html.replace('<script>window.onload=()=>{window.print()}</script>', ''))
  doc.close()

  const cleanup = () => { setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* noop */ } }, 1000) }
  iframe.contentWindow!.onafterprint = cleanup
  // Give the browser a tick to lay out before printing
  setTimeout(() => {
    iframe.contentWindow!.focus()
    iframe.contentWindow!.print()
    cleanup()
  }, 250)
}

/**
 * Fetch and print a receipt. Defaults to the donations endpoint; pass a
 * different `basePath` (e.g. '/seva-bookings') for other receipt-bearing
 * resources whose `/:id/receipt` returns a shape-compatible payload.
 */
export async function printDonationReceipt(id: string, basePath = '/donations'): Promise<void> {
  const { data } = await api.get(`${basePath}/${id}/receipt`)
  const receipt: ReceiptData = data.data
  const html = buildReceiptHtml(receipt)
  printReceiptHtml(html)
}

// ─────────────────────────────────────────────────────────────────────────────
// One-click PDF download / share (Vyapar / Khatabook style).
//
// Reuses the exact same receipt HTML + 9 templates as printing — the only
// difference is the output sink: instead of the browser print dialog we
// rasterize the rendered receipt and assemble an A4 PDF in the browser. This
// keeps everything 100% client-side (works offline on the desktop counter),
// with no server PDF worker. Heavy libs (html2canvas, jsPDF) are dynamically
// imported so they don't bloat the initial bundle.
// ─────────────────────────────────────────────────────────────────────────────

const A4 = { width: 210, height: 297 } // mm

/** Render receipt HTML in a detached iframe and rasterize it to a canvas. */
async function renderHtmlToCanvas(html: string): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas')

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '794px' // ≈ A4 width @ 96dpi, matches the .page max-widths
  iframe.style.height = '10px'
  iframe.style.border = '0'
  iframe.style.background = '#fff'
  document.body.appendChild(iframe)

  try {
    const doc = iframe.contentWindow?.document
    if (!doc) throw new Error('Could not create render frame')
    // Drop the auto-print script — we only want layout, not a print dialog.
    // The "Ctrl+P to print or save as PDF" hint is only meant for someone
    // looking at the receipt on screen before printing; @media print already
    // hides it for real printing, but html2canvas rasterizes the live DOM and
    // ignores print-media rules, so without stripping it here it would end up
    // baked into every downloaded/shared PDF.
    doc.open()
    doc.write(
      html
        .replace('<script>window.onload=()=>{window.print()}</script>', '')
        .replace(/<div class="print-hint">.*?<\/div>/, ''),
    )
    doc.close()

    // Wait for fonts + images (logo) to settle before snapshotting.
    await (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready?.catch(() => {})
    await new Promise((r) => setTimeout(r, 350))

    const target = (doc.querySelector('.page') as HTMLElement) || doc.body
    return await html2canvas(target, {
      scale: 2, // crisp text at print resolution
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight,
    })
  } finally {
    setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* noop */ } }, 100)
  }
}

/** Turn receipt HTML into a jsPDF document, paginating tall receipts across A4 pages. */
async function htmlToPdf(html: string): Promise<import('jspdf').jsPDF> {
  const { jsPDF } = await import('jspdf')
  const canvas = await renderHtmlToCanvas(html)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  // Fit the canvas to the A4 width, then slice it into page-height chunks.
  const imgWidthMm = A4.width
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width
  const pageHeightMm = A4.height

  if (imgHeightMm <= pageHeightMm) {
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidthMm, imgHeightMm)
    return pdf
  }

  // Multi-page: render each A4-tall horizontal slice onto its own page.
  const pxPerMm = canvas.width / imgWidthMm
  const sliceHeightPx = Math.floor(pageHeightMm * pxPerMm)
  let renderedPx = 0
  let first = true
  while (renderedPx < canvas.height) {
    const slicePx = Math.min(sliceHeightPx, canvas.height - renderedPx)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = slicePx
    const ctx = slice.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, slice.width, slice.height)
    ctx.drawImage(canvas, 0, renderedPx, canvas.width, slicePx, 0, 0, canvas.width, slicePx)
    if (!first) pdf.addPage()
    pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, imgWidthMm, (slicePx / pxPerMm))
    renderedPx += slicePx
    first = false
  }
  return pdf
}

function safeFileName(receipt: ReceiptData): string {
  const num = (receipt.receipt_number || 'receipt').replace(/[\\/:*?"<>|]+/g, '-')
  return `Receipt-${num}.pdf`
}

/**
 * Build the receipt PDF and download it (one click, no print dialog).
 * Same templates/branding as printing — Vyapar-style "Download PDF".
 */
export async function downloadReceiptPdf(id: string, basePath = '/donations'): Promise<void> {
  const { data } = await api.get(`${basePath}/${id}/receipt`)
  const receipt: ReceiptData = data.data
  const pdf = await htmlToPdf(buildReceiptHtml(receipt))
  pdf.save(safeFileName(receipt))
}

/**
 * Share the receipt PDF via the native share sheet (WhatsApp / email / etc.)
 * where supported (mobile + some desktops). Falls back to a normal download
 * when the Web Share API can't share files.
 */
export async function shareReceiptPdf(id: string, basePath = '/donations'): Promise<void> {
  const { data } = await api.get(`${basePath}/${id}/receipt`)
  const receipt: ReceiptData = data.data
  const pdf = await htmlToPdf(buildReceiptHtml(receipt))
  const fileName = safeFileName(receipt)
  const blob = pdf.output('blob') as Blob

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean
    share?: (data: ShareData) => Promise<void>
  }
  const file = new File([blob], fileName, { type: 'application/pdf' })
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: `Receipt ${receipt.receipt_number}` })
      return
    } catch (e) {
      // user cancelled or share failed → fall through to download
      if ((e as DOMException)?.name === 'AbortError') return
    }
  }
  // Fallback: trigger a download of the same PDF.
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
