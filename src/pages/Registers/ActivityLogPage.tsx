import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import { api } from '../../lib/api'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState,
} from '../../components/kit/DataTable'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'

interface AuditRow {
  id: number
  entity_type: string
  entity_id: string
  action: string
  occurred_at: string
  actor_name: string | null
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
    { key: 'entity_id', label: t('activityLog.recordId'), render: r => <span className="font-mono text-[10px] text-slate-400">{r.entity_id.slice(0, 8)}</span> },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, entityTypes])

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, range, filterState])

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

      <DataTable
        viewKey="activity-log-list"
        columns={columns}
        rows={rows}
        rowKey={r => String(r.id)}
        loading={loading}
        onPrint={() => window.print()}
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
