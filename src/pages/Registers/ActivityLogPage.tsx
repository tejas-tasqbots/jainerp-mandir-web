import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api } from '../../lib/api'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState,
} from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'

interface AuditChange {
  field: string
  from: string | null
  to: string | null
}

interface AuditRow {
  id: number
  entity_type: string
  entity_id: string
  action: string
  occurred_at: string
  actor_name: string | null
  /**
   * What the record IS, in one line — "₹25,000 · Rishabh Shah · DON/…/000042".
   * The API builds it from the audit payloads (common/domain/audit-summary.ts),
   * which this screen never sees: they can hold a base64 photo or an encrypted
   * PAN.
   */
  summary?: string
  /** For an update: what moved. Empty on a create. */
  changes?: AuditChange[]
}

const PAGE_SIZE = 30
const ACTIONS = ['create', 'update', 'delete', 'void', 'restore', 'pay', 'cheque_deposit', 'cheque_clear', 'cheque_bounce']

const ACTION_BADGE: Record<string, string> = {
  create: 'badge-green', update: 'badge-blue', delete: 'badge-red', void: 'badge-red',
  restore: 'badge-yellow', pay: 'badge-green', cheque_bounce: 'badge-red',
}

/** Who did what, when — a read-only view over the audit trail every service already writes to. */
export function ActivityLogPage() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('activity-log', 'thisWeek'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [entityTypes, setEntityTypes] = useState<string[]>([])

  useEffect(() => {
    api.get('/audit-log/entity-types').then(r => setEntityTypes(r.data.data || [])).catch(() => {})
  }, [])

  const columns: ColumnDef<AuditRow>[] = useMemo(() => [
    {
      key: 'occurred_at', label: t('common.date'), sortable: false,
      render: r => <span className="text-xs text-slate-500">{new Date(r.occurred_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>,
    },
    { key: 'actor', label: t('activityLog.actor'), render: r => <span className="font-medium">{r.actor_name || t('activityLog.system')}</span> },
    {
      key: 'entity_type', label: t('activityLog.entity'),
      filter: { kind: 'enum', param: 'entity_type', options: entityTypes.map(e => ({ value: e, label: e })) },
      render: r => <span className="font-mono text-xs text-slate-600">{r.entity_type}</span>,
    },
    {
      key: 'action', label: t('activityLog.action'),
      filter: { kind: 'enum', param: 'action', options: ACTIONS.map(a => ({ value: a, label: a })) },
      render: r => <span className={ACTION_BADGE[r.action] ?? 'badge-gray'}>{r.action}</span>,
    },
    {
      // The column the log existed without: "donations · create" told a trustee
      // that something happened and nothing about what.
      key: 'summary', label: t('activityLog.details'), sortable: false,
      render: r => <AuditDetails row={r} />,
    },
    { key: 'entity_id', label: t('activityLog.recordId'), render: r => <span className="font-mono text-[10px] text-slate-400">{r.entity_id.slice(0, 8)}</span> },
     
  ], [t, entityTypes])

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (search) params.set('q', search)
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, search, range, filterState])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/audit-log?${buildParams()}`)
      setRows(data.data || [])
      setTotal(data.meta?.total || 0)
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  const stats: SummaryStat[] = [
    { label: t('activityLog.title'), value: String(total) },
  ]

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('activityLog.title')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="no-print">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><History size={18} /> {t('activityLog.title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('activityLog.subtitle')}</p>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={v => { setRange(v); setPage(1) }} storageKey="activity-log" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="activity-log-list"
        columns={columns}
        rows={rows}
        rowKey={r => String(r.id)}
        loading={loading}
        searchValue={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder={t('activityLog.search')}
        onPrint={() => printCurrentView()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
          setPage(1)
        }}
        page={page}
        limit={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        emptyMessage={t('activityLog.empty')}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />
    </div>
  )
}

/**
 * What one logged action actually did.
 *
 * The headline reads on its own ("₹25,000 · Rishabh Shah · DON/2026-27/000042").
 * An edit also carries the fields that moved, which is the part an auditor asks
 * about — shown inline up to three, then behind a toggle, so a row that changed
 * one field stays one line and a bulk edit does not push the table off screen.
 */
function AuditDetails({ row }: { row: AuditRow }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const changes = row.changes ?? []
  const shown = open ? changes : changes.slice(0, 3)

  if (!row.summary && !changes.length) {
    return <span className="text-slate-300">—</span>
  }

  return (
    <div className="text-xs">
      {row.summary && <span className="text-slate-700">{row.summary}</span>}
      {shown.length > 0 && (
        <ul className={row.summary ? 'mt-1 space-y-0.5' : 'space-y-0.5'}>
          {shown.map((c, i) => (
            <li key={i} className="text-slate-500">
              <span className="text-slate-400">{c.field}:</span>{' '}
              {c.from != null && <span className="line-through text-slate-400">{c.from}</span>}
              {c.from != null && ' → '}
              <span className="text-slate-700">{c.to ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
      {changes.length > 3 && (
        <button type="button" onClick={() => setOpen(o => !o)}
          className="mt-0.5 text-[11px] text-brand-blue hover:underline">
          {open ? t('common.showLess') : t('activityLog.moreChanges', { count: changes.length - 3 })}
        </button>
      )}
    </div>
  )
}
