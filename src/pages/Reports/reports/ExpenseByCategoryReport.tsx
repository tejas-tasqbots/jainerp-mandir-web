import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface CategoryRow {
  category: string
  count: number
  amount_paise: number
  gst_paise: number
}

interface CategoryData {
  from: string
  to: string
  rows: CategoryRow[]
  totals: { count: number; amount_paise: number; gst_paise: number }
}

/** Expense category-wise breakdown over a period. */
export function ExpenseByCategoryReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('report-expense-by-category', 'thisMonth'))
  const [data, setData] = useState<CategoryData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [range])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data: res } = await api.get(`/reports/expense-by-category?${params}`)
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const rows = data?.rows ?? []
  const grandTotal = data?.totals.amount_paise ?? 0

  const columns: ColumnDef<CategoryRow>[] = [
    { key: 'category', label: t('reports.category'), render: r => <span className="font-medium">{r.category}</span> },
    { key: 'count', label: t('reports.entries'), align: 'right', render: r => <span className="text-slate-500">{r.count}</span> },
    {
      key: 'share', label: t('reports.share'), align: 'right',
      render: r => <span className="text-slate-500">{grandTotal ? `${((r.amount_paise / grandTotal) * 100).toFixed(1)}%` : '—'}</span>,
    },
    { key: 'gst', label: 'GST', align: 'right', render: r => <span className="text-slate-500">{r.gst_paise ? `₹${fmtPaise(r.gst_paise)}` : '—'}</span> },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">₹{fmtPaise(r.amount_paise)}</span> },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('reports.totalExpenses'), value: `₹${fmtPaise(data.totals.amount_paise)}`, tone: 'expense', invert: true },
    { label: t('reports.entries'), value: String(data.totals.count) },
    { label: 'GST', value: `₹${fmtPaise(data.totals.gst_paise)}` },
    { label: t('reports.categories'), value: String(rows.length) },
  ] : []

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.expenseByCategory'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'expense-by-category',
        columns: [
          { header: t('reports.category'), width: 24 },
          { header: t('reports.entries'), width: 10 },
          { header: 'GST', type: 'money' },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: rows.map(r => [r.category, r.count, r.gst_paise, r.amount_paise]),
        totals: [t('kit.total'), data?.totals.count ?? 0, data?.totals.gst_paise ?? 0, grandTotal],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.expenseByCategory')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey="report-expense-by-category" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.category}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={rows.length || 1}
        total={rows.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noData')}
      />
    </div>
  )
}
