import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText, IndianRupee, Plus, Receipt, Trash2, X } from 'lucide-react'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { printDonationReceipt } from '../../../lib/printReceipt'
import { printBillDoc } from '../../../lib/printBill'
import { useProfileStore } from '../../../store/profileStore'
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
import {
  PaymentSplitInput, emptyPaymentRow, toPayload, sumPaise, type PaymentRow,
} from '../../../components/PaymentSplitInput'

const PAGE_SIZE = 20
const STATUSES = ['confirmed', 'checked_in', 'checked_out', 'cancelled'] as const

/** One label/amount line in the bill breakdown. */
function Row({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600">{label}</span>
      <span>₹{fmtPaise(value ?? 0)}</span>
    </div>
  )
}

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

  const [checkoutModal, setCheckoutModal] = useState<{ booking: RoomBooking; duePaise: number } | null>(null)
  const [checkoutRows, setCheckoutRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [checkingOut, setCheckingOut] = useState(false)
  const [billModal, setBillModal] = useState<Record<string, any> | null>(null)
  const [collectModal, setCollectModal] = useState<{ booking: RoomBooking; bill: Record<string, any> } | null>(null)
  const [collectRows, setCollectRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [collecting, setCollecting] = useState(false)
  const { profile } = useProfileStore()
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
      // Everything actually collected (advance + every tender at checkout),
      // summed from the payments ledger — not the stale advance_paise column.
      key: 'paid', label: t('dharamshala.paid'), align: 'right',
      render: b => <>₹{fmtPaise(b.paid_paise ?? b.advance_paise)}</>,
    },
    {
      key: 'balance', label: t('dharamshala.balance'), align: 'right',
      render: b => {
        const due = b.due_paise ?? b.balance_paise
        // A guest who leaves early is billed for fewer nights, so what they
        // already paid can EXCEED the final total. Show that as a refund due
        // rather than a silent 0 — the counter has to hand money back.
        const over = (b.paid_paise ?? 0) - (b.total_paise ?? 0)
        if (due <= 0 && over > 0) {
          return (
            <span className="text-brand-blue font-semibold" title={t('dharamshala.refundDueHint')}>
              −₹{fmtPaise(over)}
            </span>
          )
        }
        return (
          <span className={due > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
            ₹{fmtPaise(due)}
          </span>
        )
      },
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
            <button onClick={() => openCheckout(b)} className="btn-secondary btn-sm">{t('dharamshala.checkOutAction')}</button>
          )}
          {/* A checked-out row used to render an EMPTY actions cell — the bill
              it just generated was unreachable. The bill is the whole point of
              checking out, so it is always available afterwards. */}
          {b.status === 'checked_out' && (
            <button
              onClick={() => viewBill(b.id)}
              className="p-1 text-slate-400 hover:text-navy-700 rounded"
              title={t('dharamshala.viewBill')} aria-label={t('dharamshala.viewBill')}
            >
              <FileText size={14} />
            </button>
          )}
          {/* A guest can leave owing money — checkout does not require the bill
              to be settled. Without this the balance was simply stranded: the
              row showed ₹1,300 due and offered no way to take it. Available on
              any live booking with a balance, checked out or not. */}
          {b.status !== 'cancelled' && (b.due_paise ?? b.balance_paise ?? 0) > 0 && (
            <button
              onClick={() => openCollect(b)}
              className="p-1 text-slate-400 hover:text-brand-green rounded"
              title={t('dharamshala.collectPayment')} aria-label={t('dharamshala.collectPayment')}
            >
              <IndianRupee size={14} />
            </button>
          )}
          {/* The guest-facing document, as opposed to the bill above: it carries
              the gapless ROOM/FY number and the GST split, and renders through
              the same client-side templates every other receipt uses. */}
          {b.status === 'checked_out' && b.invoice_no && (
            <button
              onClick={() => printDonationReceipt(b.id, '/room-bookings').catch(() => {})}
              className="p-1 text-slate-400 hover:text-navy-700 rounded"
              title={t('common.printReceipt', { defaultValue: 'Print receipt' })}
              aria-label={t('common.printReceipt', { defaultValue: 'Print receipt' })}
            >
              <Receipt size={14} />
            </button>
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
          {/* Delete is offered only where it can succeed: the API refuses to
              delete a booking that has an issued bill or collected money. */}
          {b.status !== 'checked_out' && !(b.paid_paise ?? 0) && (
            <button
              onClick={() => removeBooking(b)}
              className="p-1 text-slate-400 hover:text-brand-red rounded"
              title={t('common.delete')} aria-label={t('common.delete')}
            >
              <Trash2 size={14} />
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

  /**
   * Opens the settlement dialog. Checkout used to POST an empty body, so no
   * money was ever recorded and the bill showed 0 taken — the cashier now
   * enters the tender(s) here before the bill is issued.
   */
  function openCheckout(b: RoomBooking) {
    const due = Math.max(0, (b.total_paise ?? 0) - (b.paid_paise ?? 0))
    setCheckoutModal({ booking: b, duePaise: due })
    setCheckoutRows([{ ...emptyPaymentRow(), amount: due ? String(due / 100) : '' }])
  }

  async function confirmCheckout() {
    if (!checkoutModal) return
    setCheckingOut(true)
    try {
      const { data } = await api.patch(`/room-bookings/${checkoutModal.booking.id}/checkout`, {
        payments: toPayload(checkoutRows),
      })
      const res = data?.data ?? data
      setCheckoutModal(null)
      toast.success(
        res?.invoice_no
          ? `${t('dharamshala.checkoutSuccess')} — ${res.invoice_no}`
          : t('dharamshala.checkoutSuccess'),
      )
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('dharamshala.checkoutFailed'))
    } finally {
      setCheckingOut(false)
    }
  }

  /** Take the outstanding balance on a booking, including after checkout. */
  async function openCollect(b: RoomBooking) {
    try {
      const { data } = await api.get(`/room-bookings/${b.id}/bill`)
      setCollectModal({ booking: b, bill: data?.data ?? data })
      setCollectRows([emptyPaymentRow()])
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('dharamshala.billLoadFailed'))
    }
  }

  async function submitCollect() {
    if (!collectModal) return
    const entered = sumPaise(collectRows)
    const due = Number(collectModal.bill.due_paise ?? 0)
    if (entered <= 0) { toast.error(t('dharamshala.enterAmount')); return }
    if (entered > due) { toast.error(t('dharamshala.overpayment')); return }
    setCollecting(true)
    try {
      await api.post(`/room-bookings/${collectModal.booking.id}/payments`, { payments: toPayload(collectRows) })
      toast.success(t('dharamshala.paymentRecorded'))
      setCollectModal(null)
      setCollectRows([emptyPaymentRow()])
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('dharamshala.paymentFailed'))
    } finally {
      setCollecting(false)
    }
  }

  async function viewBill(id: string) {
    try {
      const { data } = await api.get(`/room-bookings/${id}/bill`)
      setBillModal(data?.data ?? data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || 'Could not load the bill')
    }
  }

  /** Print the bill as its own document (see lib/printBill.ts for why). */
  function printBill(bill: Record<string, any>) {
    const rs = (p: unknown) => `₹${fmtPaise(Number(p ?? 0))}`
    const due = Number(bill.due_paise ?? 0)
    printBillDoc({
      templeName: profile?.name || 'Temple',
      templeAddress: [profile?.address, profile?.city, profile?.state].filter(Boolean).join(', '),
      title: t('dharamshala.billTitle'),
      invoiceNo: bill.invoice_no,
      meta: [
        { label: t('dharamshala.guest'), value: String(bill.guest_name ?? '') },
        { label: t('dharamshala.room'), value: String(bill.room_number ?? '') },
      ],
      charges: [
        { label: t('dharamshala.subtotal'), value: rs(bill.subtotal_paise) },
        { label: 'CGST', value: rs(bill.cgst_paise) },
        { label: 'SGST', value: rs(bill.sgst_paise) },
        { label: t('dharamshala.total'), value: rs(bill.total_paise), bold: true },
      ],
      paymentsLabel: t('dharamshala.paymentsReceived'),
      payments: ((bill.payments ?? []) as Record<string, any>[]).map(p => ({
        label: `${p.payment_mode}${p.reference_no ? ` · ${p.reference_no}` : ''} (${String(p.paid_on).slice(0, 10)})`,
        value: rs(p.amount_paise),
      })),
      noPaymentsLabel: t('dharamshala.noPaymentsRecorded'),
      balanceLabel: t('dharamshala.balance'),
      balanceValue: rs(due),
      balanceOutstanding: due > 0,
    })
  }

  async function removeBooking(b: RoomBooking) {
    if (!(await confirm({
      title: t('dharamshala.deleteBookingTitle'),
      message: t('dharamshala.deleteBookingMessage', { guest: b.guest_name }),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return
    try {
      await api.delete(`/room-bookings/${b.id}`)
      toast.success(t('dharamshala.deleteSuccess'))
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('dharamshala.deleteFailed'))
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

      {/* Checkout settlement — collect the tender(s), then issue the bill. */}
      {checkoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('dharamshala.checkoutTitle')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {checkoutModal.booking.guest_name} · {t('dharamshala.room')} {checkoutModal.booking.room_number}
            </p>

            <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-slate-500 text-xs">{t('dharamshala.total')}</p>
                <p className="font-semibold">₹{fmtPaise(checkoutModal.booking.total_paise ?? 0)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-slate-500 text-xs">{t('dharamshala.alreadyPaid')}</p>
                <p className="font-semibold">₹{fmtPaise(checkoutModal.booking.paid_paise ?? checkoutModal.booking.advance_paise ?? 0)}</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-amber-700 text-xs">{t('dharamshala.dueNow')}</p>
                <p className="font-semibold text-amber-800">₹{fmtPaise(checkoutModal.duePaise)}</p>
              </div>
            </div>

            <label className="form-label">{t('dharamshala.collectPayment')}</label>
            <PaymentSplitInput
              rows={checkoutRows}
              onChange={setCheckoutRows}
              totalPaise={checkoutModal.duePaise}
              disabled={checkingOut}
            />
            <p className="text-xs text-slate-400 mt-2">{t('dharamshala.partialPaymentHint')}</p>

            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => setCheckoutModal(null)} className="btn-secondary" disabled={checkingOut}>
                {t('common.cancel')}
              </button>
              <button onClick={confirmCheckout} disabled={checkingOut} className="btn-primary">
                {checkingOut
                  ? t('common.saving')
                  : sumPaise(checkoutRows) === 0
                    ? t('dharamshala.checkoutWithoutPayment')
                    : t('dharamshala.checkOutButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collect an outstanding balance, including on a checked-out stay. */}
      {collectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-navy-900">{t('dharamshala.collectPayment')}</h3>
                <p className="text-sm text-slate-500">
                  {collectModal.booking.guest_name} · {t('dharamshala.room')} {collectModal.booking.room_number}
                </p>
              </div>
              <button onClick={() => setCollectModal(null)} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1 text-sm border-y border-slate-100 py-3 mb-4">
              <Row label={t('dharamshala.total')} value={collectModal.bill.total_paise} />
              <Row label={t('dharamshala.paymentsReceived')} value={collectModal.bill.paid_paise} />
              <div className="flex justify-between font-semibold">
                <span>{t('dharamshala.balance')}</span>
                <span className="text-red-600">₹{fmtPaise(collectModal.bill.due_paise ?? 0)}</span>
              </div>
            </div>

            <PaymentSplitInput
              rows={collectRows}
              onChange={setCollectRows}
              totalPaise={Number(collectModal.bill.total_paise ?? 0)}
              paidPaise={Number(collectModal.bill.paid_paise ?? 0)}
              disabled={collecting}
            />

            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => setCollectModal(null)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
              <button onClick={submitCollect} disabled={collecting} className="btn-primary btn-sm">
                {collecting ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill — the invoice plus every tender recorded against it. */}
      {billModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-navy-900">{billModal.invoice_no || t('dharamshala.viewBill')}</h3>
                <p className="text-sm text-slate-500">
                  {billModal.guest_name} · {t('dharamshala.room')} {billModal.room_number}
                </p>
              </div>
              <button onClick={() => setBillModal(null)} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1 text-sm border-t border-slate-100 pt-3">
              <Row label={t('dharamshala.subtotal')} value={billModal.subtotal_paise} />
              <Row label="CGST" value={billModal.cgst_paise} />
              <Row label="SGST" value={billModal.sgst_paise} />
              <div className="flex justify-between font-semibold border-t border-slate-100 pt-1 mt-1">
                <span>{t('dharamshala.total')}</span>
                <span>₹{fmtPaise(billModal.total_paise ?? 0)}</span>
              </div>
            </div>

            {(billModal.in_clearing_paise ?? 0) > 0 && (
              /* A cheque is a promise until it clears, so "paid" and "realised"
                 are not the same number. Showing only the total made a bill
                 settled by an uncleared cheque look fully collected. */
              <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">{t('dharamshala.realised', { defaultValue: 'Realised' })}</span>
                  <span>₹{fmtPaise(billModal.realized_paise ?? 0)}</span>
                </div>
                <div className="flex justify-between text-amber-700">
                  <span>{t('dharamshala.inClearing', { defaultValue: 'Cheque in clearing' })}</span>
                  <span>₹{fmtPaise(billModal.in_clearing_paise ?? 0)}</span>
                </div>
              </div>
            )}

            <p className="form-label mt-4">{t('dharamshala.paymentsReceived')}</p>
            {billModal.payments?.length ? (
              <div className="space-y-1 text-sm">
                {billModal.payments.map((p: any) => (
                  <div key={p.id} className="flex justify-between">
                    <span className="text-slate-600">
                      {p.payment_mode}
                      {p.reference_no ? ` · ${p.reference_no}` : ''}
                      <span className="text-slate-400 text-xs ml-1">{String(p.paid_on).slice(0, 10)}</span>
                    </span>
                    <span>₹{fmtPaise(p.amount_paise)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">{t('dharamshala.noPaymentsRecorded')}</p>
            )}

            <div className="flex justify-between font-semibold border-t border-slate-100 pt-2 mt-2 text-sm">
              <span>{t('dharamshala.balance')}</span>
              <span className={(billModal.due_paise ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}>
                ₹{fmtPaise(billModal.due_paise ?? 0)}
              </span>
            </div>

            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => printBill(billModal)} className="btn-secondary">{t('common.print')}</button>
              <button onClick={() => setBillModal(null)} className="btn-primary">{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}

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
