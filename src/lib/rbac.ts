/**
 * Role → visible-module map for the sidebar (doc M1: "UI hides modules the
 * role can't access; server still enforces"). temple_admin always sees
 * everything. Keys are route prefixes; the longest matching prefix wins.
 *
 * This is a UI-decluttering layer only — every API endpoint keeps its own
 * @Roles() guard server-side.
 */

export type Role =
  | 'temple_admin'
  | 'cashier'
  | 'accountant'
  | 'priest'
  | 'volunteer'
  | 'viewer'
  | 'bhojanshala_cashier'

const ALL_STAFF: Role[] = ['cashier', 'accountant', 'priest', 'volunteer', 'viewer', 'bhojanshala_cashier']

const MODULE_ROLES: Record<string, Role[]> = {
  '/dashboard': ALL_STAFF,
  '/donations': ['cashier', 'accountant', 'viewer'],
  '/donation-requests': ['cashier', 'accountant', 'viewer'],
  '/expenses': ['accountant', 'cashier'],
  '/rooms': ['cashier', 'viewer'],
  '/hall': ['cashier', 'viewer'],
  '/prasad': ['cashier'],
  '/seva': ['cashier', 'priest'],
  '/annadaan': ['cashier', 'bhojanshala_cashier'],
  '/boli': ['cashier', 'accountant'],
  '/events': ['cashier', 'accountant', 'priest', 'volunteer', 'viewer'],
  '/maharaj': ['cashier', 'viewer'],
  '/devotees': ['cashier', 'accountant'],
  '/donors': ['cashier', 'accountant'],
  '/creditors': ['accountant', 'cashier'],
  '/masters/vendors': ['accountant', 'cashier'],
  '/masters/priests': ['cashier'],
  '/masters/employees': ['cashier'],
  '/masters/inventory': ['cashier', 'accountant'],
  '/accounts': ['accountant'],
  '/reports': ['accountant', 'viewer'],
  '/certificates': ['accountant'],
  '/registers': ['cashier', 'volunteer', 'viewer'],
  '/settings': [], // temple_admin only
  '/help': ALL_STAFF,
}

/** Can a user with these roles see the module at `path`? */
export function canSee(path: string, roles: string[] | undefined | null): boolean {
  const r = roles ?? []
  if (r.includes('temple_admin')) return true
  // Sessions from before roles were stored have an empty list — don't blank
  // the whole sidebar for them (the server still rejects what they can't do).
  if (r.length === 0) return true
  const key = Object.keys(MODULE_ROLES)
    .filter(k => path === k || path.startsWith(k + '/') || path.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  if (!key) return true // unknown module — leave visible, server enforces
  return MODULE_ROLES[key].some(allowed => r.includes(allowed))
}

export const ROLE_LABELS: Record<string, string> = {
  temple_admin: 'Temple Admin',
  cashier: 'Cashier',
  accountant: 'Accountant',
  priest: 'Priest',
  volunteer: 'Volunteer',
  viewer: 'Viewer',
  bhojanshala_cashier: 'Bhojanshala Cashier',
}
