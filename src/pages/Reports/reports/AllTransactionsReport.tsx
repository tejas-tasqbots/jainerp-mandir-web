import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { trendByDay } from '../../../lib/chartData'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

/**
 * The type chips this trust should be offered. The API names them in
 * `included_types` — it unions only the counters the trust has a module for, so
 * a hard-coded list here offered a donation-only trust filters for Prasad, Room
 * and Hall that could only ever return nothing. Falls back to the full list for
 * an API older than that field.
 */
const ALL_TYPES = ['donation', 'expense', 'seva', 'prasad', 'bhojanshala', 'room', 'hall']

interface TxnRow {
  date: string
  type: string
  reference: string | null
  party: string | null
  head: string | null
  payment_mode: string | null
  amount_paise: number
  direction: 'in' | 'out'
}

interface TxnData {
  rows: TxnRow[]
  included_types?: string[]
  totals: { count: number; inflow_paise: number; outflow_paise: number; net_paise: number }
}

/** Every money movement across every module in one stream (plan §03). */
export function AllTransactionsReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('report-all-txn', 'thisMonth'))
  const [data, setData] = useState<TxnData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const typeLabel = (ty: string) => t(`reports.txnType_${ty}`, ty)

  useEffect(() => { load() }, [range, filterState])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const types = filterState.type?.values
      if (types?.length) params.set('type', types.join(','))
      const { data: res } = await api.get(`/reports/all-transactions?${params}`)
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = useMemo(() => {
    const rows = data?.rows ?? []
    if (!q) return rows
    return rows.filter(r =>
      (r.party ?? '').toLowerCase().includes(q) ||
      (r.head ?? '').toLowerCase().includes(q) ||
      (r.reference ?? '').toLowerCase().includes(q))
  }, [data, q])

  const types = data?.included_types ?? ALL_TYPES

  const columns: ColumnDef<TxnRow>[] = [
    { key: 'date', label: t('common.date'), render: r => <span className="text-xs text-slate-500">{new Date(r.date).toLocaleDateString('en-IN')}</span> },
    {
      key: 'type', label: t('reports.txnKind'),
      filter: { kind: 'enum', param: 'type', options: types.map(ty => ({ value: ty, label: typeLabel(ty) })) },
      render: r => <span className={r.direction === 'in' ? 'badge-green' : 'badge-red'}>{typeLabel(r.type)}</span>,
    },
    { key: 'party', label: t('reports.party'), render: r => <span className="font-medium">{r.party || '—'}</span> },
    { key: 'head', label: t('reports.head'), render: r => <span className="text-slate-600">{r.head || '—'}</span> },
    { key: 'reference', label: t('accounts.reference'), render: r => <span className="font-mono text-xs text-slate-400">{r.reference || '—'}</span> },
    { key: 'mode', label: t('donations.mode'), render: r => r.payment_mode ? <span className="badge-gray">{r.payment_mode}</span> : <span className="text-slate-300">—</span> },
    {
      key: 'amount', label: t('common.amount'), align: 'right',
      render: r => (
        <span className={`font-semibold ${r.direction === 'in' ? 'text-green-700' : 'text-red-600'}`}>
          {r.direction === 'in' ? '+' : '−'}₹{fmtPaise(r.amount_paise)}
        </span>
      ),
    },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('reports.inflow'), value: `₹${fmtPaise(data.totals.inflow_paise)}`, tone: 'income' },
    { label: t('reports.outflow'), value: `₹${fmtPaise(data.totals.outflow_paise)}`, tone: 'expense' },
    { label: t('reports.net'), value: `₹${fmtPaise(data.totals.net_paise)}`, tone: data.totals.net_paise >= 0 ? 'income' : 'expense' },
    { label: t('reports.entries'), value: String(data.totals.count) },
  ] : []

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.allTransactions'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'all-transactions',
        columns: [
          { header: t('common.date'), type: 'date' }, { header: t('reports.txnKind'), width: 14 },
          { header: t('reports.party'), width: 24 }, { header: t('reports.head'), width: 18 },
          { header: t('accounts.reference'), width: 16 }, { header: t('donations.mode'), width: 10 },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: visible.map(r => [
          new Date(r.date).toLocaleDateString('en-IN'), typeLabel(r.type), r.party ?? '', r.head ?? '',
          r.reference ?? '', r.payment_mode ?? '',
          r.direction === 'in' ? r.amount_paise : -r.amount_paise,
        ]),
        totals: [t('kit.total'), '', '', '', '', '', (data?.totals.net_paise ?? 0)],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.allTransactions')} subtitle={rangeCaption(range, t('dateRange.all'))} />
      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey="report-all-txn" />
      </div>
      <SummaryStrip stats={stats} />
      <DataTable
        viewKey="all-transactions"
        columns={columns}
        rows={visible}
        rowKey={(r, i) => `${r.type}-${r.date}-${i}`}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('reports.searchTransactions')}
        graphData={trendByDay(visible.filter(r => r.direction === 'in'), 'date', 'amount_paise')}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => { const next = { ...prev }; if (s) next[key] = s; else delete next[key]; return next })
        }}
        page={1}
        limit={visible.length || 1}
        total={visible.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noData')}
        onClearFilters={() => setFilterState({})}
      />
    </div>
  )
}
