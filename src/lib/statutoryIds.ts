/**
 * The Indian statutory numbers on the trust's profile — the SAME rules the API
 * enforces (mandiradmin-api/src/common/domain/statutory-ids.ts), run here so a
 * typo is flagged as it is typed instead of after Save. The API is the
 * authority; this is the early warning. `qa/qa-statutory-ids.mjs` runs one
 * table of numbers through both, so change them together.
 *
 * Returns issue CODES rather than sentences: the sentence is translated
 * (`statutory.issue.*` in the locale files).
 */

export const VERIFIED_STATUTORY_FIELDS = [
  'pan', 'reg_12a_number', 'reg_12ab_number', 'reg_80g_number', 'reg_80g_urn', 'reg_80g_valid_upto',
] as const

export const SELF_SERVICE_STATUTORY_FIELDS = ['gstin', 'tan', 'fssai_license'] as const

export type StatutoryField =
  | (typeof VERIFIED_STATUTORY_FIELDS)[number]
  | (typeof SELF_SERVICE_STATUTORY_FIELDS)[number]

export const STATUTORY_FIELDS: readonly StatutoryField[] = [
  ...VERIFIED_STATUTORY_FIELDS,
  ...SELF_SERVICE_STATUTORY_FIELDS,
]

export function isStatutoryField(field: string): field is StatutoryField {
  return (STATUTORY_FIELDS as readonly string[]).includes(field)
}

export type StatutoryIssueCode = 'FORMAT' | 'PLACEHOLDER' | 'STATE_CODE' | 'CHECKSUM' | 'PAN_MISMATCH' | 'DATE'

export interface StatutoryIssue {
  field: StatutoryField
  code: StatutoryIssueCode
  /** Interpolation values for the translated message. */
  params?: Record<string, string>
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/
const URN_RE = /^[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]{6}$/
const FSSAI_RE = /^[0-9]{14}$/
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Example shown as each input's placeholder — the shape, not a real number. */
export const STATUTORY_EXAMPLE: Record<StatutoryField, string> = {
  pan: 'AAATR1234C',
  gstin: '27AAATR1234C1Z0',
  tan: 'MUMT12345A',
  reg_12a_number: '',
  reg_12ab_number: 'AAATR1234CE20214',
  reg_80g_number: 'AAATR1234CF20214',
  reg_80g_urn: 'AAATR1234CF20214',
  reg_80g_valid_upto: '',
  fssai_license: '10012011000123',
}

/** Longest a normalised value can be — the input's maxLength. */
export const STATUTORY_MAX_LENGTH: Record<StatutoryField, number> = {
  pan: 10, gstin: 15, tan: 10, reg_12a_number: 50, reg_12ab_number: 16,
  reg_80g_number: 16, reg_80g_urn: 16, reg_80g_valid_upto: 10, fssai_license: 14,
}

function isGstStateCode(code: string): boolean {
  const n = Number(code)
  return (n >= 1 && n <= 38) || n === 97 || n === 99
}

/** GSTN's Luhn mod-36 check character, from the first 14 characters. */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i])
    if (value < 0) return ''
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHARSET[(36 - (sum % 36)) % 36]
}

/** Shaped like a GSTIN — what decides whether GST may appear at all. */
export function isWellFormedGstin(value: unknown): boolean {
  return typeof value === 'string' && GSTIN_RE.test(value.trim().toUpperCase())
}

export function embeddedPan(field: StatutoryField, value: string): string | null {
  if (field === 'gstin') return value.length === 15 ? value.slice(2, 12) : null
  if (field === 'reg_12ab_number' || field === 'reg_80g_number' || field === 'reg_80g_urn') {
    return URN_RE.test(value) ? value.slice(0, 10) : null
  }
  return null
}

/** What will be stored for a typed value; null means blank. */
export function normaliseStatutory(field: StatutoryField, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (field === 'reg_80g_valid_upto') return normaliseDate(raw)
  const text = String(raw).trim()
  if (!text) return null
  if (field === 'reg_12a_number') return text.replace(/\s+/g, ' ').toUpperCase()
  if (field === 'fssai_license') return text.replace(/[\s-]+/g, '')
  return text.replace(/\s+/g, '').toUpperCase()
}

export function normaliseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (!text) return null
  const iso = /^(\d{4}-\d{2}-\d{2})(T.*)?$/.exec(text)
  return iso ? iso[1] : text
}

export function sameStatutoryValue(field: StatutoryField, a: unknown, b: unknown): boolean {
  return (normaliseStatutory(field, a) ?? '') === (normaliseStatutory(field, b) ?? '')
}

function isPlaceholder(value: string): boolean {
  return /^[0.\-_/\s]+$/.test(value) || /^(NA|N\/A|NIL|NONE|NULL|NOTAPPLICABLE|NOT APPLICABLE)$/i.test(value)
}

function validDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1950 || y > 2100) return false
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/**
 * What is wrong with a NORMALISED, non-blank value, or null. `trustPans` are
 * the PAN on file and any PAN awaiting review; a GSTIN or URN must carry one.
 */
export function statutoryIssue(
  field: StatutoryField,
  value: string,
  trustPans: (string | null | undefined)[] = [],
): StatutoryIssue | null {
  const issue = (code: StatutoryIssueCode, params?: Record<string, string>): StatutoryIssue => ({ field, code, params })

  if (field !== 'reg_80g_valid_upto' && isPlaceholder(value)) return issue('PLACEHOLDER', { value })

  switch (field) {
    case 'pan': return PAN_RE.test(value) ? null : issue('FORMAT')
    case 'tan': return TAN_RE.test(value) ? null : issue('FORMAT')
    case 'fssai_license': return FSSAI_RE.test(value) ? null : issue('FORMAT')
    case 'reg_80g_valid_upto': return validDate(value) ? null : issue('DATE')
    case 'reg_12a_number': return value.length <= 50 ? null : issue('FORMAT')
    case 'gstin':
      if (!GSTIN_RE.test(value)) return issue('FORMAT')
      if (!isGstStateCode(value.slice(0, 2))) return issue('STATE_CODE', { code: value.slice(0, 2) })
      if (gstinCheckCharacter(value.slice(0, 14)) !== value[14]) return issue('CHECKSUM')
      return panMismatch(field, value, trustPans, issue)
    case 'reg_12ab_number':
    case 'reg_80g_number':
    case 'reg_80g_urn':
      if (!URN_RE.test(value)) return issue('FORMAT')
      return panMismatch(field, value, trustPans, issue)
  }
  return null
}

function panMismatch(
  field: StatutoryField,
  value: string,
  trustPans: (string | null | undefined)[],
  issue: (code: StatutoryIssueCode, params?: Record<string, string>) => StatutoryIssue,
): StatutoryIssue | null {
  const pans = trustPans
    .map(p => normaliseStatutory('pan', p))
    .filter((p): p is string => !!p && PAN_RE.test(p))
  const inner = embeddedPan(field, value)
  if (!pans.length || !inner || pans.includes(inner)) return null
  return issue('PAN_MISMATCH', { inner, pan: pans[0] })
}

/** The i18n key for an issue's sentence. FORMAT is per field; the rest are shared. */
export function issueKey(i: StatutoryIssue): string {
  if (i.code !== 'FORMAT') return `statutory.issue.${i.code}`
  const urn = i.field === 'reg_12ab_number' || i.field === 'reg_80g_number' || i.field === 'reg_80g_urn'
  return `statutory.issue.FORMAT_${urn ? 'urn' : i.field}`
}

/**
 * A PAN whose 4th letter says it belongs to a person (P) or a HUF (H) is almost
 * never a trust's own PAN — an 80G receipt carrying it names the wrong
 * taxpayer. A hint, not a rule: the reviewer decides.
 */
export function panHolderHint(pan: string | null | undefined): 'individual' | 'huf' | null {
  const p = normaliseStatutory('pan', pan)
  if (!p || !PAN_RE.test(p)) return null
  if (p[3] === 'P') return 'individual'
  if (p[3] === 'H') return 'huf'
  return null
}

/**
 * Where the 80G approval stands on a given day. Renewal (Form 10AB) is due at
 * least six months before expiry, so "expiring" starts six months out.
 */
export function eightyGValidity(validUpto: string | null | undefined, today = new Date()): 'expired' | 'expiring' | null {
  const d = normaliseDate(validUpto)
  if (!d || !validDate(d)) return null
  const [y, m, day] = d.split('-').map(Number)
  const end = new Date(y, m - 1, day)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (end < start) return 'expired'
  const sixMonths = new Date(start.getFullYear(), start.getMonth() + 6, start.getDate())
  return end <= sixMonths ? 'expiring' : null
}

/** "2027-03-31" → "31 Mar 2027", from the calendar parts (no timezone shift). */
export function formatCalendarDate(value: string | null | undefined): string {
  const d = normaliseDate(value)
  if (!d || !validDate(d)) return value ?? ''
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
