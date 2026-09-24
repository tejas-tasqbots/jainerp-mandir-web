import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Receipt, Ban, Trash2 } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { rsFmt, printCurrentView } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'
import { printDonationReceipt } from '../../lib/printReceipt'
import { exportXlsx } from '../../lib/exportXlsx'
import { trendByDay } from '../../lib/chartData'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState,
} from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { SevaBooking } from '../../types'
import { useConfirm } from '../../components/ConfirmDialog'
import { useCanDeleteEntries, useDeleteEntry } from '../../components/deleteEntry'
import { enteredByColumn, enteredByText, useEnteredByOptions } from '../../lib/enteredBy'
import { paymentModeLabel } from '../../lib/paymentModeLabel'
import { tPdf } from '../../lib/i18n'

const PAGE_SIZE = 20
const STATUSES = ['booked', 'confirmed', 'completed', 'cancelled'] as const

export function SevaBookingsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const canDelete = useCanDeleteEntries()
  const deleteEntry = useDeleteEntry()

  const [bookings, setBookings] = useState<SevaBooking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('seva'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null)

  function statusBadge(s: string) {
    if (s === 'booked') return <span className="badge-yellow">{t('seva.statusBooked')}</span>
    if (s === 'confirmed') return <span className="badge-blue">{t('seva.statusConfirmed')}</span>
    if (s === 'completed') return <span className="badge-green">{t('seva.statusCompleted')}</span>
    if (s === 'cancelled') return <span className="badge-red">{t('seva.statusCancelled')}</span>
    return <span className="badge-gray">{s}</span>
  }

  const statusLabel: Record<string, string> = {
    booked: t('seva.filterBooked'),
    confirmed: t('seva.filterConfirmed'),
    completed: t('seva.filterCompleted'),
    cancelled: t('seva.filterCancelled'),
  }

  const enteredByOptions = useEnteredByOptions()
  const columns: ColumnDef<SevaBooking>[] = useMemo(() => [
    {
      key: 'devotee', label: t('seva.devotee'),
      render: b => (
        <div>
          <p className="font-medium">{b.devotee_name}</p>
          <p className="text-xs text-slate-400">{b.devotee_mobile}</p>
          {b.gotra && <p className="text-xs text-slate-300">{t('seva.gotraLabel', { gotra: b.gotra })}</p>}
        </div>
      ),
    },
    {
      key: 'seva', label: t('seva.sevaCol'),
      render: b => <span className="text-slate-700">{b.seva_name || '—'}</span>,
    },
    {
      key: 'date', label: t('common.date'),
      render: b => <span className="text-xs">{new Date(b.booking_date).toLocaleDateString('en-IN')}</span>,
    },
    {
      key: 'slot', label: t('seva.slot'),
      render: b => <span className="text-slate-500 text-xs">{b.slot_time || '—'}</span>,
    },
    {
      key: 'amount', label: t('common.amount'), align: 'right',
      render: b => <span className="font-semibold">₹{fmtPaise(b.amount_paise)}</span>,
    },
    {
      key: 'mode', label: t('seva.mode'),
      render: b => <span className="badge-gray">{paymentModeLabel(t, b.payment_mode)}</span>,
    },
    enteredByColumn<SevaBooking>(t, enteredByOptions),
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: b => statusBadge(b.status),
    },
    {
      key: 'actions', label: t('common.actions'),
      render: b => (
        <div className="flex gap-1 flex-wrap items-center">
          {b.status === 'booked' && (
            <button type="button" onClick={() => setStatus(b.id, 'confirmed')}
              className="btn-secondary btn-sm text-xs">{t('seva.confirm')}</button>
          )}
          {(b.status === 'booked' || b.status === 'confirmed') && (
            <button type="button" onClick={() => setStatus(b.id, 'completed')} className="btn-success btn-sm text-xs">
              {t('seva.markDone')}
            </button>
          )}
          <button
            type="button"
            onClick={() => openReceipt(b.id)}
            title={t('seva.printReceipt')} aria-label={t('seva.printReceipt')}
            disabled={receiptLoading === b.id}
            className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
          >
            <Receipt size={14} className={receiptLoading === b.id ? 'animate-pulse' : ''} />
          </button>
          {b.status !== 'cancelled' && b.status !== 'completed' && (
            <button
              type="button"
              onClick={() => cancelBooking(b.id)}
              title={t('seva.cancelBooking')} aria-label={t('seva.cancelBooking')}
              className="p-1 text-slate-400 hover:text-brand-red rounded"
            >
              <Ban size={14} />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={async () => {
                if (await deleteEntry({
                  kind: 'seva_booking', id: b.id, title: b.devotee_name, detail: b.seva_name ?? null,
                  amountPaise: b.amount_paise, date: b.booking_date,
                })) load()
              }}
              title={t('entries.delete')} aria-label={t('entries.delete')}
              className="p-1 text-slate-400 hover:text-brand-red rounded"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, enteredByOptions, receiptLoading, canDelete])

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
      const { data } = await api.get(`/seva-bookings?${buildParams(PAGE_SIZE, page)}`)
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

  // Collection figure from the loaded page keeps the strip honest without an
  // aggregate endpoint; the count is the true filtered total.
  const pageAmount = bookings.filter(b => b.status !== 'cancelled').reduce((s, b) => s + b.amount_paise, 0)
  const stats: SummaryStat[] = [
    { label: t('seva.bookings'), value: String(total) },
    { label: t('seva.pageCollection'), value: `₹${fmtPaise(pageAmount)}`, tone: 'income' },
  ]

  async function fetchAllFiltered(): Promise<SevaBooking[]> {
    const { data } = await api.get(`/seva-bookings?${buildParams(1000)}`)
    return data.data || []
  }

  async function exportExcel() {
    try {
      const rows = await fetchAllFiltered()
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('seva.title'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'seva-bookings',
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('seva.devotee'), width: 24 },
          { header: t('donors.mobile'), width: 15 },
          { header: t('seva.sevaCol'), width: 24 },
          { header: t('seva.slot'), width: 12 },
          { header: t('common.amount'), type: 'money' },
          { header: t('seva.mode'), width: 10 },
          { header: t('common.status'), width: 12 },
          { header: t('enteredBy.column'), width: 18 },
        ],
        rows: rows.map(b => [
          new Date(b.booking_date).toLocaleDateString('en-IN'), b.devotee_name ?? '', b.devotee_mobile ?? '',
          b.seva_name ?? '', b.slot_time ?? '', b.amount_paise, b.payment_mode,
          statusLabel[b.status] ?? b.status, enteredByText(b, t),
        ]),
        totals: [
          t('kit.total'), '', '', '', '',
          rows.filter(b => b.status !== 'cancelled').reduce((s, b) => s + b.amount_paise, 0),
          '', '', '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  async function exportPdf() {
    try {
      const rows = await fetchAllFiltered()
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      const totalAmt = rows.reduce((s, b) => s + b.amount_paise, 0)
      downloadRowsPdf('seva-bookings.pdf', 'Seva Bookings',
        ['Date', 'Devotee', 'Mobile', 'Seva', 'Slot', 'Amount', 'Mode', 'Status'],
        rows.map(b => [
          b.booking_date, b.devotee_name ?? '', b.devotee_mobile ?? '',
          b.seva_name ?? '', b.slot_time ?? '', rsFmt(b.amount_paise), b.payment_mode, b.status,
        ]),
        { subtitle: rangeCaption(range, tPdf('dateRange.all')), totals: ['Total', '', '', '', '', rsFmt(totalAmt), '', ''] })
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  async function openReceipt(id: string) {
    setReceiptLoading(id)
    try {
      // seva receipt payload is shape-compatible with the donation receipt renderer
      await printDonationReceipt(id, '/seva-bookings')
    } catch {
      toast.error(t('donations.receiptLoadFailed'))
    } finally {
      setReceiptLoading(null)
    }
  }

  async function setStatus(id: string, status: 'confirmed' | 'completed') {
    try {
      await api.patch(`/seva-bookings/${id}`, { status })
      toast.success(status === 'confirmed' ? t('seva.confirmedToast') : t('seva.completedToast'))
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message || t('seva.updateFailed'))
    }
  }

  async function cancelBooking(id: string) {
    if (!(await confirm({ title: t('seva.cancelBookingTitle'), message: t('seva.cancelBookingMessage'), confirmLabel: t('seva.cancelBookingConfirm'), cancelLabel: t('seva.keep'), danger: true }))) return
    try {
      await api.patch(`/seva-bookings/${id}`, { status: 'cancelled' })
      toast.success(t('seva.cancelledToast'))
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message || t('seva.cancelFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('seva.title')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('seva.title')}</h1>
        <button type="button" onClick={() => navigate('/seva/add')} className="btn-primary btn-sm">
          <Plus size={14} /> {t('seva.newBooking')}
        </button>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="seva" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="seva-list"
        columns={columns}
        rows={bookings}
        rowKey={b => b.id}
        loading={loading}
        graphData={trendByDay(bookings, 'booking_date', 'amount_paise')}
        searchValue={search}
        onSearchChange={resetPageAnd(setSearch)}
        searchPlaceholder={t('seva.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onExportPdf={exportPdf}
        onPrint={() => printCurrentView()}
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
        emptyMessage={t('seva.noBookingsFound')}
        emptyAction={{ label: t('seva.newBooking'), onClick: () => navigate('/seva/add') }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />
    </div>
  )
}
