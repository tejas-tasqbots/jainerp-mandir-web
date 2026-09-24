import type { TFunction } from 'i18next'

/**
 * A role's name in the screen's language. The top bar printed the stored code
 * ("temple admin", "bhojanshala cashier") and the route guard an English map,
 * on every screen in every language (UI audit, 2026-09-25). `short` drops a
 * trailing "(read-only)" note for places that already sit in brackets.
 */
export function roleLabel(t: TFunction, code: string, short = false): string {
  const tidy = code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const label = t(`settings.users.roleLabels.${code}`, { defaultValue: tidy }) as string
  return short ? label.replace(/\s*\([^)]*\)\s*$/, '') : label
}
