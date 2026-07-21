import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface EventRow {
  event_id: string
  event_name: string
  event_type: string
  start_date: string
  boli_pledged_paise: number
  collected_paise: number
  expenses_paise: number
  net_paise: number
}

interface EventData {
  rows: EventRow[]
  totals: { collected_paise: number; expenses_paise: number; net_paise: number }
}

/** "Which festival raised what" — collections vs expenses per event (plan §03 Trends). */
export function EventCollectionReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('report-event-collection', 'thisFY'))
  const [data, setData] = useState<EventData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [range])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data: res } = await api.get(`/reports/event-wise-collection?${params}`)
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const q = search.trim().toLowerCase()
  const rows = (data?.rows ?? []).filter(r => !q || r.event_name.toLowerCase().includes(q))

  const columns: ColumnDef<EventRow>[] = [
    { key: 'event', label: t('reports.event'), render: r => <span className="font-medium text-brand-blue">{r.event_name}</span> },
    { key: 'date', label: t('common.date'), render: r => <span className="text-xs text-slate-500">{new Date(r.start_date).toLocaleDateString('en-IN')}</span> },
    { key: 'pledged', label: t('pledges.pledged'), align: 'right', render: r => <span className="text-slate-500">₹{fmtPaise(r.boli_pledged_paise)}</span> },
    { key: 'collected', label: t('reports.collected'), align: 'right', render: r => <span className="text-green-700 font-semibold">₹{fmtPaise(r.collected_paise)}</span> },
    { key: 'expenses', label: t('reports.streamExpenses'), align: 'right', render: r => <span className="text-red-600">₹{fmtPaise(r.expenses_paise)}</span> },
    {
      key: 'net', label: t('reports.net'), align: 'right',
      render: r => <span className={`font-semibold ${r.net_paise >= 0 ? 'text-green-700' : 'text-red-600'}`}>₹{fmtPaise(r.net_paise)}</span>,
    },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('reports.collected'), value: `₹${fmtPaise(data.totals.collected_paise)}`, tone: 'income' },
    { label: t('reports.streamExpenses'), value: `₹${fmtPaise(data.totals.expenses_paise)}`, tone: 'expense' },
    { label: t('reports.net'), value: `₹${fmtPaise(data.totals.net_paise)}`, tone: data.totals.net_paise >= 0 ? 'income' : 'expense' },
    { label: t('events.summaryEvents'), value: String(rows.length) },
  ] : []

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.eventCollection'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'event-collection',
        columns: [
          { header: t('reports.event'), width: 26 }, { header: t('common.date'), type: 'date' },
          { header: t('pledges.pledged'), type: 'money' }, { header: t('reports.collected'), type: 'money' },
          { header: t('reports.streamExpenses'), type: 'money' }, { header: t('reports.net'), type: 'money' },
        ],
        rows: rows.map(r => [
          r.event_name, new Date(r.start_date).toLocaleDateString('en-IN'),
          r.boli_pledged_paise, r.collected_paise, r.expenses_paise, r.net_paise,
        ]),
        totals: [t('kit.total'), '', '', data?.totals.collected_paise ?? 0, data?.totals.expenses_paise ?? 0, data?.totals.net_paise ?? 0],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.eventCollection')} subtitle={rangeCaption(range, t('dateRange.all'))} />
      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey="report-event-collection" />
      </div>
      <SummaryStrip stats={stats} />
      <p className="text-xs text-slate-400 no-print">{t('reports.eventCollectionScope')}</p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.event_id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('events.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={rows.length || 1}
        total={rows.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noData')}
        onRowClick={r => navigate(`/events/${r.event_id}`)}
      />
    </div>
  )
}
