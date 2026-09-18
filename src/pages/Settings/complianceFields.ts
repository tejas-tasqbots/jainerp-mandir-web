import {
  normaliseStatutory,
  sameStatutoryValue,
  statutoryIssue,
  type StatutoryField,
  type StatutoryIssue,
} from '../../lib/statutoryIds'

/** The registration numbers Settings → Temple Profile shows, in display order. */
export const COMPLIANCE_FIELDS = [
  'pan', 'reg_12ab_number', 'reg_80g_number', 'reg_80g_valid_upto', 'reg_12a_number',
  'gstin', 'tan', 'fssai_license',
] as const satisfies readonly StatutoryField[]

export type ComplianceField = (typeof COMPLIANCE_FIELDS)[number]

/**
 * Who the trust IS, as opposed to what it may claim: the registrar's own
 * number from the trust/society/co-operative registration, and the NITI Aayog
 * NGO-Darpan ID (tenant migration 041).
 *
 * Kept apart from COMPLIANCE_FIELDS because they are NOT StatutoryFields and
 * deliberately have no format rule — a registration number's shape varies by
 * state, registrar and year, so a pattern invented here would reject valid
 * numbers. Free text, trimmed, length-capped by the API.
 */
export const IDENTITY_FIELDS = ['registration_number', 'darpan_number'] as const

export type IdentityField = (typeof IDENTITY_FIELDS)[number]
export type IdentityValues = Record<IdentityField, string>

/** What the API accepts, so a client cannot submit something it will reject. */
export const IDENTITY_MAX_LENGTH: Record<IdentityField, number> = {
  registration_number: 60,
  darpan_number: 40,
}
export type ComplianceValues = Record<ComplianceField, string>

/**
 * Issues for every field that is CHANGING from what was loaded — the same
 * rule the API applies, so legacy data the trust has not touched never blocks
 * a Save of its address.
 */
export function complianceIssues(
  values: ComplianceValues,
  loaded: ComplianceValues,
  pendingPan?: string | null,
): Partial<Record<ComplianceField, StatutoryIssue>> {
  const out: Partial<Record<ComplianceField, StatutoryIssue>> = {}
  const pans = [normaliseStatutory('pan', values.pan) ?? loaded.pan, pendingPan]
  for (const f of COMPLIANCE_FIELDS) {
    const next = normaliseStatutory(f, values[f])
    if (next === null || sameStatutoryValue(f, next, loaded[f])) continue
    const found = statutoryIssue(f, next, f === 'pan' ? [] : pans)
    if (found) out[f] = found
  }
  return out
}
