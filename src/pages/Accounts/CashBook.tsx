import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../lib/api'
import { rsFmt } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { DataTable, type ColumnDef } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface Entry {
  date: string
  description: string
  debit_paise: number
  credit_paise: number
  balance_paise: number
  reference?: string
}

export function CashBook({ bankMode = false }: { bankMode?: boolean }) {
  const { t } = useTranslation()
  const toast = useToast()
  const storageKey = bankMode ? 'bank-book' : 'cash-book'
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange(storageKey, 'thisMonth'))

  useEffect(() => { load() }, [range, bankMode])

  async function load() {
    setLoading(true)
    try {
      const type = bankMode ? 'bank' : 'cash'
      const params = new URLSearchParams({ type })
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data } = await api.get(`/accounting/ledger?${params}`)
      setEntries(data.data || [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  // Totals/closing balance stay on the full set (running balance is cumulative);
  // search only narrows which rows are shown so you can locate an entry.
  const visible = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e => e.description?.toLowerCase().includes(q) || e.reference?.toLowerCase().includes(q))
  }, [entries, search])

  const totalDebit = entries.reduce((s, e) => s + e.debit_paise, 0)
  const totalCredit = entries.reduce((s, e) => s + e.credit_paise, 0)
  const closingBalance = entries.length ? entries[entries.length - 1].balance_paise : 0
  const title = bankMode ? t('accounts.bankBookTitle') : t('accounts.cashBookTitle')

  const columns: ColumnDef<Entry>[] = [
    { key: 'date', label: t('accounts.date'), render: e => <span className="text-xs text-slate-500">{new Date(e.date).toLocaleDateString('en-IN')}</span> },
    { key: 'description', label: t('accounts.description'), render: e => e.description },
    { key: 'reference', label: t('accounts.reference'), render: e => <span className="font-mono text-xs text-slate-400">{e.reference || '—'}</span> },
    { key: 'credit', label: t('accounts.receiptsCr'), align: 'right', render: e => e.credit_paise > 0 ? <span className="font-medium text-green-700">₹{fmtPaise(e.credit_paise)}</span> : '—' },
    { key: 'debit', label: t('accounts.paymentsDr'), align: 'right', render: e => e.debit_paise > 0 ? <span className="font-medium text-red-600">₹{fmtPaise(e.debit_paise)}</span> : '—' },
    { key: 'balance', label: t('accounts.balance'), align: 'right', render: e => <span className="font-semibold">₹{fmtPaise(e.balance_paise)}</span> },
  ]

  const stats: SummaryStat[] = [
    { label: t('accounts.totalReceipts'), value: `₹${fmtPaise(totalCredit)}`, tone: 'income' },
    { label: t('accounts.totalPayments'), value: `₹${fmtPaise(totalDebit)}`, tone: 'expense' },
    { label: t('accounts.closingBalance'), value: `₹${fmtPaise(closingBalance)}` },
  ]

  async function exportExcel() {
    if (!entries.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title,
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: storageKey,
        columns: [
          { header: t('accounts.date'), type: 'date' },
          { header: t('accounts.description'), width: 28 },
          { header: t('accounts.reference'), width: 16 },
          { header: t('accounts.receiptsCr'), type: 'money' },
          { header: t('accounts.paymentsDr'), type: 'money' },
          { header: t('accounts.balance'), type: 'money' },
        ],
        rows: entries.map(e => [
          new Date(e.date).toLocaleDateString('en-IN'), e.description, e.reference ?? '',
          e.credit_paise, e.debit_paise, e.balance_paise,
        ]),
        totals: [t('kit.total'), '', '', totalCredit, totalDebit, closingBalance],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function exportPdf() {
    if (!entries.length) { toast.info(t('kit.nothingToExport')); return }
    downloadRowsPdf(`${storageKey}-${range.from}_${range.to}.pdf`, title,
      ['Date', 'Description', 'Reference', 'Receipts', 'Payments', 'Balance'],
      entries.map(e => [new Date(e.date).toLocaleDateString('en-IN'), e.description, e.reference ?? '', rsFmt(e.credit_paise), rsFmt(e.debit_paise), rsFmt(e.balance_paise)]),
      { subtitle: rangeCaption(range, t('dateRange.all')), totals: ['Total', '', '', rsFmt(totalCredit), rsFmt(totalDebit), rsFmt(closingBalance)] })
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={title} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{title}</h1>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey={storageKey} />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey={`${storageKey}-list`}
        columns={columns}
        rows={visible}
        rowKey={(e, i) => `${e.date}-${i}`}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('accounts.searchDescRef')}
        onExportXlsx={exportExcel}
        onExportPdf={exportPdf}
        onPrint={() => window.print()}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={visible.length || 1}
        total={visible.length}
        onPageChange={() => {}}
        emptyMessage={search ? t('accounts.noEntriesMatchSearch') : t('accounts.noEntriesForPeriod')}
      />
    </div>
  )
}
