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

/** Most to least authority: the one a person is introduced by. */
const ROLE_RANK = ['temple_admin', 'accountant', 'cashier', 'bhojanshala_cashier', 'priest', 'volunteer', 'viewer']

/**
 * The role to show for someone who holds several. The top bar printed the
 * FIRST stored role, and a Temple Admin whose roles were stored as
 * ['viewer', 'temple_admin'] (handed the role back after stepping down) was
 * labelled "(Viewer)" while having full access (2026-10-12).
 */
export function primaryRole(roles: readonly string[] | null | undefined): string | null {
  if (!roles?.length) return null
  return [...roles].sort((a, b) => {
    const ia = ROLE_RANK.indexOf(a); const ib = ROLE_RANK.indexOf(b)
    return (ia < 0 ? ROLE_RANK.length : ia) - (ib < 0 ? ROLE_RANK.length : ib)
  })[0]
}
