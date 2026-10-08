import type { TFunction } from 'i18next'

/**
 * How the Activity Log and the Recycle Bin NAME things.
 *
 * The audit trail stores what the database calls them — `room_bookings`,
 * `cheque_bounce`, `kshetra_profile` — and the Activity Log used to print
 * exactly that, underscores and all, which read like a database dump rather
 * than a register a trustee could hand an auditor. Every name here goes
 * through i18n (`audit.entity.*`, `audit.action.*`), and anything the API
 * starts writing tomorrow still reads as words ("Room bookings" → "Room
 * bookings"), never as a snake_case key.
 */

/** `cheque_bounce` → `Cheque bounce`. The last resort, never the first. */
export function humanise(key: string): string {
  const words = String(key ?? '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ''
}

export function entityLabel(t: TFunction, type: string): string {
  return t(`audit.entity.${type}`, { defaultValue: humanise(type) }) as string
}

export function actionLabel(t: TFunction, action: string): string {
  return t(`audit.action.${action}`, { defaultValue: humanise(action) }) as string
}

/** Which part of the product a record belongs to — the Activity Log's "Area" filter. */
export const ENTITY_GROUPS: Record<string, string[]> = {
  donations: [
    'donations', 'donors', 'bolis', 'boli_categories', 'donation_requests', 'donation_categories', 'funds',
    'certificates_80g', 'form_10bd_entries',
  ],
  dharamshala: ['room_bookings', 'hall_bookings', 'rooms', 'halls', 'guests', 'guest_id_documents', 'room_charge_items', 'room_booking_charges'],
  counters: [
    'seva_bookings', 'sevas', 'prasad_sales', 'prasad_items', 'bhojanshala_sales', 'bhojanshala_charge_items',
    'annadaan_entries', 'annadaan_sponsorships',
  ],
  expenses: ['expenses', 'vendors', 'creditors', 'expense_categories', 'tds_records', 'vendor_items', 'expense_items'],
  accounts: [
    'accounts', 'account_opening_balances', 'contra_entries', 'bank_reconciliations', 'journal_entries',
    'loans', 'fixed_assets', 'depreciation', 'investments', 'specified_persons', 'gst_rates',
    'payment_modes', 'invoice_series',
  ],
  staff: [
    'employees', 'volunteers', 'priests', 'priest_schedules', 'priest_attendance', 'priest_salary_records',
    'employee_salary_records', 'staff_attendance', 'staff_advances', 'leave_types', 'duty_assignments',
  ],
  frontdesk: [
    'events', 'event_registrations', 'announcements', 'gallery', 'lost_found', 'visitor_counts', 'visitors',
    'inventory_items', 'inventory_transactions',
  ],
  gaushala: ['cattle', 'cattle_medical', 'feed_stock', 'milk_records', 'cow_sponsorships'],
  settings: [
    'kshetra_profile', 'tenants', 'tenant_users', 'tenant_trustees', 'comms_tenant_prefs', 'comms_tenant_settings',
    'receipt_template_drafts', 'field_change_requests', 'tenant_export', 'integrations', 'device_registry',
  ],
}

const GROUP_OF = new Map<string, string>()
for (const [group, types] of Object.entries(ENTITY_GROUPS)) for (const type of types) GROUP_OF.set(type, group)

export function groupOf(type: string): string {
  return GROUP_OF.get(type) ?? 'other'
}

export type Tone = 'green' | 'blue' | 'red' | 'amber' | 'violet' | 'slate'

/** The colour an action is drawn in: made, changed, taken away, brought back, money moved. */
export function actionTone(action: string): Tone {
  switch (action) {
    case 'create': case 'approve': case 'invite': case 'bulk_import':
      return 'green'
    case 'update': case 'correct': case 'stay_times': case 'update_public_profile': case 'housekeeping':
    case 'enable': case 'disable': case 'privacy': case 'set_primary_for_donations':
      return 'blue'
    case 'delete': case 'void': case 'cancel': case 'reject': case 'cheque_bounce': case 'reverse': case 'waive':
    case 'purged':
      return 'red'
    // Brought back — and someone looked at a guest's ID, which is worth seeing
    // at a glance (the DPDP access log).
    case 'restore': case 'withdraw': case 'viewed': case 'id_proof_revealed':
      return 'amber'
    case 'pay': case 'payment': case 'refund': case 'repay': case 'cheque_deposit': case 'cheque_clear':
    case 'deposit_collected': case 'deposit_settled': case 'redeem': case 'checkin': case 'checkout':
    case 'recover_manual':
      return 'violet'
    default:
      return 'slate'
  }
}

export const TONE_CLASSES: Record<Tone, { badge: string; dot: string; ring: string }> = {
  green: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', ring: 'ring-emerald-100' },
  blue: { badge: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500', ring: 'ring-sky-100' },
  red: { badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500', ring: 'ring-rose-100' },
  amber: { badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500', ring: 'ring-amber-100' },
  violet: { badge: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500', ring: 'ring-violet-100' },
  slate: { badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400', ring: 'ring-slate-100' },
}

/** The actions offered in the Activity Log's filter, most asked-about first. */
export const FILTER_ACTIONS = [
  'create', 'update', 'delete', 'restore', 'void', 'cancel', 'payment', 'refund',
  'cheque_deposit', 'cheque_clear', 'cheque_bounce', 'checkin', 'checkout', 'approve', 'reject', 'export',
]

/** Initials for an avatar: "Ramesh Kumar Shah" → "RS". */
export function initials(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '·'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

const AVATAR_COLOURS = [
  'bg-sky-100 text-sky-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800',
  'bg-violet-100 text-violet-800', 'bg-rose-100 text-rose-800', 'bg-teal-100 text-teal-800',
  'bg-indigo-100 text-indigo-800', 'bg-orange-100 text-orange-800',
]

/** The same person always gets the same colour. */
export function avatarColour(key: string | null | undefined): string {
  const s = String(key ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length]
}

/** A user's role as the Users screen names it — "Temple Admin", "Accountant". */
export function roleLabel(t: TFunction, role: string | null | undefined): string {
  if (!role) return ''
  if (role === 'temple_admin') return t('settings.users.templeAdmin')
  return t(`settings.users.roleLabels.${role}`, { defaultValue: humanise(role) }) as string
}
