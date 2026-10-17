/**
 * What a user can see in the nav, from two independent questions:
 *
 *   ROLES   — may this person do it?      (MODULE_ROLES, below)
 *   MODULES — did this trust buy it?      (PATH_MODULE, below)
 *
 * temple_admin passes every role gate but NOT the module gate: a module is an
 * entitlement, not a privilege, and a temple_admin at a Gaushala-only trust has
 * no rooms screen to be an admin of.
 *
 * This is a UI-decluttering layer only — every API endpoint keeps its own
 * @Roles() / @RequiresModule() guard server-side (migration 031).
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
  // Union of the three merged tabs (donations/requests/pledges) — the
  // DonationsHub page gates each tab individually via DONATIONS_TAB_ROLES.
  '/donations': ['cashier', 'accountant', 'viewer'],
  '/expenses': ['accountant', 'cashier'],
  '/rooms': ['cashier', 'viewer'],
  '/hall': ['cashier', 'viewer'],
  '/prasad': ['cashier'],
  '/seva': ['cashier', 'priest'],
  '/annadaan': ['cashier', 'bhojanshala_cashier'],
  '/gaushala': ['cashier', 'volunteer', 'viewer'],
  '/events': ['cashier', 'accountant', 'priest', 'volunteer', 'viewer'],
  '/sant': ['cashier', 'viewer'],
  '/devotees': ['cashier', 'accountant'],
  '/donors': ['cashier', 'accountant'],
  '/creditors': ['accountant', 'cashier'],
  '/masters/vendors': ['accountant', 'cashier'],
  '/masters/priests': ['cashier'],
  '/masters/employees': ['cashier'],
  // Salary and advances are money, so they follow the accountant gate the
  // rest of payables use — not the cashier gate on the employee master.
  '/payroll': ['accountant'],
  // The directory is who works here — front-desk information. Attendance is
  // marked by whoever is at the counter. Only the money is accountant-only.
  '/staff': ['cashier', 'accountant', 'viewer'],
  '/staff/attendance': ['cashier', 'accountant'],
  '/staff/payroll': ['accountant'],
  '/masters/inventory': ['cashier', 'accountant'],
  '/accounts': ['accountant'],
  // Depositing/clearing a received cheque, or moving cash to/from the bank, is
  // a routine cashier-counter action, not bookkeeping — narrower than the
  // general '/accounts' (accountant-only) module.
  '/accounts/cheques': ['cashier', 'accountant'],
  '/accounts/cash-bank': ['cashier', 'accountant'],
  '/reports': ['accountant', 'viewer'],
  '/certificates': ['accountant'],
  '/registers': ['cashier', 'volunteer', 'viewer'],
  // Deleting a money entry is a temple_admin action, so seeing what was
  // deleted — and putting it back — is one too. A cashier who deletes a vendor
  // by mistake asks an admin, the same as for a donation.
  '/registers/recycle-bin': [],
  // Who-did-what is sensitive — narrower than the rest of Registers.
  '/registers/activity-log': ['accountant'],
  '/settings': [], // temple_admin only
  // Everyone can see the devices THEIR OWN account is signed in on and end
  // one; the trust-wide half of that screen checks temple_admin itself.
  '/my-devices': ALL_STAFF,
  // Their own language and (offline) sign-in PIN — every role's own business.
  '/my-account': ALL_STAFF,
  '/help': ALL_STAFF,
}

/**
 * Route prefix → the optional module that owns it (migration 031). Longest
 * matching prefix wins, exactly like MODULE_ROLES.
 *
 * Anything absent belongs to a core module — dashboard, donations, donors,
 * expenses, accounting, reports, registers, masters, settings, users — which
 * every trust has and which therefore must never be hidden.
 */
const PATH_MODULE: Record<string, string> = {
  '/rooms': 'dharamshala',
  // Room requests from a trust's OWN website. Sold to some trusts only, so it
  // is its own module (public migration 091), granted by the super admin. The
  // sidebar item, its badge poll and the route all read this line.
  '/rooms/requests': 'website',
  '/hall': 'dharamshala',
  '/prasad': 'prasad',
  '/seva': 'seva',
  '/annadaan': 'bhojanshala', // this route IS the Bhojanshala counter (AnnadaanList)
  '/events': 'events',
  '/sant': 'sant',
  '/creditors': 'creditors',
  '/payroll': 'payroll',
  // The directory itself is core — a trust without the payroll module still
  // has priests and volunteers to look up. Only attendance and pay are gated.
  '/staff/attendance': 'payroll',
  '/staff/payroll': 'payroll',
  '/certificates': 'certificates',
  '/gaushala': 'gaushala',
  '/masters/priests': 'seva',
  // Accounting is core, but two of its screens are not: the asset register and
  // its depreciation schedule are the `fixed_assets` module, and the server has
  // always refused them without it (resource-registry, DepreciationController).
  // Only the nav had not caught up, so a Basic trust opened "Fixed Assets" from
  // its own sidebar and got MODULE_NOT_ENABLED.
  '/accounts/fixed-assets': 'fixed_assets',
  // Same for the two Registers screens that are front-desk work rather than
  // bookkeeping — `resource-registry` gates lost-found and visitor-counts on
  // `frontdesk`. Recycle Bin and Activity Log stay core.
  '/registers/lost-found': 'frontdesk',
  '/registers/visitor-count': 'frontdesk',
}

/**
 * Screens switched off for EVERY trust and role, for now (founder request,
 * 2026-09-17): Sant, and People → Connected Devotees. Nothing else changed —
 * the pages, routes and API endpoints are intact, and the sidebar, command
 * palette, shortcuts and route guard all read this list. Delete a line to bring
 * that screen back. The mandir phone app has the same list (modules_screen.dart).
 */
const HIDDEN_FOR_NOW = ['/sant', '/devotees']

export function isHiddenForNow(path: string): boolean {
  return HIDDEN_FOR_NOW.some(h => path === h || path.startsWith(h + '/'))
}

/** The module owning `path`, or null when it is core (always visible). */
export function moduleForPath(path: string): string | null {
  const key = Object.keys(PATH_MODULE)
    .filter(k => path === k || path.startsWith(k + '/') || path.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return key ? PATH_MODULE[key] : null
}

/** Per-tab roles inside the merged Donations hub (donations / requests / pledges). */
export const DONATIONS_TAB_ROLES: Record<'donations' | 'requests' | 'pledges', Role[]> = {
  donations: ['cashier', 'accountant', 'viewer'],
  requests: ['cashier', 'accountant', 'viewer'],
  pledges: ['cashier', 'accountant'],
}

/**
 * Can this user, at this trust, see `path`?
 *
 * `modules` is the trust's entitlement list; pass `null`/`undefined` when it is
 * not known yet (first paint, or a desktop launch before the profile loads) and
 * everything stays visible. Blanking the nav on a guess is far worse than
 * briefly showing a link the server would refuse.
 */
export function canSee(
  path: string,
  roles: string[] | undefined | null,
  modules?: string[] | null,
): boolean {
  if (isHiddenForNow(path)) return false
  // The module gate runs FIRST and applies to temple_admin too — an entitlement
  // is not a permission, so there is nobody it can be waived for.
  const needed = moduleForPath(path)
  if (needed && modules && !modules.includes(needed)) return false

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

/** Same temple_admin/empty-roles rules as canSee, against an explicit role list (for hub tabs). */
export function canSeeRoles(allowed: Role[], roles: string[] | undefined | null): boolean {
  const r = roles ?? []
  if (r.includes('temple_admin')) return true
  if (r.length === 0) return true
  return allowed.some(a => r.includes(a))
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
