import type { TFunction } from 'i18next'

/**
 * An accounting head as the reader's language says it.
 *
 * The accounting API names its own sources in English ("Room booking", "Prasad
 * sale", "Salaries & honorarium") in the same column as the trust's own donation
 * and expense categories. A category is the trust's data and is shown exactly
 * as typed; only these fixed names are the product's words, so only they are
 * translated. Anything not listed passes through untouched.
 */
const SYSTEM_HEADS: Record<string, string> = {
  'Donation': 'donation',
  'Seva booking': 'seva_booking',
  'Room booking': 'room_booking',
  'Hall booking': 'hall_booking',
  'Prasad sale': 'prasad_sale',
  'Bhojanshala': 'bhojanshala',
  'Event registration': 'event_registration',
  'Annadaan sponsorship': 'annadaan_sponsorship',
  'Contra transfer': 'contra_transfer',
  'Other donations': 'other_donations',
  'Other': 'other',
  'Salaries & honorarium': 'salaries',
  'Depreciation': 'depreciation',
}

export function headLabel(t: TFunction, head: string | null | undefined): string {
  const name = head ?? ''
  const key = SYSTEM_HEADS[name]
  return key ? (t(`systemHead.${key}`, { defaultValue: name }) as string) : name
}
