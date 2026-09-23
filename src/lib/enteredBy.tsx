import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { api } from './api'
import type { ColumnDef } from '../components/kit/DataTable'
import { EnteredByCell } from '../components/EnteredBy'

/**
 * "Entered by" — which staff member made an entry, on every register.
 *
 * Asked for: "in the list view application user name should be there and name
 * filter in the list view that which user has perform this activity".
 *
 * Every list endpoint returns the same three fields (mandiradmin-api
 * common/entered-by.util): `entered_by` (user id), `entered_by_name`, and
 * `entered_online` for what the devotee app wrote. The filter sends
 * `?entered_by=<id,id,online>`, server-side like every other column filter,
 * so totals and pagination always agree with what is on screen.
 */
export interface EnteredByFields {
  entered_by?: string | null
  entered_by_name?: string | null
  entered_online?: boolean | null
}

interface StaffUser { id: string; name: string; role: string; is_active: boolean }

let cache: Promise<StaffUser[]> | null = null

/** The trust's staff, fetched once per page load and shared by every list. */
function loadStaff(): Promise<StaffUser[]> {
  if (!cache) {
    cache = api.get('/entries/staff')
      .then(r => (r.data?.data ?? []) as StaffUser[])
      .catch(() => { cache = null; return [] })
  }
  return cache
}

/** Filter options: every staff member, then "Online (devotee app)". */
export function useEnteredByOptions(): { value: string; label: string }[] {
  const { t } = useTranslation()
  const [staff, setStaff] = useState<StaffUser[]>([])
  useEffect(() => {
    let live = true
    void loadStaff().then(s => { if (live) setStaff(s) })
    return () => { live = false }
  }, [])
  // Stable between renders: list pages put this in their columns' useMemo.
  return useMemo(() => [
    ...staff.map(u => ({
      value: u.id,
      label: u.is_active ? u.name : `${u.name} (${t('enteredBy.inactive')})`,
    })),
    { value: 'online', label: t('enteredBy.online') },
  ], [staff, t])
}

/** Plain text for exports and prints. */
export function enteredByText(row: object, t: TFunction): string {
  const r = row as EnteredByFields
  if (r.entered_by_name) return r.entered_by_name
  if (r.entered_online) return t('enteredBy.online')
  return ''
}

/** The column, with its server-side filter. Any row type: the fields are read optionally. */
export function enteredByColumn<T extends object>(
  t: TFunction,
  options: { value: string; label: string }[],
): ColumnDef<T> {
  return {
    key: 'entered_by',
    label: t('enteredBy.column'),
    render: row => <EnteredByCell row={row} />,
    filter: { kind: 'enum', param: 'entered_by', options },
  }
}
