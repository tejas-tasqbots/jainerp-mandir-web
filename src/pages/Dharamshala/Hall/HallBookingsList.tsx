import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Receipt } from 'lucide-react'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { printDonationReceipt } from '../../../lib/printReceipt'
import { trendByDay } from '../../../lib/chartData'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState,
} from '../../../components/kit/DataTable'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'
import type { HallBooking } from '../../../types'

const PAGE_SIZE = 20
const STATUSES = ['confirmed', 'completed', 'cancelled'] as const

export function HallBookingsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()

  const [bookings, setBookings] = useState<HallBooking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('hall'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  function statusBadge(s: string) {
    if (s === 'confirmed') return <span className="badge-blue">{t('dharamshala.statusConfirmed')}</span>
    if (s === 'completed') return <span className="badge-green">{t('dharamshala.statusCompleted')}</span>
    return <span className="badge-red">{t('dharamshala.statusCancelled')}</span>
  }

  const statusLabel: Record<string, string> = {
    confirmed: t('dharamshala.statusConfirmed'),
    completed: t('dharamshala.statusCompleted'),
    cancelled: t('dharamshala.statusCancelled'),
  }

  const columns: ColumnDef<HallBooking>[] = useMemo(() => [
    {
      key: 'event', label: t('dharamshala.event'),
      render: b => <span className="font-medium">{b.event_name}</span>,
    },
    {
      key: 'hall', label: t('dharamshala.hall'),
      render: b => <span className="text-slate-600">{b.hall_name || '—'}</span>,
    },
    {
      key: 'date', label: t('common.date'),
      render: b => <span className="text-xs">{new Date(b.booking_date).toLocaleDateString('en-IN')}</span>,
    },
    {
      key: 'session', label: t('dharamshala.session'),
      render: b => <span className="badge-blue capitalize">{b.session_type.replace('_', ' ')}</span>,
    },
    {
      key: 'total', label: t('dharamshala.total'), align: 'right',
      render: b => <span className="font-semibold">₹{fmtPaise(b.total_paise)}</span>,
    },
    {
      key: 'advance', label: t('dharamshala.advance'), align: 'right',
      render: b => <>₹{fmtPaise(b.advance_paise)}</>,
    },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: b => statusBadge(b.status),
    },
    {
      key: 'receipt', label: '', align: 'right',
      // Only once a number has been issued — before that there is nothing to
      // print, and offering the button would produce a blank document.
      render: b => b.invoice_no ? (
        <button
          onClick={e => { e.stopPropagation(); printDonationReceipt(b.id, '/hall-bookings').catch(() => {}) }}
          className="p-1 text-slate-400 hover:text-navy-700 rounded"
          title={t('common.printReceipt', { defaultValue: 'Print receipt' })}
          aria-label={t('common.printReceipt', { defaultValue: 'Print receipt' })}
        >
          <Receipt size={14} />
        </button>
      ) : null,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit) })
    if (search) params.set('q', search)
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, search, range, filterState])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/hall-bookings?${buildParams(PAGE_SIZE, page)}`)
      setBookings(data.data || [])
      setTotal(data.meta?.total || 0)
    } catch {
      setBookings([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  function resetPageAnd<T>(setter: (v: T) => void) {
  

  return (v: T) => { setter(v); setPage(1) }
  }

  async function exportExcel() {
    try {
      const { data } = await api.get(`/hall-bookings?${buildParams(1000)}`)
      const rows: HallBooking[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('dharamshala.hallTitle'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'hall-bookings',
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('dharamshala.event'), width: 26 },
          { header: t('dharamshala.hall'), width: 18 },
          { header: t('dharamshala.session'), width: 12 },
          { header: t('dharamshala.total'), type: 'money' },
          { header: t('dharamshala.advance'), type: 'money' },
          { header: t('common.status'), width: 12 },
        ],
        rows: rows.map(b => [
          new Date(b.booking_date).toLocaleDateString('en-IN'), b.event_name ?? '',
          b.hall_name ?? '', b.session_type.replace('_', ' '),
          b.total_paise, b.advance_paise, statusLabel[b.status] ?? b.status,
        ]),
        totals: [
          t('kit.total'), '', '', '',
          rows.reduce((s, b) => s + b.total_paise, 0),
          rows.reduce((s, b) => s + b.advance_paise, 0),
          '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  // Hall money view per plan §15 (balance-due column + status chips).
  const live = bookings.filter(b => b.status !== 'cancelled')
  const hallTotal = live.reduce((s2, b) => s2 + (b.total_paise ?? 0), 0)
  const hallAdvance = live.reduce((s2, b) => s2 + (b.advance_paise ?? 0), 0)
  const stats: SummaryStat[] = [
    { label: t('dharamshala.summaryBookings'), value: String(live.length) },
    { label: t('dharamshala.summaryBooked'), value: `₹${fmtPaise(hallTotal)}`, tone: 'income' },
    { label: t('dharamshala.summaryAdvances'), value: `₹${fmtPaise(hallAdvance)}` },
    { label: t('dharamshala.summaryBalanceDue'), value: `₹${fmtPaise(Math.max(hallTotal - hallAdvance, 0))}`, tone: 'expense' },
  ]

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('dharamshala.hallTitle')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('dharamshala.hallTitle')}</h1>
        <button onClick={() => navigate('/hall/add')} className="btn-primary btn-sm">
          <Plus size={14} /> {t('dharamshala.newBooking')}
        </button>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="hall" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="hall-list"
        columns={columns}
        rows={bookings}
        rowKey={b => b.id}
        loading={loading}
        graphData={trendByDay(bookings, 'booking_date', 'total_paise')}
        searchValue={search}
        onSearchChange={resetPageAnd(setSearch)}
        searchPlaceholder={t('dharamshala.hallSearchPlaceholder')}
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
          setPage(1)
        }}
        page={page}
        limit={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        emptyMessage={t('dharamshala.noHallBookings')}
        emptyAction={{ label: t('dharamshala.newBooking'), onClick: () => navigate('/hall/add') }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />
    </div>
  )
}
