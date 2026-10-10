import type { TFunction } from 'i18next'
import type { ColumnDef } from '../components/kit/DataTable'

/**
 * Where an entry came in — the Source column on Donations and Rooms.
 *
 * "Entered by" says WHO typed it; this says through which door. Since a
 * trust's own website (tenant migration 062) can take gifts and rooms, an
 * online entry is either the devotee app or the website, and the office needs
 * to tell them apart (a website guest has no app to look at their booking in).
 *
 * The API filters on `?source=` server-side, like every other column filter.
 */
export type EntrySource = 'walk_in' | 'counter' | 'online' | 'website' | 'mobile' | 'bulk_import'

const BADGE: Record<string, string> = {
  website: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-800',
  online: 'badge-blue',
  mobile: 'badge-blue',
  bulk_import: 'badge-gray',
}

export function sourceLabel(t: TFunction, source?: string | null): string {
  switch (source) {
    case 'website': return t('website.source.website')
    case 'online': return t('website.source.app')
    case 'mobile': return t('website.source.mobile')
    case 'bulk_import': return t('website.source.import')
    default: return t('website.source.counter')
  }
}

export function SourceBadge({ source, t }: { source?: string | null; t: TFunction }) {
  const cls = BADGE[source ?? ''] ?? null
  if (!cls) return <span className="text-xs text-slate-500 whitespace-nowrap">{sourceLabel(t, source)}</span>
  return <span className={`${cls} whitespace-nowrap`}>{sourceLabel(t, source)}</span>
}

/**
 * The column. `counterValue` is what this table stores for a counter entry:
 * donations say 'walk_in', room bookings say 'counter'.
 */
export function sourceColumn<T extends { source?: string | null }>(
  t: TFunction,
  counterValue: 'walk_in' | 'counter',
  extra: EntrySource[] = [],
): ColumnDef<T> {
  const values: EntrySource[] = [counterValue, 'online', 'website', ...extra]
  return {
    key: 'source',
    label: t('website.source.column'),
    render: row => <SourceBadge source={row.source} t={t} />,
    filter: { kind: 'enum', param: 'source', options: values.map(v => ({ value: v, label: sourceLabel(t, v) })) },
  }
}
