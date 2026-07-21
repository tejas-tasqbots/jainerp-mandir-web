import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'
import { trendByDay } from '../../../lib/chartData'

type RegisterType = 'seva' | 'room' | 'hall' | 'prasad' | 'bhojanshala' | 'annadaan'

const TYPES: RegisterType[] = ['seva', 'room', 'hall', 'prasad', 'bhojanshala', 'annadaan']

/** Every register row, loosely typed — the columns differ per register. */
interface Row {
  id: string
  date: string
  invoice_no?: string | null
  service?: string | null
  party?: string | null
  mobile?: string | null
  detail?: string | null
  status?: string | null
  amount_paise?: number
  total_paise?: number
  advance_paise?: number
  balance_paise?: number
  subtotal_paise?: number
  gst_paise?: number
  check_out_date?: string | null
  nights?: number
  persons_count?: number
  event_name?: string | null
  session_type?: string | null
  hours?: number
  plates?: number
  rate_per_plate_paise?: number
  tokens_redeemed?: number
  meals_served?: number
  cost_per_meal_paise?: number
  total_cost_paise?: number
  sponsored_paise?: number
  sponsor_count?: number
  items?: { name?: string; qty?: number }[]
  is_anonymous?: boolean
  payment_mode?: string | null
  notes?: string | null
}

interface Totals {
  count: number
  amount_paise: number
  sponsored_paise?: number
  unsponsored_paise?: number
}

const dateCell = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN') : '—'

/** Chronological register for one service (plan §03/§15). */
export function ServiceRegisterReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [type, setType] = useState<RegisterType>('seva')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('report-service-register', 'thisMonth'))
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [type, range])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ type })
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data } = await api.get(`/reports/service-register?${params}`)
      setRows(data.data?.rows ?? [])
      setTotals(data.data?.totals ?? null)
    } catch {
      setRows([])
      setTotals(null)
    } finally {
      setLoading(false)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = q
    ? rows.filter(r =>
        `${r.party ?? ''} ${r.mobile ?? ''} ${r.service ?? ''} ${r.invoice_no ?? ''} ${r.event_name ?? ''}`
          .toLowerCase().includes(q))
    : rows

  const money = (v?: number) => `₹${fmtPaise(v ?? 0)}`
  const partyCell = (r: Row) =>
    r.is_anonymous
      ? <span className="text-slate-400 italic">{t('reports.anonymous')}</span>
      : (
        <div>
          <span className="font-medium">{r.party || '—'}</span>
          {r.mobile && <div className="text-xs text-slate-400">{r.mobile}</div>}
        </div>
      )

  const common: ColumnDef<Row>[] = [
    { key: 'date', label: t('common.date'), render: r => <span className="text-xs text-slate-500">{dateCell(r.date)}</span> },
    { key: 'invoice_no', label: t('reports.receiptNo'), render: r => <span className="font-mono text-xs text-slate-400">{r.invoice_no || '—'}</span> },
  ]

  const COLUMNS: Record<RegisterType, ColumnDef<Row>[]> = {
    seva: [
      ...common,
      { key: 'service', label: t('reports.seva'), render: r => r.service || '—' },
      { key: 'party', label: t('reports.devotee'), render: partyCell },
      { key: 'detail', label: t('reports.slot'), render: r => r.detail || '—' },
      { key: 'status', label: t('common.status'), render: r => <span className="badge-gray">{r.status}</span> },
      { key: 'amount', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">{money(r.amount_paise)}</span> },
    ],
    room: [
      ...common,
      { key: 'service', label: t('reports.room'), render: r => r.service || '—' },
      { key: 'party', label: t('reports.guest'), render: partyCell },
      { key: 'stay', label: t('reports.stay'), render: r => <span className="text-xs text-slate-500">{dateCell(r.date)} → {dateCell(r.check_out_date)}</span> },
      { key: 'nights', label: t('reports.nights'), align: 'right', render: r => `${r.nights ?? 0} × ${r.persons_count ?? 0}` },
      { key: 'advance', label: t('reports.advance'), align: 'right', render: r => money(r.advance_paise) },
      { key: 'balance', label: t('reports.balance'), align: 'right', render: r => (r.balance_paise ?? 0) > 0 ? <span className="text-red-600">{money(r.balance_paise)}</span> : money(0) },
      { key: 'total', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">{money(r.total_paise)}</span> },
    ],
    hall: [
      ...common,
      { key: 'service', label: t('reports.hall'), render: r => r.service || '—' },
      { key: 'event_name', label: t('reports.event'), render: r => r.event_name || '—' },
      { key: 'party', label: t('reports.booker'), render: partyCell },
      { key: 'session', label: t('reports.session'), render: r => <span className="text-xs text-slate-500">{r.session_type || '—'}{r.hours ? ` · ${r.hours}h` : ''}</span> },
      { key: 'advance', label: t('reports.advance'), align: 'right', render: r => money(r.advance_paise) },
      { key: 'total', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">{money(r.total_paise)}</span> },
    ],
    prasad: [
      ...common,
      { key: 'party', label: t('reports.buyer'), render: partyCell },
      {
        key: 'items', label: t('reports.items'),
        render: r => (
          <span className="text-xs text-slate-500">
            {(r.items ?? []).map(i => `${i.name ?? ''}${i.qty ? ` ×${i.qty}` : ''}`).filter(Boolean).join(', ') || '—'}
          </span>
        ),
      },
      { key: 'gst', label: 'GST', align: 'right', render: r => money(r.gst_paise) },
      { key: 'total', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">{money(r.total_paise)}</span> },
    ],
    bhojanshala: [
      ...common,
      { key: 'service', label: t('reports.meal'), render: r => <span className="badge-gray">{r.service}</span> },
      { key: 'party', label: t('reports.buyer'), render: partyCell },
      { key: 'plates', label: t('reports.plates'), align: 'right', render: r => `${r.plates ?? 0} × ${money(r.rate_per_plate_paise)}` },
      { key: 'tokens', label: t('reports.tokensRedeemed'), align: 'right', render: r => r.tokens_redeemed ?? 0 },
      { key: 'total', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">{money(r.total_paise)}</span> },
    ],
    annadaan: [
      { key: 'date', label: t('common.date'), render: r => <span className="text-xs text-slate-500">{dateCell(r.date)}</span> },
      { key: 'meals_served', label: t('reports.mealsServed'), align: 'right', render: r => r.meals_served ?? 0 },
      { key: 'cost_per_meal', label: t('reports.costPerMeal'), align: 'right', render: r => money(r.cost_per_meal_paise) },
      { key: 'total_cost', label: t('reports.totalCost'), align: 'right', render: r => <span className="font-semibold">{money(r.total_cost_paise)}</span> },
      {
        key: 'sponsored', label: t('reports.sponsored'), align: 'right',
        render: r => (r.sponsored_paise ?? 0) > 0
          ? <span className="text-green-700">{money(r.sponsored_paise)} <span className="text-slate-400">({r.sponsor_count})</span></span>
          : <span className="text-slate-300">—</span>,
      },
      { key: 'notes', label: t('common.notes'), render: r => <span className="text-xs text-slate-500">{r.notes || '—'}</span> },
    ],
  }

  // The "amount" column differs per register, so the chart and the export read
  // whichever one this register totals on.
  const amountKey: keyof Row = type === 'seva'
    ? 'amount_paise'
    : type === 'annadaan' ? 'total_cost_paise' : 'total_paise'

  const stats: SummaryStat[] = totals ? [
    { label: t('reports.entries'), value: String(totals.count) },
    {
      label: type === 'annadaan' ? t('reports.totalCost') : t('reports.collected'),
      value: `₹${fmtPaise(totals.amount_paise)}`,
      tone: type === 'annadaan' ? 'expense' : 'income',
    },
    ...(totals.sponsored_paise !== undefined ? [
      { label: t('reports.sponsored'), value: `₹${fmtPaise(totals.sponsored_paise)}`, tone: 'income' as const },
      { label: t('reports.unsponsored'), value: `₹${fmtPaise(totals.unsponsored_paise ?? 0)}`, tone: 'expense' as const },
    ] : []),
  ] : []

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    const cols = COLUMNS[type]
    try {
      await exportXlsx({
        title: t(`reports.register.${type}`),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: `${type}-register`,
        columns: cols.map(c => (c.align === 'right' ? { header: c.label, type: 'money' as const } : { header: c.label, width: 20 })),
        // Excel needs plain values, so re-derive them from the row rather than
        // rendering the JSX cells.
        rows: visible.map(r => cols.map(c => cellValue(r, c.key))),
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function cellValue(r: Row, key: string): string | number {
    switch (key) {
      case 'date': return dateCell(r.date)
      case 'invoice_no': return r.invoice_no ?? ''
      case 'service': return r.service ?? ''
      case 'party': return r.is_anonymous ? t('reports.anonymous') : (r.party ?? '')
      case 'detail': return r.detail ?? ''
      case 'status': return r.status ?? ''
      case 'stay': return `${dateCell(r.date)} → ${dateCell(r.check_out_date)}`
      case 'nights': return r.nights ?? 0
      case 'event_name': return r.event_name ?? ''
      case 'session': return `${r.session_type ?? ''}${r.hours ? ` ${r.hours}h` : ''}`
      case 'items': return (r.items ?? []).map(i => `${i.name ?? ''}${i.qty ? ` x${i.qty}` : ''}`).join(', ')
      case 'plates': return r.plates ?? 0
      case 'tokens': return r.tokens_redeemed ?? 0
      case 'meals_served': return r.meals_served ?? 0
      case 'cost_per_meal': return r.cost_per_meal_paise ?? 0
      case 'total_cost': return r.total_cost_paise ?? 0
      case 'sponsored': return r.sponsored_paise ?? 0
      case 'notes': return r.notes ?? ''
      case 'gst': return r.gst_paise ?? 0
      case 'advance': return r.advance_paise ?? 0
      case 'balance': return r.balance_paise ?? 0
      case 'amount': return r.amount_paise ?? 0
      case 'total': return r.total_paise ?? 0
      default: return ''
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t(`reports.register.${type}`)} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center gap-2 flex-wrap no-print">
        {TYPES.map(ty => (
          <button key={ty} type="button" onClick={() => setType(ty)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium ${
              type === ty ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {t(`reports.register.${ty}`)}
          </button>
        ))}
        <div className="ml-auto"><DateRangePicker value={range} onChange={setRange} storageKey="report-service-register" /></div>
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        columns={COLUMNS[type]}
        rows={visible}
        rowKey={r => r.id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('reports.searchRegister')}
        graphData={trendByDay(visible, 'date', amountKey)}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={{}}
        onFilterChange={() => {}}
        onClearFilters={() => setSearch('')}
        page={1}
        limit={visible.length || 1}
        total={visible.length}
        onPageChange={() => {}}
        viewKey={`report-register-${type}`}
        emptyMessage={t('reports.noData')}
      />
    </div>
  )
}
