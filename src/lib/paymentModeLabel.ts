import type { TFunction } from 'i18next'

/**
 * A payment mode as a person reads it, in the screen's language.
 *
 * Sixteen lists, detail pages and reports printed the stored code - "cash",
 * "netbanking", "credit" - in English on a Hindi or Marathi screen (found by
 * the UI audit, 2026-09-25). The column filters already translated the same
 * codes; the cells did not. A trust can add its own modes in Settings, so a
 * code with no translation reads as itself, tidied: "bank_transfer" becomes
 * "Bank transfer", never a raw key.
 */
export function paymentModeLabel(t: TFunction, code: string | null | undefined): string {
  if (!code) return '—'
  const tidy = code.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase())
  return t(`common.${code}`, { defaultValue: tidy }) as string
}

/** The names a trust's payment modes are seeded with, by code. */
const SEEDED_NAMES: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', cheque: 'Cheque', netbanking: 'Net Banking', online: 'Online', credit: 'Credit', card: 'Card',
}

/**
 * A payment mode from the trust's own list, for a dropdown. The seeded names
 * are English ("Cash"), so a Hindi counter read "Cash" in its payment picker.
 * A name still as seeded shows in the screen's language; a name the trust
 * typed itself ("Temple UPI") is theirs and shows as they wrote it.
 */
export function paymentModeOptionLabel(t: TFunction, mode: { code: string; name?: string | null }): string {
  const name = (mode.name ?? '').trim()
  if (!name || name.toLowerCase() === (SEEDED_NAMES[mode.code] ?? '').toLowerCase()) return paymentModeLabel(t, mode.code)
  return name
}
