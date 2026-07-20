import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface ModeRow { payment_mode: string; count: number; amount_paise: number }
interface StreamRow { label: string; amount_paise: number; emphasis?: 'total' | 'net' }

interface CollectionData {
  from: string
  to: string
  donations_paise: number
  seva_paise: number
  prasad_paise: number
  bhojanshala_paise: number
  room_advance_paise: number
  hall_advance_paise: number
  total_collection_paise: number
  expenses_paise: number
  net_paise: number
  payment_modes: ModeRow[]
}

/** Consolidated collection across every revenue stream over a date range. */
export function CollectionSummaryReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('report-collection-summary', 'thisMonth'))
  const [data, setData] = useState<CollectionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [range])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data: res } = await api.get(`/reports/collection-summary?${params}`)
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const streamRows: StreamRow[] = useMemo(() => {
    if (!data) return []
    return [
      { label: t('reports.streamDonations'), amount_paise: data.donations_paise },
      { label: t('reports.streamSeva'), amount_paise: data.seva_paise },
      { label: t('reports.streamPrasad'), amount_paise: data.prasad_paise },
      { label: t('reports.streamBhojanshala'), amount_paise: data.bhojanshala_paise },
      { label: t('reports.streamRoomAdvance'), amount_paise: data.room_advance_paise },
      { label: t('reports.streamHallAdvance'), amount_paise: data.hall_advance_paise },
      { label: t('reports.streamTotalCollection'), amount_paise: data.total_collection_paise, emphasis: 'total' },
      { label: t('reports.streamExpenses'), amount_paise: data.expenses_paise },
      { label: t('reports.streamNet'), amount_paise: data.net_paise, emphasis: 'net' },
    ]
  }, [data, t])

  const streamColumns: ColumnDef<StreamRow>[] = [
    { key: 'label', label: t('reports.stream'), render: r => <span className={r.emphasis ? 'font-bold' : ''}>{r.label}</span> },
    {
      key: 'amount', label: t('common.amount'), align: 'right',
      render: r => <span className={r.emphasis === 'net' ? 'font-bold text-green-700' : r.emphasis === 'total' ? 'font-bold' : ''}>₹{fmtPaise(r.amount_paise)}</span>,
    },
  ]

  const modeColumns: ColumnDef<ModeRow>[] = [
    { key: 'mode', label: t('donations.mode'), render: r => <span className="badge-gray capitalize">{r.payment_mode}</span> },
    { key: 'count', label: t('reports.receipts'), align: 'right', render: r => <span className="text-slate-500">{r.count}</span> },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">₹{fmtPaise(r.amount_paise)}</span> },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('reports.streamTotalCollection'), value: `₹${fmtPaise(data.total_collection_paise)}`, tone: 'income' },
    { label: t('reports.streamExpenses'), value: `₹${fmtPaise(data.expenses_paise)}`, tone: 'expense' },
    { label: t('reports.streamNet'), value: `₹${fmtPaise(data.net_paise)}`, tone: data.net_paise >= 0 ? 'income' : 'expense' },
  ] : []

  async function exportExcel() {
    if (!data) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.collectionSummary'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'collection-summary',
        columns: [
          { header: t('reports.stream'), width: 26 },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: streamRows.map(r => [r.label, r.amount_paise]),
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.collectionSummary')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey="report-collection-summary" />
      </div>

      <SummaryStrip stats={stats} />

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-sm text-navy-900 mb-2">{t('reports.byStream')}</h3>
          <DataTable
            columns={streamColumns}
            rows={streamRows}
            rowKey={r => r.label}
            loading={loading}
            onExportXlsx={exportExcel}
            onPrint={() => window.print()}
            filterState={{}}
            onFilterChange={() => {}}
            page={1}
            limit={streamRows.length || 1}
            total={streamRows.length}
            onPageChange={() => {}}
            emptyMessage={t('reports.noData')}
          />
        </div>
        <div>
          <h3 className="font-semibold text-sm text-navy-900 mb-2">{t('reports.byPaymentMode')}</h3>
          <DataTable
            columns={modeColumns}
            rows={data?.payment_modes ?? []}
            rowKey={r => r.payment_mode}
            loading={loading}
            filterState={{}}
            onFilterChange={() => {}}
            page={1}
            limit={(data?.payment_modes.length || 1)}
            total={data?.payment_modes.length ?? 0}
            onPageChange={() => {}}
            emptyMessage={t('reports.noData')}
          />
        </div>
      </div>
    </div>
  )
}
