/**
 * THE RECEIPT DESIGNS. Pure: HTML in, HTML out.
 *
 * Split out of `printReceipt.ts` so that devotee-api can render them too.
 * devotee-api had exactly one design — the Anumodana sheet in
 * `receiptDocument.ts` — and never read `kshetra_profile.receipt_template`, so
 * a trust that chose Classic printed Classic at its counter and its donors
 * received Anumodana on WhatsApp. Reported by a client as "the template I
 * select is not the one in the WhatsApp message", and it was exactly that.
 *
 * ── WHAT MAY GO IN THIS FILE ────────────────────────────────────────────────
 * Nothing that a Nest service cannot import. No axios, no `qrcode`, no
 * `html2canvas`, no `jspdf`, no `window`. Those live in `printReceipt.ts`,
 * which is the browser's half — it re-exports everything here, so a caller
 * importing from `printReceipt` sees no difference.
 *
 * VENDORED: byte-identical in devotee-api (src/receipts/receipt-templates.ts).
 * `node qa/qa-comms-catalog.mjs` fails if the copies drift.
 */

import { receiptLabels, receiptLabelsFor, type ReceiptLabels } from './receiptLabels'
import {
  parseDefinition,
  type DefinitionBlock,
  type DefinitionDensity,
  type DefinitionFrame,
  type LocalisedText,
  type ReceiptDefinition,
} from './receiptDefinition'
import { receiptParts, type ReceiptDocument } from './receiptDocument'

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
    /**
     * The trust's house rules, sent ONLY on an accommodation document
     * (tenant migration 043). A donation receipt never carries them, so no
     * design needs to ask what kind of document it is drawing.
     */
    house_rules?: string | null
    /**
     * The trust's terms, printed on any document (tenant migration 051).
     *
     * Separate from `house_rules`, which the API sends only on a stay: "rooms
     * from 12 noon" belongs on a room bill alone, while cancellation terms
     * belong on a hall invoice and a gaushala receipt too.
     *
     * No companion toggle, deliberately - the text being present is the
     * intent. A checkbox beside a textarea asks the same question twice and
     * then lets the two answers disagree.
     */
    terms?: string | null
    /** Authorised signature as a data URI, like `logo_base64`. */
    signature_image?: string | null
    template?: string
    primary_color?: string
    /** Colour, or black and white for a mono printer (tenant migration 058). Absent = colour. */
    print_colour?: 'colour' | 'bw' | null
    // Print settings (tenant-migration 011, widened by 032).
    //
    // A COUNTER SLIP arrives in these same fields — mandir-api substitutes the
    // Counter-slip settings into `template` / `receipt_paper` / `receipt_copies`
    // before sending (see receipt-mandir.ts). That is deliberate: this renderer
    // needs to know what to draw and on what paper, not which module asked.
    receipt_copies?: 'single' | 'both'
    receipt_paper?: 'a4' | 'a5' | 'thermal58' | 'thermal80' | 'thermal112'
    receipt_language?: string
    receipt_show_upi_qr?: boolean
    /**
     * Roll-only print options (tenant migration 052).
     *
     * Separate from the A4/A5 settings because none of them mean anything on a
     * sheet: a sheet has no cutter, no feed, and enough width that hiding a row
     * to save space is never the question.
     *
     * Validated by `thermalOpts()` before use — a stored jsonb row outlives the
     * code that wrote it, the same reason `label_overrides` is re-validated.
     */
    receipt_thermal?: unknown
    /**
     * The trust's own APPROVED design, when `template` is 'custom'.
     *
     * Travels in the payload rather than being fetched: this renderer has no
     * database and runs offline on the desktop counter. Re-validated by
     * `parseDefinition` before anything is drawn — see receiptDefinition.ts.
     */
    template_definition?: unknown
    /**
     * The trust's own wording, `{ <label key>: { <lang>: text } }`
     * (tenant migration 046). Validated by the renderer before use - a stored
     * row outlives the code that wrote it.
     */
    label_overrides?: unknown
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
    /**
     * The RECIPIENT's GSTIN — Rule 46(e), and absent from this payload until
     * now.
     *
     * A dharamshala lets rooms to companies and other trusts, not only to
     * individuals, and a registered recipient cannot claim input tax credit
     * from an invoice that does not carry their GSTIN. Optional because most
     * guests are individuals, who have none.
     */
    gstin?: string | null
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
  lines?: Array<{
    label: string
    qty?: string
    amount_paise: number
    /**
     * HSN/SAC per line — Rule 46(g). Accommodation is SAC 9963.
     *
     * Per LINE rather than per document, because a folio can mix a room at
     * 9963 with food at 9963.xx and a hall at 9972, and one code at the top
     * would be wrong for two of the three.
     */
    sac?: string | null
    /** The line's GST rate as a percentage — Rule 46(k). */
    rate_pct?: number | null
  }> | null
  /**
   * The GST split, when tax was actually charged.
   *
   * Null on every document from a trust with no GSTIN: mandir-api's
   * GstRateService returns 0% for an unregistered trust, and the receipt
   * builders send `tax: null` rather than a row of zeroes.
   */
  tax?: {
    cgst_paise?: number
    sgst_paise?: number
    igst_paise?: number
    /**
     * The rate as a percentage, and the document-level SAC — Rule 46(k) and
     * 46(g). Fallbacks for when the lines do not carry their own.
     *
     * The old tax invoice printed "CGST ₹80.00" and no rate anywhere, which is
     * an incomplete invoice: the recipient cannot verify the tax without it.
     */
    rate_pct?: number | null
    sac_code?: string | null
    /**
     * Rule 46(p): whether tax is payable on reverse charge.
     *
     * Prints either way. "No" is the declaration the rule asks for, so leaving
     * it off when false is the same omission as leaving it off when true.
     */
    reverse_charge?: boolean
  } | null
  /**
   * Rule 46(n). Falls back to the guest's state, which is what the old
   * template used — correct for accommodation, where the place of supply is
   * the property's location, but stated explicitly when the API knows it.
   */
  place_of_supply?: string | null
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

/**
 * A date and the time of day, in IST, for a stored instant.
 *
 * Every other date on a receipt is a plain calendar date, which is why
 * `toLocaleDateString` was enough until now. A payment, a check-in and a
 * check-out are *instants*, and the trust's clerk needs to recognise the one
 * they took \u2014 so the zone is pinned to IST rather than left to the machine
 * doing the printing. A counter PC set to the wrong zone, or a donor opening
 * the PDF abroad, would otherwise read a different time than the receipt was
 * issued at.
 */
/** A tender dated without a time ('2026-09-24', or that day at midnight UTC as a DATE column serialises). */
function isDateOnly(value: unknown): boolean {
  const s = String(value ?? '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(s)
}

function fmtDateTime(value: unknown): string {
  if (!value) return ''
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return ''
  // A date with no time (a backdated cheque, an imported register) prints as
  // the date alone. It used to print midnight UTC as "05:30 am" - a time the
  // money was never taken at.
  if (isDateOnly(value)) {
    return new Date(String(value).slice(0, 10) + 'T00:00:00Z').toLocaleDateString(dateLocale, {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
    })
  }
  // `month: 'long'`, matching the document date every design already prints.
  // 'short' renders September as "Sept" under en-IN, which sits beside a
  // "19 September 2026" header looking like a typo.
  return d.toLocaleString(dateLocale, {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

/**
 * A plain calendar date — no time, no zone conversion.
 *
 * For a DATE column (`check_in_date`), which is already the trust's local day
 * and must not be shifted by the reader's zone. `new Date('2026-09-19')` is
 * parsed as UTC midnight, so a viewer west of Greenwich would otherwise see
 * the 18th.
 */
function fmtDay(value: unknown): string {
  if (!value) return ''
  const raw = String(value).slice(0, 10)
  const [y, m, d] = raw.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(dateLocale, {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/**
 * WHEN the money actually arrived, and under what reference.
 *
 * `payments[].paid_on` has been in the payload since the split-tender work and
 * no design ever printed it: a receipt said "Cash + UPI" and not when either
 * was taken. For a stay settled partly at booking and partly at checkout those
 * are different DAYS, and the guest reconciling the bill cannot tell which
 * payment is which. Returns '' when there is nothing more to say than the
 * document's own date already says.
 */
function paymentWhenRows(r: ReceiptData): Array<[string, string]> {
  const tenders = r.payments ?? []
  if (!tenders.length) return []
  const dated = tenders.filter(t => fmtDateTime(t.paid_on))
  if (!dated.length) return []
  // One tender: a single "Received on <date> at <time>" line reads better than
  // a table of one row.
  if (tenders.length === 1) {
    const t = dated[0]
    const ref = t.reference_no ? ` \u00b7 ${L.reference} ${t.reference_no}` : ''
    return [[L.receivedOn, `${fmtDateTime(t.paid_on)}${ref}`]]
  }
  return dated.map(t => {
    const ref = t.reference_no ? ` \u00b7 ${L.reference} ${t.reference_no}` : ''
    return [
      `${modeName(t.payment_mode)} \u20b9${fmtRs(Number(t.amount_paise))}`,
      `${fmtDateTime(t.paid_on)}${ref}`,
    ] as [string, string]
  })
}

/**
 * The payment-when rows as one flowing line a design can drop in anywhere.
 *
 * Deliberately a wrapping paragraph rather than a row per tender. A row each
 * cost four lines on a two-tender bill and pushed three designs off an A4 page
 * (qa-receipt-pages.mjs caught it the moment this block was added), and it also
 * repeated what the design's own payment-mode row already said — the mode and
 * the amount — adding only the date.
 */
function paymentWhenBlock(r: ReceiptData, opts: { compact?: boolean } = {}): string {
  const rows = paymentWhenRows(r)
  if (!rows.length) return ''
  const size = opts.compact ? '9px' : '9.5px'
  const text = rows.length === 1
    ? `<span style="color:#6b7280">${rows[0][0]}</span> <b>${rows[0][1]}</b>`
    : rows.map(([k, v]) => `<b>${k}</b> <span style="color:#6b7280">${v}</span>`).join(' &nbsp;·&nbsp; ')
  return `<div class="payment-when" style="margin-top:6px;font-size:${size};line-height:1.45;color:#374151">${text}</div>`
}

/** A donation, or a bill for a service (a room, a hall, a meal, a packet)? */
function isDonationDoc(r: ReceiptData): boolean {
  if (r.kind) return r.kind === 'donation'
  if (r.slip_kind) return false
  return !r.doc_title
}

/**
 * Can this trust grant 80G at all? Its 80G number, and 80G shown on receipts.
 *
 * Without both, every 80G line is noise: a trust with no 80G registration
 * printed "80G eligible: No" on every donation - true, and meaningless, since
 * it cannot grant the deduction to anyone (reported 2026-09-25).
 */
function trustGrants80g(mandir: NonNullable<ReceiptData['mandir']>): boolean {
  return !!(mandir.show_80g && String(mandir.reg_80g_number ?? '').trim())
}

/** The "80G eligible: Yes/No" line: a gift, at a trust that can grant 80G. */
function show80gLine(r: ReceiptData, mandir: NonNullable<ReceiptData['mandir']>): boolean {
  return isDonationDoc(r) && trustGrants80g(mandir)
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

/**
 * The locale a receipt's dates are written in: the print language's month
 * names, Latin digits (`-u-nu-latn` — Marathi would otherwise print Devanagari
 * numerals in the date and Latin ones everywhere else on the same receipt).
 * Set per receipt in buildReceiptHtml, beside `L`.
 */
const DATE_LOCALES: Record<string, string> = {
  hi: 'hi-IN-u-nu-latn', mr: 'mr-IN-u-nu-latn', gu: 'gu-IN-u-nu-latn',
  kn: 'kn-IN-u-nu-latn', ta: 'ta-IN-u-nu-latn', te: 'te-IN-u-nu-latn',
}
let dateLocale = 'en-IN'

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
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      // The trust's wording is escaped by the label layer that owns it
      // (`escapeLabel`), so it must not be escaped here as well. It used to be,
      // and Anumodana printed `&amp;amp;lt;` - that design passes the already
      // escaped block down into a renderer that escapes again, so an apostrophe
      // came out as `&amp;#39;` on the one design a donor receives by WhatsApp.
      // This function is for receipt DATA - names, addresses, categories typed
      // by devotees. Wording is a different input with a different owner.
      out[k] = k === 'label_overrides' ? x : escapeDeep(x)
    }
    return out as T
  }
  return v
}

/**
 * `escapeDeep` backwards, for the one design that escapes for itself.
 *
 * Anumodana is drawn by receiptDocument.ts, which escapes every value it
 * interpolates - it is vendored into devotee-api and cannot trust its caller.
 * Handing it this file's already-escaped payload escaped everything twice, so a
 * donor named D'Souza printed as `D&#39;Souza` and "Jain Mandir & Trust" as
 * `Jain Mandir &amp; Trust` - on the design a donor receives by WhatsApp.
 * The five entities escapeDeep writes are reversed here, and only those, in
 * the opposite order; receiptDocument then escapes each value exactly once.
 */
function unescapeHtml(v: string): string {
  return v
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function unescapeDeep<T>(v: T): T {
  if (typeof v === 'string') return unescapeHtml(v) as unknown as T
  if (Array.isArray(v)) return v.map(unescapeDeep) as unknown as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = k === 'label_overrides' ? x : unescapeDeep(x)
    }
    return out as T
  }
  return v
}

/**
 * The affirmative palette, derived from the trust's own colour.
 *
 * "80G ELIGIBLE" used to print in a fixed leaf green (#15803d on #dcfce7) in
 * five designs and in the WhatsApp PDF, whatever colour the trust had chosen:
 * a bright green pill on a near-black receipt, which is what the client saw and
 * called wrong. Green-for-yes is a good convention on a web page and a bad one
 * on stationery.
 *
 * Alpha is appended as hex (#RRGGBBAA), which Chromium honours in print and
 * which several designs already used for tints. A colour that is not 6-digit
 * hex degrades to a neutral rather than emitting #zzzz14 and taking the whole
 * declaration down with it - `primary_color` comes from an <input type=color>
 * today, but it is a free-text column and outlives the screen that wrote it.
 */
const HEX6 = /^#[0-9a-fA-F]{6}$/

function tint(color: string, alphaHex: string, fallback: string): string {
  return HEX6.test(color) ? color + alphaHex : fallback
}

function affirm(color: string): { bg: string; border: string; text: string } {
  return {
    bg: tint(color, '12', '#f6f7f9'),
    border: tint(color, '44', '#d1d5db'),
    text: HEX6.test(color) ? color : '#374151',
  }
}

/**
 * The negative of an affirmative note. Deliberately grey and not red: a
 * donation that is not 80G-eligible is the normal case, not an error, and
 * printing it in alarm red on the donor's copy reads as a rejection.
 */
const DENY_TEXT = '#6b7280'

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

/**
 * WHO the trust is: PAN, the registrar's registration number, the NGO-Darpan
 * ID. Never gated on anything.
 *
 * These are identity, not a claim. `show_80g` is a switch for whether the
 * trust's TAX-EXEMPTION details appear, and it used to sit at the top of
 * regBlock as an early return — so a trust that turned 80G display off lost
 * its PAN from every receipt too, and would have lost its registration number
 * the same way. Splitting them is the point: a document always says who
 * issued it, and separately may or may not make an 80G claim.
 */
function identityParts(mandir: NonNullable<ReceiptData['mandir']>): string[] {
  return identityPairs(mandir).map(([k, v]) => `${k}: <b>${v}</b>`)
}

/**
 * The same, as label/value pairs.
 *
 * regBlock needs the two apart to set the label quiet and the value firm. They
 * used to arrive as one pre-formatted string with the value already wrapped in
 * <b>, which left label and number at the same weight - a row of seven of those
 * is the wall of text the client saw.
 *
 * identityParts keeps the joined form for the designs that lay out their own
 * header line and expect a string.
 */
function identityPairs(mandir: NonNullable<ReceiptData['mandir']>): Array<[string, string]> {
  const parts: Array<[string, string]> = []
  if (mandir.pan) parts.push(['PAN', mandir.pan])
  if (mandir.registration_number) parts.push([L.registrationNo, mandir.registration_number])
  if (mandir.darpan_number) parts.push([L.darpanNo, mandir.darpan_number])
  return parts
}

/** The same, as one plain line — for designs that lay out their own header. */
function identityLine(mandir: ReceiptData['mandir'], sep = ' &nbsp;|&nbsp; '): string {
  if (!mandir) return ''
  return identityParts(mandir).join(sep)
}

function regBlock(mandir: ReceiptData['mandir'], r?: ReceiptData): string {
  if (!mandir) return ''
  // A room or hall bill is not a donation: printing the trust's 80G and 12AB
  // numbers on it reads as a tax-exemption claim for money that buys a service.
  const donation = !r || isDonationDoc(r)
  // IDENTITY FIRST, THEN THE CLAIM. CGST Rule 46 groups the supplier's name,
  // address and GSTIN at the head of an invoice; 80G guidance groups the
  // trust's name, address, registration number and PAN the same way. An
  // exemption number is not identity - it is an assertion about the money - so
  // it follows, and on a room bill it is absent entirely.
  const parts: Array<[string, string]> = []
  parts.push(...identityPairs(mandir))
  // GSTIN used to be pasted onto the end of the address paragraph in eight
  // designs, which made the most consequential identifier on a taxable supply
  // a fragment of prose while lesser numbers had a structured block.
  if (mandir.show_gstin && mandir.gstin) parts.push(['GSTIN', mandir.gstin])
  if (mandir.show_80g && donation && mandir.reg_80g_number) parts.push(['80G', mandir.reg_80g_number])
  if (mandir.show_80g && donation && mandir.reg_12a_number) parts.push(['12A', mandir.reg_12a_number])
  if (mandir.show_80g && donation && mandir.reg_12ab_number) parts.push(['12AB', mandir.reg_12ab_number])
  if (!parts.length) return ''

  // ── CHIPS, NOT A RUN OF PIPES ─────────────────────────────────────────────
  // These were joined with ` | ` into one paragraph. Six numbers at 10.5px wrap
  // to two or three lines and the break lands wherever it lands - so a line can
  // begin with a separator, and a number can be split from its own label. That
  // is the "nothing should look scattered" this design work started from.
  //
  // A chip is a bounded unit: it cannot split, the wrap leaves no orphan
  // separator, and the height is the same two lines a column layout would have
  // cost four to six of. The Anumodana sheet has drawn them this way from the
  // start, so this is the other twelve agreeing with it rather than a new idea.
  //
  // Inline-styled for the same reason `remittanceBlock` is: it drops into
  // thirteen different stylesheets without each of them growing a copy.
  //
  // ── PLAIN TYPE, NOT CHIPS ─────────────────────────────────────────────────
  // These were bordered pills and the client's verdict was "it is in the boxes
  // look too ugly and different from the template structure ui in teh all
  // receipts". Correct: an outlined chip belongs to none of these designs. Each
  // has its own type system - rules, small caps, a tinted band - so the same
  // chip bolted into thirteen of them looks bolted on in all thirteen.
  //
  // A letterhead sets identity numbers as TYPE: a quiet label, a firm value,
  // and space between. No border, no background, no radius.
  //
  // The chips were introduced to stop a wrapped line beginning with an orphan
  // "|". No separator character at all is the better answer - the space is
  // margin, so a wrap has nothing to orphan - and each item stays nowrap so a
  // number never splits from its own label.
  //
  // Inline-block rather than flex so the strip inherits text-align from
  // whatever it sits in: centred designs centre it, left-aligned ones do not,
  // with no per-design override to forget on the next design.
  const chips = parts
    .map(([k, v]) => `<span style="display:inline-block;margin:0 13px 1px 0;white-space:nowrap"><span style="opacity:.6">${k}</span> <b style="font-weight:600">${v}</b></span>`)
    .join('')
  return `<div class="reg-block">${chips}</div>`
}

/**
 * How a devotee can pay this trust: UPI, the bank account, and the QR.
 *
 * ── WHY THIS IS ONE FUNCTION ────────────────────────────────────────────────
 * It was five. `paymentBlock()` served seven designs; Temple, Tabular and Jain
 * Tirth each wrote their own; Anumodana has a sixth in receiptDocument.ts; and
 * Acknowledgement printed no bank details at all, on any trust. Three of the
 * five were broken, in the way hand-written string concatenation always breaks
 * — on the fields a trust does NOT have:
 *
 *   - Tabular printed `IFSC: <b>null</b> — null` for a trust with an account
 *     number but no IFSC, and opened with a dangling ` | ` when there was no
 *     UPI id, because the separator was unconditional.
 *   - Temple interpolated `bank_ifsc` raw into the same shape.
 *   - Jain Tirth printed placeholder dashes — `Bank: —`, `IFS Code: —`.
 *   - `paymentBlock` gated the WHOLE bank line on `bank_account_no`, so a
 *     trust with a bank name and an IFSC but no account number printed
 *     nothing at all.
 *
 * So the rule here is absolute: a field that is missing contributes NO row, no
 * label, no separator and no placeholder. A trust with everything gets a
 * two-column panel with its QR; a trust with only a UPI id gets one line; a
 * trust with neither gets nothing, and nothing below it shifts.
 */
function remittanceRows(mandir: NonNullable<ReceiptData['mandir']>): Array<[string, string]> {
  // Fixed order — how a passbook reads, and how someone typing a transfer into
  // their banking app expects to find the fields.
  const rows: Array<[string, string]> = []
  if (mandir.upi_id) rows.push([L.upiId, mandir.upi_id])
  if (mandir.bank_account_name) rows.push([L.accountName, mandir.bank_account_name])
  if (mandir.bank_account_no) rows.push([L.accountNo, mandir.bank_account_no])
  if (mandir.bank_ifsc) rows.push([L.ifsc, mandir.bank_ifsc])
  if (mandir.bank_name) rows.push([L.bankLabel, mandir.bank_name])
  return rows
}

/**
 * The QR, and what it is FOR.
 *
 * Two intents were conflated. `upiQrBlock` suppressed the QR on any document
 * with a payment recorded, which is right for a "scan to pay" prompt — a
 * settled receipt must not invite a second payment for the same thing — but it
 * meant the trust's UPI QR never appeared on a receipt at all, which is what
 * the trust turned the setting on for. Same image, different caption, and the
 * caption is the whole difference.
 */
function qrCaption(r: ReceiptData): string {
  const settled = (r.payments?.length ?? 0) > 0 || !!r.payment_mode
  return settled ? L.scanToDonate : L.scanToPay
}

/**
 * A stay: which room, who for, and the arrival and departure INSTANTS.
 *
 * `room_bookings` has held `check_in_time` and `check_out_time` since the
 * schema was written and no document ever showed either — `roomReceipt()` put
 * the two DATES in `meta` and left the times behind. A guest arriving at
 * 2:30 pm and leaving at 10 am got a bill that said only "19 Sep to 21 Sep",
 * which settles no argument about a late checkout.
 *
 * Reads the planned times when the booking has not happened yet and the actual
 * ones once it has, because a confirmation and a bill are answering different
 * questions: "when may I arrive" and "when did you leave".
 */
function stayBlock(r: ReceiptData, color: string, opts: { compact?: boolean } = {}): string {
  const meta = (r.meta ?? {}) as Record<string, unknown>
  const rows: Array<[string, string]> = []

  const inAt = meta.checked_in_at ?? meta.planned_check_in_at
  const outAt = meta.checked_out_at ?? meta.planned_check_out_at
  // A date with a time reads as one field; a bare date still reads correctly,
  // which is what every pre-existing booking has.
  const inStr = fmtDateTime(inAt) || fmtDay(meta.check_in_date)
  const outStr = fmtDateTime(outAt) || fmtDay(meta.check_out_date)
  if (inStr) rows.push([L.checkIn, inStr])
  if (outStr) rows.push([L.checkOut, outStr])
  // Room and nights are deliberately NOT repeated here. A stay bill already
  // names the room twice — in `category` ("Dharamshala — Room 101") and in the
  // itemised line — and the nights in that line's quantity ("2 nights ×
  // ₹1,500"). Printing them a third time is what pushed six designs off an A4
  // page when this block was added; the arrival and departure instants are the
  // information that was genuinely missing.
  if (Number(meta.persons) > 0) rows.push([L.persons, String(meta.persons)])
  // Only the last four digits are recoverable — the rest is encrypted at rest
  // (tenant migration 033) and must never be printed even if it were.
  if (meta.guest_id_last4) {
    rows.push([L.guestIdLabel, `${meta.guest_id_type ? `${meta.guest_id_type} ` : ''}•••• ${meta.guest_id_last4}`])
  }
  if (!rows.length) return ''

  const size = opts.compact ? '9px' : '9.5px'
  const cells = rows
    .map(([k, v]) => `<div style="display:flex;gap:5px;min-width:0"><span style="color:#5b6472;flex:none">${k}</span><b style="color:#111827">${v}</b></div>`)
    .join('')
  const rules = mandirHouseRules(r) + remarksLine(r)
  return `<div class="stay" style="flex:1;margin-top:9px;border:1px solid ${color}22;border-left:2px solid ${color};border-radius:3px;padding:${opts.compact ? '5px 8px' : '7px 10px'};background:${color}05">
    <div style="font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:${color};font-weight:700;margin-bottom:3px">${L.stayDetails}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:1px 12px;font-size:${size};line-height:1.4">${cells}</div>
    ${rules}
  </div>`
}

/**
 * The trust's house rules, when this document is one that should carry them.
 *
 * The API decides: `house_rules` is populated only for an accommodation
 * document, so a design does not have to know what it is drawing.
 */
/** The counter's remarks on a booking ("late arrival, ground floor"). */
function remarksLine(r: ReceiptData): string {
  const text = (r.meta as Record<string, unknown> | null | undefined)?.remarks
  if (typeof text !== 'string' || !text.trim()) return ''
  return `<div style="margin-top:4px;font-size:8.5px;line-height:1.35;color:#374151"><b>${L.remarks}:</b> ${text}</div>`
}

/**
 * The money AFTER the total on a bill — advance, paid, refunded, still due —
 * for the designs whose itemised table ends at the total. The stay designs
 * print `stayMoneyRows` in their own panel and pass `total: false`, so this is
 * never printed twice.
 */
function moneyAfterTotal(r: ReceiptData): Array<[string, string, boolean]> {
  if (isDonationDoc(r)) return []
  return stayMoneyRows(r).filter(([label]) => label !== L.total)
}

function mandirHouseRules(r: ReceiptData): string {
  const text = r.mandir?.house_rules
  if (!text) return ''
  return `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed #d1d5db;font-size:8px;line-height:1.35;color:#6b7280"><b>${L.houseRules}:</b> ${text}</div>`
}

/**
 * The one slot every design reserves below its money section: what the stay
 * was, WHEN this was paid, then HOW to pay the trust.
 *
 * Kept as a single call so a design has one insertion point rather than three
 * to keep in the right order. Each part independently renders nothing when
 * there is nothing to say, so a cash donation from a trust with no bank
 * details adds no empty boxes and shifts nothing below it.
 */
/**
 * The panels under an itemised bill: the stay window, and how to pay.
 *
 * `stay: false` for a design that ALREADY prints the stay details in its own
 * header. Four do - folio, stay_invoice, room_gst and stay_slip - and they were
 * printing check-in, check-out, persons and the guest ID twice, under a second
 * heading reading STAY DETAILS. It is plainly visible in the client's room
 * receipt and it is what "many receipts struture is not got analyze" meant.
 *
 * The duplication was invisible to review because the two blocks are built by
 * different functions from the same `meta`: `stayFacts` for a header grid,
 * `stayBlock` for this footer, each written as though it were the only one.
 */
function paymentFooter(
  r: ReceiptData,
  color: string,
  opts: { compact?: boolean; stay?: boolean } = {},
): string {
  const stay = opts.stay === false ? '' : stayBlock(r, color, opts)
  const remit = remittanceBlock(r, color, opts)
  // Side by side when both exist, because stacking two bordered panels under an
  // itemised bill cost ~45px and pushed the tall designs onto a second sheet.
  // `flex-wrap` puts them back in a column on paper too narrow to share a row.
  const panels = stay && remit
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:stretch">
      <div style="flex:1 1 46%;min-width:180px;display:flex">${stay}</div>
      <div style="flex:1 1 46%;min-width:180px;display:flex">${remit}</div>
    </div>`
    : `${stay}${remit}`
  return `${paymentWhenBlock(r, opts)}${panels}`
}

function remittanceBlock(
  r: ReceiptData,
  color: string,
  opts: { compact?: boolean } = {},
): string {
  const mandir = r.mandir
  if (!mandir) return ''
  const rows = remittanceRows(mandir)
  const qr = r.upi_qr_data_uri || ''
  if (!rows.length && !qr) return ''

  // Tight by default. This is a footer detail — where to send a transfer — not
  // a headline, and it has to fit under an itemised bill on the three most
  // decorative designs without pushing them onto a second sheet.
  const pad = opts.compact ? '5px 8px' : '7px 10px'
  const size = opts.compact ? '9px' : '9.5px'
  // The label column has a WIDTH, which is the whole of the structure.
  //
  // Without it each value started wherever its own label ended, so the five
  // fields sat at four or five different left edges and the block read as a
  // flowed run rather than a table - measured across all thirteen designs, and
  // twelve of them did it. The labels are five known short strings and the
  // widest is about 52px at this size; giving them all that width starts every
  // value at the same offset, and since the cells are equal-width grid tracks
  // the values line up across the columns as well.
  //
  // Deliberately NOT an explicit multi-column grid of label/value pairs, which
  // is the obvious way to align a table: five fields at two pairs per row is
  // three rows where the auto-fit below gives two, and the page-fit harness has
  // already caught one payment-block change pushing a design onto a second sheet
  // today. Alignment is not worth a page.
  const labelW = opts.compact ? '46px' : '52px'
  const cells = rows
    .map(([k, v]) => `<div style="display:flex;gap:5px;min-width:0"><span style="color:#5b6472;flex:none;min-width:${labelW}">${k}</span><b style="color:#111827;word-break:break-all;min-width:0">${v}</b></div>`)
    .join('')

  // Two columns only when there is a QR AND rows to sit beside it. A QR alone
  // centres; rows alone fill the width. No empty grid cell in any case.
  const details = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:1px 12px;font-size:${size};line-height:1.4;min-width:0">${cells}</div>`
  const qrSize = opts.compact ? 54 : 64
  const qrPanel = qr
    ? `<div style="flex:none;text-align:center">
      <img src="${qr}" alt="" style="width:${qrSize}px;height:${qrSize}px;display:block" />
      <div style="font-size:8.5px;color:#5b6472;margin-top:2px;max-width:${qrSize}px;line-height:1.2">${qrCaption(r)}</div>
    </div>`
    : ''

  return `<div class="remittance" style="flex:1;margin-top:9px;border:1px solid ${color}22;border-left:2px solid ${color};border-radius:3px;padding:${pad};background:${color}05">
    <div style="font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:${color};font-weight:700;margin-bottom:${rows.length ? 3 : 0}px">${L.paymentDetails}</div>
    <div style="display:flex;gap:12px;align-items:${qr && rows.length ? 'center' : 'flex-start'};justify-content:${rows.length ? 'space-between' : 'center'}">
      ${rows.length ? details : ''}${qrPanel}
    </div>
  </div>`
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
    .badge-green { background:${affirm(color).bg}; color:${affirm(color).text}; }
    .badge-red { background:#f6f7f9; color:${DENY_TEXT}; }
    .reg-block { font-size:9.5px; line-height:1.6; margin:4px 0 0; padding:0 32px; }  /* this design pads .header and .body, not .page, so the strip needs its own 32px or it prints against the sheet edge */
    .payment-block { font-size:10.5px; color:#374151; padding-top:8px; line-height:1.9; }
    .pay-label { font-weight:700; color:${color}; }
    .footer-note { font-size:11px; color:#6b7280; margin-top:16px; padding-top:12px; border-top:1px solid #e2e8f0; text-align:center; font-style:italic; }
    @media print { body{background:#fff;} .page{box-shadow:none;margin:0;border-radius:0;} }
  </style>
  <div class="page">
    <div class="header">
      ${logoTag(mandir)}
      <div class="header-text">
        <h1>${mandir.name}</h1>
        <p>${mandir.address}${mandir.mobile ? '<br>'+mandir.mobile : ''}</p>
      </div>
      <div class="receipt-badge">
        <div class="label">${docTitle(r, L.donationReceipt)}</div>
        <div class="rno">${r.receipt_number}</div>
        <div class="date">${dateStr}</div>
      </div>
    </div>
    ${regBlock(mandir, r)}
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
        ${show80gLine(r, mandir) ? `<tr><td>${L.eligible80g}</td><td><span class="${r.is_80g_eligible ? 'badge badge-green' : 'badge badge-red'}">${r.is_80g_eligible ? L.yes : L.no}</span></td></tr>` : ''}
      </table>
      ${itemsBlock(r, color)}
      ${paymentFooter(r, color)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
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
    .reg-block { font-size:9.5px; line-height:1.6; margin:4px 0 0; }
    .payment-block { font-size:10px; color:#6b7280; line-height:2; }
    .pay-label { color:${color}; font-weight:700; }
    .footer-note { font-size:11px; color:#6b7280; text-align:center; margin-top:24px; font-style:italic; }
    @media print { .page{border:none;margin:0;padding:28px;} }
  </style>
  <div class="page">
    <div class="top">
      <div class="mandir-info">
        ${logoTag(mandir)}
        <h1>${mandir.name}</h1>
        <p>${mandir.address}</p>
      </div>
      <div class="rhs">
        <div class="rtitle">${docTitle(r, L.donationReceipt)}</div>
        <div class="rno">${r.receipt_number}</div>
        <div class="rdate">${dateStr}</div>
      </div>
    </div>
    ${regBlock(mandir, r)}
    ${voidedBanner(r.is_voided)}
    <div class="field"><span class="k">${L.receivedFrom}</span><span class="v">${r.donor?.name || L.anonymous}${r.donor?.mobile ? '<br><span style="font-weight:400;font-size:11px;color:#6b7280">'+r.donor.mobile+'</span>' : ''}</span></div>
    ${donorPan(r) ? `<div class="field"><span class="k">${L.donorPan}</span><span class="v">${donorPan(r)}</span></div>` : ''}
    <div class="field"><span class="k">${L.category}</span><span class="v">${r.category || '—'}</span></div>
    <div class="field"><span class="k">${L.paymentMode}</span><span class="v">${paymentModeText(r)}</span></div>
    ${show80gLine(r, mandir) ? `<div class="field"><span class="k">${L.eligible80g}</span><span class="v">${r.is_80g_eligible ? '✓ Yes' : '✗ No'}</span></div>` : ''}
    <div class="field amount-row"><span class="k">${L.amount}</span><span class="v">₹ ${fmtRs(r.amount_paise)}</span></div>
    <div class="words">${amountInWords(r.amount_paise)}</div>
    ${itemsBlock(r, color)}
    ${paymentFooter(r, color)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
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
    .receipt-id .dt { font-size:11px; color:#64748b; margin-top:2px; }
    ${voidedBanner(r.is_voided) ? '.voided{background:#fef2f2;border-left:4px solid #ef4444;color:#b91c1c;padding:10px 16px;font-weight:700;font-size:12px;margin:16px 36px;}' : ''}
    .body { padding:24px 36px 32px; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
    .info-card { background:#f8fafc; border-radius:8px; padding:14px 16px; }
    .info-card .label { font-size:10px; color:#64748b; font-weight:700; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
    .info-card .value { font-size:14px; font-weight:700; color:#0f172a; }
    .info-card .sub { font-size:11px; color:#64748b; margin-top:2px; }
    .amount-hero { background:linear-gradient(135deg,${color},${color}cc); border-radius:10px; padding:20px 24px; color:#fff; display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
    .amount-hero .lbl { font-size:11px; opacity:.8; font-weight:600; letter-spacing:.5px; }
    .amount-hero .amt { font-size:32px; font-weight:900; font-family:monospace; }
    .amount-hero .words { font-size:10.5px; opacity:.8; margin-top:4px; font-style:italic; }
    .details { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px; }
    .detail-item .k { font-size:10px; color:#64748b; font-weight:700; letter-spacing:.5px; text-transform:uppercase; margin-bottom:2px; }
    .detail-item .v { font-size:13px; font-weight:600; color:#0f172a; }
    .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; }
    .badge-yes { background:${affirm(color).bg}; color:${affirm(color).text}; }
    .badge-no { background:#f6f7f9; color:${DENY_TEXT}; }
    .reg-block { font-size:9.5px; line-height:1.6; margin:4px 0 0; padding:0 36px; }  /* this design pads .header and .body, not .page, so the strip needs its own 36px or it prints against the sheet edge */
    .payment-block { font-size:10.5px; color:#475569; background:#f8fafc; border-radius:6px; padding:10px 14px; margin-bottom:12px; line-height:2; }
    .pay-label { color:${color}; font-weight:700; }
    .footer-note { font-size:11px; color:#64748b; text-align:center; font-style:italic; padding-top:16px; border-top:1px solid #f1f5f9; margin-top:8px; }
    @media print { body{background:#fff;} .page{box-shadow:none;border-radius:0;margin:0;} }
  </style>
  <div class="page">
    <div class="stripe"></div>
    <div class="header">
      ${logoTag(mandir)}
      <div class="mandir-info">
        <h1>${mandir.name}</h1>
        <p>${mandir.address}</p>
      </div>
      <div class="receipt-id">
        <div class="tag">${docTitle(r, L.donationReceipt).toUpperCase()}</div>
        <div class="num">${r.receipt_number}</div>
        <div class="dt">${dateStr}</div>
      </div>
    </div>
    ${regBlock(mandir, r)}
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
        ${show80gLine(r, mandir) ? `<div class="detail-item"><div class="k">${L.eligible80g}</div><div class="v"><span class="${r.is_80g_eligible ? 'badge badge-yes' : 'badge badge-no'}">${r.is_80g_eligible ? L.yes + ' ✓' : L.no}</span></div></div>` : ''}
      </div>
      ${itemsBlock(r, color)}
      ${paymentFooter(r, color)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
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
    .header { padding:13px 32px; text-align:center; border-bottom:2px solid #f59e0b; background:linear-gradient(180deg,#fef3c7,#fffef9); }
    .aum { font-size:28px; color:#a16207; margin-bottom:2px; }
    .logo { height:56px; width:auto; object-fit:contain; margin-bottom:8px; }
    .mandir-name { font-size:22px; font-weight:700; color:#92400e; letter-spacing:.5px; }
    .mandir-address { font-size:11px; color:#78350f; margin-top:3px; line-height:1.7; }
    .receipt-title { font-size:13px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#a16207; margin-top:10px; border-top:1px dashed #f59e0b; padding-top:8px; }
    .meta { display:flex; justify-content:space-between; padding:9px 32px; background:#fef9ee; border-bottom:1px solid #fde68a; font-size:12px; color:#78350f; font-weight:600; }
    ${voidedBanner(r.is_voided) ? '.voided{background:#fee2e2;border:2px solid #f87171;color:#991b1b;padding:8px;text-align:center;font-weight:700;font-size:13px;margin:12px 32px;}' : ''}
    .body { padding:12px 32px 14px; }
    .received { font-size:12px; color:#78350f; margin-bottom:6px; font-style:italic; }
    .donor-name { font-size:20px; font-weight:700; color:#92400e; margin-bottom:2px; }
    .donor-mobile { font-size:12px; color:#a16207; margin-bottom:10px; }
    .divider { border:none; border-top:1px dashed #f59e0b; margin:9px 0; }
    table { width:100%; border-collapse:collapse; }
    td { padding:5px 12px; border-bottom:1px solid #fef3c7; font-size:13px; }
    td:first-child { color:#78350f; font-weight:600; width:38%; }
    td:last-child { color:#1c1917; font-weight:500; }
    .amount-td { font-size:22px; font-weight:800; color:#a16207; font-family:monospace; }
    .words-row td { font-size:10.5px; color:#a16207; font-style:italic; }
    /* line-height was 2 on both. With a trust that holds every registration
       these are three or four lines each, and double leading alone put this
       design over an A4 page (qa-receipt-pages.mjs, tallest-header case). */
    .reg-block { font-size:9.5px; line-height:1.6; margin:4px 0 0; padding:0 32px; }  /* this design pads .header and .body, not .page, so the strip needs its own 32px or it prints against the sheet edge */
    .payment-block { font-size:10.5px; color:#78350f; line-height:1.65; padding-top:6px; }
    .pay-label { color:#a16207; font-weight:700; }
    .footer-note { font-size:11px; color:#a16207; text-align:center; margin-top:10px; font-style:italic; }
    .bottom-border { height:8px; background:linear-gradient(90deg,#c97b22,#f59e0b,#c97b22); margin-top:12px; }
    @media print { body{background:#fff;} .page{border-color:#6b7280;box-shadow:none;margin:0;} }
  </style>
  <div class="page">
    <div class="top-border"></div>
    <div class="header">
      <div class="aum">🕉</div>
      ${logoTag(mandir)}
      <div class="mandir-name">${mandir.name}</div>
      <div class="mandir-address">${mandir.address}${mandir.mobile ? '<br>'+mandir.mobile : ''}</div>
      <div class="receipt-title">${docTitle(r, `${L.donationReceipt} / दान रसीद`)}</div>
    </div>
    ${regBlock(mandir, r)}
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
        ${show80gLine(r, mandir) ? `<tr><td>${L.eligible80g}</td><td>${r.is_80g_eligible ? '✓ Yes' : 'No'}</td></tr>` : ''}
        ${r.lines?.length ? '' : `<tr><td>${L.amount}</td><td class="amount-td">₹ ${fmtRs(r.amount_paise)}</td></tr>`}
        <tr class="words-row"><td></td><td>${amountInWords(r.amount_paise)}</td></tr>
      </table>
      ${itemsBlock(r, mandir.primary_color || '#0D1B2E')}
      ${paymentFooter(r, mandir.primary_color || '#0D1B2E')}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    </div>
    <div class="bottom-border"></div>
  </div>`
}

// ── TEMPLATE 5: Elegant (Premium) ───────────────────────────────────────────
function buildElegant(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  return `
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; background:#f5f5f5; }
    .page { max-width:700px; margin:24px auto; background:#fff; border-radius:2px; overflow:hidden; box-shadow:0 2px 20px rgba(0,0,0,.12); }
    .accent-bar { height:4px; background:${color}; }
    .header { display:grid; grid-template-columns:1fr auto; align-items:start; gap:24px; padding:22px 40px 16px; border-bottom:1px solid #e5e7eb; }
    .logo { height:52px; width:auto; object-fit:contain; display:block; margin-bottom:12px; }
    .mandir-name { font-size:20px; font-weight:700; color:#111; letter-spacing:-.2px; margin-bottom:4px; }
    .mandir-address { font-size:11px; color:#6b7280; line-height:1.55; }
    .receipt-meta { text-align:right; }
    .receipt-meta .rt { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:${color}; font-weight:700; margin-bottom:8px; }
    .receipt-meta .rn { font-size:18px; font-weight:700; font-family:'Courier New',monospace; color:#111; }
    .receipt-meta .rd { font-size:11px; color:#6b7280; margin-top:4px; }
    ${voidedBanner(r.is_voided) ? '.voided{border:1px solid #fca5a5;background:#fff5f5;color:#b91c1c;padding:10px 16px;font-weight:700;text-align:center;font-size:12px;margin:16px 40px;}' : ''}
    .body { padding:20px 40px 24px; }
    /* 24px between four sections, on the airiest design in the gallery, was
       most of what pushed an itemised bill onto a second A4 sheet. */
    .sec { margin-bottom:15px; }
    .sec-title { font-size:9px; letter-spacing:2px; text-transform:uppercase; color:${color}; font-weight:700; padding-bottom:4px; border-bottom:1px solid #f3f4f6; margin-bottom:8px; }
    .donor-name { font-size:20px; font-weight:700; color:#111; }
    .donor-sub { font-size:12px; color:#6b7280; margin-top:3px; }
    .amount-line { display:flex; align-items:baseline; gap:12px; margin:8px 0; }
    .amount-num { font-size:36px; font-weight:700; color:${color}; font-family:'Courier New',monospace; letter-spacing:-1px; }
    .amount-cur { font-size:20px; font-weight:700; color:${color}; }
    .amount-words { font-size:11px; color:#6b7280; font-style:italic; margin-top:2px; }
    .dl { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .dt { font-size:10px; color:#6b7280; font-weight:700; letter-spacing:.5px; text-transform:uppercase; margin-bottom:3px; }
    .dd { font-size:13px; color:#111; font-weight:600; }
    .elig-yes { color:${affirm(color).text}; } .elig-no { color:${DENY_TEXT}; }
    .reg-block { font-size:9.5px; line-height:1.6; margin:4px 0 0; padding:0 40px; }  /* this design pads .header and .body, not .page, so the strip needs its own 40px or it prints against the sheet edge */
    .pay-label { color:${color}; font-weight:700; }
    .footer-note { font-size:11px; color:#6b7280; text-align:center; margin-top:12px; font-style:italic; }
    .bottom { height:4px; background:${color}20; margin-top:16px; position:relative; }
    .bottom::before { content:''; position:absolute; left:0; top:0; height:100%; width:30%; background:${color}; }
    @media print { body{background:#fff;} .page{box-shadow:none;margin:0;} }
  </style>
  <div class="page">
    <div class="accent-bar"></div>
    <div class="header">
      <div>
        ${logoTag(mandir)}
        <div class="mandir-name">${mandir.name}</div>
        <div class="mandir-address">${mandir.address}${mandir.mobile ? '<br>'+mandir.mobile : ''}</div>
      </div>
      <div class="receipt-meta">
        <div class="rt">${docTitle(r, L.donationReceipt)}</div>
        <div class="rn">${r.receipt_number}</div>
        <div class="rd">${dateStr}</div>
      </div>
    </div>
    ${regBlock(mandir, r)}
    ${voidedBanner(r.is_voided)}
    <div class="body">
      <div class="sec">
        <div class="sec-title">${L.receivedFrom}</div>
        <div class="donor-name">${r.donor?.name || L.anonymous}</div>
        ${r.donor?.mobile ? `<div class="donor-sub">${r.donor.mobile}</div>` : ''}
        ${donorPan(r) ? `<div class="donor-sub">${L.pan}: ${donorPan(r)}</div>` : ''}
      </div>
      <div class="sec">
        <div class="sec-title">${r.lines?.length ? L.total : amountLabel(r)}</div>
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
          ${show80gLine(r, mandir) ? `<div><div class="dt">${L.eligible80g}</div><div class="dd ${r.is_80g_eligible ? 'elig-yes' : 'elig-no'}">${r.is_80g_eligible ? '✓ ' + L.yes : '✗ ' + L.no}</div></div>` : ''}
        </div>
      </div>
      ${itemsBlock(r, color)}
      ${paymentFooter(r, color)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    </div>
    <div class="bottom"></div>
  </div>`
}

// ── TEMPLATE 6: Temple (Shri Ram style — two-column, orange bar) ────────────
function buildTemple(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  // The registration numbers keep this footer alive for a trust that shows no
  // 80G at all — they identify the issuer and are not part of the 80G claim.
  const hasReg = (mandir.show_80g && (mandir.reg_80g_number || mandir.pan)) || (mandir.show_gstin && mandir.gstin)
    || !!mandir.pan || !!mandir.registration_number || !!mandir.darpan_number
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
    @media print { body{background:#fff;} .page{box-shadow:none;margin:0;border:none;} }
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
      ${isDonationDoc(r) && mandir.show_80g && mandir.reg_80g_number ? `<span>Income Tax Exemption (80-G) Number: <b>${mandir.reg_80g_number}</b></span>` : ''}
      ${mandir.pan ? `<span>PAN: <b>${mandir.pan}</b></span>` : ''}
      ${mandir.show_gstin && mandir.gstin ? `<span>GSTIN: <b>${mandir.gstin}</b></span>` : ''}
      ${mandir.registration_number ? `<span>${L.registrationNo}: <b>${mandir.registration_number}</b></span>` : ''}
      ${mandir.darpan_number ? `<span>${L.darpanNo}: <b>${mandir.darpan_number}</b></span>` : ''}
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
        ${paymentFooter(r, color, { compact: true })}
      </div>
      <div class="col-right">
        <div class="sec-hdr">${docTitle(r, L.donationReceipt)}:</div>
        <div class="field"><div class="k">${L.donorName}</div><div class="v">${r.donor?.name || '—'}</div></div>
        <div style="margin:10px 0 6px"><div class="sec-hdr" style="margin:-4px -20px 10px">${L.purposeOfDonation}:</div>
          <div class="v">${r.category || L.generalDonation}</div>
        </div>
        ${/* This design printed paymentModeText TWICE — once under a
              hardcoded-English "Payment details:" header and again under the
              localised "Mode of Payment:" one, so every Temple receipt read
              "PAYMENT DETAILS: Cash / MODE OF PAYMENT: Cash". Visible in the
              client's screenshots. The trust's own bank details, which is what
              "payment details" should have meant, were in a separate box
              below. */''}
        <div style="margin-top:10px"><div class="sec-hdr" style="margin:-4px -20px 10px">${L.modeOfPayment}:</div>
          <div class="v">${paymentModeText(r)}</div>
        </div>
        ${r.is_80g_eligible && trustGrants80g(mandir) ? `<div style="margin-top:10px;padding:6px 10px;background:#fef3c7;border:1px solid #fde68a;border-radius:3px;font-size:10px;color:#92400e"><b>${L.eligible80g}</b> — Tax exemption certificate available</div>` : ''}
      </div>
    </div>
    ${/* Every head of a multi-head donation, every extra on a bill (tenant
          migration 057): the two columns above name the purpose once, this
          says what each part was. */''}
    ${r.lines?.length ? `<div style="padding:0 20px">${itemsBlock(r, color)}</div>` : ''}
    ${mandir.footer ? `<div class="notes-section"><div style="font-size:10px;font-weight:700;margin-bottom:6px">Please Note:</div><ul><li>${mandir.footer}</li></ul></div>` : ''}
    <div class="footer-row">
      <div style="font-size:11px;color:#374151;max-width:300px;font-style:italic">${r.is_80g_eligible && trustGrants80g(mandir) ? L.valid80g : L.thankYou}</div>
      <div class="sig-block">
        <div class="for">For ${mandir.name}</div>
        <div class="auth">${L.authorisedSignatory}</div>
      </div>
    </div>
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
    table.main tr.total-row td { font-weight:900; border-top:2px solid #333; font-size:15px; }
    /* Right-aligned, because the description column is wide: measured, the
       word "Total" sat 441px from the figure it labels - the far left of
       the page from its own number. Every invoicing product puts the label
       immediately beside the total. */
    table.main tr.total-row td:first-child { text-align:right; }
    table.main tr.total-row td.amount-td { color:${color}; }
    .footer-section { padding:10px 14px; border-top:1px solid #ccc; background:#fafafa; font-size:10.5px; color:#374151; line-height:1.8; }
    .sig-row { display:flex; justify-content:space-between; align-items:flex-end; padding:10px 14px 14px; }
    .sig-block { text-align:center; }
    .sig-block .sig-line { width:120px; border-top:1px solid #333; margin:0 auto 3px; }
    .sig-block .sig-label { font-size:10px; color:#555; }
    @media print { body{background:#fff;} .page{margin:0;border:2px solid #333;} }
  </style>
  <div class="page">
    <div class="header">
      ${mandir.show_logo ? logoTag(mandir) : ''}
      <h1>${mandir.name}</h1>
      ${(() => {
        const bits = [
          isDonationDoc(r) && mandir.show_80g && mandir.reg_80g_number ? 'FTR No / 80G: ' + mandir.reg_80g_number : '',
          identityLine(mandir),
        ].filter(Boolean)
        return bits.length ? `<div class="ftr-no">${bits.join(' &nbsp;|&nbsp; ')}</div>` : ''
      })()}
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
      <div>${L.mode}: <b>${paymentModeText(r)}</b>${show80gLine(r, mandir) ? ` &nbsp;|&nbsp; 80G: <b>${r.is_80g_eligible ? L.yes : L.no}</b>` : ''}</div>
    </div>
    <table class="main">
      <thead><tr><th>${L.description}</th><th>${L.amount}</th></tr></thead>
      <tbody>
        <tr><td>${r.category || L.generalDonation}</td><td class="amount-td">₹ ${fmtRs(r.amount_paise)}</td></tr>
        <tr><td style="font-size:10px;color:#6b7280;font-style:italic">${amountInWords(r.amount_paise)}</td><td></td></tr>
      </tbody>
      <tfoot><tr class="total-row"><td><b>Total</b></td><td class="amount-td">₹ ${fmtRs(r.amount_paise)}</td></tr></tfoot>
    </table>
    <!-- total: false - the tfoot above already carries it, and itemsBlock
         printing another put "Total" twice on every room bill. -->
    ${itemsBlock(r, color, { total: false })}
    <div class="footer-section" style="padding-top:0;border:0">${paymentFooter(r, color, { compact: true })}</div>
    ${mandir.footer ? `<div class="footer-section" style="border-top:1px solid #ccc">${mandir.footer}</div>` : ''}
    <div class="sig-row">
      <div style="font-size:11px;color:#555">This is a computer-generated receipt.</div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">${L.authorisedSignatory}</div>
        <div style="font-size:10px;font-weight:700;color:#111;margin-top:2px">${mandir.name}</div>
      </div>
    </div>
  </div>`
}

// ── TEMPLATE 8: Acknowledgement (Tirumala / Formal letter style) ─────────────
function buildAcknowledgement(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  // Identity with the GSTIN: this design has no reg block, so a room bill
  // printed on it named no GSTIN at all.
  const identity = [identityLine(mandir), mandir.show_gstin && mandir.gstin ? `GSTIN ${mandir.gstin}` : ''].filter(Boolean).join(' &nbsp;|&nbsp; ')
  return `
  <style>
    /* line-height 1.7 over ~25 lines of body copy was most of this design's
       height; 1.55 is still generous for a serif document and is what brings
       the tallest-header room bill back onto one A4 page. */
    body { font-family: 'Times New Roman', Times, serif; background:#fff; font-size:13px; line-height:1.42; }
    .page { max-width:700px; margin:20px auto; background:#fff; border:2px double #333; padding:0; }
    .header { text-align:center; padding:12px 28px 9px; border-bottom:3px double #333; }
    .logo { height:60px; object-fit:contain; margin-bottom:6px; }
    .header h1 { font-size:20px; font-weight:900; text-transform:uppercase; letter-spacing:1px; color:#111; }
    .header h2 { font-size:13px; font-weight:700; color:#444; margin-top:2px; letter-spacing:.5px; }
    .header .addr { font-size:11px; color:#555; margin-top:4px; }
    .txn-row { display:flex; justify-content:space-between; padding:6px 28px; background:#f8f8f8; border-bottom:1px solid #ccc; font-size:11px; }
    .txn-row .lbl { color:#555; }
    .txn-row .val { font-weight:700; color:#111; }
    ${r.is_voided ? '.voided{text-align:center;font-weight:700;color:#b91c1c;padding:8px;border-bottom:2px solid #ccc;font-size:13px;}' : ''}
    .ack-title { text-align:center; font-size:15px; font-weight:900; letter-spacing:2px; text-transform:uppercase; padding:9px 28px; border-bottom:1px solid #ccc; background:${color}08; }
    .body { padding:12px 28px; }
    .recvd-para { margin-bottom:9px; }
    .recvd-para .amount-highlight { font-size:16px; font-weight:900; color:${color}; }
    table.details { width:100%; border-collapse:collapse; margin:12px 0; }
    table.details th { background:#333; color:#fff; font-size:11px; padding:6px 14px; text-align:left; }
    table.details td { padding:6px 12px; border:1px solid #ccc; font-size:12px; }
    table.details td.amt-col { font-weight:700; text-align:right; font-family:monospace; font-size:14px; }
    .certified { font-size:11px; color:#374151; background:#f9fafb; border:1px solid #e5e7eb; border-radius:3px; padding:7px 12px; margin:8px 0; line-height:1.45; }
    .contribution-line { font-style:italic; text-align:center; font-size:12px; color:#444; margin:8px 0; border-top:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb; padding:6px; }
    .address-block { margin-top:10px; }
    .address-block .to { font-size:11px; color:#555; margin-bottom:4px; }
    .address-block .donor-name { font-size:14px; font-weight:700; }
    .address-block .donor-addr { font-size:12px; color:#374151; margin-top:4px; line-height:1.55; }
    .sig-section { display:flex; justify-content:space-between; align-items:flex-end; margin-top:12px; padding-top:9px; border-top:1px solid #ccc; }
    .sig-left { font-size:11px; color:#555; }
    .sig-right { text-align:right; }
    .sig-right .role { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-top:12px; border-top:1px solid #333; padding-top:4px; }
    .sig-right .org { font-size:12px; font-weight:700; color:#111; }
    .footer-note { font-size:10px; color:#6b7280; text-align:center; padding:6px 28px 9px; border-top:1px solid #ccc; font-style:italic; }
    @media print { body{background:#fff;} .page{margin:0;} }
  </style>
  <div class="page">
    <div class="header">
      ${mandir.show_logo ? logoTag(mandir) : ''}
      <h1>${mandir.name}</h1>
      ${(isDonationDoc(r) && mandir.show_80g && mandir.reg_80g_number) ? `<h2>${mandir.reg_80g_number}</h2>` : ''}
      <div class="addr">${mandir.address}${mandir.mobile ? '<br>Phone: '+mandir.mobile : ''}${mandir.email ? '<br>Email: '+mandir.email : ''}</div>
    </div>
    <div class="txn-row">
      <span><span class="lbl">${L.transactionId}: </span><span class="val">${r.receipt_number}</span></span>
      <span><span class="lbl">${L.status}: </span><span class="val" style="color:${color}">${L.received}</span></span>
    </div>
    ${r.is_voided ? '<div class="voided">⚠ THIS RECEIPT HAS BEEN VOIDED</div>' : ''}
    <div class="ack-title">${docTitle(r, 'Acknowledgement Receipt')}</div>
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
      ${r.is_80g_eligible && trustGrants80g(mandir) ? `<div class="certified">Certified that this donation is eligible for deduction U/S 80 G (5) (vi) of the Income Tax Act. ${mandir.reg_80g_number ? 'Reg No: <b>'+mandir.reg_80g_number+'</b>.' : ''} ${mandir.pan ? 'PAN: <b>'+mandir.pan+'</b>.' : ''}</div>` : ''}
      <div class="contribution-line">Your contribution towards "<b>${mandir.name}</b>" is one of the best charities.</div>
      ${/* This design showed the trust's bank details and QR on NO trust at all
            — it was the only one of the thirteen with no remittance block of
            any kind, hand-written or shared. */''}
      ${paymentFooter(r, color, { compact: true })}
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
    ${identity ? `<div class="footer-note" style="font-style:normal">${identity}</div>` : ''}
    <div class="footer-note">PLEASE SEE OVERLEAF FOR PARTICULARS OF THE TRUST</div>
  </div>`
}

// ── TEMPLATE 9: Jain Tirth (Tally-style — bank box, signature) ──────────────
function buildJainTirth(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
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
    @media print { body{background:#fff;} .page{margin:0;} }
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
        ${mandir.pan ? `PAN No: <b>${mandir.pan}</b><br>` : ''}
        ${mandir.show_gstin && mandir.gstin ? `GSTIN: <b>${mandir.gstin}</b><br>` : ''}
        ${mandir.registration_number ? `${L.registrationNo}: <b>${mandir.registration_number}</b><br>` : ''}
        ${mandir.darpan_number ? `${L.darpanNo}: <b>${mandir.darpan_number}</b><br>` : ''}
        ${L.date}: <b>${dateStr}</b>
      </div>
    </div>
    <div class="title-bar">${docTitle(r, 'Trust Receipt')}</div>
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
      <!-- The amount used to live INSIDE the bank box, cheque-style, with a
           separate field-row fallback when the trust had no bank details: two
           layouts for one number, and the bank half printed em-dash
           placeholders for "Bank" and "IFS Code" on a trust that had an
           account number and nothing else. The amount now always renders the
           same way and the bank details are the shared block. -->
      ${/* The lines first, then the design's own large amount as their total.
            With lines this row used to step aside for an itemised table that
            this design never drew, so a room bill or a multi-head donation
            printed no amount at all. */''}
      ${r.lines?.length ? itemsBlock(r, color, { total: false }) : ''}
      ${r.lines?.length
        // Under an itemised table the total closes it: right-aligned under the
        // amount column and set large, the way every invoice ends.
        ? `<div class="field-row" style="justify-content:space-between"><span class="lbl">${L.total}</span><span class="val big" style="font-size:22px;text-align:right">₹ ${fmtRs(r.amount_paise)}</span></div>`
        : `<div class="field-row"><span class="lbl">${L.amount}</span><span class="val big">₹ ${fmtRs(r.amount_paise)}</span></div>`}
      <div class="field-row"><span class="lbl">${L.modeOfPayment}</span><span class="val">${paymentModeText(r)}</span></div>
      ${paymentFooter(r, color)}
      <div class="sig-row">
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-lbl">Signature</div>
        </div>
      </div>
    </div>
    ${isDonationDoc(r) && mandir.show_80g && mandir.reg_80g_number ? `<div class="reg-footer">80G Exemption: <b>${mandir.reg_80g_number}</b>${mandir.pan ? ' &nbsp;|&nbsp; PAN: <b>'+mandir.pan+'</b>' : ''} — This donation is eligible for income tax deduction u/s 80G of Income Tax Act, 1961.</div>` : ''}
    ${mandir.footer ? `<div class="reg-footer" style="border-top:1px solid #ccc">${mandir.footer}</div>` : ''}
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
    .reg-strip .k { font-size:9.5px; text-transform:uppercase; letter-spacing:.6px; color:#64748b; font-weight:700; }
    .reg-strip .v { font-size:12px; font-weight:700; color:#0f172a; margin-top:2px; font-family:'Courier New',monospace; }
    ${r.is_voided ? '.voided{background:#fee2e2;border:2px solid #f87171;color:#991b1b;padding:9px;text-align:center;font-weight:700;margin:14px 34px;border-radius:5px;}' : ''}
    .title { text-align:center; padding:14px; }
    .title h2 { font-size:16px; letter-spacing:2px; text-transform:uppercase; color:${color}; font-weight:700; }
    .title .sub { font-size:11px; color:#64748b; margin-top:3px; }
    .body { padding:6px 34px 26px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:18px; }
    .card { border:1px solid #e2e8f0; border-radius:6px; padding:14px 16px; }
    .card .lbl { font-size:9.5px; text-transform:uppercase; letter-spacing:.7px; color:#64748b; font-weight:700; margin-bottom:6px; }
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
    .badge-green { background:${affirm(color).bg}; color:${affirm(color).text}; }
    .declaration { font-size:11.5px; color:#374151; line-height:1.85; background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid ${color}; border-radius:5px; padding:13px 16px; }
    .declaration b { color:#0f172a; }
    .pay { font-size:10.5px; color:#475569; margin-top:12px; line-height:1.9; }
    .pay b { color:#0f172a; }
    .sign-row { display:flex; justify-content:space-between; align-items:flex-end; margin-top:30px; }
    .sign-note { font-size:10.5px; color:#64748b; font-style:italic; max-width:320px; }
    .sign-box { text-align:center; font-size:11px; color:#475569; }
    .sign-box .for { font-weight:700; color:#0f172a; margin-bottom:34px; }
    .sign-box .line { border-top:1px solid #94a3b8; padding-top:4px; min-width:190px; }
    .footer-note { font-size:11px; color:#64748b; text-align:center; font-style:italic; margin-top:16px; padding-top:12px; border-top:1px solid #e2e8f0; }
    @media print { body{background:#fff;} .page{box-shadow:none;border:none;margin:0;border-radius:0;} }
    .reg-block { font-size:9.5px; line-height:1.6; margin:6px 0 0; color:#6b7280; }
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
      ${mandir.registration_number ? `<div class="cell"><div class="k">${L.registrationNo}</div><div class="v">${mandir.registration_number}</div></div>` : ''}
      ${mandir.darpan_number ? `<div class="cell"><div class="k">${L.darpanNo}</div><div class="v">${mandir.darpan_number}</div></div>` : ''}
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
          <div class="li">${L.eligible80g}: <span class="badge badge-green">${L.yes}</span></div>
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
      ${paymentFooter(r, color)}
      ${itemsBlock(r, color)}
      <div class="sign-row">
        <div class="sign-note">This is a computer-generated receipt. Please verify the trust's 80G status and eligibility of your donation before claiming a deduction.</div>
        <div class="sign-box">
          <div class="for">For ${mandir.name}</div>
          <div class="line">${L.authorisedSignatory}</div>
        </div>
      </div>
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
    </div>
  </div>`
}


/** The QR block appended below the receipt body when one was generated. */
/**
 * The QR on a thermal roll. The A4/A5 designs get theirs from
 * `remittanceBlock()`; a roll is 58–80mm of paper and lays out its own.
 *
 * It no longer returns '' for a settled document. That rule was written for a
 * "Scan to pay" prompt — a settled receipt must not invite a second payment
 * for the same thing — but a counter slip is ALWAYS settled, so the QR never
 * printed on a roll at all. `qrCaption()` distinguishes the two intents, which
 * is the only thing that ever differed.
 */
function upiQrBlock(r: ReceiptData): string {
  if (!r.upi_qr_data_uri) return ''
  return `<div class="upi-qr">
    <img src="${r.upi_qr_data_uri}" alt="" />
    <div class="upi-cap">${qrCaption(r)}${r.mandir?.upi_id ? `<br><span class="upi-id">${r.mandir.upi_id}</span>` : ''}</div>
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
  // THE TOTAL IS THE FIGURE THE READER CAME FOR, so it is set larger than the
  // rows above it, banded, and ruled off. Measured before this: the total was
  // 12px like every other row and merely bold, which put it at 1.1 to 1.45x
  // the body size across seven designs - a bill whose conclusion does not
  // stand out from its line items reads as a list, not a bill.
  //
  // 15px against 12px rows is about 1.5x the body text, which is where the eye
  // lands first without the figure shouting.
  const row = (label: string, value: string, strong = false) => {
    const pad = strong ? '9px 10px' : '7px 10px'
    const size = strong ? '15px' : '12px'
    const band = strong ? `background:${tint(color, '0f', '#f6f7f9')};border-top:1.5px solid ${tint(color, 'cc', '#9ca3af')};` : ''
    return `
    <tr>
      <td style="padding:${pad};${band}border-bottom:1px solid #eef2f7;font-size:${size};color:${strong ? '#111' : '#374151'};font-weight:${strong ? 700 : 400};letter-spacing:${strong ? '.3px' : 'normal'}">${label}</td>
      <td style="padding:${pad};${band}border-bottom:1px solid #eef2f7;font-size:${size};text-align:right;white-space:nowrap;color:${strong ? '#111' : '#374151'};font-weight:700">${value}</td>
    </tr>`
  }
  // ── ITEMS FULL WIDTH, TOTALS IN A RIGHT-HAND BLOCK ────────────────────────
  // The published convention, and what every mainstream invoicing product
  // produces: line items span the page, and Subtotal / Tax / Total stack in a
  // narrow column under the RIGHT-HAND END of that table, with payment notes to
  // their left. It follows the F-pattern a reader actually uses - across the
  // top, down the left, then out to the figure at the end.
  //
  // Measured before this: eleven of thirteen itemised designs ran their totals
  // across the full width, starting at 0-6% of the content and spanning 88-100%
  // of it. That puts the number the reader came for in the middle of nowhere,
  // with "Total" marooned at the far left of the page from its own figure.
  //
  // 46% wide, so it sits under the amount column without crowding it, and as a
  // block-level table with `margin-left:auto` rather than a float - floats and
  // print pagination disagree, and this has to survive a page break.
  const sumRow = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:${strong ? '7px 10px' : '4px 10px'};font-size:${strong ? '15px' : '11.5px'};color:${strong ? '#111' : '#374151'};font-weight:${strong ? 700 : 400};${strong ? `border-top:1.5px solid ${tint(color, 'cc', '#9ca3af')};` : ''}white-space:nowrap">${label}</td>
      <td style="padding:${strong ? '7px 10px' : '4px 10px'};font-size:${strong ? '15px' : '11.5px'};text-align:right;white-space:nowrap;color:${strong ? '#111' : '#111827'};font-weight:700;${strong ? `border-top:1.5px solid ${tint(color, 'cc', '#9ca3af')};` : ''}">${value}</td>
    </tr>`

  const summary = [
    gstShown ? sumRow(L.subtotal, `₹ ${fmtRs(net)}`) : '',
    gstShown && (tax?.cgst_paise ?? 0) > 0 ? sumRow('CGST', `₹ ${fmtRs(tax!.cgst_paise!)}`) : '',
    gstShown && (tax?.sgst_paise ?? 0) > 0 ? sumRow('SGST', `₹ ${fmtRs(tax!.sgst_paise!)}`) : '',
    gstShown && (tax?.igst_paise ?? 0) > 0 ? sumRow('IGST', `₹ ${fmtRs(tax!.igst_paise!)}`) : '',
    opts.total === false ? '' : sumRow(L.total, `₹ ${fmtRs(r.amount_paise)}`, true),
    ...(opts.total === false ? [] : moneyAfterTotal(r).map(([k, v]) => sumRow(k, v))),
  ].join('')

  return `
  <table style="width:100%;border-collapse:collapse;margin:14px 0 0;border:1px solid #e5e7eb">
    <thead>
      <tr>
        <th style="padding:6px 10px;background:${color};color:#fff;font-size:9.5px;letter-spacing:1px;text-transform:uppercase;text-align:left">${L.description}</th>
        <th style="padding:6px 10px;background:${color};color:#fff;font-size:9.5px;letter-spacing:1px;text-transform:uppercase;text-align:right">${L.amount}</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map((l) => row(`${l.label}${l.qty ? ` <span style="color:#6b7280;font-size:11px">· ${l.qty}</span>` : ''}`, `₹ ${fmtRs(l.amount_paise)}`)).join('')}
    </tbody>
  </table>
  ${summary ? `<table style="width:46%;min-width:190px;margin:0 0 6px auto;border-collapse:collapse;page-break-inside:avoid;break-inside:avoid">${summary}</table>` : ''}`
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
    <div style="font-size:9.5px;color:#6b7280;max-width:55%;line-height:1.6">${L.computerGenerated}</div>
    <div style="text-align:center;min-width:180px">
      <div style="font-size:10px;color:#6b7280">${L.forTrust.replace('{name}', mandir.name)}</div>
      <!-- The signature image, when the trust supplied one, in the space the
           rule was always drawn over. Same 34px the blank left, so a design's
           page-fit does not change depending on whether a signature exists,
           and object-fit contain so a wide scan is letterboxed not stretched.
           NO BACKTICKS: this comment is inside a template literal. -->
      ${mandir.signature_image
        ? `<img src="${mandir.signature_image}" alt="" style="height:34px;max-width:170px;object-fit:contain;display:block;margin:0 auto" />`
        : '<div style="height:34px"></div>'}
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
function buildAnumodana(r: ReceiptData, mandir: NonNullable<ReceiptData['mandir']>, copyLabel?: string): string {
  const lines = r.lines ?? []
  const detail = lines.length
    ? lines.map(l => `${l.label}${l.qty ? ` × ${l.qty}` : ''}`).join(', ')
    : r.category
  // What the sheet prints beyond a gift's one purpose (tenant migration 057):
  // every head of a multi-head donation, a room and its extras, a hall; the
  // stay or hall facts; and the money after the lines. Composed HERE because
  // this file owns the tax and stay rules - receiptDocument only lays them out.
  const meta = (r.meta ?? {}) as Record<string, unknown>
  const tax = r.tax ?? null
  const taxTotal = (tax?.cgst_paise ?? 0) + (tax?.sgst_paise ?? 0) + (tax?.igst_paise ?? 0)
  const gstShown = taxTotal > 0 && !!mandir.gst_enabled
  const facts: Array<[string, string]> = isDonationDoc(r) ? [] : [
    ...(meta.room_number || meta.check_in_date ? stayFacts(r) : []),
    ...(meta.event_name ? [[L.eventName, String(meta.event_name)] as [string, string]] : []),
    ...(meta.booking_date ? [[L.date, fmtDay(meta.booking_date)] as [string, string]] : []),
  ]
  const summary: Array<[string, string, boolean]> = lines.length ? [
    ...(gstShown ? [
      [L.subtotal, `₹ ${fmtRs(r.amount_paise - taxTotal)}`, false] as [string, string, boolean],
      ...(['cgst', 'sgst', 'igst'] as const)
        .filter((k) => (tax?.[`${k}_paise`] ?? 0) > 0)
        .map((k) => [k.toUpperCase() + (tax?.rate_pct ? ` @ ${k === 'igst' ? tax.rate_pct : tax.rate_pct / 2}%` : ''), `₹ ${fmtRs(tax![`${k}_paise`]!)}`, false] as [string, string, boolean]),
    ] : []),
  ] : []
  // Paid, refunded, still due: printed under the total they settle.
  const settlement = moneyAfterTotal(r)
  // Everything below reaches receiptDocument, which escapes it once itself.
  const doc: ReceiptDocument = unescapeDeep({
    // A gift or a sale — the payload says so now; a title is the old signal.
    kind: isDonationDoc(r) ? 'donation' : 'sale',
    // "Donation Receipt · Donor Copy", the way a carbon receipt book prints it.
    // A banner ABOVE the sheet cost ~20px of page height, and this design's
    // sheet already IS the page: donor + office copies came out as four sheets,
    // each one 6px over. The label belongs in the document, not over it.
    title: [r.doc_title ?? null, copyLabel].filter(Boolean).join(' · ') || null,
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
    // A single line that only restates the purpose ("General Donation ₹1,500")
    // adds a table that says nothing the purpose row does not, so one line
    // with no quantity stays the classic one-purpose sheet.
    // ...unless tax was charged: a GST bill must show its taxable value and
    // each tax, and they are laid out under the lines (a hall booking is one
    // line of ₹25,000 + 18% GST and printed only "₹29,500").
    items: lines.length > 1 || lines.some((l) => l.qty) || gstShown ? lines : null,
    items_labels: { description: L.description, amount: L.amountInr },
    // Under a table whose column already reads "Amount", the figure in the
    // box is the total, and saying so keeps one heading from printing twice.
    amount_label: lines.length > 1 || lines.some((l) => l.qty) || gstShown ? L.total : null,
    facts,
    summary,
    settlement,
    remarks: typeof meta.remarks === 'string' && meta.remarks.trim() ? { label: L.remarks, text: meta.remarks } : null,
    payment_mode: paymentModeText(r),
    // The instant the money arrived, and the trust's QR — both new to this
    // design, and both already in the payload the other twelve now render.
    paid_on: r.payments?.find(t => t.paid_on)?.paid_on ?? null,
    upi_qr_data_uri: r.upi_qr_data_uri ?? null,
    is_80g_eligible: r.is_80g_eligible,
    mandir: { ...mandir, receipt_language: mandir.receipt_language },
    // buildReceiptHtml owns the @page rule for every design. Without this the
    // A5 rule in this design's own CSS — emitted from the BODY, so later in
    // the cascade — overrode the trust's chosen paper for the whole document.
  })
  const { css, body } = receiptParts(doc, { ownPage: false })
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
    .party .cap { font-size:9px; letter-spacing:1.4px; text-transform:uppercase; color:#6b7280; margin-bottom:4px; }
    .party .nm { font-size:14px; font-weight:700; }
    .party .sub { font-size:11px; color:#6b7280; line-height:1.7; }
    .totals { display:flex; justify-content:flex-end; margin-top:10px; }
    .totals .box { min-width:260px; }
    .totals .row { display:flex; justify-content:space-between; font-size:12px; padding:5px 0; color:#374151; }
    .totals .grand { border-top:2px solid ${color}; margin-top:4px; padding-top:8px; font-size:16px; font-weight:800; color:${color}; }
    .words { font-size:10.5px; color:#6b7280; font-style:italic; text-align:right; margin-top:4px; }
    .reg-block { font-size:9.5px; line-height:1.6; margin:4px 0 0; }
    .payment-block { font-size:10px; color:#4b5563; line-height:1.9; margin-top:12px; }
    .pay-label { font-weight:700; color:${color}; }
    .footer-note { font-size:11px; color:#6b7280; text-align:center; font-style:italic; margin-top:16px; }
    .voided { background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; text-align:center; font-weight:700; padding:8px; margin-bottom:14px; }
    @media print { body{background:#fff;} .page{border:none;margin:0;padding:24px;} }
  </style>
  <div class="page">
    ${voidedBanner(r.is_voided)}
    <div class="head">
      <div class="trust">
        ${logoTag(mandir)}
        <h1>${mandir.name}</h1>
        <p>${mandir.address}${mandir.mobile ? '<br>' + mandir.mobile : ''}</p>
      </div>
      <div class="doc">
        <div class="kind">${docTitle(r, L.donationReceipt)}</div>
        <div class="no">${r.receipt_number}</div>
        <div class="dt">${dateStr}</div>
      </div>
    </div>
    ${regBlock(mandir, r)}
    <div class="parties">
      <div class="party">
        <div class="cap">${L.receivedFrom}</div>
        <div class="nm">${r.donor?.name || L.anonymous}</div>
        <div class="sub">${[r.donor?.mobile, donorPan(r) ? `${L.pan} ${donorPan(r)}` : '', r.donor?.address].filter(Boolean).join('<br>')}</div>
      </div>
      <div class="party">
        <div class="cap">${L.category}</div>
        <div class="nm" style="font-size:13px">${r.category || '—'}</div>
        <div class="sub">${L.paymentMode}: ${paymentModeText(r)}${show80gLine(r, mandir) ? `<br>80G: ${r.is_80g_eligible ? L.yes : L.no}` : ''}</div>
      </div>
    </div>
    ${itemsBlock(r, color, { total: false })}
    <div class="totals"><div class="box">
      <div class="row grand"><span>${L.total}</span><span>₹ ${fmtRs(r.amount_paise)}</span></div>
      ${/* Paid, refunded, still due - a bill that stops at its total leaves
            the guest working out where their advance went. */''}
      ${moneyAfterTotal(r).map(([k, v, strong]) => `<div class="row"${strong ? ' style="font-weight:700"' : ''}><span>${k}</span><span>${v}</span></div>`).join('')}
    </div></div>
    <div class="words">${amountInWords(r.amount_paise)}</div>
    ${paymentFooter(r, color)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
  </div>`
}

// ── TEMPLATE 13: Heritage ───────────────────────────────────────────────────
// For trusts that want the receipt to look like the mandir: a double rule, a
// gold hairline, and the amount set as the centrepiece. Serif throughout, and
// the Jai Jinendra line at the head where a printed Jain receipt carries it.
function buildHeritage(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  const gold = '#8F6519'
  return `
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; background:#FBF8F1; color:#241C10; }
    .page { max-width:700px; margin:24px auto; background:#FFFDF8; border:3px double ${gold}; padding:6px; }
    .inner { border:1px solid ${gold}55; padding:26px 30px; }
    .jai { text-align:center; color:${gold}; font-size:12px; letter-spacing:3px; }
    .name { text-align:center; font-size:22px; font-weight:700; color:${color}; margin-top:6px; }
    .addr { text-align:center; font-size:10.5px; color:#6B5A44; line-height:1.7; margin-top:4px; }
    .regs { text-align:center; font-size:9.5px; color:#7A6550; margin-top:6px; }
    .kind { text-align:center; margin:14px 0 4px; }
    .kind span { display:inline-block; border-top:1px solid ${gold}; border-bottom:1px solid ${gold}; padding:4px 18px; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:${color}; }
    .meta { display:flex; justify-content:space-between; font-size:11.5px; color:#4B3F30; margin:10px 2px 14px; }
    .to-cap { font-size:9.5px; letter-spacing:2px; text-transform:uppercase; color:#7A6550; }
    .to { font-size:17px; font-weight:700; margin-top:2px; }
    .to-sub { font-size:11px; color:#6B5A44; margin-top:2px; }
    .amt { display:flex; align-items:center; justify-content:space-between; gap:16px; border:1px solid ${gold}66; background:${gold}0f; padding:12px 16px; margin:14px 0 6px; }
    .amt .cap { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#7A6550; }
    .amt .words { font-size:11px; font-style:italic; color:#6B5A44; margin-top:3px; }
    .amt .val { font-size:26px; font-weight:700; color:${color}; white-space:nowrap; }
    .rows { font-size:12.5px; }
    .rows .r { display:flex; justify-content:space-between; padding:7px 2px; border-bottom:1px dotted ${gold}55; }
    .rows .r span:first-child { color:#6B5A44; }
    .rows .r span:last-child { font-weight:700; }
    .reg-block { font-size:9.5px; line-height:1.6; margin:4px 0 0; }
    .payment-block { font-size:10px; color:#6B5A44; line-height:1.9; margin-top:10px; }
    .pay-label { font-weight:700; color:${color}; }
    .footer-note { text-align:center; font-style:italic; color:${gold}; font-size:12px; margin-top:14px; }
    .voided { border:1px solid #B91C1C; color:#B91C1C; text-align:center; font-weight:700; padding:7px; margin-bottom:12px; letter-spacing:2px; }
    @media print { body{background:#fff;} .page{margin:0;} }
  </style>
  <div class="page"><div class="inner">
    ${voidedBanner(r.is_voided)}
    <div class="jai">॥ जय जिनेन्द्र ॥</div>
    ${logoTag(mandir) ? `<div style="text-align:center;margin-top:8px">${logoTag(mandir)}</div>` : ''}
    <div class="name">${mandir.name}</div>
    <div class="addr">${mandir.address}${mandir.mobile ? ' · ' + mandir.mobile : ''}</div>
    ${regBlock(mandir, r)}
    <div class="kind"><span>${docTitle(r, L.donationReceipt)}</span></div>
    <div class="meta"><span>${L.receiptNo}: <b>${r.receipt_number}</b></span><span>${L.date}: <b>${dateStr}</b></span></div>
    <div class="to-cap">${L.receivedWithThanks}</div>
    <div class="to">${r.donor?.name || L.anonymous}</div>
    <div class="to-sub">${[r.donor?.mobile, donorPan(r) ? `${L.pan} ${donorPan(r)}` : ''].filter(Boolean).join(' · ')}</div>
    <div class="amt">
      <div>
        <div class="cap">${r.lines?.length ? L.total : amountLabel(r)}</div>
        <div class="words">${amountInWords(r.amount_paise)}</div>
      </div>
      <div class="val">₹ ${fmtRs(r.amount_paise)}</div>
    </div>
    <div class="rows">
      <div class="r"><span>${L.category}</span><span>${r.category || '—'}</span></div>
      <div class="r"><span>${L.paymentMode}</span><span>${paymentModeText(r)}</span></div>
      ${show80gLine(r, mandir) ? `<div class="r"><span>80G</span><span>${r.is_80g_eligible ? L.yes : L.no}</span></div>` : ''}
    </div>
    ${itemsBlock(r, color)}
    ${r.is_80g_eligible && trustGrants80g(mandir) && isDonationDoc(r) ? `<div style="font-size:10.5px;color:#6B5A44;margin-top:10px">${L.valid80g}</div>` : ''}
    ${paymentFooter(r, color)}
    ${signatureBlock(mandir)}
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
  </div></div>`
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOMMODATION DESIGNS
//
// Until now a room bill printed through one of the donation designs. That is
// why the client asked for "a proper template for accommodation": a stay has
// facts a donation receipt has no place for — who the guest is and which
// document identified them, which room, when they arrived and when they left,
// how many nights and people, what was taken as an advance, what is held as a
// refundable deposit, and what is still owed. A donation has a donor, an
// amount and an 80G claim, and the layouts were built around that.
//
// All three share `stayFacts()` so the numbers cannot disagree between them,
// and all three fit A4 and A5 (qa-receipt-pages.mjs asserts it by name).
// ─────────────────────────────────────────────────────────────────────────────

/** The money a stay involves, in the order a guest reads it. */
function stayMoneyRows(r: ReceiptData): Array<[string, string, boolean]> {
  const meta = (r.meta ?? {}) as Record<string, unknown>
  const advance = Number(meta.advance_paise ?? 0)
  const paid = Number(meta.paid_paise ?? 0)
  const due = Number(meta.due_paise ?? 0)
  const deposit = Number(meta.deposit_paise ?? 0)
  const rows: Array<[string, string, boolean]> = [[L.total, `₹ ${fmtRs(r.amount_paise)}`, true]]
  // The advance is part of `paid`, so it is shown only when it is not the
  // whole of it — otherwise the same money appears on two lines.
  if (advance > 0 && advance !== paid) rows.push([L.advance, `₹ ${fmtRs(advance)}`, false])
  if (paid > 0) rows.push([L.amountPaid, `₹ ${fmtRs(paid)}`, false])
  // An advance larger than the stay came to (tenant migration 057): what was
  // given back, and what is still owed back. Both, so the guest sees where
  // every rupee of the advance went.
  const refunded = Number(meta.refunded_paise ?? 0)
  const refundDue = Number(meta.refund_due_paise ?? 0)
  if (refunded > 0) rows.push([L.refunded, `₹ ${fmtRs(refunded)}`, false])
  if (refundDue > 0) rows.push([L.refundDue, `₹ ${fmtRs(refundDue)}`, true])
  if (due > 0) rows.push([L.balanceDue, `₹ ${fmtRs(due)}`, true])
  // Held, not earned: it is not part of the bill and must never be added into
  // the total (tenant migration 034 made the same point in the ledger).
  if (deposit > 0) rows.push([L.securityDeposit, `₹ ${fmtRs(deposit)}`, false])
  return rows
}

/** Guest, room and stay window — the header block all three designs share. */
function stayFacts(r: ReceiptData): Array<[string, string]> {
  const meta = (r.meta ?? {}) as Record<string, unknown>
  const rows: Array<[string, string]> = []
  if (meta.room_number) rows.push([L.room, String(meta.room_number)])
  const inStr = fmtDateTime(meta.checked_in_at ?? meta.planned_check_in_at) || fmtDay(meta.check_in_date)
  const outStr = fmtDateTime(meta.checked_out_at ?? meta.planned_check_out_at) || fmtDay(meta.check_out_date)
  if (inStr) rows.push([L.checkIn, inStr])
  if (outStr) rows.push([L.checkOut, outStr])
  if (Number(meta.nights) > 0) rows.push([L.nights, String(meta.nights)])
  if (Number(meta.persons) > 0) rows.push([L.persons, String(meta.persons)])
  if (meta.guest_id_last4) {
    rows.push([L.guestIdLabel, `${meta.guest_id_type ? `${meta.guest_id_type} ` : ''}•••• ${meta.guest_id_last4}`])
  }
  return rows
}

// ── TEMPLATE 14: Guest folio ────────────────────────────────────────────────
// The document a dharamshala front desk hands over: everything about the stay
// on one sheet, the money down the right, and the house rules at the foot.
function buildFolio(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  const facts = stayFacts(r)
  const money = stayMoneyRows(r)
  return `
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background:#f7f7f8; color:#111827; }
    .page { max-width:720px; margin:20px auto; background:#fff; border:1px solid #e5e7eb; }
    .head { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; padding:16px 22px; border-bottom:2px solid ${color}; }
    .logo { height:44px; width:auto; object-fit:contain; margin-bottom:5px; }
    .trust h1 { font-size:16px; font-weight:800; letter-spacing:-.2px; }
    .trust p { font-size:10px; color:#6b7280; line-height:1.5; margin-top:2px; }
    .doc { text-align:right; flex:none; }
    .doc .kind { font-size:9px; letter-spacing:1.5px; text-transform:uppercase; color:${color}; font-weight:800; }
    .doc .no { font-size:14px; font-weight:700; font-family:'Courier New',monospace; margin-top:2px; }
    .doc .dt { font-size:10px; color:#6b7280; }
    .guest { display:flex; justify-content:space-between; gap:16px; padding:12px 22px; background:#fafafa; border-bottom:1px solid #eef2f7; }
    .cap { font-size:8px; letter-spacing:1px; text-transform:uppercase; color:#6b7280; font-weight:700; }
    .guest .nm { font-size:15px; font-weight:700; margin-top:1px; }
    .guest .sub { font-size:10px; color:#6b7280; margin-top:2px; line-height:1.45; }
    .cols { display:flex; gap:0; align-items:stretch; }
    .facts { flex:1; padding:12px 22px; border-right:1px solid #eef2f7; }
    .facts table { width:100%; border-collapse:collapse; }
    .facts td { padding:3.5px 0; font-size:10.5px; border-bottom:1px solid #f6f7f9; }
    .facts td:first-child { color:#6b7280; width:42%; }
    .facts td:last-child { font-weight:600; text-align:right; }
    .money { flex:none; width:38%; padding:12px 22px; }
    .money table { width:100%; border-collapse:collapse; }
    .money td { padding:4px 0; font-size:10.5px; border-bottom:1px solid #f6f7f9; }
    .money td:last-child { text-align:right; font-weight:600; white-space:nowrap; }
    .money tr.strong td { font-weight:800; font-size:15px; color:${color}; padding-top:3px; border-top:1.5px solid ${tint(color, 'cc', '#9ca3af')}; }
    .words { padding:0 22px 10px; font-size:9.5px; font-style:italic; color:#6b7280; }
    .body { padding:0 22px 14px; }
    .voided { background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; text-align:center; font-weight:700; padding:7px; margin:10px 22px 0; font-size:11px; }
    .footer-note { font-size:10px; color:#6b7280; text-align:center; font-style:italic; padding:0 22px 8px; }
    @media print { body{background:#fff;} .page{border:none;margin:0;} }
    /* Horizontal padding matching this design's own .body inset. The strip is
       a SIBLING of the padded blocks, not a child, so without its own inset
       it sits at x=0 against the page border and the first glyph of "PAN"
       prints shaved - reported from a real print and from the PDF, and
       measurable in the render (the text started 1px from the page edge).
       The ruled design is deliberately NOT in this list: its strip lives
       inside .idrow, which pads it 10px, so that design is already
       consistent. NO BACKTICKS IN HERE - this comment is inside a template
       literal, so a backtick ends the literal and the CSS after it becomes
       code. That is the seventh time this file has caught me with it. */
    .reg-block { font-size:9.5px; line-height:1.6; margin:6px 0 0; padding:0 22px; color:#6b7280; }
  </style>
  <div class="page">
    ${voidedBanner(r.is_voided)}
    <div class="head">
      <div class="trust">
        ${logoTag(mandir)}
        <h1>${mandir.name}</h1>
        <p>${[mandir.address, mandir.mobile].filter(Boolean).join(' · ')}</p>
      </div>
      <div class="doc">
        <div class="kind">${docTitle(r, L.guestFolio)}</div>
        <div class="no">${r.receipt_number}</div>
        <div class="dt">${dateStr}</div>
      </div>
    </div>
    ${regBlock(mandir, r)}
    <div class="guest">
      <div>
        <div class="cap">${L.guest}</div>
        <div class="nm">${r.donor?.name || L.anonymous}</div>
        <div class="sub">${[r.donor?.mobile, r.donor?.address].filter(Boolean).join(' · ')}</div>
      </div>
      <div style="text-align:right">
        <div class="cap">${L.paymentMode}</div>
        <div class="sub" style="font-size:11px;font-weight:600;color:#111827">${paymentModeText(r)}</div>
      </div>
    </div>
    <div class="cols">
      ${/* No facts, no section. These designs are offered only for
            accommodation, but `receipt_template` accepts any design id over
            the API, and a "Stay details" caption above an empty table is
            exactly the mess the client asked us to stop printing. */''}
      ${facts.length ? `<div class="facts">
        <div class="cap" style="margin-bottom:5px">${L.stayDetails}</div>
        <table>${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      </div>` : ''}
      <div class="money"${facts.length ? '' : ' style="width:100%"'}>
        ${r.lines?.length ? '' : `<div class="cap" style="margin-bottom:5px">${L.amount}</div>`}
        <table>${money.map(([k, v, strong]) => `<tr class="${strong ? 'strong' : ''}"><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      </div>
    </div>
    <div class="words">${amountInWords(r.amount_paise)}</div>
    <div class="body">
      <!-- total: false - the money panel above is stayMoneyRows, which opens
           with the total; a second one under the itemised table repeated both
           the figure and the AMOUNT caption. -->
      ${itemsBlock(r, color, { total: false })}
      ${paymentFooter(r, color, { compact: true, stay: false })}
      ${signatureBlock(mandir)}
    </div>
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
  </div>`
}

// ── TEMPLATE 15: Stay tax invoice ───────────────────────────────────────────
// The statutory shape, for a trust that charges GST on rooms: place of supply,
// taxable value, the tax split as its own column, and the invoice number where
// an auditor looks for it. Renders correctly with no GSTIN too — the tax rows
// simply do not appear, because GstRateService returns 0% for an unregistered
// trust and the receipt carries `tax: null`.
function buildStayInvoice(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  const facts = stayFacts(r)
  const tax = r.tax ?? null
  const taxTotal = (tax?.cgst_paise ?? 0) + (tax?.sgst_paise ?? 0) + (tax?.igst_paise ?? 0)
  const gstShown = taxTotal > 0 && mandir.gst_enabled
  const taxable = r.amount_paise - (gstShown ? taxTotal : 0)
  // Rule 46(k) wants the rate, and this design printed only amounts. CGST and
  // SGST each carry half the rate; IGST carries all of it.
  const halfRate = ratePct(tax?.cgst_paise ?? tax?.sgst_paise ?? 0, taxable,
    tax?.rate_pct != null ? tax.rate_pct / 2 : null)
  const fullRate = ratePct(taxTotal, taxable, tax?.rate_pct)
  const money = stayMoneyRows(r)
  const row = (k: string, v: string, strong = false) =>
    `<tr${strong ? ' class="strong"' : ''}><td>${k}</td><td>${v}</td></tr>`
  return `
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background:#fff; color:#111827; }
    .page { max-width:740px; margin:18px auto; background:#fff; border:1.5px solid #111827; }
    .title { text-align:center; font-size:11px; letter-spacing:3px; text-transform:uppercase; font-weight:800; padding:6px; background:#111827; color:#fff; }
    .head { display:flex; justify-content:space-between; gap:18px; padding:12px 20px; border-bottom:1px solid #111827; }
    .logo { height:40px; width:auto; object-fit:contain; margin-bottom:4px; }
    .trust h1 { font-size:15px; font-weight:800; }
    .trust p { font-size:9.5px; color:#4b5563; line-height:1.5; margin-top:2px; }
    .doc { text-align:right; flex:none; font-size:10px; line-height:1.7; }
    .doc b { font-family:'Courier New',monospace; font-size:12px; }
    .grid { display:flex; border-bottom:1px solid #111827; }
    /* 8px, not 10. Part of a measured 150px trim: with a 9-night stay this
       design came to 1150px against A4's 1062px printable box and printed a
       second page carrying the totals alone. room_gst and ruled render the
       SAME bill in 1009px and 988px, so the height was spacing rather than
       content - this design simply had the loosest rhythm of the three. */
    .grid > div { flex:1; padding:8px 20px; }
    .grid > div + div { border-left:1px solid #d1d5db; }
    .cap { font-size:8px; letter-spacing:1px; text-transform:uppercase; color:#6b7280; font-weight:700; margin-bottom:3px; }
    .nm { font-size:13px; font-weight:700; }
    .sub { font-size:10px; color:#4b5563; line-height:1.5; margin-top:2px; }
    table.facts { width:100%; border-collapse:collapse; }
    table.facts td { padding:2px 0; font-size:10px; }
    table.facts td:first-child { color:#6b7280; width:45%; }
    table.facts td:last-child { font-weight:600; }
    .body { padding:9px 20px; }
    /* A narrow summary flush right, not a full-width row - the convention
       every invoicing product follows, and measured at 94% of the width
       before this. The itemised table above it still spans the page; it is
       the TOTALS that belong in a column under its right-hand end. */
    table.amt { width:52%; min-width:210px; border-collapse:collapse; margin:10px 0 0 auto;
      page-break-inside:avoid; break-inside:avoid; }
    table.amt td { padding:4px 8px; font-size:11px; border:1px solid #e5e7eb; }
    table.amt td:last-child { text-align:right; font-weight:600; white-space:nowrap; }
    table.amt tr.strong td { font-weight:800; font-size:15px; background:#f3f4f6; border-top:1.5px solid #9ca3af; }
    .words { font-size:10px; font-style:italic; color:#4b5563; margin-top:6px; }
    .voided { background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; text-align:center; font-weight:700; padding:7px; margin:10px 20px 0; font-size:11px; }
    .footer-note { font-size:10px; color:#6b7280; text-align:center; font-style:italic; padding:0 20px 8px; }
    @media print { .page{border-color:#111827;margin:0;} }
    /* 20px, matching .head / .grid / .body. Without it the strip sat at x=0
       inside a page with a 1.5px border, so the P of "PAN" printed under that
       border and came out shaved - reported from a real print and from the PDF,
       and visible in the render once the strip was measured (textL was 1px).
       Four designs were given this inset by hand when the strip was added and
       the rest were not, which is why only some templates showed it. */
    .reg-block { font-size:9.5px; line-height:1.6; margin:6px 0 0; padding:0 20px; color:#6b7280; }
  </style>
  <div class="page">
    <div class="title">${docTitle(r, gstShown ? L.taxInvoice : L.guestFolio)}</div>
    ${voidedBanner(r.is_voided)}
    <div class="head">
      <div class="trust">
        ${logoTag(mandir)}
        <h1>${mandir.name}</h1>
        <p>${mandir.address}${mandir.mobile ? `<br>${mandir.mobile}` : ''}</p>
      </div>
      <div class="doc">
        ${L.receiptNo}: <b>${r.receipt_number}</b><br>
        ${L.date}: ${dateStr}
        ${gstShown && (r.place_of_supply || r.donor?.state) ? `<br>${L.placeOfSupply}: ${r.place_of_supply || r.donor?.state}` : ''}
        ${gstShown ? `<br>${L.reverseCharge}: ${r.tax?.reverse_charge === true ? L.yes : L.no}` : ''}
      </div>
    </div>
    ${regBlock(mandir, r)}
    <div class="grid">
      <div>
        <div class="cap">${L.guest}</div>
        <div class="nm">${r.donor?.name || L.anonymous}</div>
        <div class="sub">${[r.donor?.mobile, r.donor?.address].filter(Boolean).join('<br>')}</div>
        ${r.donor?.gstin ? `<div class="sub"><b>${L.guestGstin}:</b> ${r.donor.gstin}</div>` : ''}
      </div>
      ${facts.length ? `<div>
        <div class="cap">${L.stayDetails}</div>
        <table class="facts">${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      </div>` : ''}
    </div>
    <div class="body">
      ${itemsBlock(r, color, { total: false })}
      <table class="amt">
        ${gstShown ? row(L.hsnSac, tax?.sac_code || SAC_ACCOMMODATION) : ''}
        ${gstShown && fullRate ? row(L.taxRate, `${fullRate}%`) : ''}
        ${gstShown ? row(L.taxableValue, `₹ ${fmtRs(taxable)}`) : ''}
        ${gstShown && (tax?.cgst_paise ?? 0) > 0 ? row(`CGST${halfRate ? ' @ ' + halfRate + '%' : ''}`, `₹ ${fmtRs(tax!.cgst_paise!)}`) : ''}
        ${gstShown && (tax?.sgst_paise ?? 0) > 0 ? row(`SGST${halfRate ? ' @ ' + halfRate + '%' : ''}`, `₹ ${fmtRs(tax!.sgst_paise!)}`) : ''}
        ${gstShown && (tax?.igst_paise ?? 0) > 0 ? row(`IGST${fullRate ? ' @ ' + fullRate + '%' : ''}`, `₹ ${fmtRs(tax!.igst_paise!)}`) : ''}
        ${money.map(([k, v, strong]) => row(k, v, strong)).join('')}
      </table>
      <div class="words">${L.amountInWords}: ${amountInWords(r.amount_paise)}</div>
      ${paymentFooter(r, color, { compact: true, stay: false })}
      ${signatureBlock(mandir)}
    </div>
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
  </div>`
}

/**
 * The GST rate for a tax component, as a percentage string.
 *
 * Derived from the money when the payload does not carry a rate, which every
 * existing document is: `rate_pct` is new. Deriving matters rather than being a
 * nicety — Rule 46(k) requires the RATE, and an invoice that prints
 * "CGST 80.00" with no percentage anywhere is incomplete, so falling back to
 * blank would have left every historical reprint non-compliant.
 *
 * cgst/taxable is exact for a uniform rate, which accommodation is. Trailing
 * zeros are trimmed so 6 prints as "6" and 2.5 as "2.5".
 */
function ratePct(componentPaise: number, taxablePaise: number, declared?: number | null): string {
  if (declared != null && declared > 0) return String(Number(declared.toFixed(2)))
  if (!taxablePaise || !componentPaise) return ''
  return String(Number(((componentPaise / taxablePaise) * 100).toFixed(2)))
}

/**
 * SAC 9963 — accommodation, food and beverage services.
 *
 * The default rather than a hardcoding: a line carries its own code when the
 * API sends one, then the document's, then this. A dharamshala bill is
 * accommodation unless told otherwise, and printing nothing is the one option
 * Rule 46(g) does not allow.
 */
const SAC_ACCOMMODATION = '9963'

// ── TEMPLATE 17: Room GST tax invoice ───────────────────────────────────────
// A strict CGST Rule 46 tax invoice for accommodation.
//
// The existing `stay_invoice` carries a GST badge and was missing four
// mandatory particulars: the recipient's GSTIN (46(e)), HSN/SAC (46(g)), the
// tax RATE (46(k)) and the reverse-charge declaration (46(p)). That is not a
// cosmetic gap. An invoice missing mandatory particulars can cost a registered
// guest their input tax credit, and s.122 CGST exposes the issuer to a penalty
// of ₹10,000 or the tax involved, whichever is higher — on a trust that let a
// hall to a company for a wedding, the tax involved is the larger number.
//
// Monochrome on purpose. A tax invoice is a statutory form: it does not take
// the trust's brand colour, and `color` is deliberately not a parameter here so
// no later edit can quietly introduce one.
function buildRoomGst(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>): string {
  const facts = stayFacts(r)
  const tax = r.tax ?? null
  const cgst = tax?.cgst_paise ?? 0
  const sgst = tax?.sgst_paise ?? 0
  const igst = tax?.igst_paise ?? 0
  const taxTotal = cgst + sgst + igst
  const taxable = r.amount_paise - taxTotal
  // Rule 46(n). For accommodation the place of supply is where the property is,
  // which is the guest's stated state on a domestic booking; an explicit value
  // from the API wins.
  const pos = r.place_of_supply || r.donor?.state || ''
  const rc = tax?.reverse_charge === true

  // ── TAX INVOICE, OR BILL OF SUPPLY ────────────────────────────────────────
  // s.31(3)(c) CGST: a registered person supplying exempt or nil-rated services
  // issues a BILL OF SUPPLY, not a tax invoice. A temple that holds a GSTIN and
  // lets a room below the taxable tariff is precisely that — `isTariffTaxable`
  // in room-charges decides it, and the bill then carries no tax at all.
  //
  // Heading such a document "TAX INVOICE" would assert tax on a supply that
  // bore none. Rule 49 asks for much the same particulars minus the tax, so the
  // SAC and the place of supply stay and the rate and reverse-charge lines go.
  //
  // An UNREGISTERED trust never gets here: buildReceiptHtml falls its template
  // back to stay_invoice, because it has no standing to issue either document.
  const taxed = taxTotal > 0 && mandir.gst_enabled !== false

  // One line minimum. A room bill settled at the counter may arrive with no
  // itemisation at all, and a tax invoice with an empty description column is
  // not an invoice — so the category becomes the single line it describes.
  const lines = (r.lines && r.lines.length)
    ? r.lines
    : [{ label: r.category || L.roomBill, qty: '', amount_paise: r.amount_paise, sac: null, rate_pct: null }]

  // Each line's taxable share. The payload gives gross line amounts, so on a
  // tax-inclusive bill the tax has to come back out proportionally rather than
  // be shown as though the guest were charged it twice.
  const grossTotal = lines.reduce((n, l) => n + l.amount_paise, 0) || r.amount_paise
  const lineRows = lines.map((l, i) => {
    const share = taxTotal > 0 ? Math.round((l.amount_paise / grossTotal) * taxable) : l.amount_paise
    const sac = l.sac || tax?.sac_code || SAC_ACCOMMODATION
    const rate = ratePct(taxTotal, taxable, tax?.rate_pct ?? l.rate_pct)
    return `<tr>
        <td class="c">${i + 1}</td>
        <td>${l.label}</td>
        <td class="c mono">${sac}</td>
        <td class="c">${l.qty || '—'}</td>
        ${taxed ? `<td class="r">${rate ? rate + '%' : '—'}</td>` : ''}
        <td class="r">${fmtRs(share)}</td>
      </tr>`
  }).join('')

  // One fewer column when the Rate column is absent, or the totals detach from
  // the right-hand edge they are meant to line up with.
  const span = taxed ? 5 : 4
  const taxLine = (label: string, pct: string, amt: number) =>
    `<tr><td colspan="${span}" class="r lbl">${label}${pct ? ' @ ' + pct + '%' : ''}</td><td class="r">${fmtRs(amt)}</td></tr>`

  return `
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background:#fff; color:#111827; }
    .page { max-width:760px; margin:18px auto; background:#fff; border:1.5px solid #111827; }
    .title { display:flex; align-items:baseline; justify-content:center; gap:10px; background:#111827; color:#fff; padding:6px 14px; }
    .title b { font-size:11.5px; letter-spacing:3px; text-transform:uppercase; }
    .title span { font-size:8.5px; letter-spacing:1px; opacity:.85; }
    .parties { display:flex; border-bottom:1px solid #111827; }
    .parties > div { flex:1; padding:10px 16px; }
    .parties > div + div { border-left:1px solid #111827; }
    .cap { font-size:8px; letter-spacing:1.2px; text-transform:uppercase; color:#6b7280; font-weight:700; margin-bottom:3px; }
    .nm { font-size:13px; font-weight:800; line-height:1.3; }
    .sub { font-size:9.5px; color:#4b5563; line-height:1.55; margin-top:2px; }
    .logo { height:36px; width:auto; object-fit:contain; margin-bottom:4px; }
    table.meta { width:100%; border-collapse:collapse; }
    table.meta td { font-size:9.5px; padding:1.5px 0; vertical-align:top; }
    table.meta td:first-child { color:#6b7280; width:46%; }
    table.meta td:last-child { font-weight:700; text-align:right; }
    .mono { font-family:'Courier New',monospace; }
    table.items { width:100%; border-collapse:collapse; }
    table.items th { font-size:8.5px; letter-spacing:.8px; text-transform:uppercase; background:#f3f4f6;
      border-bottom:1px solid #111827; padding:5px 6px; text-align:left; color:#374151; }
    table.items td { font-size:10px; padding:5px 6px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
    /* The TABLE is inset, not its outer cells. Padding on :first-child /
       :last-child only reaches whichever cells happen to be first and last, and
       this table's column set varies - IGST appears only on an interstate
       supply - so the rightmost column is not always the same one. Measured at
       1.32mm of clearance on A5, which is where the reported shaving happens;
       insetting the table itself cannot be undone by a column appearing. */
    table.items { width:calc(100% - 32px); margin-left:16px; margin-right:16px; }
    table.items td.c, table.items th.c { text-align:center; }
    table.items td.r, table.items th.r { text-align:right; white-space:nowrap; }
    table.items td.lbl { color:#4b5563; font-weight:600; }
    table.items tr.grand td { font-size:15px; font-weight:800; background:#f3f4f6; border-top:1.5px solid #111827; border-bottom:1.5px solid #111827; padding-top:7px; padding-bottom:7px; }
    .words { font-size:10px; padding:7px 16px; border-bottom:1px solid #e5e7eb; }
    .words b { font-style:italic; }
    .body { padding:10px 16px; }
    .decl { display:flex; gap:16px; align-items:flex-end; justify-content:space-between; padding:10px 16px; border-top:1px solid #e5e7eb; }
    .decl p { font-size:8.5px; color:#6b7280; line-height:1.5; max-width:62%; }
    .voided { background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; text-align:center; font-weight:700; padding:7px; margin:10px 16px 0; font-size:11px; }
    .footer-note { font-size:9.5px; color:#6b7280; text-align:center; font-style:italic; padding:0 16px 8px; }
    @media print { .page{border-color:#111827;margin:0;} }
    /* Horizontal padding matching this design's own .body inset. The strip is
       a SIBLING of the padded blocks, not a child, so without its own inset
       it sits at x=0 against the page border and the first glyph of "PAN"
       prints shaved - reported from a real print and from the PDF, and
       measurable in the render (the text started 1px from the page edge).
       The ruled design is deliberately NOT in this list: its strip lives
       inside .idrow, which pads it 10px, so that design is already
       consistent. NO BACKTICKS IN HERE - this comment is inside a template
       literal, so a backtick ends the literal and the CSS after it becomes
       code. That is the seventh time this file has caught me with it. */
    .reg-block { font-size:9.5px; line-height:1.6; margin:6px 0 0; padding:0 16px; color:#6b7280; }
  </style>
  <div class="page">
    <div class="title"><b>${taxed ? L.taxInvoice : L.billOfSupply}</b><span>${L.originalForRecipient}</span></div>
    ${voidedBanner(r.is_voided)}
    <div class="parties">
      <div>
        <div class="cap">${L.supplier}</div>
        ${logoTag(mandir)}
        <div class="nm">${mandir.name}</div>
        <div class="sub">${[mandir.address, mandir.mobile, mandir.email].filter(Boolean).join('<br>')}</div>
      </div>
      <div>
        <table class="meta">
          <tr><td>${L.receiptNo}</td><td class="mono">${r.receipt_number}</td></tr>
          <tr><td>${L.date}</td><td>${dateStr}</td></tr>
          ${pos ? `<tr><td>${L.placeOfSupply}</td><td>${pos}</td></tr>` : ''}
          ${taxed ? `<tr><td>${L.reverseCharge}</td><td>${rc ? L.yes : L.no}</td></tr>` : ''}
        </table>
      </div>
    </div>
    ${regBlock(mandir, r)}
    <div class="parties">
      <div>
        <div class="cap">${L.recipient}</div>
        <div class="nm">${r.donor?.name || L.anonymous}</div>
        <div class="sub">${[r.donor?.mobile, r.donor?.address, [r.donor?.city, r.donor?.state, r.donor?.pincode].filter(Boolean).join(', ')].filter(Boolean).join('<br>')}</div>
        ${r.donor?.gstin ? `<div class="sub"><b>${L.guestGstin}:</b> <span class="mono">${r.donor.gstin}</span></div>` : ''}
      </div>
      ${facts.length ? `<div>
        <div class="cap">${L.stayDetails}</div>
        <table class="meta">${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      </div>` : ''}
    </div>
    <table class="items">
      <tr>
        <th class="c">#</th>
        <th>${L.description}</th>
        <th class="c">${L.hsnSac}</th>
        <th class="c">${L.qty}</th>
        ${taxed ? `<th class="r">${L.taxRate}</th>` : ''}
        <th class="r">${taxed ? L.taxableValue : L.amount}</th>
      </tr>
      ${lineRows}
      ${taxed ? `${taxLine(L.taxableValue, '', taxable)}
      ${cgst > 0 ? taxLine('CGST', ratePct(cgst, taxable, tax?.rate_pct != null ? tax.rate_pct / 2 : null), cgst) : ''}
      ${sgst > 0 ? taxLine('SGST', ratePct(sgst, taxable, tax?.rate_pct != null ? tax.rate_pct / 2 : null), sgst) : ''}
      ${igst > 0 ? taxLine('IGST', ratePct(igst, taxable, tax?.rate_pct), igst) : ''}` : ''}
      <tr class="grand"><td colspan="${span}" class="r">${L.total}</td><td class="r">₹ ${fmtRs(r.amount_paise)}</td></tr>
      ${/* After the invoice total: what was paid, what was given back, what is
            still due. Not part of the tax invoice's value - the rows follow the
            total rather than feed it. */''}
      ${moneyAfterTotal(r).map(([k, v, strong]) => `<tr><td colspan="${span}" class="r"${strong ? ' style="font-weight:700"' : ''}>${k}</td><td class="r"${strong ? ' style="font-weight:700"' : ''}>${v}</td></tr>`).join('')}
    </table>
    <div class="words">${L.amountInWords}: <b>${amountInWords(r.amount_paise)}</b></div>
    <div class="body">
      ${paymentFooter(r, '#111827', { compact: true, stay: false })}
    </div>
    <div class="decl">
      <p>${L.gstDeclaration}</p>
      <div>${signatureBlock(mandir)}</div>
    </div>
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
  </div>`
}

// ── TEMPLATE 18: Ruled ──────────────────────────────────────────────────────
// The boxed, ruled grid an Indian trust's auditor reads without being taught
// it - the structural lesson taken from Tally/Vyapar-style invoices - applied
// to a temple's documents rather than a wholesaler's.
//
// Serves rooms, halls, bhojanshala and gaushala from one template. The first
// three are taxable supplies; a cow sponsorship is a donation. The document
// says which it is, and the blocks that do not apply collapse rather than
// printing empty.
//
// Monochrome, like the other statutory designs: a ruled invoice does not take
// the trust's brand colour, and `color` is deliberately not a parameter.
function buildRuled(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, copyLabel?: string): string {
  const donation = isDonationDoc(r)
  const tax = r.tax ?? null
  const cgst = tax?.cgst_paise ?? 0
  const sgst = tax?.sgst_paise ?? 0
  const igst = tax?.igst_paise ?? 0
  const taxTotal = cgst + sgst + igst
  // A gift is never a taxable supply, whatever tax numbers happen to ride
  // along: a cow sponsorship follows the trust's 80G registration, not its
  // GSTIN.
  const taxed = !donation && taxTotal > 0 && mandir.gst_enabled !== false
  const taxable = r.amount_paise - (taxed ? taxTotal : 0)
  const pos = r.place_of_supply || r.donor?.state || ''
  const facts = stayFacts(r)
  const meta = (r.meta ?? {}) as Record<string, unknown>
  const paid = Number(meta.paid_paise ?? 0)
  const due = Number(meta.due_paise ?? 0)

  // One line minimum: a counter sale may arrive with no itemisation, and a
  // ruled table with an empty description column is not a document.
  const lines = (r.lines && r.lines.length)
    ? r.lines
    : [{ label: r.category || '', qty: '', amount_paise: r.amount_paise, sac: null, rate_pct: null }]
  const grossTotal = lines.reduce((n, l) => n + l.amount_paise, 0) || r.amount_paise
  const shareOf = (amt: number) => (taxed ? Math.round((amt / grossTotal) * taxable) : amt)
  const rateOf = (l: { rate_pct?: number | null }) =>
    ratePct(taxTotal, taxable, tax?.rate_pct ?? l.rate_pct)
  const sacOf = (l: { sac?: string | null }) => l.sac || tax?.sac_code || SAC_ACCOMMODATION

  // ── THE RATE-WISE TAX SUMMARY ─────────────────────────────────────────────
  // Standard on an Indian tax invoice and what reconciles the document against
  // GSTR-1. Grouped by SAC and rate, because that is the grouping the return
  // asks for - a room at 12% and prasad at 5% on one bill are two rows, and a
  // single-rate bill is one row rather than a table nobody needs.
  const groups = new Map<string, { sac: string; rate: string; taxable: number }>()
  if (taxed) {
    for (const l of lines) {
      const sac = sacOf(l)
      const rate = rateOf(l)
      const key = sac + '|' + rate
      const g = groups.get(key) ?? { sac, rate, taxable: 0 }
      g.taxable += shareOf(l.amount_paise)
      groups.set(key, g)
    }
  }
  // Only when it tells the reader something the totals block does not. One
  // rate means one row, and a one-row table is furniture - which is the whole
  // point of not copying a wholesaler's invoice wholesale.
  const summaryRows = [...groups.values()].map((g) => {
    // Split proportionally so the rows add up to the tax actually charged
    // rather than to a recomputation that can differ by a paisa.
    const share = taxable > 0 ? g.taxable / taxable : 1
    const gc = Math.round(cgst * share)
    const gs = Math.round(sgst * share)
    const gi = Math.round(igst * share)
    return `<tr>
        <td class="mono">${g.sac}</td>
        <td class="r">${fmtRs(g.taxable)}</td>
        ${igst > 0 ? '' : `<td class="c">${g.rate ? (Number(g.rate) / 2) + '%' : '\u2014'}</td><td class="r">${fmtRs(gc)}</td>
        <td class="c">${g.rate ? (Number(g.rate) / 2) + '%' : '\u2014'}</td><td class="r">${fmtRs(gs)}</td>`}
        ${igst > 0 ? `<td class="c">${g.rate ? g.rate + '%' : '\u2014'}</td><td class="r">${fmtRs(gi)}</td>` : ''}
        <td class="r"><b>${fmtRs(gc + gs + gi)}</b></td>
      </tr>`
  }).join('')
  const showSummary = taxed && groups.size > 1

  const totalRow = (label: string, value: string, strong = false) => `
      <tr${strong ? ' class="grand"' : ''}>
        <td>${label}</td><td class="r">${value}</td>
      </tr>`

  // ── WHICH COPY THIS IS ────────────────────────────────────────────────────
  // Wired to the two copies that already exist rather than inventing a third.
  // `receipt_copies` offers one or two, so the captions are Original and
  // Duplicate for Office; a Triplicate has nothing to drive it and is not
  // pretended into existence.
  //
  // "Duplicate for Office", not the trade's "Duplicate for Transporter": a
  // trust moves nothing, and its second copy goes to its own office.
  const copyCaption = copyLabel === L.officeCopy ? L.duplicateForOffice : L.originalForRecipient

  return `
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background:#fff; color:#111827; }
    .page { max-width:760px; margin:16px auto; background:#fff; border:1.5px solid #111827; }
    .title { display:flex; align-items:center; justify-content:space-between; gap:10px;
      border-bottom:1.5px solid #111827; padding:5px 10px; }
    .title b { font-size:12px; letter-spacing:3px; text-transform:uppercase; }
    .title span { font-size:8.5px; letter-spacing:.8px; color:#374151; text-transform:uppercase; }
    .grid { display:flex; border-bottom:1.5px solid #111827; }
    .grid > div { flex:1; padding:8px 10px; min-width:0; }
    .grid > div + div { border-left:1px solid #111827; }
    .cap { font-size:8px; letter-spacing:1.2px; text-transform:uppercase; color:#5b6472; font-weight:700; margin-bottom:3px; }
    /* The identity strip gets the full width of the sheet, not a share of the
       two-column header. Measured inside that column it ran to eight lines. */
    .idrow { padding:5px 10px; border-bottom:1.5px solid #111827; }
    .idrow .reg-block { margin:0; font-size:9px; line-height:1.55; }
    .nm { font-size:16px; font-weight:800; line-height:1.25; }
    .sub { font-size:9.5px; color:#4b5563; line-height:1.55; margin-top:2px; }
    .logo { height:32px; width:auto; object-fit:contain; margin-bottom:3px; }
    .mono { font-family:'Courier New',monospace; }
    table.kv { width:100%; border-collapse:collapse; }
    table.kv td { font-size:9.5px; padding:1px 0; vertical-align:top; }
    table.kv td:first-child { color:#5b6472; width:46%; }
    table.kv td:last-child { font-weight:700; text-align:right; }
    table.items { width:100%; border-collapse:collapse; }
    table.items th { font-size:8px; letter-spacing:.8px; text-transform:uppercase; background:#f3f4f6;
      border-bottom:1px solid #111827; padding:4px 6px; text-align:left; color:#374151; font-weight:700; }
    table.items td { font-size:10px; padding:4px 6px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
    /* The outer columns align with this design's own inset instead of sitting
       6px from the frame. An items table that spans the full width is a
       sibling of the padded blocks, so its first and last cells were the
       closest ink to the page border in the whole document - measured at
       7px on A4 and 5px on A5, which is where the reported shaving happens.
       It is also simply better set: the columns line up with the headings
       above and below them rather than hanging outside. */
    table.items th:first-child, table.items td:first-child { padding-left:14px; }
    table.items th:last-child, table.items td:last-child { padding-right:14px; }
    table.items th + th, table.items td + td { border-left:1px solid #e5e7eb; }
    .c { text-align:center; }
    .r { text-align:right; white-space:nowrap; }
    .lower { display:flex; border-top:1.5px solid #111827; }
    .lower > div { padding:8px 10px; min-width:0; }
    .lower > div + div { border-left:1px solid #111827; }
    table.sum { width:100%; border-collapse:collapse; }
    table.sum th { font-size:7.5px; letter-spacing:.6px; text-transform:uppercase; color:#374151;
      padding:3px 5px; border-bottom:1px solid #d1d5db; text-align:left; font-weight:700; }
    table.sum td { font-size:9.5px; padding:3px 5px; border-bottom:1px solid #f3f4f6; }
    table.tot { width:100%; border-collapse:collapse; }
    table.tot td { font-size:10.5px; padding:3px 6px; }
    table.tot tr.grand td { font-size:14px; font-weight:800; border-top:1.5px solid #111827;
      border-bottom:1.5px solid #111827; padding:6px; }
    .words { font-size:10px; padding:6px 10px; border-top:1px solid #111827; }
    .foot { display:flex; border-top:1.5px solid #111827; }
    .foot > div { padding:8px 10px; min-width:0; }
    .foot > div + div { border-left:1px solid #111827; }
    .decl { font-size:8.5px; color:#4b5563; line-height:1.5; }
    .sign { text-align:right; font-size:9.5px; }
    .voided { background:#fee2e2; border-bottom:1px solid #fca5a5; color:#991b1b; text-align:center;
      font-weight:700; padding:5px; font-size:11px; letter-spacing:1px; }
    .footer-note { font-size:9.5px; color:#5b6472; text-align:center; font-style:italic; padding:6px 10px; border-top:1px solid #e5e7eb; }
    @media print { .page{border-color:#111827;margin:0;} }
  </style>
  <div class="page">
    <div class="title">
      <b>${docTitle(r, donation ? L.donationReceipt : (taxed ? L.taxInvoice : L.billOfSupply))}</b>
      <span>${copyCaption}</span>
    </div>
    ${r.is_voided ? `<div class="voided">${L.voided}</div>` : ''}

    <div class="grid">
      <div>
        <div class="cap">${L.supplier}</div>
        ${logoTag(mandir)}
        <div class="nm">${mandir.name}</div>
        <div class="sub">${[mandir.address, mandir.mobile, mandir.email].filter(Boolean).join('<br>')}</div>
      </div>
      <div>
        <table class="kv">
          <tr><td>${L.receiptNo}</td><td class="mono">${r.receipt_number}</td></tr>
          <tr><td>${L.date}</td><td>${dateStr}</td></tr>
          ${taxed && pos ? `<tr><td>${L.placeOfSupply}</td><td>${pos}</td></tr>` : ''}
          ${taxed ? `<tr><td>${L.reverseCharge}</td><td>${tax?.reverse_charge === true ? L.yes : L.no}</td></tr>` : ''}
          ${donation && trustGrants80g(mandir) ? `<tr><td>${L.eligible80g}</td><td>${r.is_80g_eligible ? L.yes : L.no}</td></tr>` : ''}
        </table>
      </div>
    </div>

    <div class="idrow">${regBlock(mandir, r)}</div>

    <div class="grid">
      <div>
        <div class="cap">${donation ? L.receivedFrom : L.recipient}</div>
        <div class="nm">${r.donor?.name || L.anonymous}</div>
        <div class="sub">${[r.donor?.mobile, r.donor?.address,
          [r.donor?.city, r.donor?.state, r.donor?.pincode].filter(Boolean).join(', ')].filter(Boolean).join('<br>')}</div>
        ${donorPan(r) ? `<div class="sub">${L.donorPan}: <b>${donorPan(r)}</b></div>` : ''}
        ${r.donor?.gstin ? `<div class="sub">${L.guestGstin}: <b class="mono">${r.donor.gstin}</b></div>` : ''}
      </div>
      ${facts.length ? `<div>
        <div class="cap">${L.stayDetails}</div>
        <table class="kv">${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      </div>` : ''}
    </div>

    <table class="items">
      <tr>
        <th class="c">${L.srNo}</th>
        <th>${L.description}</th>
        ${taxed ? `<th class="c">${L.hsnSac}</th>` : ''}
        <th class="c">${L.qty}</th>
        ${taxed ? `<th class="r">${L.taxRate}</th>` : ''}
        <th class="r">${taxed ? L.taxableValue : L.amount}</th>
      </tr>
      ${lines.map((l, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${l.label}</td>
        ${taxed ? `<td class="c mono">${sacOf(l)}</td>` : ''}
        <td class="c">${l.qty || '\u2014'}</td>
        ${taxed ? `<td class="r">${rateOf(l) ? rateOf(l) + '%' : '\u2014'}</td>` : ''}
        <td class="r">${fmtRs(shareOf(l.amount_paise))}</td>
      </tr>`).join('')}
    </table>

    <div class="lower">
      ${showSummary ? `<div style="flex:1.3">
        <div class="cap">${L.hsnSummary}</div>
        <table class="sum">
          <tr>
            <th>${L.hsnSac}</th><th class="r">${L.taxableValue}</th>
            ${igst > 0 ? `<th class="c">${L.taxRate}</th><th class="r">IGST</th>`
              : `<th class="c">${L.taxRate}</th><th class="r">CGST</th><th class="c">${L.taxRate}</th><th class="r">SGST</th>`}
            <th class="r">${L.total}</th>
          </tr>
          ${summaryRows}
        </table>
      </div>` : ''}
      <div style="flex:0 0 46%;margin-left:auto">
        <table class="tot">
          ${taxed ? totalRow(L.taxableValue, '\u20b9 ' + fmtRs(taxable)) : ''}
          ${taxed && cgst > 0 ? totalRow('CGST', '\u20b9 ' + fmtRs(cgst)) : ''}
          ${taxed && sgst > 0 ? totalRow('SGST', '\u20b9 ' + fmtRs(sgst)) : ''}
          ${taxed && igst > 0 ? totalRow('IGST', '\u20b9 ' + fmtRs(igst)) : ''}
          ${totalRow(L.total, '\u20b9 ' + fmtRs(r.amount_paise), true)}
          ${paid > 0 ? totalRow(L.amountPaid, '\u20b9 ' + fmtRs(paid)) : ''}
          ${due > 0 ? totalRow(L.balanceDue, '\u20b9 ' + fmtRs(due)) : ''}
        </table>
      </div>
    </div>

    <div class="words">${L.amountInWords}: <b>${amountInWords(r.amount_paise)}</b></div>

    <div class="lower" style="border-top:1px solid #111827">
      <div style="flex:1.2">${remittanceBlock(r, '#111827', { compact: true })}</div>
      ${(mandir.terms || mandir.house_rules) ? `<div style="flex:1">
        <div class="cap">${L.termsConditions}</div>
        <!-- The general terms first, then the stay rules. A room bill shows
             both when the trust has both: cancellation terms apply to every
             document, "vacate by 10 am" only to this one. -->
        <div class="decl">${[mandir.terms, mandir.house_rules].filter(Boolean).join('<br>')}</div>
      </div>` : ''}
    </div>

    <div class="foot">
      <div style="flex:1.4">
        <div class="decl">${taxed ? L.gstDeclaration
          : (donation && r.is_80g_eligible && trustGrants80g(mandir) ? L.certified80g : L.computerGenerated)}</div>
      </div>
      <div style="flex:1" class="sign">${signatureBlock(mandir)}</div>
    </div>
    ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}
  </div>`
}

// ── TEMPLATE 16: Stay slip ──────────────────────────────────────────────────
// A half-sheet for a busy front desk: the room, the window, the balance, and
// nothing else. Designed narrow so it reads at full size on A5 rather than
// being scaled down like the A4 designs are.
function buildStaySlip(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, color: string): string {
  const facts = stayFacts(r)
  const money = stayMoneyRows(r)
  return `
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background:#fff; color:#111827; }
    .page { max-width:460px; margin:14px auto; background:#fff; border:1px solid #d1d5db; border-top:3px solid ${color}; }
    .head { padding:10px 14px 8px; border-bottom:1px dashed #d1d5db; }
    .logo { height:34px; width:auto; object-fit:contain; margin-bottom:3px; }
    .trust { font-size:13.5px; font-weight:800; line-height:1.2; }
    .addr { font-size:9px; color:#6b7280; margin-top:2px; line-height:1.4; }
    .kind { font-size:8.5px; letter-spacing:1.5px; text-transform:uppercase; color:${color}; font-weight:800; margin-top:5px; }
    .meta { display:flex; justify-content:space-between; font-size:9.5px; color:#4b5563; padding:5px 14px; background:#fafafa; border-bottom:1px solid #eef2f7; }
    .meta b { color:#111827; font-family:'Courier New',monospace; }
    .body { padding:9px 14px; }
    .who { font-size:13px; font-weight:700; }
    .who span { display:block; font-size:9.5px; font-weight:400; color:#6b7280; margin-top:1px; }
    table { width:100%; border-collapse:collapse; margin-top:7px; }
    td { padding:2.5px 0; font-size:10px; border-bottom:1px solid #f6f7f9; }
    td:first-child { color:#6b7280; width:46%; }
    td:last-child { text-align:right; font-weight:600; }
    tr.strong td { font-weight:800; font-size:14px; color:${color}; border-top:1.5px solid ${tint(color, 'cc', '#9ca3af')}; padding-top:3px; }
    .sign { display:flex; justify-content:space-between; align-items:flex-end; margin-top:12px; font-size:8.5px; color:#6b7280; }
    .sign .line { border-top:1px solid #9ca3af; padding-top:2px; min-width:110px; text-align:center; color:#4b5563; }
    .voided { background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; text-align:center; font-weight:700; padding:5px; font-size:10px; }
    @media print { .page{margin:0;} }
  </style>
  <div class="page">
    ${voidedBanner(r.is_voided)}
    <div class="head">
      ${logoTag(mandir)}
      <div class="trust">${mandir.name}</div>
      <div class="addr">${[mandir.address, mandir.mobile].filter(Boolean).join(' · ')}</div>
      ${mandir.show_gstin && mandir.gstin ? `<div class="addr">GSTIN ${mandir.gstin}</div>` : ''}
      <div class="kind">${docTitle(r, L.guestFolio)}</div>
    </div>
    <div class="meta">
      <span>${L.receiptNo} <b>${r.receipt_number}</b></span>
      <span>${dateStr}</span>
    </div>
    <div class="body">
      <div class="who">${r.donor?.name || L.anonymous}<span>${[r.donor?.mobile, `${L.paymentMode}: ${paymentModeText(r)}`].filter(Boolean).join(' · ')}</span></div>
      <table>
        ${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
        ${/* The lines, when there is more than the room: an extra bed, a meal,
              or every room of a group booking (tenant migration 057). One line
              is just the room, which the facts above already state. */''}
        ${(r.lines?.length ?? 0) > 1 ? r.lines!.map((l) => `<tr style="font-size:9.5px"><td style="font-size:9.5px">${l.label}${l.qty ? ` <span style="color:#6b7280">· ${l.qty}</span>` : ''}</td><td style="font-size:9.5px">₹ ${fmtRs(l.amount_paise)}</td></tr>`).join('') : ''}
        ${money.map(([k, v, strong]) => `<tr class="${strong ? 'strong' : ''}"><td>${k}</td><td>${v}</td></tr>`).join('')}
      </table>
      ${paymentFooter(r, color, { compact: true, stay: false })}
      <div class="sign">
        <span>${L.computerGenerated}</span>
        <span class="line">${L.authorisedSignatory}</span>
      </div>
    </div>
  </div>`
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOM DESIGN
//
// A trust composes a receipt from a fixed vocabulary of blocks (see
// `receiptDefinition.ts` for why it is data and not markup) and this renders
// it. One layout, every part optional and reorderable — which is what a trust
// actually asks for: "our name bigger", "invocation at the top", "drop the 80G
// row", "bank details in a box at the bottom", "add our own line".
//
// It deliberately calls the SAME shared blocks the shipped designs call, so a
// custom design inherits the page fitting, the remittance degradation rules
// and the statutory gates instead of reimplementing them — and cannot be used
// to print a registration number the trust does not hold.
// ─────────────────────────────────────────────────────────────────────────────

/** Vertical rhythm per density. One place, so the three stay proportional. */
const DENSITY_GAP: Record<DefinitionDensity, number> = { compact: 6, normal: 10, roomy: 15 }

/** The frame around the sheet. `none` still leaves the page's own margin. */
function definitionFrameCss(frame: DefinitionFrame, accent: string): string {
  if (frame === 'none') return 'border:none'
  if (frame === 'hairline') return `border:1px solid ${accent}33`
  if (frame === 'double') return `border:3px double ${accent}`
  return `border:1.5px solid ${accent}`
}

/**
 * A trust's own text in the receipt's language.
 *
 * Falls back to English rather than showing nothing: a trust that wrote its
 * closing line once, in English, still wants it on a Hindi receipt. Escaped by
 * `escapeDeep` before any of this runs? NO — the definition is not part of the
 * receipt payload, so it is escaped here, at its own door.
 */
function definitionText(text: LocalisedText, lang: string | undefined): string {
  const pick = (text as Record<string, string | undefined>)[lang ?? 'en'] ?? text.en ?? ''
  return pick
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildCustom(
  r: ReceiptData,
  dateStr: string,
  mandir: NonNullable<ReceiptData['mandir']>,
  rawDefinition: unknown,
): string {
  // Parsed HERE as well as in the API. The two live in different repos and a
  // stored row outlives the code that wrote it, so the renderer does not trust
  // a definition it did not validate itself. An unusable one falls back to the
  // shipped Classic design rather than drawing nothing — a receipt must come
  // out of the printer.
  let def: ReceiptDefinition
  try {
    def = parseDefinition(rawDefinition)
  } catch {
    return buildClassic(r, dateStr, mandir, mandir.primary_color || '#0D1B2E')
  }

  const accent = def.accent
  // The affirmative palette follows the design's own accent, so a trust that
  // picks maroon does not get a green 80G note inside a maroon frame.
  const ok = affirm(accent)
  const gap = DENSITY_GAP[def.density]
  const serif = def.font === 'serif'
  const donation = isDonationDoc(r)
  const lang = mandir.receipt_language
  const align = def.header_align

  const cap = (text: string) =>
    `<div style="font-size:8px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;font-weight:700">${text}</div>`

  const block = (name: DefinitionBlock): string => {
    switch (name) {
      case 'invocation':
        return `<div style="text-align:center;color:${accent};font-size:10.5px;letter-spacing:1.5px">॥ जय जिनेन्द्र ॥</div>`

      case 'logo':
        return logoTag(mandir) ? `<div style="text-align:${align}">${logoTag(mandir)}</div>` : ''

      case 'trust_name':
        return `<div style="text-align:${align};font-size:19px;font-weight:800;color:${accent};line-height:1.2">${mandir.name}</div>`

      case 'trust_address': {
        const parts = [mandir.address, mandir.mobile, mandir.email].filter(Boolean).join(' · ')
        return parts ? `<div style="text-align:${align};font-size:10px;color:#6b7280;line-height:1.45">${parts}</div>` : ''
      }

      case 'trust_identity': {
        const parts = identityParts(mandir)
        return parts.length
          ? `<div style="text-align:${align};font-size:9.5px;color:#4b5563">${parts.join(' &nbsp;|&nbsp; ')}</div>`
          : ''
      }

      case 'doc_title': {
        // The trust's own wording when it set one, otherwise whatever this
        // document calls itself — so a room bill through a custom design is
        // still titled as a room bill.
        const own = definitionText(def.title, lang)
        return `<div style="text-align:center;margin:${gap}px 0 0">
          <span style="display:inline-block;background:${accent};color:#fff;font-size:9.5px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;padding:3px 14px;border-radius:3px">${own || docTitle(r, L.donationReceipt)}</span>
        </div>`
      }

      case 'doc_meta':
        return `<div style="display:flex;justify-content:space-between;gap:12px;font-size:10px;color:#4b5563;border-top:1px dashed #d1d5db;border-bottom:1px dashed #d1d5db;padding:5px 2px">
          <span>${L.receiptNo} <b style="color:#111827">${r.receipt_number}</b></span>
          <span>${L.date} <b style="color:#111827">${dateStr}</b></span>
        </div>`

      case 'party': {
        const bits = [r.donor?.mobile, donorPan(r) ? `${L.pan} ${donorPan(r)}` : '', r.donor?.address]
          .filter(Boolean).join(' · ')
        return `<div>
          ${cap(donation ? L.receivedFrom : L.guest)}
          <div style="font-size:15px;font-weight:700;margin-top:1px">${r.donor?.name || L.anonymous}</div>
          ${bits ? `<div style="font-size:10px;color:#6b7280;margin-top:1px">${bits}</div>` : ''}
        </div>`
      }

      case 'amount':
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:${Math.round(gap * 0.7)}px 12px;border-radius:3px;${
          def.amount_emphasis
            ? `background:${accent}10;border-left:3px solid ${accent}`
            : `border-top:1px solid ${accent}44;border-bottom:1px solid ${accent}44`
        }">
          ${cap(amountLabel(r))}
          <div style="font-size:24px;font-weight:800;color:${accent};font-family:${serif ? 'Georgia,serif' : "'Courier New',monospace"}">₹ ${fmtRs(r.amount_paise)}</div>
        </div>`

      case 'amount_words':
        return `<div style="font-size:10px;font-style:italic;color:#6b7280">${amountInWords(r.amount_paise)}</div>`

      case 'details': {
        // The 80G row only on a gift, and only when this trust could issue
        // one — the same rule every shipped design follows.
        const rows: Array<[string, string]> = [[L.category, r.category || '—'], [L.paymentMode, paymentModeText(r)]]
        if (donation && trustGrants80g(mandir)) rows.push([L.eligible80g, r.is_80g_eligible ? L.yes : L.no])
        return `<table style="width:100%;border-collapse:collapse;font-size:11px">
          ${rows.map(([k, v]) => `<tr>
            <td style="padding:3.5px 0;color:#6b7280;width:42%;border-bottom:1px solid #f3f4f6">${k}</td>
            <td style="padding:3.5px 0;font-weight:600;text-align:right;border-bottom:1px solid #f3f4f6">${v}</td>
          </tr>`).join('')}
        </table>`
      }

      case 'items':
        return itemsBlock(r, accent)

      case 'stay':
        return stayBlock(r, accent, { compact: def.density === 'compact' })

      case 'tax_note':
        return r.is_80g_eligible && trustGrants80g(mandir) && donation
          ? `<div style="font-size:9.5px;color:${ok.text};background:${ok.bg};border:1px solid ${ok.border};border-radius:3px;padding:6px 9px;line-height:1.45">${L.valid80g}</div>`
          : ''

      case 'blessing':
        return r.is_voided ? '' : `<div style="text-align:center;font-size:10.5px;font-style:italic;color:${accent};line-height:1.45">${donation ? L.thankYou : L.thankYou}</div>`

      case 'remittance':
        // `paymentFooter` also carries when the money arrived, and the QR is
        // inside it — the trust's toggle only decides whether to ask for one.
        return paymentFooter(
          def.show_qr ? r : { ...r, upi_qr_data_uri: null },
          accent,
          { compact: def.density === 'compact' },
        )

      case 'custom_text': {
        const own = definitionText(def.custom_text, lang) || (mandir.footer ?? '')
        return own ? `<div style="text-align:center;font-size:10px;font-style:italic;color:#4b5563;line-height:1.45">${own}</div>` : ''
      }

      case 'signature':
        return signatureBlock(mandir)

      default:
        // Unreachable: `parseDefinition` rejects an unknown block. Present so
        // a block added to the vocabulary and forgotten here renders nothing
        // rather than `undefined`.
        return ''
    }
  }

  const parts = def.blocks.map(block).filter(Boolean)
  return `
  <style>
    body { font-family: ${serif
      ? "'Noto Serif','Noto Serif Devanagari',Georgia,serif"
      : "'Noto Sans','Noto Sans Devanagari','Segoe UI',Arial,sans-serif"}; background:#f7f7f8; color:#111827; }
    .page { max-width:700px; margin:20px auto; background:#fff; padding:${gap + 8}px ${gap + 14}px; ${definitionFrameCss(def.frame, accent)}; }
    .logo { max-height:52px; max-width:130px; object-fit:contain; }
    @media print { body{background:#fff;} .page{margin:0;} }
  </style>
  <div class="page">
    ${voidedBanner(r.is_voided)}
    <div style="display:flex;flex-direction:column;gap:${gap}px">${parts.map((html) => `<div>${html}</div>`).join('')}</div>
  </div>`
}

function renderBody(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>, template: string, color: string, copyLabel?: string): string {
  if (template === 'anumodana') return buildAnumodana(r, mandir, copyLabel)
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
  // A trust's own approved design. `custom` is the template id; the definition
  // travels in the payload, because the renderer has no database.
  if (template === 'custom') return buildCustom(r, dateStr, mandir, r.mandir?.template_definition)
  // Accommodation (2026-09). Selected by `room_invoice_template`, so a trust
  // can hand a guest a folio while its donors still get a devotional receipt.
  if (template === 'folio') return buildFolio(r, dateStr, mandir, color)
  if (template === 'stay_invoice') return buildStayInvoice(r, dateStr, mandir, color)
  // A strict CGST Rule 46 tax invoice. No `color` argument: a statutory form
  // does not take the trust's brand colour.
  if (template === 'room_gst') return buildRoomGst(r, dateStr, mandir)
  // One ruled design for rooms, halls, bhojanshala and gaushala: it reads the
  // document rather than being told which module sent it. No `color` argument -
  // a ruled statutory document does not take the trust's brand colour.
  if (template === 'ruled') return buildRuled(r, dateStr, mandir, copyLabel)
  if (template === 'stay_slip') return buildStaySlip(r, dateStr, mandir, color)
  return buildClassic(r, dateStr, mandir, color)
}

/**
 * ROLL GEOMETRY, IN ONE PLACE.
 *
 * The three sizes a counter actually buys, by the inch measurement printers are
 * sold under: 2" (58 mm), 3" (80 mm) and 4" (112 mm). `printable` is narrower
 * than the roll because a thermal head does not print to the paper edge — the
 * margins are mechanical, not a design choice.
 *
 * This exists as a table because the width was previously computed in two
 * places and hardcoded in a third, and they disagreed: a trust that chose the
 * 58 mm roll got a receipt laid out for 80 mm, which printed off the edge of
 * its own paper. One table, read by every roll renderer.
 */
/**
 * ── WHY EVERY ROLL CARRIES AN EXPLICIT HEIGHT, AND `auto` DOES NOT WORK ─────
 *
 * This table used to say `size: 58mm auto`, and so did the slip renderer. That
 * is INVALID CSS: `size` takes `auto` on its own, or one length, or two
 * lengths — never a length paired with `auto`. Chromium discards the whole
 * declaration and falls back to its default paper, so every thermal receipt
 * this product has ever produced declared US Letter. Measured, from the PDF
 * MediaBox the driver is handed: 215.9mm wide, on all three rolls.
 *
 * The damage is the WIDTH. A 72mm layout on 215.9mm of declared paper is
 * clipped or scaled by whatever the driver decides, and the desktop's own PDF
 * fallback — what it writes when a silent print times out, which is the normal
 * case on a machine with no printer configured — came out Letter-sized with the
 * receipt in one corner.
 *
 * So: two explicit lengths. The height cannot be computed, because a roll is
 * continuous and this renderer has no way to measure itself — the desktop
 * prints receipts with `javascript: false`, so nothing can run in the document.
 * The heights below come from measuring the real thing at each width with
 * ordinary and worst-case data (a 58mm roll wraps the most, so it needs the
 * most room: 253mm measured against 190mm on the 4" roll), plus headroom.
 *
 * They are deliberately generous, because the two failures are not equal: a
 * receipt SPLIT across two pages is torn in half by the cutter and has to be
 * reprinted, while a page taller than its content only leaves a blank tail —
 * and a continuous-feed driver in receipt mode feeds to the last printed line
 * and trims it anyway. That is also the difference between this and the old
 * behaviour, which declared Letter and got the width wrong as well.
 */
const ROLL: Record<string, { page: string; printable: string; inches: string }> = {
  thermal58: { page: '58mm 380mm', printable: '48mm', inches: '2"' },
  thermal80: { page: '80mm 300mm', printable: '72mm', inches: '3"' },
  thermal112: { page: '112mm 280mm', printable: '104mm', inches: '4"' },
}

/** Every roll size, for the paper-size checks that used to list two by hand. */
const isRoll = (paper?: string): boolean => !!paper && paper in ROLL

const rollGeom = (paper?: string) => ROLL[paper ?? ''] ?? ROLL.thermal80

/**
 * The optional rows a roll may be told to leave out.
 *
 * A type rather than an array, because nothing here needs the values at
 * runtime: `show()` tests membership of the trust's OWN stored list, and an
 * unrecognised string in that list simply never matches a field name. The
 * runtime list that IS needed — by the settings screen, to draw the checkboxes,
 * and by the API, to refuse an unknown one — lives in
 * mandiradmin-web/src/lib/thermalOptions.ts and in receipt-mandir.ts. This file
 * is vendored byte-identical into devotee-api, so it carries only what the
 * renderer itself uses.
 */
type ThermalField =
  | 'mobile' | 'pan' | 'category' | 'payment_mode'
  | 'amount_in_words' | 'registration' | 'upi_qr' | 'footer'

interface ThermalOpts {
  /** Heavier weights and pure black, for a head that has faded. */
  bold: boolean
  /** Blank millimetres after the last line, so the cut misses the text. */
  feedMm: number
  /** Break the page between copies, which is what makes a cutter fire. */
  cutBetweenCopies: boolean
  /** Which optional rows to print. */
  show: (f: ThermalField) => boolean
}

/**
 * Read the trust's roll options, defensively.
 *
 * Every default is the CURRENT behaviour, so a trust that has never opened
 * these settings gets exactly the receipt it got before this existed. That is
 * the whole contract of adding options to something already in use.
 *
 * ── WHY `feedMm` MATTERS AND IS NOT COSMETIC ────────────────────────────────
 * On a thermal printer the cutter sits 15-20 mm PAST the print head. Whatever
 * is in that gap when the cut fires is either sliced through or left hanging on
 * the next receipt. Counters work around it by hand-feeding, which wastes paper
 * and sometimes takes the total with it. 18 mm is the middle of the common
 * range and is the default.
 *
 * ── AND WHY THERE IS NO ESC/POS HERE ────────────────────────────────────────
 * A real auto-cut is an ESC/POS byte sequence (GS V) sent to the device. This
 * renderer produces HTML that Chromium prints through the OS driver — there is
 * no raw device channel anywhere in the product (the desktop bridge exposes
 * print:html, print:page and print:toPDF, and nothing else). So `cut` here
 * means "end the page", because an ESC/POS driver in receipt mode feeds and
 * cuts at page end. That is a real cut, obtained the only way this stack can
 * obtain one; claiming to send a cut command would be a lie in a comment.
 */
function thermalOpts(mandir: NonNullable<ReceiptData['mandir']>): ThermalOpts {
  const raw = mandir.receipt_thermal
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {}

  // An explicit list means "only these"; anything else means "all of them",
  // which is the behaviour every existing trust already has.
  const listed = Array.isArray(o.fields)
    ? new Set((o.fields as unknown[]).filter((f): f is string => typeof f === 'string'))
    : null

  const feed = Number(o.feed_mm)
  return {
    bold: o.bold === true,
    // Clamped: a negative feed is meaningless and a huge one silently eats a
    // roll. 0 is allowed and means the trust tears by hand.
    feedMm: Number.isFinite(feed) ? Math.min(Math.max(feed, 0), 40) : 18,
    cutBetweenCopies: o.cut_between_copies !== false,
    show: (f) => (listed ? listed.has(f) : true),
  }
}

/**
 * Thermal roll layout (plan §16). Deliberately its own minimal renderer rather
 * than a squeezed A4 template: at 72 mm of printable width the boxed,
 * two-column A4 designs are unreadable, and thermal printers render only
 * monochrome text well.
 */
function buildThermal(r: ReceiptData, dateStr: string, mandir: NonNullable<ReceiptData['mandir']>): string {
  const row = (k: string, v: string) => `<div class="tr"><span>${k}</span><span>${v}</span></div>`
  const geom = rollGeom(mandir.receipt_paper)
  const t = thermalOpts(mandir)
  // A faded head prints grey where the design asked for grey. On a roll the
  // only reliable ink is full black, so "bold" removes the greys entirely
  // rather than merely thickening the strokes.
  const ink = t.bold ? '#000' : '#333'
  const w = (normal: number, heavy: number) => (t.bold ? heavy : normal)
  return `
  <style>
    @page { size: ${geom.page}; margin: 0; }
    body { background:#fff; font-family:'Arial',sans-serif; }
    .roll { width:${geom.printable}; margin:0 auto; padding:6mm 2mm; color:#000; font-size:${t.bold ? '11.5px' : '11px'}; line-height:1.5; ${t.bold ? 'font-weight:600;' : ''} }
    .roll .name { text-align:center; font-size:14px; font-weight:800; }
    .roll .addr { text-align:center; font-size:10px; margin-bottom:6px; }
    .roll .title { text-align:center; font-weight:${w(700, 800)}; border-top:1px dashed #000; border-bottom:1px dashed #000; padding:4px 0; margin-bottom:6px; }
    /* A value that does not fit beside its label takes the next line WHOLE,
       right-aligned, and breaks only if it is wider than the paper itself.
       Breaking it in place split a receipt number in two - "PRS/2026-" over
       "27/000001" - which read as the number being cut off (2026-09-25). So
       the value may not shrink (flex-shrink 0) and the row wraps instead. */
    .tr { display:flex; flex-wrap:wrap; justify-content:space-between; column-gap:8px; }
    /* The label keeps its width and the VALUE wraps. Without min-width:0 a flex
       item refuses to shrink below its content, so a long value ran off the
       paper: on a 58mm roll a registration number like SOC/2015/BEAWAR/000123
       measured 236px against 219px of paper and printed off the edge, on every
       design. break-all rather than normal wrapping because these are
       identifiers with no spaces to break at. */
    .tr span:first-child { color:${ink}; flex:none; white-space:nowrap; }
    .tr span:last-child { font-weight:${w(600, 700)}; text-align:right; flex:1 0 auto; max-width:100%; overflow-wrap:anywhere; }
    .amt { text-align:center; font-size:${t.bold ? '17px' : '16px'}; font-weight:800; border-top:1px dashed #000; border-bottom:1px dashed #000; padding:5px 0; margin:6px 0; }
    .words { font-size:10px; font-style:italic; text-align:center; margin-bottom:6px; }
    .note { font-size:9.5px; text-align:center; margin-top:6px; }
    /* The mechanical gap between the print head and the cutter. Without it the
       cut lands in the middle of the last line it printed. */
    .feed { height:${t.feedMm}mm; }
    .voided-t { text-align:center; font-weight:800; border:1px solid #000; padding:3px; margin-bottom:6px; }
    .upi-qr { text-align:center; margin-top:8px; }
    .upi-qr img { width:32mm; height:32mm; }
    .upi-cap { font-size:9.5px; }
    .upi-id { font-family:monospace; }
    .copy-banner { text-align:center; font-size:10px; font-weight:700; letter-spacing:1px; margin-bottom:4px; }
    /* A bill line: the DESCRIPTION wraps and the amount keeps its width - the
       reverse of a label row. "Room 101 · 2 nights × ₹1500" in Hindi ran 29px
       off a 58mm roll with the label held on one line. */
    .lines .tr span:first-child { flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }
    .lines .tr span:last-child { flex:none; word-break:normal; white-space:nowrap; }
  </style>
  <div class="roll">
    <div class="name">${mandir.name}</div>
    <div class="addr">${mandir.address}${mandir.mobile ? '<br>' + mandir.mobile : ''}</div>
    <div class="title">${docTitle(r, L.donationReceipt)}</div>
    ${r.is_voided ? `<div class="voided-t">VOID</div>` : ''}
    ${row(L.receiptNo, r.receipt_number ?? '—')}
    ${row(L.date, dateStr)}
    ${row(L.receivedFrom, r.donor?.name || L.anonymous)}
    ${t.show('mobile') && r.donor?.mobile ? row(L.mobile, r.donor.mobile) : ''}
    ${t.show('pan') && donorPan(r) ? row(L.pan, donorPan(r)!) : ''}
    ${t.show('category') ? row(L.category, r.category || L.generalDonation) : ''}
    ${t.show('payment_mode') ? row(L.paymentMode, paymentModeText(r)) : ''}
    ${thermalLines(r, mandir, row)}
    <div class="amt">₹ ${fmtRs(r.amount_paise)}</div>
    ${t.show('amount_in_words') ? `<div class="words">${amountInWords(r.amount_paise)}</div>` : ''}
    ${r.is_80g_eligible && trustGrants80g(mandir) ? `<div class="note">${L.valid80g}</div>` : ''}
    ${t.show('registration') && mandir.registration_number ? row(L.registrationNo, mandir.registration_number) : ''}
    ${t.show('registration') && mandir.darpan_number ? row(L.darpanNo, mandir.darpan_number) : ''}
    ${t.show('upi_qr') ? upiQrBlock(r) : ''}
    ${t.show('footer') ? `<div class="note">${mandir.footer || (isDonationDoc(r) ? L.thankYou : L.thanks)}</div>` : ''}
    <div class="feed"></div>
  </div>`
}

/**
 * A bill's lines and its GST on the roll. The roll printed only the total, so
 * a prasad sale of ₹787.50 on an 80 mm printer never said it was ₹750 of
 * ladoo and ₹37.50 of GST - the one thing a GST bill has to say - and a
 * multi-head gift never listed its heads. One row per line (with its quantity),
 * then the taxable value and each tax, only when tax was actually charged by a
 * trust registered to charge it.
 */
function thermalLines(r: ReceiptData, mandir: NonNullable<ReceiptData['mandir']>, row: (k: string, v: string) => string): string {
  const lines = (r.lines ?? []).filter((l) => l && typeof l.label === 'string')
  const tax = r.tax ?? null
  const taxTotal = (tax?.cgst_paise ?? 0) + (tax?.sgst_paise ?? 0) + (tax?.igst_paise ?? 0)
  const gst = taxTotal > 0 && !!mandir.gst_enabled
  const itemised = lines.length > 1 || lines.some((l) => l.qty) || gst
  if (!itemised || !lines.length) return ''
  const out = lines.map((l) => row(`${l.label}${l.qty ? ` × ${l.qty}` : ''}`, `₹${fmtRs(Number(l.amount_paise))}`))
  if (gst) {
    out.push(row(L.subtotal, `₹${fmtRs(r.amount_paise - taxTotal)}`))
    for (const k of ['cgst', 'sgst', 'igst'] as const) {
      const v = tax?.[`${k}_paise`] ?? 0
      if (v > 0) out.push(row(k.toUpperCase() + (tax?.rate_pct ? ` @ ${k === 'igst' ? tax.rate_pct : tax.rate_pct / 2}%` : ''), `₹${fmtRs(v)}`))
    }
  }
  return `<div class="lines" style="border-top:1px dashed #000;margin-top:4px;padding-top:4px">${out.join('')}</div>`
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
  // Same table the receipt renderer reads, so a slip and a receipt on the same
  // roll cannot disagree about how wide that roll is.
  const geom = rollGeom(mandir.receipt_paper);
  const t = thermalOpts(mandir);
  const width = geom.printable;
  const page = geom.page;
  return `
  <style>
    @page { size: ${page}; margin: 0; }
    /* A slip is torn off at the window like a receipt is, so it needs the same
       clearance past the print head. */
    .slip .feed { height:${t.feedMm}mm; }
    body { background:#fff; font-family:'Arial',sans-serif; }
    .slip { width:${width}; margin:0 auto; padding:5mm 2mm; color:#000; font-size:11px; line-height:1.45; }
    .slip .name { text-align:center; font-size:13px; font-weight:800; }
    .slip .addr { text-align:center; font-size:9.5px; margin-bottom:5px; }
    .slip .kind { text-align:center; font-weight:700; letter-spacing:1px; text-transform:uppercase;
                  border-top:1px dashed #000; border-bottom:1px dashed #000; padding:3px 0; margin-bottom:5px; }
    /* The number is the point of the whole slip. */
    .slip .no { text-align:center; font-size:17px; font-weight:800; letter-spacing:1px; margin:2px 0 5px; }
    /* Same rule as a roll receipt's rows (.tr): the label never wraps, and a
       value that does not fit beside it takes the next line whole instead of
       being split mid-number (a token's receipt number, 2026-09-25). */
    .sr { display:flex; flex-wrap:wrap; justify-content:space-between; column-gap:8px; }
    .sr span:first-child { flex:none; white-space:nowrap; }
    .sr span:last-child { font-weight:600; text-align:right; flex:1 0 auto; max-width:100%; overflow-wrap:anywhere; }
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
    <div class="feed"></div>
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
    && (template === 'token' || template === 'compact' || template === 'plate')
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
    ${mandir.template === 'plate'
      // ── A LAYOUT WITHOUT THE RUNNING NUMBER ────────────────────────────────
      // Asked for directly: ten thalis should produce ten tokens that each say
      // "1 plate", not "1 / 10" ... "10 / 10". The numbering exists so a torn
      // off token cannot be mistaken for the whole sale, which matters when a
      // family is handed the strip and presents it in pieces. It gets in the
      // way when the tokens are handed out individually - a devotee holding
      // "7 / 10" reads it as a queue position or a shortfall, and asks.
      //
      // The plate count TAKES THE NUMBER'S PLACE rather than just being
      // deleted. The big line is the only thing readable at arm's length
      // across a counter, and a token whose largest text is the trust's name
      // is a token the server has to lean in to read. Measured side by side:
      // with the number simply removed, the tallest thing left was 11px.
      ? `<div class="of">${L.onePlate}</div>`
      : `<div class="of">${index} / ${of}</div>`}
    ${meal ? `<div class="meal">${meal}</div>` : ''}
    ${mandir.template === 'plate'
      // The words are already the big line above, so this carries the rate
      // alone rather than repeating "1 plate" underneath itself.
      ? (rate > 0 ? `<div class="plate">₹ ${fmtRs(rate)}</div>` : '')
      : `<div class="plate">${L.onePlate}${rate > 0 ? ` · ₹ ${fmtRs(rate)}` : ''}</div>`}
    ${slipRow(L.receiptNo, r.receipt_number ?? '—')}
    ${slipRow(L.date, dateStr)}
    <div class="note">${mandir.footer || L.thankYou}</div>
  </div>`;
}

/**
 * Designs that ARE a whole sheet of paper.
 *
 * Anumodana draws a double frame to the edge of a 148 mm sheet and carries its
 * own 5 mm inset, so a page margin on top of that insets it twice and it no
 * longer fits the paper it was drawn for. Every other design is a block that
 * sits inside a margin like an ordinary document.
 */
const SHEET_DESIGNS: ReadonlySet<string> = new Set(['anumodana'])

/**
 * Designs whose single copy fills a page, so two copies are two SHEETS.
 *
 * Separate from SHEET_DESIGNS on purpose: that set is about how a design is
 * drawn (no paper margin, its own scale, the copy label inside its title). This
 * one is only about whether a donor copy and an office copy can share paper.
 *
 * Measured, not guessed — an 80G certificate copy is 737px on A5 against a
 * 733px box, while a token is 230px and is meant to tile two-up and be cut.
 * qa-receipt-print asserts the resulting page counts.
 */
const FULL_PAGE_DESIGNS: ReadonlySet<string> = new Set(['80g'])

/** Paper, in mm. Portrait, and the only two full-page sizes Settings offers. */
const PAPER_MM: Record<'a4' | 'a5', { w: number; h: number; css: string }> = {
  a4: { w: 210, h: 297, css: 'A4' },
  a5: { w: 148, h: 210, css: 'A5' },
}

/**
 * The page rules for one document — the ONLY place a page size is decided.
 *
 * ── WHY A SCALE FACTOR AND NOT A MEASUREMENT ────────────────────────────────
 * Twelve of the thirteen designs are drawn for A4. Printed on A5 they overflow,
 * and four of them still overflow after being reflowed into the narrower paper
 * — narrower wrapping makes several of them TALLER, not shorter (acknowledgement
 * went 878px to 942px when I measured it).
 *
 * The obvious fix is to measure the rendered height and shrink to fit, which is
 * what devotee-api's PDF service does. **That cannot work here.** The desktop
 * shell prints a receipt by loading it with `javascript: false`
 * (mandiradmin-desktop electron/main.ts, `print:html`), so no script in a
 * receipt ever runs on the counter machine where receipts are printed most.
 * A JS fit would have silently done nothing exactly where it mattered.
 *
 * So the fit is geometric instead, and it is a proof rather than a measurement:
 * A5 is A4 halved, so its sides are 1/√2 of A4's. A document that fits A4
 * therefore fits A5 at 0.7071 — whatever its content. This is the same thing a
 * printer driver's "scale to A5" does, and it holds for a receipt with forty
 * line items as much as for one with one.
 *
 * Which leaves ONE obligation: every design must fit A4 at natural size.
 * `qa/qa-receipt-pages.mjs` measures that, per design, on both papers.
 */
function pageRules(paper: string | undefined, template: string): string {
  const a5 = paper === 'a5'
  const size = PAPER_MM[a5 ? 'a5' : 'a4']
  const sheet = SHEET_DESIGNS.has(template)
  // A sheet design keeps 6mm of paper margin, not 0. Reported 2026-09-25/26:
  // "A4 and A5 print in the printer is not proper, but the PDF is" - the
  // photographed Anumodana came off an inkjet cut on the right and bottom. A
  // PDF has no unprintable border; a printer does (3-5mm on an office inkjet),
  // and with a 0mm @page margin the driver shrank the usable page under the
  // design and dropped its edge. 6mm clears every such border, and
  // fitSheetToPage() measures against this margin, so the design shrinks to
  // fit inside it rather than losing its edge.
  const margin = sheet ? 6 : 8
  // 0.69, not the exact 0.7071: at the exact ratio a design that fits A4 with
  // a pixel to spare comes out a pixel over on A5, and I measured that
  // happening (the acknowledgement room bill). 2% of headroom absorbs the
  // rounding; the size difference is invisible.
  //
  // A sheet design is NOT in fact drawn at A5, which is what the 0.96 here used
  // to assume. Measured: the Anumodana sheet is 888px tall with ordinary data
  // and 1001px with a long trust name, a full address and a long footer. A5's
  // printable box is 794px. So it needed 0.894 at best and 0.793 at worst, and
  // 0.96 fitted neither — it printed a second, nearly empty A5 page, which is
  // the extra page the client photographed. A PDF page count found it; the
  // screen layout could not, because pagination only happens when printing.
  //
  // 0.78 covers the measured worst case with a little headroom. It is a real
  // trade: an ordinary A5 Anumodana now prints ~12% smaller than it strictly
  // needs to, because one constant has to serve both. Correct and slightly
  // small beats silently paginated — a receipt whose second page is blank gets
  // handed to a devotee as two sheets, one of them meaningless.
  //
  // The proper fix is for the sheet to FLOW to its paper instead of being a
  // fixed-height artifact that gets scaled; that is a redesign of
  // buildAnumodana, not a constant. qa-receipt-print counts PDF pages so this
  // cannot drift back either way.
  //
  // 0.73 since the 6mm margin above (2026-09-26): the printable box is 198mm,
  // not 210, so the same worst case needs 0.78 x 198/210 = 0.735.
  const scale = !a5 ? 1 : sheet ? 0.73 : 0.69

  // ── ONE COPY PER SHEET, FOR DESIGNS THAT FILL A SHEET ─────────────────────
  // Not the same question as `sheet`. `sheet` decides paper margin, scale and
  // whether the copy label goes in the title; this decides whether a donor copy
  // and an office copy can SHARE a page.
  //
  // Measured on A5, stress data: an 80G certificate copy is 737px against a
  // 733px printable box. It is not a sheet design - it keeps its 8mm margin and
  // its 0.69 scale - but two of them plus the 32px cut-line margin came to
  // 1509px against the 1466px that two pages give, so the office copy spilled
  // onto a third, near-empty page. Exactly the symptom the sheet branch below
  // was written for, on a design that branch did not cover.
  //
  // Lowering the scale would not have fixed it: at 0.68 each copy fits, but two
  // plus the separator still exceed two pages by 19px. The separator is the
  // part that has to go, which is what this does.
  //
  // Small designs are deliberately excluded - a token is 230px, and tiling two
  // on one sheet to be cut apart is the point of the cut line.
  const ownPagePerCopy = sheet || FULL_PAGE_DESIGNS.has(template)
  return `@page { size: ${size.css}; margin: ${margin}mm; }
  ${scale === 1 ? '' : `/* A4 design on A5 paper — see pageRules(). Not inside @media print:
     the Settings preview renders this same document, and a preview that shows
     a size the printer will not produce is the one thing that screen is for. */
  .receipt-copy { zoom: ${scale}; }`}
  ${!ownPagePerCopy ? '' : `/* A full-page design fills the page, so a donor copy and an office copy are two
     SHEETS — the dashed cut line between them belongs to designs that share
     one. Left in, its 32px of margin pushed the second copy onto a third page. */
  .copy-sep { display: none; }
  .receipt-copy { page-break-after: always; break-after: page; }
  .receipt-copy:last-of-type { page-break-after: auto; break-after: auto; }`}`
}

/**
 * One document per plate token, for printers that cut per JOB.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * A bhojanshala sale of three thalis prints three tokens, and the dining hall
 * collects one per plate — so they have to arrive as three separate pieces of
 * paper. The renderer already puts each token on its own PAGE on a roll, and
 * that is not enough: most ESC/POS drivers cut at the end of the JOB rather
 * than at the end of every page. Photographed at the counter: three tokens
 * (1/3, 2/3, 3/3) came out as one continuous strip with one cut at the bottom.
 *
 * There is no raw device channel anywhere in this product — the desktop bridge
 * is print:html / print:page / print:toPDF and nothing else — so an ESC/POS
 * cut command between tokens is not available. What IS available is ending the
 * job, which every such driver does cut on. So: N tokens, N documents, N jobs.
 *
 * Returns null when this does not apply — a sheet tiles its tokens to be cut
 * by hand, and a single-token sale is a single document either way. The caller
 * then prints the one document it would have printed before.
 */
export function buildPlateTokenDocuments(input: ReceiptData): string[] | null {
  if (!printsTokenPerPlate(input)) return null
  // Sheet paper is unaffected: the tokens tile on one page and are cut along
  // the dashed lines, which is the point of that layout.
  if (!isRoll(input.mandir?.receipt_paper)) return null

  const n = Number((input.meta as Record<string, unknown>).tokens)
  const docs: string[] = []
  for (let i = 1; i <= n; i++) {
    // Each document carries ONE token, so it is a complete job on its own.
    // `plate_index` narrows the existing renderer to a single plate rather
    // than duplicating buildPlateToken's layout here — one place draws a
    // token, and this only chooses how many jobs it goes into.
    docs.push(buildReceiptHtml({
      ...input,
      meta: { ...(input.meta as Record<string, unknown>), plate_index: i },
    }))
  }
  // The office copy, when the trust keeps one, is the single combined slip —
  // the counter reconciles the SALE, not the plates. It is the last job so the
  // devotee's tokens are already off the printer when it prints.
  if (input.mandir?.receipt_copies === 'both') {
    docs.push(buildReceiptHtml({
      ...input,
      meta: { ...(input.meta as Record<string, unknown>), plate_index: 0 },
    }))
  }
  return docs
}

export function buildReceiptHtml(input: ReceiptData): string {
  // A document that has not been numbered yet arrives with receipt_number:
  // null; every template interpolates it directly, so the guest's copy read
  // "Receipt null". Substitute once here rather than at all fifteen sites.
  let r: ReceiptData = escapeDeep({ ...input, receipt_number: input.receipt_number || '—' })
  // An 80G number that is only spaces is no number: without this, the header
  // strips printed "80G" with nothing after it, and the Yes/No row appeared at
  // a trust that cannot grant 80G. Blank it once, so every design agrees.
  if (r.mandir && !String(r.mandir.reg_80g_number ?? '').trim()) r = { ...r, mandir: { ...r.mandir, reg_80g_number: null } }
  const mandir = r.mandir ?? { name: 'Mandir', address: '', template: 'anumodana', primary_color: '#0D1B2E' }
  // The trust's own words on top of ours. One line, because every design
  // already reads every word it prints through `L` - so "Dan" becomes "Bhet"
  // on all seventeen designs and both copies at once, with no per-design work.
  L = receiptLabelsFor(mandir.receipt_language, mandir.label_overrides)
  // Month names in the print language too: a Hindi receipt read "22 September
  // 2026". Latin digits stay, so a number reads the same on every receipt a
  // trust issues, whatever its language.
  dateLocale = DATE_LOCALES[mandir.receipt_language ?? ''] ?? 'en-IN'
  const dateStr = new Date(r.date).toLocaleDateString(dateLocale, { day: '2-digit', month: 'long', year: 'numeric' })
  // A Bhojanshala sale arrives with its category composed IN ENGLISH by the API
  // ("Bhojanshala — breakfast (1 plate)"), so a token printed in Hindi still
  // carried an English line. Say the meal and the count in the print language;
  // the title above it already says which counter it is.
  {
    const meta = (r.meta ?? {}) as Record<string, unknown>
    if (r.slip_kind === 'bhojanshala' && meta.meal_type) {
      const n = Number(meta.tokens ?? 0)
      r = { ...r, category: `${mealName(meta.meal_type)}${n > 0 ? ` × ${n}` : ''}` }
    }
  }
  // Anumodana is the default design (founder decision 2026-09-24): a trust
  // that never chose one prints the sheet its donors are sent on WhatsApp.
  let template = mandir.template || 'anumodana'
  // The 80G template makes a statutory tax-exemption claim, so it must never be
  // used for a donation that is not 80G-eligible — NOR for a trust that holds
  // no 80G registration at all. The second condition is new: a trust could
  // previously select the 80G template in Settings and print a certificate
  // shaped document with an empty registration line on it.
  if (template === '80g' && (!r.is_80g_eligible || mandir.eighty_g_enabled === false)) {
    template = 'classic'
  }
  // ── A TRUST WITH NO GSTIN MUST NOT ISSUE A TAX INVOICE ────────────────────
  // The same class of guard as the 80G one above, and a firmer rule than it.
  //
  // Many temple trusts are not GST-registered at all. Under s.31 CGST only a
  // REGISTERED person may issue a tax invoice, and s.32 prohibits an
  // unregistered person from collecting tax — so a document headed TAX INVOICE
  // from a trust with no GSTIN is not merely untidy, it is a document it is not
  // entitled to issue, at ₹10,000 or the tax involved under s.122.
  //
  // An unregistered person cannot even issue a "bill of supply": that is for a
  // registered person supplying exempt goods or paying under composition
  // (s.31(3)(c)). What they issue is an ordinary commercial receipt, which is
  // what `stay_invoice` prints when it sees no tax — it titles itself Guest
  // Folio and omits every tax row. So the fallback is to that rather than to a
  // donation design, and a trust that picked this template still gets the
  // structured accommodation document it was after.
  if (template === 'room_gst' && !mandir.gst_enabled) {
    template = 'stay_invoice'
  }
  const color = mandir.primary_color || '#0D1B2E'
  // `isRoll`, not a hand-written list of two: adding the 4" roll to that list
  // and missing this line would have printed it through the A4 renderer.
  const thermal = isRoll(mandir.receipt_paper)
  // A counter slip is chosen by TEMPLATE, not by paper: a trust may print a
  // token on A5 (a half-sheet cut in two at the window is common) and still
  // want the token layout, while another prints full receipts on an 80 mm roll.
  // 'plate' is the token layout without the running number - see
  // buildPlateToken. It is a slip like the other two.
  const slip = template === 'token' || template === 'compact' || template === 'plate'

  const one = (copyLabel?: string) => {
    const body = slip
      ? buildSlip(r, dateStr, mandir, template === 'compact')
      : thermal
        ? buildThermal(r, dateStr, mandir)
        : renderBody(r, dateStr, mandir, template, color, copyLabel)
    // A full-sheet design carries the copy label in its own title instead (see
    // buildAnumodana): a banner above it would not fit on the page it fills.
    const banner = copyLabel && !SHEET_DESIGNS.has(template) ? copyBanner(copyLabel) : ''
    // The QR used to be APPENDED here, after the body — outside the design's
    // frame, in none of its colours, below its signature. That is the "QR is
    // not properly aligned" the client reported. It now lives inside
    // remittanceBlock(), which every design places within its own layout.
    // A thermal roll still embeds its own (buildThermal), and a token has no
    // room for one — it is collected at the counter that just took the money.
    return `<div class="receipt-copy">${banner}${body}</div>`
  }

  // "Both" prints the donor's copy and the office's file copy on one job, so
  // the counter doesn't have to run the print twice and risk a mismatch.
  // On a ROLL the separator is a page break, not a rule.
  //
  // A dashed line asks the counter to tear two receipts apart by hand and
  // usually means they come off as one long strip. Ending the page is what
  // makes an ESC/POS driver in receipt mode feed and cut, so the donor's copy
  // arrives separately from the office's — which is the entire point of
  // printing both in one job.
  const rollCut = thermal && thermalOpts(mandir).cutBetweenCopies
  let copies = mandir.receipt_copies === 'both'
    ? one(L.donorCopy)
      + (rollCut ? `<div class="roll-cut"></div>` : `<div class="copy-sep"></div>`)
      + one(L.officeCopy)
    : one()

  // One token per plate (tenant migration 039). The devotee gets N tokens; the
  // office copy, when the trust keeps one, is still the single combined slip —
  // the counter reconciles the SALE, not the plates. On a roll every token is
  // its own page, so a cutter separates them; on A4/A5 they tile, to be cut
  // along the dashed lines.
  if (printsTokenPerPlate(r)) {
    const n = Number((r.meta as Record<string, unknown>).tokens)
    // ── ONE TOKEN, WHEN ASKED FOR ONE ───────────────────────────────────────
    // `plate_index` narrows this document to a single plate, so a caller can
    // print N tokens as N separate JOBS. That is not the same as N pages: most
    // ESC/POS drivers cut at the end of the job, not of each page, so a
    // three-token job came off the printer as one strip with one cut.
    // buildPlateTokenDocuments() is the caller; 0 means the office copy alone.
    // Absent means the whole set in one document, which is what a SHEET wants
    // (its tokens tile and are cut by hand) and what every existing caller
    // gets unchanged.
    const only = Number((r.meta as Record<string, unknown>).plate_index ?? NaN)
    const single = Number.isInteger(only)
    const from = single ? only : 1
    const to = single ? only : n
    // ── ON A ROLL, ONE JOB WITH ONE TOKEN PER PAGE ─────────────────────────
    // Founder decision 2026-09-28: a sale's tokens print "all in one go", as
    // ONE job, and the counter's printer driver is set to cut after every page.
    // So the tokens are separated by .roll-cut, not by a CSS break alone: the
    // desktop sizes a roll page to the tallest section BETWEEN .roll-cut
    // markers (print-geometry.ts), and without them the whole set measured as
    // one page as tall as every token together.
    const sep = thermal ? '<div class="roll-cut"></div>' : ''
    const tokens = from < 1 ? '' : Array.from({ length: to - from + 1 }, (_, i) =>
      `<div class="plate-token">${buildPlateToken(r, dateStr, mandir, from + i, n)}</div>`).join(sep)
    // The office copy prints with the set, or alone when plate_index is 0.
    const wantsOffice = mandir.receipt_copies === 'both' && (!single || only === 0)
    const office = wantsOffice
      ? `${tokens ? sep : ''}<div class="plate-office">${one(L.officeCopy)}</div>`
      : ''
    // Last in the document on purpose: the office copy carries the slip
    // styles again, and its roll-sized @page must not win on A4/A5.
    const layout = `<style>
  .plate-token { page-break-inside:avoid; break-inside:avoid; }
  ${thermal
    // Block layout: Chromium ignores page breaks between flex items.
    // The .roll-cut between tokens ends each page (see above); a second
    // forced break here could leave a blank page on some drivers.
    ? ``
    : `@page { size: ${mandir.receipt_paper === 'a5' ? 'A5' : 'A4'}; margin: 8mm; }
  /* Tokens tile on the sheet and are cut apart, so they are never scaled to
     the paper the way a full document is — a smaller token is just harder to
     read at the window. */
  .plate-sheet { display:flex; flex-wrap:wrap; justify-content:center; }
  .plate-sheet .plate-token { border:1px dashed #666; }
  .plate-office { page-break-before:always; break-before:page; }`}
</style>`
    copies = `${slipStyles(mandir)}<div class="plate-sheet" data-plate-tokens="${n}">${tokens}</div>${office}${layout}`
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt ${r.receipt_number}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  /* TABULAR FIGURES, EVERYWHERE. Measured: not one of the seventeen designs
     asked for them, so a column of amounts was set in proportional numerals
     and the digits did not line up under each other - 3,360.00 above 200.00
     with the decimal points in different places. It is the single most visible
     difference between a receipt that looks typeset and one that looks typed.

     Set on the body rather than on the money cells: a receipt is mostly
     figures - amounts, dates, a receipt number, a PAN, a GSTIN - and all of
     them read better aligned. Declared once here so no design has to remember
     it, and the lining-nums companion stops a font with old-style figures
     dropping the 3, 4, 7 and 9 below the baseline.

     NO BACKTICKS IN THIS COMMENT. It lives inside a template literal, so a
     backtick here ends the literal and the CSS after it becomes code. That is
     the fourth time this file has caught me with it. */
  body{font-variant-numeric:tabular-nums lining-nums;font-feature-settings:'tnum' 1,'lnum' 1;}
  .copy-banner{text-align:center;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#6b7280;padding:8px 0 0;}
  .copy-sep{border-top:1px dashed #9ca3af;margin:16px 0;}
  /* The roll separator. Zero height, because it draws nothing: it exists only
     to end the page.
     A PAGE BREAK IS NOT A CUT. That was the assumption here and it is wrong:
     most ESC/POS drivers cut at the end of the JOB, not at the end of each
     page, so a three-token job came off the printer as one strip with a single
     cut at the bottom - photographed at the counter. Ending the page is still
     right (it keeps a token from being split across a tear), but a document
     that must arrive as N separate pieces has to be printed as N separate
     JOBS. printReceiptDocuments() does that; see buildPlateTokenDocuments. On
     screen it is invisible, which is correct - a preview of a cut is nothing
     to look at. */
  .roll-cut{height:0;page-break-after:always;break-after:page;}
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
  ${thermal || slip ? '' : pageRules(mandir.receipt_paper, template)}
</style>
</head><body>${copies}${mandir.print_colour === 'bw' ? BLACK_AND_WHITE : ''}<script>window.onload=()=>{window.print()}</script></body></html>`
}

/**
 * Black and white, for a mono printer (tenant migration 058).
 *
 * Asked for from a counter (2026-09-25). The designs are drawn in the trust's
 * brand colour with tinted boxes; on a black-and-white laser the tints print as
 * grey blocks and a light brand colour as text too faint to read. This prints
 * every design as pure black on white instead: black text and rules, no tinted
 * backgrounds, the logo and the ornaments in greyscale.
 *
 * Placed LAST in the body and marked !important throughout, because every
 * design carries its own <style> inside the body and paints some colours in
 * style="" attributes: an !important author rule is the one thing that
 * outranks both. Pure CSS - the desktop prints receipts with javascript off.
 */
const BLACK_AND_WHITE = `<style>
  *{color:#000 !important;background-color:transparent !important;background-image:none !important;
    border-color:#000 !important;box-shadow:none !important;text-shadow:none !important;
    -webkit-print-color-adjust:economy !important;print-color-adjust:economy !important;}
  html,body{background:#fff !important;}
  img,svg{filter:grayscale(1) !important;}
</style>`
