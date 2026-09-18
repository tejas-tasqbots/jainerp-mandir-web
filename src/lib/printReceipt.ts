import { api } from './api'
import { receiptLabels, type ReceiptLabels } from './receiptLabels'
import { receiptParts } from './receiptDocument'

/**
 * Labels for the receipt currently being built. Module-level rather than a
 * parameter on all thirteen template builders: rendering is synchronous and
 * single-threaded (buildReceiptHtml sets this, then immediately calls one
 * builder), so there is no interleaving to worry about.
 */
let L: ReceiptLabels = receiptLabels('en')

export interface ReceiptData {
  /**
   * What this document calls itself. Every template hardcoded "Donation
   * Receipt", so a room stay, a hall booking and a prasad sale all printed as
   * donation receipts — with "80G Eligible: No" underneath, which is
   * misleading on what is really a service bill. The API names the document;
   * anything that does not falls back to the donation label, so donations are
   * unchanged.
   */
  doc_title?: string | null
  /**
   * Which counter printed this slip. The API also sends an English
   * `doc_title`; this lets a slip print its title in the trust's receipt
   * language instead, and tells the renderer which slips may be split into
   * one token per plate (Bhojanshala only).
   */
  slip_kind?: 'bhojanshala' | 'prasad' | 'seva' | null
  /**
   * A gift, or a bill for something bought? A room stay printed "Donation
   * Amount" over its tariff and carried an "80G Eligible: No" row and the
   * trust's 80G number — a service bill making a tax-exemption claim it cannot
   * make. Older payloads carry no `kind`; those are read the way they always
   * were (a title means rooms/halls/gaushala, i.e. a service).
   */
  kind?: 'donation' | 'service' | null
  /**
   * Every tender that settled this receipt. When there is more than one the
   * templates print the split instead of a single mode: a 2800 room bill
   * settled 1500 cash + 1300 UPI used to print "Payment Mode: Cash", naming
   * whichever tender happened to be recorded first and misstating the rest.
   */
  payments?: Array<{
    payment_mode: string
    amount_paise: number
    reference_no?: string | null
    paid_on?: string | null
  }> | null
  /**
   * Null until the document is numbered — an unpaid hall booking or a
   * sponsorship with no invoice yet has none. buildReceiptHtml() substitutes a
   * placeholder rather than letting 13 interpolation sites print "null".
   */
  receipt_number: string | null
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
    /** The registrar's own number, and the NGO-Darpan ID (migration 041). */
    registration_number?: string | null
    darpan_number?: string | null
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
    // Print settings (tenant-migration 011, widened by 032).
    //
    // A COUNTER SLIP arrives in these same fields — mandir-api substitutes the
    // Counter-slip settings into `template` / `receipt_paper` / `receipt_copies`
    // before sending (see receipt-mandir.ts). That is deliberate: this renderer
    // needs to know what to draw and on what paper, not which module asked.
    receipt_copies?: 'single' | 'both'
    receipt_paper?: 'a4' | 'a5' | 'thermal58' | 'thermal80'
    receipt_language?: string
    receipt_show_upi_qr?: boolean
    /** 'receipt' for a document, 'slip' for a prasad/seva/bhojanshala token. */
    surface?: 'receipt' | 'slip'
    /** Open the print dialog without being asked. Counter screens read this. */
    slip_auto_print?: boolean
    /**
     * Print a Bhojanshala sale of N plates as N separate tokens (tenant
     * migration 039). Only ever true on a slip.
     */
    slip_token_per_plate?: boolean
    /**
     * Whether this trust may show GST / 80G at ALL.
     *
     * Distinct from `show_gstin` / `show_80g`, which are the trust's
     * preference: these say whether the registration exists. A trust with no
     * GSTIN gets `gst_enabled: false` and the API also sends `gstin: null`, so
     * a template that forgets one of the two still cannot print a registration
     * number the trust does not hold.
     */
    gst_enabled?: boolean
    eighty_g_enabled?: boolean
  } | null
  /**
   * UPI pay QR as a data URI. Not part of the API payload — the caller
   * generates it (see `buildUpiQr`) because QR encoding is async and the
   * template builders are synchronous.
   */
  upi_qr_data_uri?: string | null
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
  /**
   * The itemised breakdown, when the module has one.
   *
   * Sent by the shared ReceiptService (rooms, halls, gaushala) and, since the
   * counter-slip work, by prasad — a prasad slip IS its lines, because the
   * devotee collects against them rather than against a total.
   */
  lines?: Array<{ label: string; qty?: string; amount_paise: number }> | null
  /**
   * The GST split, when tax was actually charged.
   *
   * Null on every document from a trust with no GSTIN: mandir-api's
   * GstRateService returns 0% for an unregistered trust, and the receipt
   * builders send `tax: null` rather than a row of zeroes.
   */
  tax?: { cgst_paise?: number; sgst_paise?: number; igst_paise?: number } | null
  /** Module-specific extras a template may render — token counts, meal, dates. */
  meta?: Record<string, unknown> | null
}

function fmtRs(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function modeName(mode: string | null | undefined): string {
  // An unsettled document (a hall booking still to be paid, a sponsorship with
  // no tender yet) carries payment_mode: null. Interpolating that printed the
  // literal "Payment Mode: null" on the guest's copy.
  if (!mode) return '—'
  const map: Record<string, string> = {
    cash: 'Cash', upi: 'UPI', cheque: 'Cheque',
    netbanking: 'Net Banking', online: 'Online / Card',
  }
  return map[mode] || mode
}

/**
 * What the receipt says under "Payment Mode".
 *
 * One tender (or none recorded) reads exactly as before. Two or more print as
 * "Cash \u20b91,500.00 + UPI \u20b91,300.00", with the reference kept where one
 * was captured, so the document states what was actually paid.
 */
function paymentModeText(r: ReceiptData): string {
  const tenders = r.payments ?? []
  if (tenders.length < 2) return modeName(r.payment_mode)
  return tenders
    .map(t => {
      const ref = t.reference_no ? ` (${t.reference_no})` : ''
      return `${modeName(t.payment_mode)}${ref} \u20b9${fmtRs(Number(t.amount_paise))}`
    })
    .join(' + ')
}

/** A donation, or a bill for a service (a room, a hall, a meal, a packet)? */
function isDonationDoc(r: ReceiptData): boolean {
  if (r.kind) return r.kind === 'donation'
  if (r.slip_kind) return false
  return !r.doc_title
}

/** "Donation Amount" on a gift; plain "Amount" on a bill. */
function amountLabel(r: ReceiptData): string {
  return isDonationDoc(r) ? L.donationAmount : L.amount
}

function docTitle(r: ReceiptData, fallback: string): string {
  // A counter slip names itself in the receipt language. Without this every
  // prasad packet and meal token printed "Donation Receipt".
  const kind = r.slip_kind === 'bhojanshala' ? L.bhojanshalaToken
    : r.slip_kind === 'prasad' ? L.prasadSlip
      : r.slip_kind === 'seva' ? L.sevaReceipt
        : null
  return kind || r.doc_title || fallback
}

/** A meal type as the receipt language says it; anything unknown as typed. */
function mealName(meal: unknown): string {
  const m = String(meal ?? '').trim()
  if (m === 'breakfast') return L.breakfast
  if (m === 'lunch') return L.lunch
  if (m === 'dinner') return L.dinner
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : ''
}

/**
 * HTML-escape every string in the payload, once, before any template sees it.
 *
 * The templates interpolate names, addresses and item labels straight into
 * markup, and the result is written into a SAME-ORIGIN iframe. A donor or
 * buyer name such as `<img src=x onerror=…>` — which a devotee can set on their
 * own profile — therefore ran as script inside the admin's session the moment
 * a receipt was printed or downloaded. Escaping at this single entry point
 * covers all eleven layouts, including ones added later.
 *
 * Data URIs (logo, UPI QR) pass through unchanged in practice: base64 has no
 * characters this touches.
 */
function escapeDeep<T>(v: T): T {
  if (typeof v === 'string') {
    return v
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;') as unknown as T
  }
  if (Array.isArray(v)) return v.map(escapeDeep) as unknown as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = escapeDeep(x)
    return out as T
  }
  return v
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

function regBlock(mandir: ReceiptData['mandir'], r?: ReceiptData): string {
  if (!mandir?.show_80g) return ''
  // A room or hall bill is not a donation: printing the trust's 80G and 12AB
  // numbers on it reads as a tax-exemption claim for money that buys a service.
  const donation = !r || isDonationDoc(r)
  const parts: string[] = []
  if (donation && mandir.reg_80g_number) parts.push(`80G: <b>${mandir.reg_80g_number}</b>`)
  if (donation && mandir.reg_12a_number) parts.push(`12A: <b>${mandir.reg_12a_number}</b>`)
  if (donation && mandir.reg_12ab_number) parts.push(`12AB: <b>${mandir.reg_12ab_number}</b>`)
  if (mandir.pan) parts.push(`PAN: <b>${mandir.pan}</b>`)
  // NOT gated on `donation`: the registrar's number and the NGO-Darpan ID say
  // who issued the document, not what may be deducted from tax. A room bill is
  // issued by the same registered body as a donation receipt.
  if (mandir.registration_number) parts.push(`${L.registrationNo}: <b>${mandir.registration_number}</b>`)
  if (mandir.darpan_number) parts.push(`${L.darpanNo}: <b>${mandir.darpan_number}</b>`)
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
        <div class="label">${docTitle(r, L.donationReceipt)}</div>
        <div class="rno">${r.receipt_number}</div>
        <div class="date">${dateStr}</div>
      </div>
    </div>
    <div class="body">
      ${voidedBanner(r.is_voided)}
      <div class="section-label">${L.receivedFrom}</div>
      <div class="donor-box">
        <div class="donor-name">${r.donor?.name || L.anonymous}</div>
        ${r.donor?.mobile ? `<div class="donor-mobile">${r.donor.mobile}</div>` : ''}
        ${donorPan(r) ? `<div class="donor-mobile">${L.pan}: ${donorPan(r)}</div>` : ''}
      </div>
      <div class="amount-box">
        <div>
          <div class="amount-label">${amountLabel(r)}</div>
          <div class="amount-words">${amountInWords(r.amount_paise)}</div>
        </div>
        <div class="amount-value">₹ ${fmtRs(r.amount_paise)}</div>
      </div>
      <table>
        <tr><td>${L.category}</td><td>${r.category || '—'}</td></tr>
        <tr><td>${L.paymentMode}</td><td>${paymentModeText(r)}</td></tr>
        ${isDonationDoc(r) ? `<tr><td>80G Eligible</td><td><span class="${r.is_80g_eligible ? 'badge badge-green' : 'badge badge-red'}">${r.is_80g_eligible ? 'Yes' : 'No'}</span></td></tr>` : ''}
      </table>
      ${itemsBlock(r, color)}
      ${regBlock(mandir, r)}
      ${paymentBlock(mandir)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
      <div class="print-hint">${L.printHint}</div>
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
        <div class="rtitle">${docTitle(r, L.donationReceipt)}</div>
        <div class="rno">${r.receipt_number}</div>
        <div class="rdate">${dateStr}</div>
      </div>
    </div>
    ${voidedBanner(r.is_voided)}
    <div class="field"><span class="k">${L.receivedFrom}</span><span class="v">${r.donor?.name || L.anonymous}${r.donor?.mobile ? '<br><span style="font-weight:400;font-size:11px;color:#6b7280">'+r.donor.mobile+'</span>' : ''}</span></div>
    ${donorPan(r) ? `<div class="field"><span class="k">${L.donorPan}</span><span class="v">${donorPan(r)}</span></div>` : ''}
    <div class="field"><span class="k">${L.category}</span><span class="v">${r.category || '—'}</span></div>
    <div class="field"><span class="k">${L.paymentMode}</span><span class="v">${paymentModeText(r)}</span></div>
    ${isDonationDoc(r) ? `<div class="field"><span class="k">80G Eligible</span><span class="v">${r.is_80g_eligible ? '✓ Yes' : '✗ No'}</span></div>` : ''}
    <div class="field amount-row"><span class="k">${L.amount}</span><span class="v">₹ ${fmtRs(r.amount_paise)}</span></div>
    <div class="words">${amountInWords(r.amount_paise)}</div>
    ${itemsBlock(r, color)}
      ${regBlock(mandir, r)}
    ${paymentBlock(mandir)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    <div class="print-hint">${L.printHint}</div>
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
        <div class="tag">${docTitle(r, L.donationReceipt).toUpperCase()}</div>
        <div class="num">${r.receipt_number}</div>
        <div class="dt">${dateStr}</div>
      </div>
    </div>
    ${voidedBanner(r.is_voided)}
    <div class="body">
      <div class="grid2">
        <div class="info-card">
          <div class="label">${L.receivedFrom}</div>
          <div class="value">${r.donor?.name || L.anonymous}</div>
          ${r.donor?.mobile ? `<div class="sub">${r.donor.mobile}</div>` : ''}
          ${donorPan(r) ? `<div class="sub">${L.pan}: ${donorPan(r)}</div>` : ''}
        </div>
        <div class="info-card">
          <div class="label">${L.category}</div>
          <div class="value">${r.category || '—'}</div>
        </div>
      </div>
      <div class="amount-hero">
        <div>
          <div class="lbl">${amountLabel(r)}</div>
          <div class="words">${amountInWords(r.amount_paise)}</div>
        </div>
        <div class="amt">₹ ${fmtRs(r.amount_paise)}</div>
      </div>
      <div class="details">
        <div class="detail-item"><div class="k">${L.paymentMode}</div><div class="v">${paymentModeText(r)}</div></div>
        ${isDonationDoc(r) ? `<div class="detail-item"><div class="k">80G Eligible</div><div class="v"><span class="${r.is_80g_eligible ? 'badge badge-yes' : 'badge badge-no'}">${r.is_80g_eligible ? 'Yes ✓' : 'No'}</span></div></div>` : ''}
      </div>
      ${itemsBlock(r, color)}
      ${regBlock(mandir, r)}
      ${paymentBlock(mandir)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
      <div class="print-hint">${L.printHint}</div>
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
      <span>${L.receiptNo}: ${r.receipt_number}</span>
      <span>${L.date}: ${dateStr}</span>
    </div>
    ${voidedBanner(r.is_voided)}
    <div class="body">
      <div class="received">Received with gratitude from:</div>
      <div class="donor-name">${r.donor?.name || L.anonymousDonor}</div>
      ${r.donor?.mobile ? `<div class="donor-mobile">${r.donor.mobile}</div>` : ''}
      ${donorPan(r) ? `<div class="donor-mobile">${L.pan}: ${donorPan(r)}</div>` : ''}
      <hr class="divider">
      <table>
        <tr><td>${L.category}</td><td>${r.category || '—'}</td></tr>
        <tr><td>${L.paymentMode}</td><td>${paymentModeText(r)}</td></tr>
        ${isDonationDoc(r) ? `<tr><td>80G Eligible</td><td>${r.is_80g_eligible ? '✓ Yes' : 'No'}</td></tr>` : ''}
        <tr><td>${L.amount}</td><td class="amount-td">₹ ${fmtRs(r.amount_paise)}</td></tr>
        <tr class="words-row"><td></td><td>${amountInWords(r.amount_paise)}</td></tr>
      </table>
      ${itemsBlock(r, mandir.primary_color || '#0D1B2E')}
      ${regBlock(mandir, r)}
      ${paymentBlock(mandir)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    </div>
    <div class="bottom-border"></div>
    <div class="print-hint">${L.printHint}</div>
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
        <div class="rt">${docTitle(r, L.donationReceipt)}</div>
        <div class="rn">${r.receipt_number}</div>
        <div class="rd">${dateStr}</div>
      </div>
    </div>
    ${voidedBanner(r.is_voided)}
    <div class="body">
      <div class="sec">
        <div class="sec-title">${L.receivedFrom}</div>
        <div class="donor-name">${r.donor?.name || L.anonymous}</div>
        ${r.donor?.mobile ? `<div class="donor-sub">${r.donor.mobile}</div>` : ''}
        ${donorPan(r) ? `<div class="donor-sub">${L.pan}: ${donorPan(r)}</div>` : ''}
      </div>
      <div class="sec">
        <div class="sec-title">${amountLabel(r)}</div>
        <div class="amount-line">
          <span class="amount-cur">₹</span>
          <span class="amount-num">${fmtRs(r.amount_paise)}</span>
        </div>
        <div class="amount-words">${amountInWords(r.amount_paise)}</div>
      </div>
      <div class="sec">
        <div class="sec-title">Details</div>
        <div class="dl">
          <div><div class="dt">${L.category}</div><div class="dd">${r.category || '—'}</div></div>
          <div><div class="dt">${L.paymentMode}</div><div class="dd">${paymentModeText(r)}</div></div>
          ${isDonationDoc(r) ? `<div><div class="dt">80G Eligible</div><div class="dd ${r.is_80g_eligible ? 'elig-yes' : 'elig-no'}">${r.is_80g_eligible ? '✓ Yes' : '✗ No'}</div></div>` : ''}
        </div>
      </div>
      ${itemsBlock(r, color)}
      ${regBlock(mandir, r)}
      ${paymentBlock(mandir)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    </div>
    <div class="bottom"></div>
    <div class="print-hint">${L.printHint}</div>
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
      <span><span class="label">${L.receiptNo}: </span><span class="val">${r.receipt_number}</span></span>
      <span><span class="label">Created: </span><span class="val">${dateStr}</span></span>
    </div>
    ${r.is_voided ? '<div class="voided">⚠ THIS RECEIPT HAS BEEN VOIDED</div>' : ''}
    <div class="two-col">
      <div class="col-left">
        <div class="sec-hdr">${L.donorsDetail}:</div>
        <div class="field"><div class="k">Received with Thanks</div><div class="v">From ${r.donor?.name || L.anonymousDonor}</div></div>
        ${r.donor?.mobile ? `<div class="field"><div class="k">Contact No.</div><div class="v">${r.donor.mobile}</div></div>` : ''}
        ${donorPan(r) ? `<div class="field"><div class="k">${L.donorPan}</div><div class="v">${donorPan(r)}</div></div>` : ''}
        <div class="field" style="margin-top:12px"><div class="k">${L.amountInr}</div><div class="v amount">INR ${fmtRs(r.amount_paise)}</div></div>
        <div class="field"><div class="k">As donation for the cause</div><div class="v">${r.category || L.generalDonation}</div></div>
        ${hasBank ? `<div style="margin-top:12px"><div class="k" style="color:#6b7280;font-size:10px;font-weight:600;margin-bottom:4px">Bank / Payment Details</div><div class="bank-box">${mandir.upi_id ? 'UPI: <b>'+mandir.upi_id+'</b><br>' : ''}${mandir.bank_account_no ? 'A/C: <b>'+mandir.bank_account_no+'</b> &nbsp; IFSC: <b>'+mandir.bank_ifsc+'</b><br>'+mandir.bank_name : ''}</div></div>` : ''}
      </div>
      <div class="col-right">
        <div class="sec-hdr">Transaction Detail:</div>
        <div class="field"><div class="k">${L.donorName}</div><div class="v">${r.donor?.name || '—'}</div></div>
        <div style="margin:10px 0 6px"><div class="sec-hdr" style="margin:-4px -20px 10px">${L.purposeOfDonation}:</div>
          <div class="v">${r.category || L.generalDonation}</div>
        </div>
        <div style="margin-top:10px"><div class="sec-hdr" style="margin:-4px -20px 10px">Payment details:</div>
          <div class="v">${paymentModeText(r)}</div>
        </div>
        <div style="margin-top:10px"><div class="sec-hdr" style="margin:-4px -20px 10px">${L.modeOfPayment}:</div>
          <div class="v">${paymentModeText(r)}</div>
        </div>
        ${r.is_80g_eligible && mandir.show_80g ? `<div style="margin-top:10px;padding:6px 10px;background:#fef3c7;border:1px solid #fde68a;border-radius:3px;font-size:10px;color:#92400e"><b>80G Eligible</b> — Tax exemption certificate available</div>` : ''}
      </div>
    </div>
    ${mandir.footer ? `<div class="notes-section"><div style="font-size:10px;font-weight:700;margin-bottom:6px">Please Note:</div><ul><li>${mandir.footer}</li></ul></div>` : ''}
    <div class="footer-row">
      <div style="font-size:11px;color:#374151;max-width:300px;font-style:italic">${r.is_80g_eligible && mandir.show_80g ? L.valid80g : L.thankYou}</div>
      <div class="sig-block">
        <div class="for">For ${mandir.name}</div>
        <div class="auth">${L.authorisedSignatory}</div>
      </div>
    </div>
    <div class="print-hint">${L.printHint}</div>
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
      ${(isDonationDoc(r) && mandir.show_80g && mandir.reg_80g_number) || mandir.pan ? `<div class="ftr-no">${[isDonationDoc(r) && mandir.reg_80g_number ? 'FTR No / 80G: '+mandir.reg_80g_number : '', mandir.pan ? 'PAN: '+mandir.pan : ''].filter(Boolean).join(' &nbsp;|&nbsp; ')}</div>` : ''}
      <div class="addr">${mandir.address}${mandir.mobile ? ' &nbsp;|&nbsp; Ph: '+mandir.mobile : ''}${mandir.show_gstin && mandir.gstin ? ' &nbsp;|&nbsp; GSTIN: '+mandir.gstin : ''}</div>
    </div>
    <div class="dup-banner">${docTitle(r, L.donationReceipt).toUpperCase()}</div>
    ${r.is_voided ? '<div class="voided-row">⚠ THIS RECEIPT HAS BEEN VOIDED</div>' : ''}
    <div class="meta-row">
      <div class="meta-cell"><div class="k">Cont. No.</div><div class="v">${paymentModeText(r).toUpperCase()}</div></div>
      <div class="meta-cell"><div class="k">Receipt Number</div><div class="v">${r.receipt_number}</div></div>
      <div class="meta-cell"><div class="k">${L.date}</div><div class="v">${dateStr}</div></div>
    </div>
    <div class="rcvd-row">${L.receivedFrom}: &nbsp;<b>${r.donor?.name || L.anonymousDonor}</b>${r.donor?.mobile ? ' &nbsp;&nbsp; '+L.mobile+': <b>'+r.donor.mobile+'</b>' : ''}${donorPan(r) ? ' &nbsp;&nbsp; PAN: <b>'+donorPan(r)+'</b>' : ''}</div>
    <div class="addr-row">
      <div>${L.category}: <b>${r.category || L.generalDonation}</b></div>
      <div>${L.mode}: <b>${paymentModeText(r)}</b>${isDonationDoc(r) ? ` &nbsp;|&nbsp; 80G: <b>${r.is_80g_eligible ? L.yes : L.no}</b>` : ''}</div>
    </div>
    <table class="main">
      <thead><tr><th>${L.description}</th><th>${L.amount}</th></tr></thead>
      <tbody>
        <tr><td>${r.category || L.generalDonation}</td><td class="amount-td">₹ ${fmtRs(r.amount_paise)}</td></tr>
        <tr><td style="font-size:10px;color:#6b7280;font-style:italic">${amountInWords(r.amount_paise)}</td><td></td></tr>
      </tbody>
      <tfoot><tr class="total-row"><td><b>Total</b></td><td class="amount-td">₹ ${fmtRs(r.amount_paise)}</td></tr></tfoot>
    </table>
    ${itemsBlock(r, color)}
    ${(mandir.upi_id || mandir.bank_account_no) ? `<div class="footer-section">${mandir.upi_id ? 'UPI ID: <b>'+mandir.upi_id+'</b>' : ''} ${mandir.bank_account_no ? '&nbsp;|&nbsp; Bank A/C: <b>'+mandir.bank_account_no+'</b> IFSC: <b>'+mandir.bank_ifsc+'</b> — '+mandir.bank_name : ''}</div>` : ''}
    ${mandir.footer ? `<div class="footer-section" style="border-top:1px solid #ccc">${mandir.footer}</div>` : ''}
    <div class="sig-row">
      <div style="font-size:11px;color:#555">This is a computer-generated receipt.</div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">${L.authorisedSignatory}</div>
        <div style="font-size:10px;font-weight:700;color:#111;margin-top:2px">${mandir.name}</div>
      </div>
    </div>
    <div class="print-hint">${L.printHint}</div>
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
        ${L.receivedWithThanks} <b>${r.donor?.name || L.anonymousDonor}</b>, an amount of
        <span class="amount-highlight">INR ${fmtRs(r.amount_paise)} / ${amountInWords(r.amount_paise)}</span>
        towards corpus donation on <b>${dateStr}</b>.
      </div>
      <table class="details">
        <thead><tr><th>${L.modeOfPayment}</th><th>${L.instrumentNo}</th><th>${L.instrumentDate}</th><th>${L.realizedAmount}</th></tr></thead>
        <tbody><tr>
          <td>${paymentModeText(r)}</td>
          <td>${r.receipt_number}</td>
          <td>${dateStr}</td>
          <td class="amt-col">INR ${fmtRs(r.amount_paise)}</td>
        </tr></tbody>
      </table>
      ${itemsBlock(r, color)}
      ${r.is_80g_eligible && mandir.show_80g ? `<div class="certified">Certified that this donation is eligible for deduction U/S 80 G (5) (vi) of the Income Tax Act. ${mandir.reg_80g_number ? 'Reg No: <b>'+mandir.reg_80g_number+'</b>.' : ''} ${mandir.pan ? 'PAN: <b>'+mandir.pan+'</b>.' : ''}</div>` : ''}
      <div class="contribution-line">Your contribution towards "<b>${mandir.name}</b>" is one of the best charities.</div>
      ${mandir.footer ? `<div style="font-size:11px;color:#374151;font-style:italic;margin-top:8px">${mandir.footer}</div>` : ''}
      <div class="address-block">
        <div class="to">TO</div>
        <div class="donor-name">${r.donor?.name || L.anonymousDonor}</div>
        ${r.donor?.mobile ? `<div class="donor-addr">${r.donor.mobile}</div>` : ''}
        ${donorPan(r) ? `<div class="donor-addr">${L.pan}: ${donorPan(r)}</div>` : ''}
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
    <div class="print-hint">${L.printHint}</div>
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
        ${isDonationDoc(r) && mandir.show_80g && mandir.reg_80g_number ? `Reg. No: <b>${mandir.reg_80g_number}</b><br>` : ''}
        ${mandir.pan ? `PAN No: <b>${mandir.pan}</b>` : ''}
        <br>${L.date}: <b>${dateStr}</b>
      </div>
    </div>
    <div class="title-bar">TRUST RECEIPT</div>
    <div class="meta-row">
      <span>${L.receiptNo}: <b>${r.receipt_number}</b></span>
      <span>${L.date}: <b>${dateStr}</b></span>
    </div>
    ${r.is_voided ? '<div class="voided">⚠ VOID</div>' : ''}
    <div class="body">
      <div class="field-row"><span class="lbl">${L.donorNamePrefix}</span><span class="val">${r.donor?.name || L.anonymousDonor}</span></div>
      ${r.donor?.mobile ? `<div class="field-row"><span class="lbl">Mobile Number</span><span class="val">${r.donor.mobile}</span></div>` : ''}
      ${donorPan(r) ? `<div class="field-row"><span class="lbl">${L.donorPan}</span><span class="val">${donorPan(r)}</span></div>` : ''}
      <div class="field-row"><span class="lbl">${L.amountInWords}</span><span class="val">INR ${amountInWords(r.amount_paise)}</span></div>
      <div class="field-row"><span class="lbl">For Purpose of</span><span class="val">${r.category || L.generalDonation}</span></div>
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
            <span style="font-size:11px;font-weight:400;color:#6b7280">${L.mode}: ${paymentModeText(r)}</span>
          </td>
        </tr>
      </table>` : `
      <div class="field-row"><span class="lbl">${L.amount}</span><span class="val big">₹ ${fmtRs(r.amount_paise)}</span></div>
      <div class="field-row"><span class="lbl">${L.modeOfPayment}</span><span class="val">${paymentModeText(r)}</span></div>`}
      <div class="sig-row">
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-lbl">Signature</div>
        </div>
      </div>
    </div>
    ${isDonationDoc(r) && mandir.show_80g && mandir.reg_80g_number ? `<div class="reg-footer">80G Exemption: <b>${mandir.reg_80g_number}</b>${mandir.pan ? ' &nbsp;|&nbsp; PAN: <b>'+mandir.pan+'</b>' : ''} — This donation is eligible for income tax deduction u/s 80G of Income Tax Act, 1961.</div>` : ''}
    ${mandir.footer ? `<div class="reg-footer" style="border-top:1px solid #ccc">${mandir.footer}</div>` : ''}
    <div class="print-hint">${L.printHint}</div>
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
      ${mandir.pan ? `<div class="cell"><div class="k">${L.panOfTrust}</div><div class="v">${mandir.pan}</div></div>` : ''}
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
          <div class="nm">${r.donor?.name || L.anonymousDonor}</div>
          ${r.donor?.mobile ? `<div class="li">Mobile: <b>${r.donor.mobile}</b></div>` : ''}
          ${donorAddress ? `<div class="li">${donorAddress}</div>` : ''}
          <div class="li">${L.pan}: <b>${donorPan(r) || L.notProvided}</b></div>
        </div>
        <div class="card">
          <div class="lbl">Donation Details</div>
          <div class="li">${L.category}: <b>${r.category || L.generalDonation}</b></div>
          <div class="li">${L.paymentMode}: <b>${paymentModeText(r)}</b></div>
          <div class="li">Nature: <b>Voluntary donation (not corpus/anonymous)</b></div>
          <div class="li">80G Eligible: <span class="badge badge-green">Yes</span></div>
        </div>
      </div>
      <div class="amount-band">
        <div>
          <div class="lbl">${amountLabel(r)}</div>
          <div class="words">${amountInWords(r.amount_paise)}</div>
        </div>
        <div class="amt">₹ ${fmtRs(r.amount_paise)}</div>
      </div>
      <div class="declaration">
        Certified that <b>${mandir.name}</b> is registered under <b>Section 80G(5)</b> of the Income-tax Act, 1961${mandir.reg_80g_number ? ` vide registration/approval no. <b>${mandir.reg_80g_number}</b>` : ''}${validUpto ? `, valid up to <b>${validUpto}</b>` : ''}. Donations to this institution qualify for deduction under Section 80G. <b>No goods or services</b> were provided to the donor in consideration of this donation. This receipt should be retained for claiming the deduction.
      </div>
      ${paymentBlock(mandir)}
      ${itemsBlock(r, color)}
      <div class="sign-row">
        <div class="sign-note">This is a computer-generated receipt. Please verify the trust's 80G status and eligibility of your donation before claiming a deduction.</div>
        <div class="sign-box">
          <div class="for">For ${mandir.name}</div>
          <div class="line">${L.authorisedSignatory}</div>
        </div>
      </div>
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
      <div class="print-hint">${L.printHint}</div>
    </div>
  </div>`
}

/**
 * UPI deep-link QR for the temple's UPI ID, pre-filled with the receipt amount
 * (plan §16). Generated in the browser — nothing is fetched, so it works on the
 * offline desktop counter. Returns null when there is no UPI ID configured or
 * the trust has the QR turned off.
 */
export async function buildUpiQr(r: ReceiptData): Promise<string | null> {
  const m = r.mandir
  if (!m?.receipt_show_upi_qr || !m.upi_id) return null
  const params = new URLSearchParams({
    pa: m.upi_id,
    pn: m.name,
    am: (r.amount_paise / 100).toFixed(2),
    cu: 'INR',
    tn: r.receipt_number ? `Donation ${r.receipt_number}` : 'Donation',
  })
  try {
    const QR = await import('qrcode')
    return await QR.toDataURL(`upi://pay?${params.toString()}`, { margin: 1, width: 220 })
  } catch {
    // A missing QR must never block the receipt itself.
    return null
  }
}

/** The QR block appended below the receipt body when one was generated. */
function upiQrBlock(r: ReceiptData): string {
  if (!r.upi_qr_data_uri) return ''
  // Nothing to pay: this document exists because the money came in. A "Scan to
  // pay" QR under a settled receipt invites a second payment for the same
  // thing. It stays on documents that are still owed — an unpaid hall booking
  // has no tender recorded and no payment mode.
  const settled = (r.payments?.length ?? 0) > 0 || !!r.payment_mode
  if (settled) return ''
  return `<div class="upi-qr">
    <img src="${r.upi_qr_data_uri}" alt="UPI QR" />
    <div class="upi-cap">${L.scanToPay}${r.mandir?.upi_id ? `<br><span class="upi-id">${r.mandir.upi_id}</span>` : ''}</div>
  </div>`
}

/** Per-copy caption ("Donor Copy" / "Office Copy") — only when printing both. */
/**
 * The itemised breakdown — what was actually bought or given.
 *
 * Rooms, halls, prasad and gaushala all send `lines`, and NOT ONE of the A4
 * designs rendered them: a two-night stay printed "Dharamshala — Room 101" and
 * a total, with nothing to check the total against, and a prasad sale of three
 * items printed none of them. The slip had this from the start; the documents
 * a guest actually files did not.
 *
 * Styled inline rather than per template, because it has to drop into eleven
 * different designs without each of them growing a copy of the same table.
 */
function itemsBlock(r: ReceiptData, color: string, opts: { total?: boolean } = {}): string {
  const lines = r.lines ?? []
  if (!lines.length) return ''
  const tax = r.tax ?? null
  const taxTotal = (tax?.cgst_paise ?? 0) + (tax?.sgst_paise ?? 0) + (tax?.igst_paise ?? 0)
  const gstShown = taxTotal > 0 && r.mandir?.gst_enabled
  const net = r.amount_paise - (gstShown ? taxTotal : 0)
  const row = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #eef2f7;font-size:12px;color:${strong ? '#111' : '#374151'};font-weight:${strong ? 700 : 400}">${label}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eef2f7;font-size:12px;text-align:right;white-space:nowrap;color:${strong ? '#111' : '#374151'};font-weight:${strong ? 700 : 600}">${value}</td>
    </tr>`
  return `
  <table style="width:100%;border-collapse:collapse;margin:14px 0 4px;border:1px solid #e5e7eb">
    <thead>
      <tr>
        <th style="padding:6px 10px;background:${color};color:#fff;font-size:9.5px;letter-spacing:1px;text-transform:uppercase;text-align:left">${L.description}</th>
        <th style="padding:6px 10px;background:${color};color:#fff;font-size:9.5px;letter-spacing:1px;text-transform:uppercase;text-align:right">${L.amount}</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map((l) => row(`${l.label}${l.qty ? ` <span style="color:#6b7280;font-size:11px">· ${l.qty}</span>` : ''}`, `₹ ${fmtRs(l.amount_paise)}`)).join('')}
      ${gstShown ? row(`${L.subtotal}`, `₹ ${fmtRs(net)}`) : ''}
      ${gstShown && (tax?.cgst_paise ?? 0) > 0 ? row('CGST', `₹ ${fmtRs(tax!.cgst_paise!)}`) : ''}
      ${gstShown && (tax?.sgst_paise ?? 0) > 0 ? row('SGST', `₹ ${fmtRs(tax!.sgst_paise!)}`) : ''}
      ${gstShown && (tax?.igst_paise ?? 0) > 0 ? row('IGST', `₹ ${fmtRs(tax!.igst_paise!)}`) : ''}
      ${opts.total === false ? '' : row(L.total, `₹ ${fmtRs(r.amount_paise)}`, true)}
    </tbody>
  </table>`
}

/**
 * "For <trust> · Authorised signatory", and the line that says a printout
 * without a signature is still valid.
 *
 * Classic, Minimal, Modern, Traditional and Elegant had none: the receipt
 * simply stopped after the footer note, which is not what a document somebody
 * files with a CA looks like. Styled inline for the same reason as itemsBlock.
 */
function signatureBlock(mandir: NonNullable<ReceiptData['mandir']>): string {
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-top:22px;padding-top:12px;border-top:1px solid #e5e7eb">
    <div style="font-size:9.5px;color:#9ca3af;max-width:55%;line-height:1.6">${L.computerGenerated}</div>
    <div style="text-align:center;min-width:180px">
      <div style="font-size:10px;color:#6b7280">${L.forTrust.replace('{name}', mandir.name)}</div>
      <div style="height:34px"></div>
      <div style="border-top:1px solid #9ca3af;padding-top:4px;font-size:10px;color:#374151">${L.authorisedSignatory}</div>
    </div>
  </div>`
}

function copyBanner(label: string): string {
  return `<div class="copy-banner">${label}</div>`
}

/**
 * TEMPLATE 11: Anumodana — the receipt donors receive.
 *
 * The same builder devotee-api renders the WhatsApp "Download receipt (PDF)"
 * from (lib/receiptDocument.ts is a byte-identical copy), so a trust that
 * picks this template prints exactly the document its donors are sent: the
 * "॥ जय जिनेन्द्र ॥" invocation, a double frame in the trust's colour, the
 * amount in figures and words, 80G certification where it applies, and an
 * anumodana line for a gift.
 */
function buildAnumodana(r: ReceiptData, mandir: NonNullable<ReceiptData['mandir']>): string {
  const lines = r.lines ?? []
  const detail = lines.length
    ? lines.map(l => `${l.label}${l.qty ? ` × ${l.qty}` : ''}`).join(', ')
    : r.category
  const { css, body } = receiptParts({
    // A gift or a sale — the payload says so now; a title is the old signal.
    kind: isDonationDoc(r) ? 'donation' : 'sale',
    title: r.doc_title ?? null,
    receipt_number: r.receipt_number ?? '—',
    date: r.date,
    is_voided: r.is_voided,
    donor: {
      name: r.donor?.name,
      mobile: r.donor?.mobile,
      pan: donorPan(r) || null,
      address: [r.donor?.address, r.donor?.city, r.donor?.state, r.donor?.pincode].filter(Boolean).join(', ') || null,
    },
    amount_paise: r.amount_paise,
    detail_label: lines.length ? L.description : null,
    category: detail,
    payment_mode: paymentModeText(r),
    is_80g_eligible: r.is_80g_eligible,
    mandir: { ...mandir, receipt_language: mandir.receipt_language },
  })
  return `<style>${css}</style>${body}`
}


// ── TEMPLATE 12: Statement ──────────────────────────────────────────────────
// An invoice-shaped document for the things a trust BILLS for — a room, a hall,
// a bhojanshala account. Party block on the left, document facts on the right,
// the items carrying the page, and the total where an accountant looks for it.
function buildStatement(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  return `
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background:#f6f7f9; color:#111827; }
    .page { max-width:720px; margin:24px auto; background:#fff; padding:36px 40px; border:1px solid #e5e7eb; }
    .head { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; padding-bottom:16px; border-bottom:3px solid ${color}; }
    .logo { height:52px; width:auto; object-fit:contain; margin-bottom:8px; }
    .trust h1 { font-size:17px; font-weight:800; letter-spacing:-.2px; }
    .trust p { font-size:10.5px; color:#6b7280; line-height:1.7; margin-top:3px; }
    .doc { text-align:right; white-space:nowrap; }
    .doc .kind { display:inline-block; background:${color}; color:#fff; font-size:9.5px; letter-spacing:1.4px; text-transform:uppercase; padding:4px 10px; border-radius:3px; }
    .doc .no { font-family:'SF Mono',Consolas,monospace; font-size:15px; font-weight:700; margin-top:8px; }
    .doc .dt { font-size:11px; color:#6b7280; margin-top:2px; }
    .parties { display:flex; gap:24px; margin:20px 0 4px; }
    .party { flex:1; }
    .party .cap { font-size:9px; letter-spacing:1.4px; text-transform:uppercase; color:#9ca3af; margin-bottom:4px; }
    .party .nm { font-size:14px; font-weight:700; }
    .party .sub { font-size:11px; color:#6b7280; line-height:1.7; }
    .totals { display:flex; justify-content:flex-end; margin-top:10px; }
    .totals .box { min-width:260px; }
    .totals .row { display:flex; justify-content:space-between; font-size:12px; padding:5px 0; color:#374151; }
    .totals .grand { border-top:2px solid ${color}; margin-top:4px; padding-top:8px; font-size:16px; font-weight:800; color:${color}; }
    .words { font-size:10.5px; color:#6b7280; font-style:italic; text-align:right; margin-top:4px; }
    .reg-block, .payment-block { font-size:10px; color:#4b5563; line-height:1.9; margin-top:12px; }
    .pay-label { font-weight:700; color:${color}; }
    .footer-note { font-size:11px; color:#6b7280; text-align:center; font-style:italic; margin-top:16px; }
    .print-hint { font-size:10px; color:#cbd5e1; text-align:center; margin-top:10px; }
    .voided { background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; text-align:center; font-weight:700; padding:8px; margin-bottom:14px; }
    @media print { body{background:#fff;} .page{border:none;margin:0;padding:24px;} .print-hint{display:none;} }
  </style>
  <div class="page">
    ${voidedBanner(r.is_voided)}
    <div class="head">
      <div class="trust">
        ${logoTag(mandir)}
        <h1>${mandir.name}</h1>
        <p>${mandir.address}${mandir.mobile ? '<br>' + mandir.mobile : ''}${mandir.show_gstin && mandir.gstin ? '<br>GSTIN: ' + mandir.gstin : ''}</p>
      </div>
      <div class="doc">
        <div class="kind">${docTitle(r, L.donationReceipt)}</div>
        <div class="no">${r.receipt_number}</div>
        <div class="dt">${dateStr}</div>
      </div>
    </div>
    <div class="parties">
      <div class="party">
        <div class="cap">${L.receivedFrom}</div>
        <div class="nm">${r.donor?.name || L.anonymous}</div>
        <div class="sub">${[r.donor?.mobile, donorPan(r) ? `${L.pan} ${donorPan(r)}` : '', r.donor?.address].filter(Boolean).join('<br>')}</div>
      </div>
      <div class="party">
        <div class="cap">${L.category}</div>
        <div class="nm" style="font-size:13px">${r.category || '—'}</div>
        <div class="sub">${L.paymentMode}: ${paymentModeText(r)}${isDonationDoc(r) ? `<br>80G: ${r.is_80g_eligible ? L.yes : L.no}` : ''}</div>
      </div>
    </div>
    ${itemsBlock(r, color, { total: false })}
    <div class="totals"><div class="box">
      <div class="row grand"><span>${L.total}</span><span>₹ ${fmtRs(r.amount_paise)}</span></div>
    </div></div>
    <div class="words">${amountInWords(r.amount_paise)}</div>
    ${regBlock(mandir, r)}
    ${paymentBlock(mandir)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    <div class="print-hint">${L.printHint}</div>
  </div>`
}

// ── TEMPLATE 13: Heritage ───────────────────────────────────────────────────
// For trusts that want the receipt to look like the mandir: a double rule, a
// gold hairline, and the amount set as the centrepiece. Serif throughout, and
// the Jai Jinendra line at the head where a printed Jain receipt carries it.
function buildHeritage(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  const gold = '#B8862B'
  return `
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; background:#FBF8F1; color:#241C10; }
    .page { max-width:700px; margin:24px auto; background:#FFFDF8; border:3px double ${gold}; padding:6px; }
    .inner { border:1px solid ${gold}55; padding:26px 30px; }
    .jai { text-align:center; color:${gold}; font-size:12px; letter-spacing:3px; }
    .name { text-align:center; font-size:22px; font-weight:700; color:${color}; margin-top:6px; }
    .addr { text-align:center; font-size:10.5px; color:#6B5A44; line-height:1.7; margin-top:4px; }
    .regs { text-align:center; font-size:9.5px; color:#8A7560; margin-top:6px; }
    .kind { text-align:center; margin:14px 0 4px; }
    .kind span { display:inline-block; border-top:1px solid ${gold}; border-bottom:1px solid ${gold}; padding:4px 18px; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:${color}; }
    .meta { display:flex; justify-content:space-between; font-size:11.5px; color:#4B3F30; margin:10px 2px 14px; }
    .to-cap { font-size:9.5px; letter-spacing:2px; text-transform:uppercase; color:#8A7560; }
    .to { font-size:17px; font-weight:700; margin-top:2px; }
    .to-sub { font-size:11px; color:#6B5A44; margin-top:2px; }
    .amt { display:flex; align-items:center; justify-content:space-between; gap:16px; border:1px solid ${gold}66; background:${gold}0f; padding:12px 16px; margin:14px 0 6px; }
    .amt .cap { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8A7560; }
    .amt .words { font-size:11px; font-style:italic; color:#6B5A44; margin-top:3px; }
    .amt .val { font-size:26px; font-weight:700; color:${color}; white-space:nowrap; }
    .rows { font-size:12.5px; }
    .rows .r { display:flex; justify-content:space-between; padding:7px 2px; border-bottom:1px dotted ${gold}55; }
    .rows .r span:first-child { color:#6B5A44; }
    .rows .r span:last-child { font-weight:700; }
    .reg-block, .payment-block { font-size:10px; color:#6B5A44; line-height:1.9; margin-top:10px; }
    .pay-label { font-weight:700; color:${color}; }
    .footer-note { text-align:center; font-style:italic; color:${gold}; font-size:12px; margin-top:14px; }
    .print-hint { text-align:center; font-size:10px; color:#C9BCA6; margin-top:8px; }
    .voided { border:1px solid #B91C1C; color:#B91C1C; text-align:center; font-weight:700; padding:7px; margin-bottom:12px; letter-spacing:2px; }
    @media print { body{background:#fff;} .page{margin:0;} .print-hint{display:none;} }
  </style>
  <div class="page"><div class="inner">
    ${voidedBanner(r.is_voided)}
    <div class="jai">॥ जय जिनेन्द्र ॥</div>
    ${logoTag(mandir) ? `<div style="text-align:center;margin-top:8px">${logoTag(mandir)}</div>` : ''}
    <div class="name">${mandir.name}</div>
    <div class="addr">${mandir.address}${mandir.mobile ? ' · ' + mandir.mobile : ''}</div>
    <div class="regs">${[mandir.pan ? `PAN ${mandir.pan}` : '', mandir.show_gstin && mandir.gstin ? `GSTIN ${mandir.gstin}` : ''].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>
    <div class="kind"><span>${docTitle(r, L.donationReceipt)}</span></div>
    <div class="meta"><span>${L.receiptNo}: <b>${r.receipt_number}</b></span><span>${L.date}: <b>${dateStr}</b></span></div>
    <div class="to-cap">${L.receivedWithThanks}</div>
    <div class="to">${r.donor?.name || L.anonymous}</div>
    <div class="to-sub">${[r.donor?.mobile, donorPan(r) ? `${L.pan} ${donorPan(r)}` : ''].filter(Boolean).join(' · ')}</div>
    <div class="amt">
      <div>
        <div class="cap">${amountLabel(r)}</div>
        <div class="words">${amountInWords(r.amount_paise)}</div>
      </div>
      <div class="val">₹ ${fmtRs(r.amount_paise)}</div>
    </div>
    <div class="rows">
      <div class="r"><span>${L.category}</span><span>${r.category || '—'}</span></div>
      <div class="r"><span>${L.paymentMode}</span><span>${paymentModeText(r)}</span></div>
      ${isDonationDoc(r) ? `<div class="r"><span>80G</span><span>${r.is_80g_eligible ? L.yes : L.no}</span></div>` : ''}
    </div>
    ${itemsBlock(r, color)}
    ${r.is_80g_eligible && mandir.show_80g && isDonationDoc(r) ? `<div style="font-size:10.5px;color:#6B5A44;margin-top:10px">${L.valid80g}</div>` : ''}
    ${regBlock(mandir, r)}
    ${paymentBlock(mandir)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    <div class="print-hint">${L.printHint}</div>
  </div></div>`
}

function renderBody(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, template: string, color: string): string {
  if (template === 'anumodana') return buildAnumodana(r, mandir)
  if (template === 'minimal') return buildMinimal(r, dateStr, mandir, color)
  if (template === 'modern') return buildModern(r, dateStr, mandir, color)
  if (template === 'traditional') return buildTraditional(r, dateStr, mandir)
  if (template === 'elegant') return buildElegant(r, dateStr, mandir, color)
  if (template === 'temple') return buildTemple(r, dateStr, mandir, color)
  if (template === 'tabular') return buildTabular(r, dateStr, mandir, color)
  if (template === 'acknowledgement') return buildAcknowledgement(r, dateStr, mandir, color)
  if (template === 'jain_tirth') return buildJainTirth(r, dateStr, mandir, color)
  if (template === 'statement') return buildStatement(r, dateStr, mandir, color)
  if (template === 'heritage') return buildHeritage(r, dateStr, mandir, color)
  if (template === '80g') return build80G(r, dateStr, mandir, color)
  return buildClassic(r, dateStr, mandir, color)
}

/**
 * 80 mm thermal roll layout (plan §16). Deliberately its own minimal renderer
 * rather than a squeezed A4 template: at 72 mm of printable width the boxed,
 * two-column A4 designs are unreadable, and thermal printers render only
 * monochrome text well.
 */
function buildThermal(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>): string {
  const row = (k: string, v: string) => `<div class="tr"><span>${k}</span><span>${v}</span></div>`
  return `
  <style>
    @page { size: 80mm auto; margin: 0; }
    body { background:#fff; font-family:'Arial',sans-serif; }
    .roll { width:72mm; margin:0 auto; padding:6mm 2mm; color:#000; font-size:11px; line-height:1.5; }
    .roll .name { text-align:center; font-size:14px; font-weight:800; }
    .roll .addr { text-align:center; font-size:10px; margin-bottom:6px; }
    .roll .title { text-align:center; font-weight:700; border-top:1px dashed #000; border-bottom:1px dashed #000; padding:4px 0; margin-bottom:6px; }
    .tr { display:flex; justify-content:space-between; gap:8px; }
    .tr span:first-child { color:#333; }
    .tr span:last-child { font-weight:600; text-align:right; }
    .amt { text-align:center; font-size:16px; font-weight:800; border-top:1px dashed #000; border-bottom:1px dashed #000; padding:5px 0; margin:6px 0; }
    .words { font-size:10px; font-style:italic; text-align:center; margin-bottom:6px; }
    .note { font-size:9.5px; text-align:center; margin-top:6px; }
    .voided-t { text-align:center; font-weight:800; border:1px solid #000; padding:3px; margin-bottom:6px; }
    .upi-qr { text-align:center; margin-top:8px; }
    .upi-qr img { width:32mm; height:32mm; }
    .upi-cap { font-size:9.5px; }
    .upi-id { font-family:monospace; }
    .copy-banner { text-align:center; font-size:10px; font-weight:700; letter-spacing:1px; margin-bottom:4px; }
    @media print { .print-hint { display:none; } }
  </style>
  <div class="roll">
    <div class="name">${mandir.name}</div>
    <div class="addr">${mandir.address}${mandir.mobile ? '<br>' + mandir.mobile : ''}</div>
    <div class="title">${docTitle(r, L.donationReceipt)}</div>
    ${r.is_voided ? `<div class="voided-t">VOID</div>` : ''}
    ${row(L.receiptNo, r.receipt_number ?? '—')}
    ${row(L.date, dateStr)}
    ${row(L.receivedFrom, r.donor?.name || L.anonymous)}
    ${r.donor?.mobile ? row(L.mobile, r.donor.mobile) : ''}
    ${donorPan(r) ? row(L.pan, donorPan(r)!) : ''}
    ${row(L.category, r.category || L.generalDonation)}
    ${row(L.paymentMode, paymentModeText(r))}
    <div class="amt">₹ ${fmtRs(r.amount_paise)}</div>
    <div class="words">${amountInWords(r.amount_paise)}</div>
    ${r.is_80g_eligible && mandir.show_80g ? `<div class="note">${L.valid80g}</div>` : ''}
    ${upiQrBlock(r)}
    <div class="note">${mandir.footer || L.thankYou}</div>
  </div>`
}

/**
 * The counter slip — prasad, seva, bhojanshala.
 *
 * ── WHY THESE ARE NOT JUST A NARROW RECEIPT ─────────────────────────────────
 * The thirteen A4 templates are DOCUMENTS: a donor block, a signature line, an 80G
 * certification, a footer. What a prasad counter hands over is a claim check
 * for a ₹20 packet. Printing a certificate for it wastes the paper and buries
 * the one thing the window actually reads — what, how many, and the number.
 *
 * ── WHAT A TOKEN SHOWS, IN ORDER OF WHAT THE WINDOW NEEDS ───────────────────
 * The number, big enough to read at arm's length across a counter; the items
 * and their quantities; the total. The buyer's name appears only on `compact`,
 * because a token is bearer-presented — whoever holds it collects.
 *
 * GST prints only when the trust HAS a GSTIN and tax was actually charged. Both
 * conditions, not either: a zero tax row on an unregistered trust is a claim to
 * be collecting a tax it cannot collect.
 */
const slipRow = (k: string, v: string) =>
  `<div class="sr"><span>${k}</span><span>${v}</span></div>`;

function slipStyles(mandir: NonNullable<ReceiptData['mandir']>): string {
  const width = mandir.receipt_paper === 'thermal58' ? '48mm' : '72mm';
  const page = mandir.receipt_paper === 'thermal58' ? '58mm auto' : '80mm auto';
  return `
  <style>
    @page { size: ${page}; margin: 0; }
    body { background:#fff; font-family:'Arial',sans-serif; }
    .slip { width:${width}; margin:0 auto; padding:5mm 2mm; color:#000; font-size:11px; line-height:1.45; }
    .slip .name { text-align:center; font-size:13px; font-weight:800; }
    .slip .addr { text-align:center; font-size:9.5px; margin-bottom:5px; }
    .slip .kind { text-align:center; font-weight:700; letter-spacing:1px; text-transform:uppercase;
                  border-top:1px dashed #000; border-bottom:1px dashed #000; padding:3px 0; margin-bottom:5px; }
    /* The number is the point of the whole slip. */
    .slip .no { text-align:center; font-size:17px; font-weight:800; letter-spacing:1px; margin:2px 0 5px; }
    .sr { display:flex; justify-content:space-between; gap:8px; }
    .sr span:last-child { font-weight:600; text-align:right; }
    .items { border-top:1px dashed #000; margin-top:4px; padding-top:4px; }
    .it { display:flex; justify-content:space-between; gap:6px; font-size:10.5px; }
    .it .q { flex:0 0 auto; color:#333; }
    .tot { text-align:center; font-size:15px; font-weight:800;
           border-top:1px dashed #000; border-bottom:1px dashed #000; padding:4px 0; margin:5px 0; }
    .big { text-align:center; font-size:22px; font-weight:800; letter-spacing:2px; margin:4px 0; }
    .note { font-size:9px; text-align:center; margin-top:5px; }
    .void { text-align:center; font-weight:800; border:1px solid #000; padding:3px; margin-bottom:5px; }
    .copy-banner { text-align:center; font-size:9.5px; font-weight:700; letter-spacing:1px; margin-bottom:3px; }
    /* One-token-per-plate (tenant migration 039). */
    .slip .of { text-align:center; font-size:28px; font-weight:800; letter-spacing:1px; margin:4px 0 0; }
    .slip .meal { text-align:center; font-size:15px; font-weight:800; text-transform:uppercase; margin:0 0 2px; }
    .slip .plate { text-align:center; font-size:11px; margin-bottom:5px; }
    @media print { .print-hint { display:none; } }
  </style>`;
}

function buildSlip(
  r: ReceiptData,
  dateStr: string,
  mandir: NonNullable<ReceiptData['mandir']>,
  compact: boolean,
): string {
  const lines = r.lines ?? [];
  const tax = r.tax ?? null;
  const taxTotal = (tax?.cgst_paise ?? 0) + (tax?.sgst_paise ?? 0) + (tax?.igst_paise ?? 0);
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const tokens = Number(meta.tokens ?? 0);
  const row = slipRow;

  return `${slipStyles(mandir)}
  <div class="slip">
    <div class="name">${mandir.name}</div>
    <div class="addr">${mandir.address}${mandir.mobile ? '<br>' + mandir.mobile : ''}</div>
    <div class="kind">${docTitle(r, L.donationReceipt)}</div>
    ${r.is_voided ? `<div class="void">VOID</div>` : ''}
    <div class="no">${r.receipt_number ?? '—'}</div>
    ${row(L.date, dateStr)}
    ${compact && r.donor?.name ? row(L.receivedFrom, r.donor.name) : ''}
    ${compact && r.donor?.mobile ? row(L.mobile, r.donor.mobile) : ''}
    ${tokens > 0 ? `<div class="big">${tokens}</div>` : ''}
    ${lines.length
      ? `<div class="items">${lines.map((l) => `
          <div class="it">
            <span>${l.label}</span>
            <span class="q">${l.qty ? '×' + l.qty + '  ' : ''}${fmtRs(l.amount_paise)}</span>
          </div>`).join('')}</div>`
      : row(L.category, r.category || '—')}
    ${taxTotal > 0 && mandir.gst_enabled ? row('GST', fmtRs(taxTotal)) : ''}
    <div class="tot">₹ ${fmtRs(r.amount_paise)}</div>
    ${compact ? row(L.paymentMode, paymentModeText(r)) : ''}
    <div class="note">${mandir.footer || L.thankYou}</div>
  </div>`;
}

/**
 * The most tokens one sale may print separately. A sponsored bhandara of 500
 * plates is a different job — nobody hands out 500 slips across a counter —
 * so above this the sale prints as the single combined slip.
 */
export const MAX_PLATE_TOKENS = 100;

/**
 * Whether this receipt prints as one token per plate (tenant migration 039).
 *
 * Only a Bhojanshala slip with more than one plate, from a trust that turned
 * the setting on, and never a voided sale: N valid-looking tokens for a
 * cancelled sale are N free meals.
 */
export function printsTokenPerPlate(r: ReceiptData): boolean {
  const mandir = r.mandir;
  const template = mandir?.template;
  const tokens = Number((r.meta as Record<string, unknown> | null | undefined)?.tokens ?? 0);
  return !!mandir?.slip_token_per_plate
    && (template === 'token' || template === 'compact')
    && r.slip_kind === 'bhojanshala'
    && !r.is_voided
    && Number.isInteger(tokens) && tokens > 1 && tokens <= MAX_PLATE_TOKENS;
}

/**
 * One plate's token: the meal, "3 / 10", the sale it belongs to. The dining
 * hall collects one per thali, so each token has to stand on its own — the
 * sale number ties it back to the counter's record, and "3 / 10" is what stops
 * a torn-off token being mistaken for the whole sale.
 */
function buildPlateToken(
  r: ReceiptData,
  dateStr: string,
  mandir: NonNullable<ReceiptData['mandir']>,
  index: number,
  of: number,
): string {
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const rate = Number(meta.rate_paise ?? 0);
  const meal = mealName(meta.meal_type);
  return `
  <div class="slip">
    <div class="name">${mandir.name}</div>
    <div class="kind">${docTitle(r, L.bhojanshalaToken)}</div>
    <div class="of">${index} / ${of}</div>
    ${meal ? `<div class="meal">${meal}</div>` : ''}
    <div class="plate">${L.onePlate}${rate > 0 ? ` · ₹ ${fmtRs(rate)}` : ''}</div>
    ${slipRow(L.receiptNo, r.receipt_number ?? '—')}
    ${slipRow(L.date, dateStr)}
    <div class="note">${mandir.footer || L.thankYou}</div>
  </div>`;
}

export function buildReceiptHtml(input: ReceiptData): string {
  // A document that has not been numbered yet arrives with receipt_number:
  // null; every template interpolates it directly, so the guest's copy read
  // "Receipt null". Substitute once here rather than at all fifteen sites.
  const r: ReceiptData = escapeDeep({ ...input, receipt_number: input.receipt_number || '—' })
  const dateStr = new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const mandir = r.mandir ?? { name: 'Mandir', address: '', template: 'classic', primary_color: '#0D1B2E' }
  L = receiptLabels(mandir.receipt_language)
  let template = mandir.template || 'classic'
  // The 80G template makes a statutory tax-exemption claim, so it must never be
  // used for a donation that is not 80G-eligible — NOR for a trust that holds
  // no 80G registration at all. The second condition is new: a trust could
  // previously select the 80G template in Settings and print a certificate
  // shaped document with an empty registration line on it.
  if (template === '80g' && (!r.is_80g_eligible || mandir.eighty_g_enabled === false)) {
    template = 'classic'
  }
  const color = mandir.primary_color || '#0D1B2E'
  const thermal = mandir.receipt_paper === 'thermal80' || mandir.receipt_paper === 'thermal58'
  // A counter slip is chosen by TEMPLATE, not by paper: a trust may print a
  // token on A5 (a half-sheet cut in two at the window is common) and still
  // want the token layout, while another prints full receipts on an 80 mm roll.
  const slip = template === 'token' || template === 'compact'

  const one = (copyLabel?: string) => {
    const body = slip
      ? buildSlip(r, dateStr, mandir, template === 'compact')
      : thermal
        ? buildThermal(r, dateStr, mandir)
        : renderBody(r, dateStr, mandir, template, color)
    const banner = copyLabel ? copyBanner(copyLabel) : ''
    // The QR is appended after the body for A4 (thermal already embeds it, and
    // a token has no room for one — it is collected at the counter that just
    // took the money).
    const qr = thermal || slip ? '' : upiQrBlock(r)
    return `<div class="receipt-copy">${banner}${body}${qr}</div>`
  }

  // "Both" prints the donor's copy and the office's file copy on one job, so
  // the counter doesn't have to run the print twice and risk a mismatch.
  let copies = mandir.receipt_copies === 'both'
    ? one(L.donorCopy) + `<div class="copy-sep"></div>` + one(L.officeCopy)
    : one()

  // One token per plate (tenant migration 039). The devotee gets N tokens; the
  // office copy, when the trust keeps one, is still the single combined slip —
  // the counter reconciles the SALE, not the plates. On a roll every token is
  // its own page, so a cutter separates them; on A4/A5 they tile, to be cut
  // along the dashed lines.
  if (printsTokenPerPlate(r)) {
    const n = Number((r.meta as Record<string, unknown>).tokens)
    const tokens = Array.from({ length: n }, (_, i) =>
      `<div class="plate-token">${buildPlateToken(r, dateStr, mandir, i + 1, n)}</div>`).join('')
    const office = mandir.receipt_copies === 'both'
      ? `<div class="plate-office">${one(L.officeCopy)}</div>`
      : ''
    // Last in the document on purpose: the office copy carries the slip
    // styles again, and its roll-sized @page must not win on A4/A5.
    const layout = `<style>
  .plate-token { page-break-inside:avoid; break-inside:avoid; }
  ${thermal
    // Block layout: Chromium ignores page breaks between flex items.
    ? `.plate-token + .plate-token, .plate-office { page-break-before:always; break-before:page; }`
    : `@page { size: ${mandir.receipt_paper === 'a5' ? 'A5' : 'A4'}; margin: 8mm; }
  .plate-sheet { display:flex; flex-wrap:wrap; justify-content:center; }
  .plate-sheet .plate-token { border:1px dashed #666; }
  .plate-office { page-break-before:always; break-before:page; }`}
</style>`
    copies = `${slipStyles(mandir)}<div class="plate-sheet" data-plate-tokens="${n}">${tokens}</div>${office}${layout}`
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt ${r.receipt_number}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  .copy-banner{text-align:center;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#6b7280;padding:8px 0 0;}
  .copy-sep{border-top:1px dashed #9ca3af;margin:16px 0;}
  .upi-qr{text-align:center;padding:12px 0 18px;}
  .upi-qr img{width:120px;height:120px;}
  .upi-cap{font-size:10.5px;color:#6b7280;margin-top:4px;}
  .upi-id{font-family:monospace;color:#374151;}
  /* Browsers drop background colours when printing unless asked not to, so the
     coloured header band, the amount box and the badges came out plain white on
     paper and in the downloaded PDF — same layout as the Settings preview, but
     the wrong colours. Declared on * because each template paints its own
     elements and any one of them would otherwise be stripped. */
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  @media print{
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .copy-sep{border-top:1px dashed #999;page-break-inside:avoid;}
    .receipt-copy{page-break-inside:avoid;}
  }
</style>
</head><body>${copies}<script>window.onload=()=>{window.print()}</script></body></html>`
}

/** The desktop shell's bridge, when this is running inside Electron. */
interface DesktopPrintBridge {
  printHtml?: (html: string, opts?: { silent?: boolean }) => Promise<{
    success: boolean
    reason?: string
    error?: string
    filePath?: string
  }>
  openPath?: (filePath: string) => Promise<string>
}

function desktopBridge(): DesktopPrintBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { electronAPI?: DesktopPrintBridge }).electronAPI
}

/**
 * Render the receipt HTML and trigger print. Uses a hidden iframe (no popup,
 * so it is not blocked by popup blockers); falls back to a new tab if the
 * iframe approach is unavailable.
 *
 * ── ON THE DESKTOP BUILD THIS GOES THROUGH ELECTRON ─────────────────────────
 * `window.print()` never returns inside the Electron shell. The call blocks,
 * no print dialog ever appears, the cleanup below never runs and the iframe is
 * left in the DOM — so somebody at the counter saves a donation, sees nothing
 * happen, and the donor leaves without a receipt. There is no error to notice.
 * Confirmed against the unmodified shell: the donation was written to the
 * database correctly and the print simply went nowhere.
 *
 * The shell renders the document in its own window and prints it there, and
 * writes a PDF and opens it when there is no printer — a counter machine
 * frequently has none configured. The browser build is untouched.
 */
export function printReceiptHtml(html: string): void {
  const bridge = desktopBridge()
  if (bridge?.printHtml) {
    void bridge.printHtml(html).then((res) => {
      // Not an error worth interrupting anyone over: a cancelled print and an
      // absent printer look the same from here, and in both cases the PDF is
      // the useful outcome rather than a dialog saying something went wrong.
      if (!res?.success && res?.filePath) void bridge.openPath?.(res.filePath)
    }).catch(() => { /* the shell reports its own failures */ })
    return
  }

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
  const receipt = await fetchReceipt(id, basePath)
  printReceiptHtml(buildReceiptHtml(receipt))
}

/** The fetch every print/download/share path shares, QR included. */
async function fetchReceipt(id: string, basePath: string): Promise<ReceiptData> {
  const { data } = await api.get(`${basePath}/${id}/receipt`)
  const receipt: ReceiptData = data.data
  receipt.upi_qr_data_uri = await buildUpiQr(receipt)
  return receipt
}

/**
 * Print a counter slip immediately, but only if the trust asked for that.
 *
 * ── WHY THE DECISION IS MADE HERE AND NOT AT THE COUNTER ────────────────────
 * `slip_auto_print` is a trust-level setting (Settings → Receipts → Counter
 * slips, tenant migration 032). The prasad, seva and bhojanshala screens should
 * not each fetch the profile to find out whether to print — that is three
 * copies of one rule, and the receipt payload already carries the answer.
 *
 * So this fetches the slip once, prints it if the flag is set, and otherwise
 * does nothing at all. The manual Print button stays on every screen: a
 * counter whose printer is out of paper still needs to be able to reprint.
 *
 * ── AND WHY IT SWALLOWS ITS ERRORS ──────────────────────────────────────────
 * The SALE is already recorded by the time this runs. A print failure must not
 * surface as a failed sale — the operator would void a good transaction and
 * take the money again. Returns false so the caller can mention it quietly if
 * it wants to.
 */
export async function autoPrintSlip(id: string, basePath: string): Promise<boolean> {
  try {
    const receipt = await fetchReceipt(id, basePath)
    if (!receipt.mandir?.slip_auto_print) return false
    printReceiptHtml(buildReceiptHtml(receipt))
    return true
  } catch {
    return false
  }
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
    // The "${L.printHint}" hint is only meant for someone
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

    // .sheet is the Anumodana template's page; every other template uses .page.
    const target = (doc.querySelector('.page, .sheet') as HTMLElement) || doc.body
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
  receipt.upi_qr_data_uri = await buildUpiQr(receipt)
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
  receipt.upi_qr_data_uri = await buildUpiQr(receipt)
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
