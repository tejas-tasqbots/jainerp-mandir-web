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

const PAYMENT_MODES = ['cash', 'upi', 'cheque', 'netbanking', 'online']

interface DonationRow {
  date: string
  invoice_no: string
  donor: string
  pan_masked: string | null
  category: string | null
  payment_mode: string
  amount_paise: number
  is_80g_eligible: boolean
}

export function DonationRegisterReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [rows, setRows] = useState<DonationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('report-donation-register', 'thisMonth'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const columns: ColumnDef<DonationRow>[] = useMemo(() => [
    { key: 'date', label: t('common.date'), render: r => <span className="text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span> },
    { key: 'invoice', label: t('donations.invoiceNo'), render: r => <span className="font-mono text-xs text-brand-blue">{r.invoice_no}</span> },
    { key: 'donor', label: t('donations.donor'), render: r => <span className="font-medium">{r.donor}</span> },
    { key: 'pan', label: t('donors.pan'), render: r => <span className="font-mono text-xs">{r.pan_masked || '—'}</span> },
    {
      key: 'category', label: t('donations.category'),
      filter: { kind: 'text', param: 'category' },
      render: r => <span className="text-slate-600">{r.category || '—'}</span>,
    },
    {
      key: 'mode', label: t('donations.mode'),
      filter: { kind: 'enum', param: 'payment_mode', options: PAYMENT_MODES.map(m => ({ value: m, label: t(`common.${m}`) })) },
      render: r => <span className="badge-gray">{r.payment_mode}</span>,
    },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">₹{fmtPaise(r.amount_paise)}</span> },
    {
      key: 'eightyG', label: t('donations.eightyG'),
      render: r => r.is_80g_eligible ? <span className="badge-green">{t('common.yes')}</span> : <span className="badge-gray">{t('common.no')}</span>,
    },
     
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
      const { data } = await api.get(`/reports/donation-register?${buildParams()}`)
      setRows(data.data?.rows ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = q
    ? rows.filter(r =>
        r.donor?.toLowerCase().includes(q) ||
        r.invoice_no?.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q) ||
        r.pan_masked?.toLowerCase().includes(q))
    : rows

  const totalAmount = visible.reduce((s, r) => s + Number(r.amount_paise), 0)
  const stats: SummaryStat[] = [
    { label: t('kit.total'), value: `₹${fmtPaise(totalAmount)}`, tone: 'income' },
    { label: t('kit.receipts'), value: String(visible.length) },
  ]

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.donationRegister'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'donation-register',
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('donations.invoiceNo') },
          { header: t('donations.donor'), width: 26 },
          { header: t('donors.pan'), width: 13 },
          { header: t('donations.category') },
          { header: t('donations.mode'), width: 12 },
          { header: t('common.amount'), type: 'money' },
          { header: t('donations.eightyG'), width: 8 },
        ],
        rows: visible.map(r => [
          new Date(r.date).toLocaleDateString('en-IN'), r.invoice_no, r.donor, r.pan_masked ?? '',
          r.category ?? '', r.payment_mode, r.amount_paise, r.is_80g_eligible ? t('common.yes') : t('common.no'),
        ]),
        totals: [t('kit.total'), '', '', '', '', '', totalAmount, ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.donationRegister')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey="report-donation-register" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={r => r.invoice_no}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('donations.searchPlaceholder')}
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
