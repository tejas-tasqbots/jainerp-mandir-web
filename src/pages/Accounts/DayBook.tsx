import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../lib/api'
import { rsFmt, printCurrentView } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface Entry {
  date: string
  type: string
  description: string
  debit_paise: number
  credit_paise: number
  reference?: string
}

export function DayBook() {
  const { t } = useTranslation()
  const toast = useToast()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('day-book', 'today'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  useEffect(() => { load() }, [range])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data } = await api.get(`/accounting/day-book?${params}`)
      setEntries(data.data || [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  const types = Array.from(new Set(entries.map(e => e.type))).sort()
  const q = search.trim().toLowerCase()
  const filtered = entries.filter(e => {
    if (filterState.type?.values?.length && !filterState.type.values.includes(e.type)) return false
    if (q && !(e.description?.toLowerCase().includes(q) || e.reference?.toLowerCase().includes(q))) return false
    return true
  })

  const columns: ColumnDef<Entry>[] = [
    { key: 'date', label: t('accounts.date'), render: e => <span className="text-xs text-slate-500">{new Date(e.date).toLocaleDateString('en-IN')}</span> },
    {
      key: 'type', label: t('accounts.type'),
      filter: { kind: 'enum', param: 'type', options: types.map(ty => ({ value: ty, label: ty.replace(/_/g, ' ') })) },
      render: e => <span className="badge-blue capitalize">{e.type.replace(/_/g, ' ')}</span>,
    },
    { key: 'description', label: t('accounts.description'), render: e => e.description },
    { key: 'reference', label: t('accounts.reference'), render: e => <span className="font-mono text-xs text-slate-400">{e.reference || '—'}</span> },
    // Debit = money in (green), credit = money out (red). The colours were the
    // other way round under the pre-2026-08 inverted convention.
    { key: 'debit', label: t('accounts.debit'), align: 'right', render: e => e.debit_paise > 0 ? <span className="text-green-700">₹{fmtPaise(e.debit_paise)}</span> : '—' },
    { key: 'credit', label: t('accounts.credit'), align: 'right', render: e => e.credit_paise > 0 ? <span className="text-red-600">₹{fmtPaise(e.credit_paise)}</span> : '—' },
  ]

  const totalDebit = filtered.reduce((s, e) => s + e.debit_paise, 0)
  const totalCredit = filtered.reduce((s, e) => s + e.credit_paise, 0)

  // Receipts sit in the debit column and payments in the credit column, so
  // income is the debit total. These two tiles kept the pre-2026-08 inverted
  // convention and showed each other's figure.
  const stats: SummaryStat[] = [
    { label: t('accounts.totalReceiptsIncome'), value: `₹${fmtPaise(totalDebit)}`, tone: 'income' },
    { label: t('accounts.totalPaymentsExpense'), value: `₹${fmtPaise(totalCredit)}`, tone: 'expense' },
  ]

  async function exportExcel() {
    if (!filtered.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('accounts.dayBookTitle'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'day-book',
        columns: [
          { header: t('accounts.date'), type: 'date' },
          { header: t('accounts.type'), width: 14 },
          { header: t('accounts.description'), width: 28 },
          { header: t('accounts.reference'), width: 16 },
          { header: t('accounts.debit'), type: 'money' },
          { header: t('accounts.credit'), type: 'money' },
        ],
        rows: filtered.map(e => [
          new Date(e.date).toLocaleDateString('en-IN'), e.type.replace(/_/g, ' '), e.description, e.reference ?? '',
          e.debit_paise, e.credit_paise,
        ]),
        totals: [t('kit.total'), '', '', '', totalDebit, totalCredit],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function exportPdf() {
    if (!filtered.length) { toast.info(t('kit.nothingToExport')); return }
    downloadRowsPdf(`day-book-${range.from}_${range.to}.pdf`, 'Day Book',
      ['Date', 'Type', 'Description', 'Reference', 'Debit', 'Credit'],
      filtered.map(e => [new Date(e.date).toLocaleDateString('en-IN'), e.type.replace(/_/g, ' '), e.description, e.reference ?? '', rsFmt(e.debit_paise), rsFmt(e.credit_paise)]),
      { subtitle: rangeCaption(range, t('dateRange.all')), totals: ['Total', '', '', '', rsFmt(totalDebit), rsFmt(totalCredit)] })
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('accounts.dayBookTitle')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.dayBookTitle')}</h1>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey="day-book" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="day-book-list"
        columns={columns}
        rows={filtered}
        rowKey={(e, i) => `${e.date}-${i}`}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('accounts.searchDescRef')}
        onExportXlsx={exportExcel}
        onExportPdf={exportPdf}
        onPrint={() => printCurrentView()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => { const next = { ...prev }; if (s) next[key] = s; else delete next[key]; return next })
        }}
        page={1}
        limit={filtered.length || 1}
        total={filtered.length}
        onPageChange={() => {}}
        emptyMessage={t('accounts.noEntries')}
        onClearFilters={() => setFilterState({})}
      />
    </div>
  )
}
