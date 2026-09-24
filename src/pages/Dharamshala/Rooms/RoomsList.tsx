import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock, Contact as IdCard, FileText, IndianRupee, Pencil, Plus, Receipt, Trash2, Undo2, X, ShieldCheck, PackagePlus, Files } from 'lucide-react'
import { printCurrentView } from '../../../lib/downloadReport'
import { api, apiErrorMessage, fmtPaise, parsePaise, todayIst } from '../../../lib/api'
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
import { useReceiptLabels } from '../../../lib/useReceiptLabels'
import type { RoomBooking } from '../../../types'
import { useCanDeleteEntries, useDeleteEntry } from '../../../components/deleteEntry'
import {
  PaymentSplitInput, emptyPaymentRow, toPayload, sumPaise, type PaymentRow,
} from '../../../components/PaymentSplitInput'
import { enteredByColumn, enteredByText, useEnteredByOptions } from '../../../lib/enteredBy'
import { EditBookingModal, IdDocumentsModal } from './GuestIdDocuments'
import { CheckinModal, CheckoutModal, ExtrasModal } from './StayDialogs'

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

/**
 * One stay time, as EXPECTED and as it HAPPENED.
 *
 * The actual line only appears when the two disagree. A stay that went to plan
 * is the common case, and a second identical line under every row in the table
 * is noise that trains people to stop reading it.
 *
 * The expected value falls back to the booked DATE when no instant was stored:
 * `planned_check_in_at` arrived with tenant migration 043, and rows written
 * before it have only the date. Showing the date is right there - it is what the
 * trust agreed - and showing nothing would read as missing data.
 */
function StayTime({ planned, date, actual }: {
  planned?: string | null
  date?: string | null
  actual?: string | null
}) {
  const fmtDay = (v: string) => new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  const fmtWhen = (v: string) =>
    new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })

  const expected = planned ? fmtWhen(planned) : date ? fmtDay(date) : null
  const happened = actual ? fmtWhen(actual) : null
  // Compared by the minute, not by string: an instant and a bare date never
  // render alike, so a string comparison would call every planned stay changed.
  const differs = !!(actual && planned
    && Math.abs(Date.parse(actual) - Date.parse(planned)) > 60_000)
  const onlyActual = !!happened && !planned

  return (
    <div className="text-xs leading-tight">
      <span className={happened && (differs || onlyActual) ? 'text-slate-400' : ''}>{expected ?? '\u2014'}</span>
      {happened && (differs || onlyActual) && (
        <span className="block font-medium text-navy-800">{happened}</span>
      )}
    </div>
  )
}

/**
 * What the trust is holding that is no longer its money.
 *
 * Mirrors `refundBooking` in the API: everything collected, less anything
 * already refunded, less what the stay is still entitled to keep. A cancelled
 * booking keeps nothing, because cancelling zeroes the bill; a checked-out one
 * keeps its total, so only an overpayment is refundable.
 *
 * Computed here as well as there so the button can appear without a round trip -
 * the API is the one that decides, and refuses anything this gets wrong.
 */
function refundable(b: RoomBooking): number {
  const collected = b.paid_paise ?? 0
  const refunded = b.refunded_paise ?? 0
  const keep = b.status === 'cancelled' ? 0 : (b.total_paise ?? 0)
  return Math.max(0, collected - refunded - keep)
}

export function RoomsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canDelete = useCanDeleteEntries()
  const deleteEntry = useDeleteEntry()
  const toast = useToast()
  /** The TRUST's printed words, for the bill. Not `t()` - see the hook. */
  const L = useReceiptLabels()

  const [bookings, setBookings] = useState<RoomBooking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('rooms'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const [billModal, setBillModal] = useState<Record<string, any> | null>(null)
  const [collectModal, setCollectModal] = useState<{ booking: RoomBooking; bill: Record<string, any> } | null>(null)
  // Settling a deposit is its own action, not part of checkout: a guest can
  // leave before the room has been inspected, and the deposit is returned
  // afterwards. Held = taken - refunded - forfeited.
  const [depositModal, setDepositModal] = useState<RoomBooking | null>(null)
  /** The stay-times dialog, and the four instants it is editing. */
  const [timesModal, setTimesModal] = useState<RoomBooking | null>(null)
  const [timesForm, setTimesForm] = useState({
    planned_check_in_at: '', planned_check_out_at: '', checked_in_at: '', checked_out_at: '',
  })
  const [timesBusy, setTimesBusy] = useState(false)
  const [timesError, setTimesError] = useState('')
  /** The refund dialog. */
  const [refundModal, setRefundModal] = useState<RoomBooking | null>(null)
  const [refundAmt, setRefundAmt] = useState('')
  const [refundMode, setRefundMode] = useState('cash')
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundError, setRefundError] = useState('')
  const [forfeitAmt, setForfeitAmt] = useState('')
  const [settling, setSettling] = useState(false)
  const [settleError, setSettleError] = useState('')
  const [collectRows, setCollectRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [collecting, setCollecting] = useState(false)
  const { profile } = useProfileStore()
  const [cancelModal, setCancelModal] = useState<{ id: string; guestName: string } | null>(null)
  // Identity documents (any role that can see the booking adds; the temple
  // admin alone views and removes) and the admin's edit (tenant migration 055).
  const [idDocsFor, setIdDocsFor] = useState<RoomBooking | null>(null)
  const [editFor, setEditFor] = useState<RoomBooking | null>(null)
  // The desk dialogs (tenant migration 057): check-in with edits and extras,
  // extras during the stay, checkout with a live bill and the refund.
  const [checkinFor, setCheckinFor] = useState<RoomBooking | null>(null)
  const [extrasFor, setExtrasFor] = useState<RoomBooking | null>(null)
  const [checkoutFor, setCheckoutFor] = useState<RoomBooking | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)


  // Occupancy + money held, per plan §15 (Rooms: occupancy %, advances held, due-out today).
  const todayIso = todayIst()
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

  const enteredByOptions = useEnteredByOptions()
  const columns: ColumnDef<RoomBooking>[] = useMemo(() => [
    {
      key: 'guest', label: t('dharamshala.guest'),
      render: b => (
        <div>
          <p className="font-medium">{b.guest_name}</p>
          <p className="text-xs text-slate-400">{b.guest_mobile}</p>
          {/* "Book it now, we'll bring the ID": the booking stands, and the
              register keeps saying the ID is still owed until it arrives. */}
          {b.has_id_document === false && b.status !== 'cancelled' && (
            <button
              onClick={() => setIdDocsFor(b)}
              className="badge-yellow mt-1 cursor-pointer hover:opacity-80"
              title={t('guestId.pendingHint')}
            >
              {t('guestId.pending')}
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'room', label: t('dharamshala.room'),
      render: b => <span className="text-slate-600">{b.room_number || b.room_id}</span>,
    },
    {
      // EXPECTED on top, ACTUAL underneath when they differ.
      //
      // This column used to print `check_in_date` under the bare heading
      // "CHECK-IN", so a clerk looking at a guest standing in front of them saw
      // tomorrow's date and no way to tell an expectation from a fact. The
      // instants have existed since tenant migration 043 and no screen showed
      // either of them.
      //
      // Only shown when they DISAGREE. A stay that went to plan is the common
      // case and a second identical line under every row is noise.
      key: 'check_in', label: t('dharamshala.checkInExpected'),
      render: b => <StayTime planned={b.planned_check_in_at} date={b.check_in_date} actual={b.checked_in_at} />,
    },
    {
      key: 'check_out', label: t('dharamshala.checkOutExpected'),
      render: b => <StayTime planned={b.planned_check_out_at} date={b.check_out_date} actual={b.checked_out_at} />,
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
        // A cancelled booking is not a debt. It used to show whatever bill it
        // had when it was cancelled - reported as "why it is showing balance
        // pening now if it is cancelled" - because cancelling only set the
        // status. The API now zeroes the bill (tenant migration 047 backfills
        // the rows that were cancelled before it did), and what the trust is
        // HOLDING shows as a refund due instead, which is the actionable half.
        if (b.status === 'cancelled') {
          const held = b.paid_paise ?? 0
          return held > 0
            ? (
              <span className="text-brand-blue font-semibold" title={t('dharamshala.refundDueHint')}>
                &minus;₹{fmtPaise(held)}
              </span>
            )
            : <span className="text-slate-400">&mdash;</span>
        }
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
    enteredByColumn<RoomBooking>(t, enteredByOptions),
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
            <button onClick={() => setCheckinFor(b)} className="btn-success btn-sm">{t('dharamshala.checkInAction')}</button>
          )}
          {b.status === 'checked_in' && (
            <button onClick={() => setCheckoutFor(b)} className="btn-secondary btn-sm">{t('dharamshala.checkOutAction')}</button>
          )}
          {/* An extra bed, a meal, laundry - on the bill while the stay is open. */}
          {(b.status === 'confirmed' || b.status === 'booked' || b.status === 'checked_in') && (
            <button
              onClick={() => setExtrasFor(b)}
              className="p-1 text-slate-400 hover:text-navy-700 rounded"
              title={t('roomCharges.title')} aria-label={t('roomCharges.title')}
            >
              <PackagePlus size={14} />
            </button>
          )}
          {/* Several rooms booked together print on one combined bill. */}
          {b.group_id && b.status !== 'cancelled' && (
            <button
              onClick={() => printDonationReceipt(b.id, '/room-bookings', 'group-receipt').catch(() => toast.error(t('dharamshala.printFailed')))}
              className="p-1 text-slate-400 hover:text-navy-700 rounded"
              title={t('dharamshala.printGroupBill')} aria-label={t('dharamshala.printGroupBill')}
            >
              <Files size={14} />
            </button>
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
          {/* Correcting the times. A clerk who writes up an arrival an hour late,
              or types the wrong day, had no way back - and on a checked-out stay
              this re-bills, which is how an extension gets charged after the
              fact. */}
          {b.status !== 'cancelled' && (
            <button
              onClick={() => openTimes(b)}
              className="p-1 text-slate-400 hover:text-navy-700 rounded"
              title={t('dharamshala.editTimes')} aria-label={t('dharamshala.editTimes')}
            >
              <Clock size={14} />
            </button>
          )}
          {/* Giving money back. A cancelled booking that took an advance left the
              trust holding money with nothing to do about it: "what if the
              booking of room is cancel how to refund". Also covers a guest
              overcharged at checkout, which is the same transaction. */}
          {refundable(b) > 0 && (
            <button
              onClick={() => openRefund(b)}
              className="p-1 text-slate-400 hover:text-brand-blue rounded"
              title={t('dharamshala.refund')} aria-label={t('dharamshala.refund')}
            >
              <Undo2 size={14} />
            </button>
          )}
          {/* A guest can leave owing money — checkout does not require the bill
              to be settled. Without this the balance was simply stranded: the
              row showed ₹1,300 due and offered no way to take it. Available on
              any live booking with a balance, checked out or not. */}
          {b.status !== 'cancelled' && depositHeld(b) > 0 && (
            <button
              onClick={() => { setDepositModal(b); setForfeitAmt(''); setSettleError('') }}
              className="p-1 text-slate-400 hover:text-amber-600 rounded"
              title={t('dharamshala.settleDeposit')} aria-label={t('dharamshala.settleDeposit')}
            >
              <ShieldCheck size={14} />
            </button>
          )}
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
          {b.status !== 'cancelled' && (
            <button
              onClick={() => setIdDocsFor(b)}
              className="p-1 text-slate-400 hover:text-navy-700 rounded"
              title={t('guestId.title')} aria-label={t('guestId.title')}
            >
              <IdCard size={14} />
            </button>
          )}
          {/* temple_admin only: the safe edits (guest, persons, notes; room,
              dates and rate until checkout). */}
          {canDelete && b.status !== 'cancelled' && (
            <button
              onClick={() => setEditFor(b)}
              className="p-1 text-slate-400 hover:text-navy-700 rounded"
              title={t('editBooking.title')} aria-label={t('editBooking.title')}
            >
              <Pencil size={14} />
            </button>
          )}
          {/* temple_admin only — the shared entry delete voids whatever was
              collected, frees the room, and is restorable from the Recycle Bin. */}
          {canDelete && (
            <button
              onClick={() => removeBooking(b)}
              className="p-1 text-slate-400 hover:text-brand-red rounded"
              title={t('entries.delete')} aria-label={t('entries.delete')}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, enteredByOptions, canDelete])

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
          { header: t('enteredBy.column'), width: 18 },
        ],
        rows: rows.map(b => [
          b.guest_name ?? '', b.guest_mobile ?? '', b.room_number || b.room_id,
          new Date(b.check_in_date).toLocaleDateString('en-IN'),
          new Date(b.check_out_date).toLocaleDateString('en-IN'),
          b.persons_count, b.advance_paise, b.balance_paise,
          statusLabel[b.status] ?? b.status, enteredByText(b, t),
        ]),
        totals: [
          t('kit.total'), '', '', '', '', '',
          rows.reduce((s, b) => s + b.advance_paise, 0),
          rows.reduce((s, b) => s + b.balance_paise, 0),
          '', '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  /** Take the outstanding balance on a booking, including after checkout. */
  /** What is still held against a booking, in paise. */
  function depositHeld(b: RoomBooking): number {
    const anyB = b as unknown as Record<string, unknown>
    return Number(anyB.deposit_paise ?? 0)
      - Number(anyB.deposit_refunded_paise ?? 0)
      - Number(anyB.deposit_forfeited_paise ?? 0)
  }

  async function settleDeposit() {
    if (!depositModal) return
    const held = depositHeld(depositModal)
    const forfeit = forfeitAmt ? parsePaise(forfeitAmt) : 0
    if (forfeit > held) {
      setSettleError(t('dharamshala.forfeitTooLarge', { held: fmtPaise(held) }))
      return
    }
    setSettling(true)
    setSettleError('')
    try {
      // refund_paise is omitted on purpose: the server returns everything not
      // forfeited, so the two can never disagree about what is left.
      await api.post(`/room-bookings/${depositModal.id}/deposit/settle`, { forfeit_paise: forfeit })
      toast.success(t('dharamshala.depositSettled'))
      setDepositModal(null)
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setSettleError(err.response?.data?.error?.message || t('dharamshala.depositSettleFailed'))
    } finally {
      setSettling(false)
    }
  }

  /**
   * Open the stay-times dialog.
   *
   * `datetime-local` wants a local-time string with no zone, and the stored
   * values are instants. Converted here rather than in the input: doing it the
   * other way round (feeding an ISO string straight to the input) silently
   * blanks the field, because the element rejects anything with a zone on it.
   */
  function openTimes(b: RoomBooking) {
    const forInput = (v?: string | null) => {
      if (!v) return ''
      const d = new Date(v)
      if (Number.isNaN(d.getTime())) return ''
      // Shifted into the browser's own offset so the box shows the wall clock
      // the clerk is looking at, then shifted back on save.
      return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    }
    setTimesModal(b)
    setTimesError('')
    setTimesForm({
      planned_check_in_at: forInput(b.planned_check_in_at),
      planned_check_out_at: forInput(b.planned_check_out_at),
      checked_in_at: forInput(b.checked_in_at),
      checked_out_at: forInput(b.checked_out_at),
    })
  }

  async function saveTimes() {
    if (!timesModal) return
    setTimesBusy(true)
    setTimesError('')
    try {
      // Only what CHANGED is sent. The endpoint treats an absent key as "leave
      // it alone" and an explicit null as "clear it", so sending the whole form
      // every time would rewrite instants nobody touched.
      const forInput = (v?: string | null) => {
        if (!v) return ''
        const d = new Date(v)
        return Number.isNaN(d.getTime())
          ? ''
          : new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
      }
      const body: Record<string, string | null> = {}
      for (const k of ['planned_check_in_at', 'planned_check_out_at', 'checked_in_at', 'checked_out_at'] as const) {
        const now = timesForm[k]
        const was = forInput(timesModal[k])
        if (now === was) continue
        body[k] = now ? new Date(now).toISOString() : null
      }
      if (!Object.keys(body).length) { setTimesModal(null); return }
      const { data } = await api.patch(`/room-bookings/${timesModal.id}/times`, body)
      const res = data?.data ?? data
      if (res?.rebilled) {
        toast.success(t('dharamshala.timesRebilled', {
          nights: res.nights, amount: `₹${fmtPaise(res.total_paise)}`,
        }))
      } else {
        toast.success(t('dharamshala.timesSaved'))
      }
      setTimesModal(null)
      await load()
    } catch (e) {
      setTimesError(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setTimesBusy(false)
    }
  }

  function openRefund(b: RoomBooking) {
    setRefundModal(b)
    setRefundError('')
    setRefundMode('cash')
    // Prefilled with everything refundable, which is what a cancellation
    // normally gives back. A cashier keeping part of it types a smaller number.
    setRefundAmt((refundable(b) / 100).toFixed(2))
  }

  async function submitRefund() {
    if (!refundModal) return
    setRefundBusy(true)
    setRefundError('')
    try {
      await api.post(`/room-bookings/${refundModal.id}/refund`, {
        amount_paise: parsePaise(refundAmt),
        payment_mode: refundMode,
      })
      toast.success(t('dharamshala.refunded', { amount: `₹${refundAmt}` }))
      setRefundModal(null)
      await load()
    } catch (e) {
      setRefundError(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setRefundBusy(false)
    }
  }

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
      // `L`, not `t()`. This document is handed to the GUEST, so it reads the
      // trust's printed vocabulary in the trust's receipt language - the same
      // table the seventeen receipt designs read. It used to use the operator's
      // UI i18n, so a trust that renamed a word saw it on the receipt and not on
      // the bill, and a Marathi-speaking volunteer handed guests a Marathi bill
      // at a trust that issues English receipts. See lib/useReceiptLabels.ts.
      title: L.roomBill,
      invoiceNo: bill.invoice_no,
      meta: [
        { label: L.guest, value: String(bill.guest_name ?? '') },
        { label: L.room, value: String(bill.room_number ?? '') },
      ],
      charges: [
        { label: L.subtotal, value: rs(bill.subtotal_paise) },
        // CGST and SGST stay Latin in every language, like IFSC and PAN: they
        // are what a CA looks for on the page and what the GST portal prints.
        { label: 'CGST', value: rs(bill.cgst_paise) },
        { label: 'SGST', value: rs(bill.sgst_paise) },
        { label: L.total, value: rs(bill.total_paise), bold: true },
      ],
      paymentsLabel: L.paymentsReceived,
      payments: ((bill.payments ?? []) as Record<string, any>[]).map(p => ({
        label: `${p.payment_mode}${p.reference_no ? ` · ${p.reference_no}` : ''} (${String(p.paid_on).slice(0, 10)})`,
        value: rs(p.amount_paise),
      })),
      noPaymentsLabel: L.noPaymentsRecorded,
      balanceLabel: L.balanceDue,
      balanceValue: rs(due),
      balanceOutstanding: due > 0,
    })
  }

  async function removeBooking(b: RoomBooking) {
    const deleted = await deleteEntry({
      kind: 'room_booking', id: b.id, title: b.guest_name,
      detail: b.room_number ? t('recycleBin.room', { room: b.room_number }) : null,
      reference: b.invoice_no ?? null, amountPaise: b.total_paise || b.advance_paise || null, date: b.check_in_date,
    })
    if (deleted) load()
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
        emptyMessage={t('dharamshala.noBookingsFound')}
        emptyAction={{ label: t('dharamshala.newBooking'), onClick: () => navigate('/rooms/checkin') }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />

      {/* Checkout settlement — collect the tender(s), then issue the bill. */}

      {/* Collect an outstanding balance, including on a checked-out stay. */}
      {/* ── Correcting the stay times ──────────────────────────────────────
          Four instants, two of them expectations and two of them facts, and
          until now nothing could edit any of them. On a checked-out stay this
          RE-BILLS, which is how an extension gets charged after the guest has
          already gone - so the dialog says so before the save rather than
          surprising a cashier with a new total. */}
      {idDocsFor && (
        <IdDocumentsModal booking={idDocsFor} onClose={() => setIdDocsFor(null)} onChanged={() => void load()} />
      )}
      {checkinFor && (
        <CheckinModal booking={checkinFor} onClose={() => setCheckinFor(null)}
          onDone={() => { setCheckinFor(null); load() }} />
      )}
      {extrasFor && (
        <ExtrasModal booking={extrasFor} onClose={() => { setExtrasFor(null); load() }} onDone={load} />
      )}
      {checkoutFor && (
        <CheckoutModal booking={checkoutFor} onClose={() => setCheckoutFor(null)}
          onDone={res => {
            const b = checkoutFor
            setCheckoutFor(null)
            toast.success(
              [
                res?.invoice_no ? `${t('dharamshala.checkoutSuccess')} — ${res.invoice_no}` : t('dharamshala.checkoutSuccess'),
                res?.refunded_paise ? t('dharamshala.refundedAtCheckout', { amount: fmtPaise(res.refunded_paise) }) : '',
              ].filter(Boolean).join(' · '),
            )
            load()
            // The proper bill, straight away - a stay ends with the guest
            // holding it.
            if (b) printDonationReceipt(b.id, '/room-bookings', b.group_id ? 'group-receipt' : 'receipt').catch(() => {})
          }} />
      )}
      {editFor && (
        <EditBookingModal booking={editFor} onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); void load() }} />
      )}

      {timesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-navy-900">{t('dharamshala.editTimes')}</h3>
                <p className="text-sm text-slate-500">
                  {timesModal.guest_name} \u00b7 {t('dharamshala.room')} {timesModal.room_number}
                </p>
              </div>
              <button onClick={() => setTimesModal(null)} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="form-label" htmlFor="pci">{t('dharamshala.plannedCheckIn')}</label>
                <input
                  id="pci" type="datetime-local" className="form-input"
                  value={timesForm.planned_check_in_at}
                  onChange={e => setTimesForm(f => ({ ...f, planned_check_in_at: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="pco">{t('dharamshala.plannedCheckOut')}</label>
                <input
                  id="pco" type="datetime-local" className="form-input"
                  value={timesForm.planned_check_out_at}
                  onChange={e => setTimesForm(f => ({ ...f, planned_check_out_at: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="aci">{t('dharamshala.actualCheckIn')}</label>
                <input
                  id="aci" type="datetime-local" className="form-input"
                  value={timesForm.checked_in_at}
                  onChange={e => setTimesForm(f => ({ ...f, checked_in_at: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="aco">{t('dharamshala.actualCheckOut')}</label>
                <input
                  id="aco" type="datetime-local" className="form-input"
                  value={timesForm.checked_out_at}
                  onChange={e => setTimesForm(f => ({ ...f, checked_out_at: e.target.value }))}
                  disabled={timesModal.status !== 'checked_out'}
                />
                {timesModal.status !== 'checked_out' && (
                  <p className="form-hint">{t('dharamshala.actualCheckOutLater')}</p>
                )}
              </div>
            </div>

            {/* The consequence, before the save. The ACTUAL dates are what the
                bill is computed from, so moving them moves the money. */}
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
              {timesModal.status === 'checked_out'
                ? t('dharamshala.timesRebillNote')
                : t('dharamshala.timesPlanNote')}
            </p>

            {timesError && <p className="mt-2 text-sm text-red-600">{timesError}</p>}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setTimesModal(null)} className="btn-secondary">{t('common.cancel')}</button>
              <button onClick={() => void saveTimes()} disabled={timesBusy} className="btn-primary">
                {timesBusy ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Giving money back ──────────────────────────────────────────────
          A cancelled booking that had taken an advance left the trust holding
          money with nothing to do about it. Recorded as a tender against an
          account, so the cash leaving the drawer is on the books. */}
      {refundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-navy-900">{t('dharamshala.refund')}</h3>
                <p className="text-sm text-slate-500">
                  {refundModal.guest_name} \u00b7 {t('dharamshala.room')} {refundModal.room_number}
                </p>
              </div>
              <button onClick={() => setRefundModal(null)} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1 text-sm border-y border-slate-100 py-3 mb-4">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('dharamshala.paid')}</span>
                <span>\u20b9{fmtPaise(refundModal.paid_paise ?? 0)}</span>
              </div>
              {(refundModal.refunded_paise ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('dharamshala.alreadyRefunded')}</span>
                  <span>\u20b9{fmtPaise(refundModal.refunded_paise ?? 0)}</span>
                </div>
              )}
              {refundModal.status !== 'cancelled' && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('dharamshala.billTotal')}</span>
                  <span>\u20b9{fmtPaise(refundModal.total_paise ?? 0)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <span>{t('dharamshala.refundable')}</span>
                <span className="text-brand-blue">\u20b9{fmtPaise(refundable(refundModal))}</span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="form-label" htmlFor="ramt">{t('dharamshala.refundAmount')}</label>
                <input
                  id="ramt" className="form-input" inputMode="decimal"
                  value={refundAmt} onChange={e => setRefundAmt(e.target.value)}
                />
                <p className="form-hint">{t('dharamshala.refundLessNote')}</p>
              </div>
              <div>
                <label className="form-label" htmlFor="rmode">{t('dharamshala.refundMode')}</label>
                <select
                  id="rmode" className="form-select" value={refundMode}
                  onChange={e => setRefundMode(e.target.value)}
                >
                  {['cash', 'upi', 'neft', 'cheque'].map(m => (
                    <option key={m} value={m}>{t(`payments.mode.${m}`, m.toUpperCase())}</option>
                  ))}
                </select>
              </div>
            </div>

            {refundError && <p className="mt-2 text-sm text-red-600">{refundError}</p>}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRefundModal(null)} className="btn-secondary">{t('common.cancel')}</button>
              <button
                onClick={() => void submitRefund()}
                disabled={refundBusy || parsePaise(refundAmt) <= 0}
                className="btn-primary"
              >{refundBusy ? t('common.saving') : t('dharamshala.refundConfirm')}</button>
            </div>
          </div>
        </div>
      )}

      {depositModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-navy-900">{t('dharamshala.settleDeposit')}</h3>
                <p className="text-sm text-slate-500">
                  {depositModal.guest_name} · {t('dharamshala.room')} {depositModal.room_number}
                </p>
              </div>
              <button onClick={() => setDepositModal(null)} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1 text-sm border-y border-slate-100 py-3 mb-4">
              <div className="flex justify-between">
                <span>{t('dharamshala.depositHeld')}</span>
                <span className="font-semibold">₹{fmtPaise(depositHeld(depositModal))}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="form-label" htmlFor="forfeit">{t('dharamshala.forfeitAmount')}</label>
              <input
                id="forfeit" className="form-input" inputMode="decimal" autoFocus
                value={forfeitAmt} onChange={e => setForfeitAmt(e.target.value)} placeholder="0"
              />
              <p className="text-xs text-slate-500 mt-1">
                {t('dharamshala.refundPreview', {
                  amount: fmtPaise(Math.max(0, depositHeld(depositModal) - (forfeitAmt ? parsePaise(forfeitAmt) : 0))),
                })}
              </p>
            </div>

            {settleError && <p className="text-sm text-red-600 mb-3">{settleError}</p>}

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDepositModal(null)}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={settleDeposit} disabled={settling}>
                {settling ? t('common.saving') : t('dharamshala.settleAndRefund')}
              </button>
            </div>
          </div>
        </div>
      )}

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
