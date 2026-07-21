import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
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
import type { RoomBooking } from '../../../types'
import { useConfirm } from '../../../components/ConfirmDialog'

const PAGE_SIZE = 20
const STATUSES = ['confirmed', 'checked_in', 'checked_out', 'cancelled'] as const

export function RoomsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()

  const [bookings, setBookings] = useState<RoomBooking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('rooms'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const [cancelModal, setCancelModal] = useState<{ id: string; guestName: string } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)


  // Occupancy + money held, per plan §15 (Rooms: occupancy %, advances held, due-out today).
  const todayIso = new Date().toISOString().slice(0, 10)
  const occupied = bookings.filter(b => b.status === 'checked_in').length
  const dueOut = bookings.filter(b => b.status === 'checked_in' && (b.check_out_date || '').slice(0, 10) === todayIso).length
  const advancesHeld = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'checked_out').reduce((s2, b) => s2 + (b.advance_paise ?? 0), 0)
  const stats: SummaryStat[] = [
    { label: t('dharamshala.summaryBookings'), value: String(total) },
    { label: t('dharamshala.summaryOccupied'), value: String(occupied) },
    { label: t('dharamshala.summaryDueOut'), value: String(dueOut), tone: dueOut ? 'expense' : 'default' },
    { label: t('dharamshala.summaryAdvances'), value: `₹${fmtPaise(advancesHeld)}`, tone: 'income' },
  ]

  function statusBadge(s: string) {
    if (s === 'booked' || s === 'confirmed') return <span className="badge-blue">{t('dharamshala.statusBooked')}</span>
    if (s === 'checked_in') return <span className="badge-green">{t('dharamshala.statusCheckedIn')}</span>
    if (s === 'checked_out') return <span className="badge-gray">{t('dharamshala.statusCheckedOut')}</span>
    return <span className="badge-red">{t('dharamshala.statusCancelled')}</span>
  }

  const statusLabel: Record<string, string> = {
    confirmed: t('dharamshala.filterConfirmed'),
    checked_in: t('dharamshala.filterCheckedIn'),
    checked_out: t('dharamshala.filterCheckedOut'),
    cancelled: t('dharamshala.filterCancelled'),
  }

  const columns: ColumnDef<RoomBooking>[] = useMemo(() => [
    {
      key: 'guest', label: t('dharamshala.guest'),
      render: b => (
        <div>
          <p className="font-medium">{b.guest_name}</p>
          <p className="text-xs text-slate-400">{b.guest_mobile}</p>
        </div>
      ),
    },
    {
      key: 'room', label: t('dharamshala.room'),
      render: b => <span className="text-slate-600">{b.room_number || b.room_id}</span>,
    },
    {
      key: 'check_in', label: t('dharamshala.checkIn'),
      render: b => <span className="text-xs">{new Date(b.check_in_date).toLocaleDateString('en-IN')}</span>,
    },
    {
      key: 'check_out', label: t('dharamshala.checkOut'),
      render: b => <span className="text-xs">{new Date(b.check_out_date).toLocaleDateString('en-IN')}</span>,
    },
    {
      key: 'persons', label: t('dharamshala.persons'),
      render: b => <span className="block text-center">{b.persons_count}</span>,
    },
    {
      key: 'advance', label: t('dharamshala.advance'), align: 'right',
      render: b => <>₹{fmtPaise(b.advance_paise)}</>,
    },
    {
      key: 'balance', label: t('dharamshala.balance'), align: 'right',
      render: b => (
        <span className={b.balance_paise > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
          ₹{fmtPaise(b.balance_paise)}
        </span>
      ),
    },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: b => statusBadge(b.status),
    },
    {
      key: 'actions', label: t('common.actions'),
      render: b => (
        <div className="flex gap-1">
          {(b.status === 'confirmed' || b.status === 'booked') && (
            <button onClick={() => checkin(b.id)} className="btn-success btn-sm">{t('dharamshala.checkInAction')}</button>
          )}
          {b.status === 'checked_in' && (
            <button onClick={() => checkout(b.id)} className="btn-secondary btn-sm">{t('dharamshala.checkOutAction')}</button>
          )}
          {(b.status === 'confirmed' || b.status === 'booked') && (
            <button
              onClick={() => setCancelModal({ id: b.id, guestName: b.guest_name })}
              className="p-1 text-slate-400 hover:text-brand-red rounded"
              title={t('dharamshala.cancelBooking')} aria-label={t('dharamshala.cancelBooking')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ),
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
      const { data } = await api.get(`/room-bookings?${buildParams(PAGE_SIZE, page)}`)
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
      const { data } = await api.get(`/room-bookings?${buildParams(1000)}`)
      const rows: RoomBooking[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('dharamshala.roomsTitle'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'room-bookings',
        columns: [
          { header: t('dharamshala.guest'), width: 24 },
          { header: t('donors.mobile'), width: 15 },
          { header: t('dharamshala.room'), width: 10 },
          { header: t('dharamshala.checkIn'), type: 'date' },
          { header: t('dharamshala.checkOut'), type: 'date' },
          { header: t('dharamshala.persons'), type: 'number', width: 9 },
          { header: t('dharamshala.advance'), type: 'money' },
          { header: t('dharamshala.balance'), type: 'money' },
          { header: t('common.status'), width: 13 },
        ],
        rows: rows.map(b => [
          b.guest_name ?? '', b.guest_mobile ?? '', b.room_number || b.room_id,
          new Date(b.check_in_date).toLocaleDateString('en-IN'),
          new Date(b.check_out_date).toLocaleDateString('en-IN'),
          b.persons_count, b.advance_paise, b.balance_paise,
          statusLabel[b.status] ?? b.status,
        ]),
        totals: [
          t('kit.total'), '', '', '', '', '',
          rows.reduce((s, b) => s + b.advance_paise, 0),
          rows.reduce((s, b) => s + b.balance_paise, 0),
          '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  async function checkin(id: string) {
    if (!(await confirm({ title: t('dharamshala.confirmCheckinTitle'), message: t('dharamshala.confirmCheckinMessage'), confirmLabel: t('dharamshala.checkInButton') }))) return
    try {
      await api.patch(`/room-bookings/${id}/checkin`, {})
      toast.success(t('dharamshala.checkinSuccess'))
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('dharamshala.checkinFailed'))
    }
  }

  async function checkout(id: string) {
    if (!(await confirm({ title: t('dharamshala.confirmCheckoutTitle'), message: t('dharamshala.confirmCheckoutMessage'), confirmLabel: t('dharamshala.checkOutButton') }))) return
    try {
      await api.patch(`/room-bookings/${id}/checkout`, {})
      toast.success(t('dharamshala.checkoutSuccess'))
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('dharamshala.checkoutFailed'))
    }
  }

  async function confirmCancel() {
    if (!cancelModal) return
    setCancelling(true)
    try {
      await api.patch(`/room-bookings/${cancelModal.id}/cancel`, { reason: cancelReason || undefined })
      setCancelModal(null)
      setCancelReason('')
      toast.success(t('dharamshala.cancelSuccess'))
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('dharamshala.cancelFailed'))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('dharamshala.roomsTitle')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('dharamshala.roomsTitle')}</h1>
        <button onClick={() => navigate('/rooms/checkin')} className="btn-primary btn-sm">
          <Plus size={14} /> {t('dharamshala.newBooking')}
        </button>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="rooms" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="rooms-list"
        columns={columns}
        rows={bookings}
        rowKey={b => b.id}
        loading={loading}
        graphData={trendByDay(bookings, 'check_in_date', 'advance_paise')}
        searchValue={search}
        onSearchChange={resetPageAnd(setSearch)}
        searchPlaceholder={t('dharamshala.searchPlaceholder')}
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
        emptyMessage={t('dharamshala.noBookingsFound')}
        emptyAction={{ label: t('dharamshala.newBooking'), onClick: () => navigate('/rooms/checkin') }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />

      {/* Cancel confirmation modal */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('dharamshala.cancelBookingTitle')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('dharamshala.cancelBookingWarning', { name: cancelModal.guestName })}
            </p>
            <div className="mb-4">
              <label className="form-label">{t('dharamshala.reasonOptional')}</label>
              <input className="form-input" value={cancelReason}
                onChange={e => setCancelReason(e.target.value)} placeholder={t('dharamshala.reasonPlaceholder')} />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setCancelModal(null); setCancelReason('') }} className="btn-secondary">{t('dharamshala.keepBooking')}</button>
              <button onClick={confirmCancel} disabled={cancelling} className="btn-danger">
                {cancelling ? t('dharamshala.cancelling') : t('dharamshala.cancelBookingTitle')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
