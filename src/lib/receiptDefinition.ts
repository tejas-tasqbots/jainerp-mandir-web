/**
 * A TRUST-AUTHORED RECEIPT DESIGN, as data.
 *
 * ── WHY THIS IS NOT HTML ────────────────────────────────────────────────────
 * The obvious way to let a trust design its own receipt is to let it write the
 * markup. That cannot be done here, and the reason is worth stating plainly
 * because it will be proposed again:
 *
 *   - `escapeDeep()` escapes the DATA in a receipt, not the template. A receipt
 *     is written into a SAME-ORIGIN iframe in the admin app, so trust-authored
 *     markup is stored XSS against every user of that tenant — including the
 *     temple_admin whose session can move money.
 *   - The same markup is rendered by headless Chromium inside devotee-api to
 *     produce the donor's PDF. There it reaches the network and the filesystem.
 *   - A trust is not a hostile party, but a trust's account can be taken, and
 *     "the customer typed it" is not a defence for either of the above.
 *
 * So a trust composes from a fixed vocabulary instead, and OUR renderer turns
 * that into markup. Everything below is an enum, a boolean, a bounded string
 * or a hex colour. There is no field into which markup can be smuggled — the
 * text fields are escaped like any other receipt data, and nothing here
 * becomes a class name, a style, a URL or an attribute.
 *
 * ── WHAT A TRUST ACTUALLY CONTROLS ──────────────────────────────────────────
 * Rather than parameterise all sixteen shipped designs — sixteen layouts each
 * growing a dozen conditionals — a custom design is ONE canonical layout with
 * every part of it optional and reorderable. That is what a trust asks for in
 * practice: "our name bigger", "the invocation at the top", "drop the 80G row",
 * "put the bank details in a box at the bottom", "add our own line about
 * anumodana".
 *
 * VENDORED: byte-identical in devotee-api (src/receipts/receiptDefinition.ts),
 * because the donor's PDF must render a trust's approved design too.
 * `node qa/qa-comms-catalog.mjs` fails if the copies drift.
 */

import type { ReceiptLang } from './receiptLabels'

/** The blocks a custom design is built from, in the order a trust picks. */
export const DEFINITION_BLOCKS = [
  'invocation',   // ॥ जय जिनेन्द्र ॥
  'logo',
  'trust_name',
  'trust_address',
  'trust_identity', // PAN / registration no. / Darpan no.
  'doc_title',
  'doc_meta',     // receipt no. + date
  'party',        // who paid, and their contact
  'amount',
  'amount_words',
  'details',      // category, payment mode, 80G row
  'items',        // the itemised table, when the document has lines
  'stay',         // check-in/check-out, for an accommodation document
  'tax_note',     // the 80G certification paragraph
  'blessing',     // the anumodana / thank-you line
  'remittance',   // how to pay the trust, and the QR
  'custom_text',  // the trust's own line
  'signature',
] as const
export type DefinitionBlock = (typeof DEFINITION_BLOCKS)[number]

/** Blocks a trust may NOT remove, because a receipt without them is not one. */
export const REQUIRED_BLOCKS: readonly DefinitionBlock[] = [
  'trust_name', 'doc_title', 'doc_meta', 'amount',
]

export const DEFINITION_FRAMES = ['none', 'hairline', 'single', 'double'] as const
export const DEFINITION_DENSITIES = ['compact', 'normal', 'roomy'] as const
export const DEFINITION_FONTS = ['sans', 'serif'] as const
export const DEFINITION_ALIGNMENTS = ['left', 'center'] as const

export type DefinitionFrame = (typeof DEFINITION_FRAMES)[number]
export type DefinitionDensity = (typeof DEFINITION_DENSITIES)[number]
export type DefinitionFont = (typeof DEFINITION_FONTS)[number]
export type DefinitionAlignment = (typeof DEFINITION_ALIGNMENTS)[number]

/** Per-language free text a trust may add. Escaped at render, capped here. */
export type LocalisedText = Partial<Record<ReceiptLang, string>>

export interface ReceiptDefinition {
  /** Schema version. A stored definition outlives the code that wrote it. */
  v: 1
  /** Which blocks appear, in order. Anything omitted does not render. */
  blocks: DefinitionBlock[]
  frame: DefinitionFrame
  density: DefinitionDensity
  font: DefinitionFont
  /** Where the trust's name and address sit. */
  header_align: DefinitionAlignment
  /** `#rrggbb`. Validated — it becomes a CSS colour. */
  accent: string
  /** Tint the amount block with the accent instead of a plain rule. */
  amount_emphasis: boolean
  /** Show the QR alongside the bank details in the remittance block. */
  show_qr: boolean
  /** The trust's own title for the document, per language. */
  title: LocalisedText
  /** The trust's own closing line, per language (the `custom_text` block). */
  custom_text: LocalisedText
}

export const MAX_TEXT_LEN = 240

/** What a trust starts from when it clicks "create". */
export function defaultDefinition(accent = '#0D1B2E'): ReceiptDefinition {
  return {
    v: 1,
    blocks: [
      'invocation', 'logo', 'trust_name', 'trust_address', 'trust_identity',
      'doc_title', 'doc_meta', 'party', 'amount', 'amount_words', 'details',
      'items', 'stay', 'tax_note', 'blessing', 'remittance', 'custom_text',
      'signature',
    ],
    frame: 'single',
    density: 'normal',
    font: 'serif',
    header_align: 'center',
    accent,
    amount_emphasis: true,
    show_qr: true,
    title: {},
    custom_text: {},
  }
}

export class DefinitionError extends Error {
  constructor(readonly code: 'INVALID_DEFINITION', message: string) {
    super(message)
    this.name = 'DefinitionError'
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/
const LANGS: readonly ReceiptLang[] = ['en', 'hi', 'mr', 'gu', 'kn', 'ta', 'te']

function bad(message: string): never {
  throw new DefinitionError('INVALID_DEFINITION', message)
}

/**
 * Validate and NORMALISE a definition from an untrusted source.
 *
 * This is the door. It runs in the API before anything is stored and again in
 * the renderer before anything is drawn, because the two are in different
 * repos and a row can outlive the code that wrote it. It returns a freshly
 * built object rather than the input — an unknown key cannot survive, so a
 * future field added by a newer client cannot be smuggled past an older
 * renderer either.
 *
 * Modelled on `superadmin-api`'s `apply-guards.ts`, which exists for exactly
 * this reason and says so: an allow-list is the injection defence, not a
 * validation nicety.
 */
export function parseDefinition(input: unknown): ReceiptDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('A design must be an object.')
  const raw = input as Record<string, unknown>
  if (raw.v !== 1) bad('Unsupported design version.')

  const blocks = raw.blocks
  if (!Array.isArray(blocks) || !blocks.length) bad('A design must list at least one block.')
  if (blocks.length > DEFINITION_BLOCKS.length) bad('Too many blocks.')
  const seen = new Set<string>()
  const cleanBlocks: DefinitionBlock[] = []
  for (const b of blocks) {
    if (typeof b !== 'string' || !(DEFINITION_BLOCKS as readonly string[]).includes(b)) {
      bad(`Unknown block: ${String(b).slice(0, 40)}`)
    }
    // A block twice would render twice. Silently de-duplicating would hide a
    // client bug; saying so is cheap.
    if (seen.has(b)) bad(`Block listed twice: ${b}`)
    seen.add(b)
    cleanBlocks.push(b as DefinitionBlock)
  }
  for (const required of REQUIRED_BLOCKS) {
    if (!seen.has(required)) bad(`A receipt must include the "${required}" block.`)
  }

  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], name: string): T => {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      bad(`${name} must be one of: ${allowed.join(', ')}`)
    }
    return value as T
  }

  if (typeof raw.accent !== 'string' || !HEX.test(raw.accent)) {
    // The accent is interpolated into CSS. `red; } body { display:none` would
    // otherwise be a stylesheet, which is the whole reason this is a regex and
    // not a trim.
    bad('The colour must be a 6-digit hex value such as #0D1B2E.')
  }

  const text = (value: unknown, name: string): LocalisedText => {
    if (value == null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) bad(`${name} must be an object keyed by language.`)
    const out: LocalisedText = {}
    for (const [lang, v] of Object.entries(value as Record<string, unknown>)) {
      if (!LANGS.includes(lang as ReceiptLang)) bad(`${name}: unknown language "${lang.slice(0, 8)}"`)
      if (v == null || v === '') continue
      if (typeof v !== 'string') bad(`${name}.${lang} must be text.`)
      if (v.length > MAX_TEXT_LEN) bad(`${name}.${lang} is longer than ${MAX_TEXT_LEN} characters.`)
      // NOT an HTML check — the renderer escapes this like any other receipt
      // data, so markup here is inert. Refused anyway, because a trust typing
      // a tag expects it to WORK, and a receipt reading `<b>Trust</b>` is a
      // support call either way.
      if (/[<>]/.test(v)) bad(`${name}.${lang} cannot contain < or >.`)
      out[lang as ReceiptLang] = v.trim()
    }
    return out
  }

  return {
    v: 1,
    blocks: cleanBlocks,
    frame: oneOf(raw.frame, DEFINITION_FRAMES, 'frame'),
    density: oneOf(raw.density, DEFINITION_DENSITIES, 'density'),
    font: oneOf(raw.font, DEFINITION_FONTS, 'font'),
    header_align: oneOf(raw.header_align, DEFINITION_ALIGNMENTS, 'header_align'),
    accent: raw.accent.toUpperCase(),
    amount_emphasis: !!raw.amount_emphasis,
    show_qr: !!raw.show_qr,
    title: text(raw.title, 'title'),
    custom_text: text(raw.custom_text, 'custom_text'),
  }
}

/** True when a definition is usable; for a UI that wants to disable Save. */
export function definitionIssue(input: unknown): string | null {
  try {
    parseDefinition(input)
    return null
  } catch (e) {
    return e instanceof DefinitionError ? e.message : 'This design cannot be saved.'
  }
}
