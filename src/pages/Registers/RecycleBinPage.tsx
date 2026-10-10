import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import type { TFunction } from 'i18next'
import { History, Info, MessageSquareQuote, RotateCcw, Search, Trash2 } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise } from '../../lib/api'
import { useApiGet } from '../../lib/useApiGet'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { humanise } from '../../lib/auditLabels'
import { DataTable, type ColumnDef, type RowAction } from '../../components/kit/DataTable'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { Avatar } from './ActivityLogPage'

interface BinRow {
  type: string
  source: 'entry' | 'resource'
  resource?: string
  id: string
  title: string | null
  detail: string | null
  ref: string | null
  amount_paise: number | null
  qty: number | null
  anonymous: boolean
  entry_date: string | null
  deleted_at: string
  deleted_by_name: string | null
  reason: string | null
  can_restore: boolean
}

const PAGE_SIZE = 50

/** The entry kinds first (money), then the master records, in a fixed order. */
const TYPE_ORDER = [
  'donation', 'boli', 'seva_booking', 'prasad_sale', 'bhojanshala_sale', 'room_booking', 'hall_booking', 'expense',
  'vendors', 'rooms', 'halls', 'guests', 'priests', 'employees', 'volunteers', 'inventory-items', 'lost-found',
  'creditors', 'fixed-assets', 'loans', 'announcements', 'gallery', 'cattle', 'feed-stock', 'cow-sponsorships',
]

/** Audit entity_type for a bin row — what the Activity Log filters by. */
const ENTRY_TABLE: Record<string, string> = {
  donation: 'donations', seva_booking: 'seva_bookings', prasad_sale: 'prasad_sales', bhojanshala_sale: 'bhojanshala_sales',
  room_booking: 'room_bookings', hall_booking: 'hall_bookings', expense: 'expenses', boli: 'bolis',
}

function binTypeLabel(t: TFunction, type: string): string {
  return t(`recycleBin.types.${type}`, { defaultValue: humanise(type) }) as string
}

/**
 * Recycle Bin — every deleted record this user may see, and the way back.
 *
 * Money entries (donations, bookings, counter sales, expenses) are deleted by a
 * temple admin with a reason and come back exactly as they were — the same
 * receipt number, their payments re-added to Cash & Bank. Master records
 * (vendors, rooms, cattle…) come back for whoever may edit them. Nothing here
 * is ever erased, so an auditor can always see what was taken out and why.
 */
export function RecycleBinPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('recycle-bin', 'all'))
  const [restoringKey, setRestoringKey] = useState<string | null>(null)

  // Search waits for the typing to stop.
  useEffect(() => {
    const h = setTimeout(() => { setSearch(searchInput.trim()); setPage(1) }, 300)
    return () => clearTimeout(h)
  }, [searchInput])

  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (search) p.set('q', search)
    if (type) p.set('type', type)
    if (range.from) p.set('from', range.from)
    if (range.to) p.set('to', range.to)
    return `/recycle-bin?${p}`
  }, [page, search, type, range])
  const { data, loading, refresh } = useApiGet<{ data?: BinRow[]; meta?: { total?: number; counts?: Record<string, number> } }>(url)
  const rows = data?.data ?? []
  const total = data?.meta?.total ?? 0
  const counts = useMemo(() => data?.meta?.counts ?? {}, [data])

  const keyOf = (r: BinRow) => `${r.type}:${r.id}`

  const typeChips = useMemo(() => {
    const types = Object.keys(counts).filter(k => counts[k] > 0)
    return types.sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  }, [counts])
  const allCount = Object.values(counts).reduce((s, n) => s + n, 0)

  function describe(r: BinRow): string {
    if (r.type === 'bhojanshala_sale') {
      return [r.qty != null ? t('recycleBin.plates', { count: r.qty }) : null, r.detail ? t(`recycleBin.meal.${r.detail}`, { defaultValue: humanise(r.detail) }) : null]
        .filter(Boolean).join(' · ')
    }
    if (r.type === 'room_booking') {
      return [r.detail ? t('recycleBin.room', { room: r.detail }) : null, r.qty ? t('recycleBin.nights', { count: r.qty }) : null]
        .filter(Boolean).join(' · ')
    }
    return r.detail ?? ''
  }

  async function restore(r: BinRow) {
    const item = r.anonymous ? t('recycleBin.anonymous') : (r.title || binTypeLabel(t, r.type))
    if (!(await confirm({
      title: t('recycleBin.restoreTitle'),
      message: t(r.source === 'entry' ? 'recycleBin.restoreEntryMessage' : 'recycleBin.restoreMessage', { item }),
      confirmLabel: t('recycleBin.restore'),
    }))) return
    setRestoringKey(keyOf(r))
    try {
      const path = r.source === 'entry' ? `/entries/${r.type}/${r.id}/restore` : `/${r.resource ?? r.type}/${r.id}/restore`
      await api.post(path, {})
      toast.success(t('recycleBin.restoredItem', { item }))
      refresh()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('recycleBin.restoreFailed')))
    } finally {
      setRestoringKey(null)
    }
  }

  const columns: ColumnDef<BinRow>[] = useMemo(() => [
    {
      key: 'type', label: t('recycleBin.type'),
      render: r => (
        <span className={r.source === 'entry' ? 'badge-blue' : 'badge-gray'}>{binTypeLabel(t, r.type)}</span>
      ),
    },
    {
      key: 'item', label: t('recycleBin.item'),
      render: r => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800 truncate">{r.anonymous ? t('recycleBin.anonymous') : (r.title || '—')}</p>
          {describe(r) && <p className="text-xs text-slate-500 truncate">{describe(r)}</p>}
          {r.ref && <p className="text-[11px] text-slate-400 font-mono">{r.ref}</p>}
        </div>
      ),
    },
    {
      key: 'amount', label: t('common.amount'), align: 'right',
      render: r => r.amount_paise != null ? <span className="font-medium tabular-nums">₹{fmtPaise(r.amount_paise)}</span> : <span className="text-slate-300">—</span>,
    },
    {
      key: 'entry_date', label: t('recycleBin.entryDate'),
      render: r => r.entry_date
        ? <span className="text-xs text-slate-500">{new Date(`${r.entry_date}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        : <span className="text-slate-300">—</span>,
    },
    {
      key: 'deleted', label: t('recycleBin.deletedAt'),
      render: r => (
        <div className="flex items-center gap-2">
          <Avatar name={r.deleted_by_name} size="sm" />
          <div>
            <p className="text-xs text-slate-700">{r.deleted_by_name || '—'}</p>
            <p className="text-[11px] text-slate-400">{new Date(r.deleted_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'reason', label: t('recycleBin.reason'),
      render: r => r.reason
        ? <span className="inline-flex max-w-[16rem] items-start gap-1 text-xs text-amber-900"><MessageSquareQuote size={12} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{r.reason}</span></span>
        : <span className="text-slate-300">—</span>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

  function rowActions(r: BinRow): RowAction[] {
    return [
      {
        label: r.can_restore ? t('recycleBin.restore') : t('recycleBin.adminRestores'),
        icon: <RotateCcw size={13} />, primary: true,
        onClick: () => void restore(r),
        disabled: !r.can_restore || restoringKey === keyOf(r),
      },
      {
        label: t('recycleBin.history'), icon: <History size={13} />,
        onClick: () => navigate(historyPath(r)),
      },
    ]
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('recycleBin.title')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Trash2 size={18} /> {t('recycleBin.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5 max-w-2xl">{t('recycleBin.subtitle')}</p>
        </div>
        <Link to="/registers/activity-log" className="btn-secondary btn-sm"><History size={14} /> {t('activityLog.title')}</Link>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 no-print">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>{t('recycleBin.howItWorks')}</span>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={v => { setRange(v); setPage(1) }} storageKey="recycle-bin" />
      </div>

      <div className="flex flex-wrap items-center gap-2 no-print">
        <div className="relative min-w-[16rem] flex-1 sm:flex-none sm:w-80">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="form-input pl-9" value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder={t('recycleBin.search')} aria-label={t('recycleBin.search')} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('recycleBin.type')}>
          <Chip active={!type} onClick={() => { setType(''); setPage(1) }} label={t('recycleBin.all')} count={allCount} />
          {typeChips.map(k => (
            <Chip key={k} active={type === k} onClick={() => { setType(k); setPage(1) }} label={binTypeLabel(t, k)} count={counts[k]} />
          ))}
        </div>
      </div>

      <DataTable
        viewKey="recycle-bin"
        columns={columns}
        rows={rows}
        rowKey={r => keyOf(r)}
        rowActions={rowActions}
        loading={loading}
        filterState={{}}
        onFilterChange={() => {}}
        page={page}
        limit={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        emptyMessage={search || type ? t('recycleBin.noMatches') : t('recycleBin.empty')}
      />
    </div>
  )
}

/** The Activity Log, filtered to one deleted record — who made it, changed it, deleted it. */
function historyPath(r: BinRow): string {
  const q = new URLSearchParams({ entity_id: r.id })
  const entityType = r.source === 'entry' ? ENTRY_TABLE[r.type] : ''
  if (entityType) q.set('entity_type', entityType)
  return `/registers/activity-log?${q}`
}

function Chip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
    >
      {label}
      <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
    </button>
  )
}
