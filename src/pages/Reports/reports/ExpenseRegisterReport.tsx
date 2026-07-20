import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState,
} from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface ExpenseRow {
  date: string
  bill_number: string | null
  category: string | null
  vendor: string | null
  description: string
  payment_mode: string
  is_on_credit: boolean
  amount_paise: number
  gst_paid_paise: number | null
  tds_amount_paise: number | null
}

export function ExpenseRegisterReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('report-expense-register', 'thisMonth'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const columns: ColumnDef<ExpenseRow>[] = useMemo(() => [
    { key: 'date', label: t('common.date'), render: r => <span className="text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span> },
    { key: 'description', label: t('expenses.description'), render: r => <span className="font-medium">{r.description}</span> },
    {
      key: 'vendor', label: t('expenses.vendor'),
      filter: { kind: 'text', param: 'vendor' },
      render: r => <span className="text-slate-600">{r.vendor || '—'}</span>,
    },
    { key: 'category', label: t('expenses.category'), render: r => <span className="text-slate-500">{r.category || '—'}</span> },
    { key: 'bill', label: t('expenses.billNo'), render: r => <span className="font-mono text-xs">{r.bill_number || '—'}</span> },
    { key: 'mode', label: t('expenses.mode'), render: r => <span className="badge-gray">{r.payment_mode}</span> },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">₹{fmtPaise(r.amount_paise)}</span> },
    { key: 'gst', label: 'GST', align: 'right', render: r => <>{r.gst_paid_paise ? `₹${fmtPaise(r.gst_paid_paise)}` : '—'}</> },
    { key: 'tds', label: t('expenses.tds'), align: 'right', render: r => <>{r.tds_amount_paise ? `₹${fmtPaise(r.tds_amount_paise)}` : '—'}</> },
    {
      key: 'type', label: t('expenses.type'),
      render: r => r.is_on_credit ? <span className="badge-red">{t('expenses.credit')}</span> : <span className="badge-green">{t('expenses.paid')}</span>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams()
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [range, filterState])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/reports/expense-register?${buildParams()}`)
      setRows(data.data?.rows ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const totalAmount = rows.reduce((s, r) => s + Number(r.amount_paise), 0)
  const totalGst = rows.reduce((s, r) => s + Number(r.gst_paid_paise ?? 0), 0)
  const stats: SummaryStat[] = [
    { label: t('kit.total'), value: `₹${fmtPaise(totalAmount)}`, tone: 'expense' },
    { label: t('expenses.totalExpenses'), value: String(rows.length) },
  ]

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.expenseRegister'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'expense-register',
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('expenses.description'), width: 30 },
          { header: t('expenses.vendor'), width: 22 },
          { header: t('expenses.category') },
          { header: t('expenses.billNo'), width: 14 },
          { header: t('expenses.mode'), width: 10 },
          { header: t('common.amount'), type: 'money' },
          { header: 'GST', type: 'money' },
          { header: t('expenses.tds'), type: 'money' },
          { header: t('expenses.type'), width: 10 },
        ],
        rows: rows.map(r => [
          new Date(r.date).toLocaleDateString('en-IN'), r.description, r.vendor ?? '', r.category ?? '',
          r.bill_number ?? '', r.payment_mode, r.amount_paise, r.gst_paid_paise ?? 0, r.tds_amount_paise ?? 0,
          r.is_on_credit ? t('expenses.credit') : t('expenses.paid'),
        ]),
        totals: [t('kit.total'), '', '', '', '', '', totalAmount, totalGst, '', ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.expenseRegister')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey="report-expense-register" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r, i) => `${r.bill_number ?? 'nb'}-${r.date}-${i}`}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
        }}
        page={1}
        limit={rows.length || 1}
        total={rows.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noData')}
        onClearFilters={() => setFilterState({})}
      />
    </div>
  )
}
