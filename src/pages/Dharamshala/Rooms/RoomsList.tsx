import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock, Contact as IdCard, FileText, IndianRupee, Pencil, Plus, Receipt, Trash2, Undo2, X, ShieldCheck, PackagePlus, Files, PartyPopper } from 'lucide-react'
import { printCurrentView } from '../../../lib/downloadReport'
import { api, apiErrorMessage, dayOf, fmtPaise, parsePaise, todayIst } from '../../../lib/api'
import { istInputOf, istInputToDate } from '../../../lib/istClock'
import { exportXlsx } from '../../../lib/exportXlsx'
import { printDonationReceipt } from '../../../lib/printReceipt'
import { printDepositReceipt, printDepositRefundVoucher } from '../../../lib/printVoucher'
import { PaymentFields, emptyPayment, needsReference, type PaymentFieldsValue } from '../../../components/PaymentFields'
import { usePaymentModes } from '../../../lib/useDropdownOptions'
import { printBillDoc } from '../../../lib/printBill'
import { useProfileStore } from '../../../store/profileStore'
import { trendByDay } from '../../../lib/chartData'
import { makeRange, rangeCaption, type DateRange } from '../../../lib/dateRanges'
import {
  DataTable, filterStateToParams, type RowAction,
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
import { sourceColumn, sourceLabel } from '../../../lib/entrySource'
import { EditBookingModal, IdDocumentsModal } from './GuestIdDocuments'
import { CheckinModal, CheckoutModal, ExtrasModal } from './StayDialogs'
import { depositHeldOf } from './deposit'
import { GroupCheckinModal, GroupCheckoutModal } from './GroupStayDialogs'

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

/**
 * One guest's rooms booked together (tenant migration 057, `group_id`) as ONE
 * entry, the rooms under it (founder, 2026-09-24: "if one booking is there
 * from one person so the booking will be one only and all rooms will be shown
 * in one entry"). The entry sums what the rooms have in common - persons,
 * paid, balance - and each room keeps its own row, and actions, when opened.
 *
 * Grouped on the page's rows: a group is created in one request, so its rooms
 * sit together in the list.
 */
type StayRow = RoomBooking & {
  members?: RoomBooking[]
  /** A room shown under its group: its money is the group's (see the group entry). */
  inGroup?: boolean
}

/**
 * A room of a hall package (tenant migration 063) with nothing billed on the
 * room itself: its stay is on the hall booking's bill, so the register says
 * "In hall bill" instead of a ₹0 that reads like a free stay.
 */
function onHallBill(b: RoomBooking): boolean {
  return !!b.hall_booking_id && (b.total_paise ?? 0) === 0
}

function groupStays(list: RoomBooking[]): StayRow[] {
  const byGroup = new Map<string, RoomBooking[]>()
  for (const b of list) {
    if (!b.group_id) continue
    byGroup.set(b.group_id, [...(byGroup.get(b.group_id) ?? []), b])
  }
  const out: StayRow[] = []
  const done = new Set<string>()
  for (const b of list) {
    const ms = b.group_id ? byGroup.get(b.group_id)! : [b]
    if (ms.length < 2) { out.push(b); continue }
    if (done.has(b.group_id!)) continue
    done.add(b.group_id!)
    const sum = (f: (x: RoomBooking) => number | null | undefined) => ms.reduce((acc, x) => acc + (f(x) ?? 0), 0)
    const statuses = [...new Set(ms.map(x => x.status))]
    out.push({
      ...ms[0],
      id: `group:${b.group_id}`,
      room_number: ms.map(x => x.room_number || x.room_id).join(', '),
      persons_count: sum(x => x.persons_count),
      paid_paise: sum(x => x.paid_paise ?? x.advance_paise),
      advance_paise: sum(x => x.advance_paise),
      refunded_paise: sum(x => x.refunded_paise),
      total_paise: sum(x => x.total_paise),
      // One account: the group's money against every room's bill, netted.
      due_paise: Math.max(0, sum(x => x.total_paise) - sum(x => (x.paid_paise ?? x.advance_paise) - (x.refunded_paise ?? 0))),
      balance_paise: sum(x => x.balance_paise),
      // 'mixed' is only ever on a group's own entry; the status column reads it.
      status: (statuses.length === 1 ? statuses[0] : 'mixed') as RoomBooking['status'],
      has_id_document: ms.every(x => x.has_id_document !== false),
      members: ms.map(x => ({ ...x, inGroup: true })),
    })
  }
  return out
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
  // ?q= opens the register on one booking — the Website requests inbox links
  // a confirmed request to its booking this way.
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [page, setPage] = useState(1)
  // Opened on one booking (?q=): any date, or a stay next month is "not found".
  const [range, setRange] = useState<DateRange>(() => (searchParams.get('q') ? makeRange('all') : loadStoredRange('rooms')))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const [billModal, setBillModal] = useState<Record<string, any> | null>(null)
  const [collectModal, setCollectModal] = useState<{ booking: RoomBooking; bill: Record<string, any> } | null>(null)
  // Settling a deposit is its own action, not part of checkout: a guest can
  // leave before the room has been inspected, and the deposit is returned
  // afterwards. Held = taken - refunded - forfeited.
  const [depositModal, setDepositModal] = useState<RoomBooking | null>(null)
  // How the deposit goes back, and why anything is kept (2026-10-08): the
  // guest signs a voucher for exactly this, so it has to say it.
  const [refundPayment, setRefundPayment] = useState<PaymentFieldsValue>(emptyPayment())
  const [keptReason, setKeptReason] = useState('')
  const depositModes = usePaymentModes()
  // Rooms whose deposits are settled one after another - a group's checkout
  // can free more than one.
  const [depositQueue, setDepositQueue] = useState<RoomBooking[]>([])
  function openDeposit(b: RoomBooking, next: RoomBooking[] = []) {
    setDepositModal(b); setDepositQueue(next)
    setForfeitAmt(''); setSettleError(''); setKeptReason(''); setRefundPayment(emptyPayment())
  }
  function closeDeposit() {
    const [next, ...rest] = depositQueue
    if (next) openDeposit(next, rest)
    else { setDepositModal(null); setDepositQueue([]) }
  }
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
  const [groupCheckinFor, setGroupCheckinFor] = useState<RoomBooking[] | null>(null)
  const [groupCheckoutFor, setGroupCheckoutFor] = useState<RoomBooking[] | null>(null)
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
    if (s === 'booked' || s === 'confirmed') return <span className="badge-blue whitespace-nowrap">{t('dharamshala.statusBooked')}</span>
    if (s === 'checked_in') return <span className="badge-green whitespace-nowrap">{t('dharamshala.statusCheckedIn')}</span>
    if (s === 'checked_out') return <span className="badge-gray whitespace-nowrap">{t('dharamshala.statusCheckedOut')}</span>
    return <span className="badge-red whitespace-nowrap">{t('dharamshala.statusCancelled')}</span>
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
          {b.hall_booking_id && !(b as StayRow).inGroup && (
            <button
              onClick={e => { e.stopPropagation(); navigate(`/hall?q=${encodeURIComponent(b.hall_invoice_no ?? b.hall_event_name ?? '')}`) }}
              className="mt-1 mr-1 inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-200"
              title={t('dharamshala.hallPackageHint')}
              data-testid="hall-package-badge"
            >
              <PartyPopper size={11} /> {t('dharamshala.hallPackageOf', { event: b.hall_event_name ?? '' })}
            </button>
          )}
          {(b as StayRow).members && (
            <span className="badge-blue mt-1 whitespace-nowrap" data-testid="group-rooms">
              {t('dharamshala.roomsCount', { count: (b as StayRow).members!.length })}
            </span>
          )}
          {/* "Book it now, we'll bring the ID": the booking stands, and the
              register keeps saying the ID is still owed until it arrives. */}
          {b.has_id_document === false && b.status !== 'cancelled' && (
            <button
              onClick={e => {
                e.stopPropagation()
                setIdDocsFor((b as StayRow).members?.find(x => x.has_id_document === false) ?? b)
              }}
              className="badge-yellow mt-1 ml-1 cursor-pointer hover:opacity-80"
              title={t('guestId.pendingHint')}
            >
              {t('guestId.pending')}
            </button>
          )}
        </div>
      ),
    },
    {
      // The persons ride under the room number: a column of its own for one
      // small figure was part of what pushed the actions off the screen.
      key: 'room', label: t('dharamshala.room'),
      render: b => (
        <div>
          <span className="text-slate-700">{b.room_number || b.room_id}</span>
          <span className="block text-xs text-slate-400">{t('dharamshala.personsN', { count: b.persons_count })}</span>
        </div>
      ),
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
      //
      // Arrival and departure share ONE column, arrival above departure. As two
      // columns under three-line headings they made the register wider than a
      // laptop screen and pushed the actions off its right edge.
      key: 'stay', label: t('dharamshala.stayColumn'),
      render: b => (
        <div className="space-y-1 min-w-[8.5rem]">
          <div className="flex gap-1.5"><span className="text-[10px] uppercase tracking-wide text-slate-400 w-7 shrink-0 pt-0.5">{t('dharamshala.inShort')}</span>
            <StayTime planned={b.planned_check_in_at} date={b.check_in_date} actual={b.checked_in_at} /></div>
          <div className="flex gap-1.5"><span className="text-[10px] uppercase tracking-wide text-slate-400 w-7 shrink-0 pt-0.5">{t('dharamshala.outShort')}</span>
            <StayTime planned={b.planned_check_out_at} date={b.check_out_date} actual={b.checked_out_at} /></div>
        </div>
      ),
    },
    {
      // Everything actually collected (advance + every tender at checkout),
      // summed from the payments ledger — not the stale advance_paise column.
      key: 'paid', label: t('dharamshala.paid'), align: 'right',
      render: b => onHallBill(b) && !(b.paid_paise ?? 0)
        ? <span className="text-xs text-violet-700" title={t('dharamshala.hallPackageHint')}>{t('dharamshala.inHallBill')}</span>
        : <>₹{fmtPaise(b.paid_paise ?? b.advance_paise)}</>,
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
        // Refunds already given back are not held any more (tenant migration
        // 057 refunds at checkout): a stay paid 1,200, billed 600 and refunded
        // 600 is settled, not "-600".
        const refunded = b.refunded_paise ?? 0
        if (onHallBill(b) && !(b.paid_paise ?? 0)) return <span className="text-slate-400">&mdash;</span>
        // A room under its group entry: the money is the group's, so the room
        // shows its bill, not a balance of its own.
        if ((b as StayRow).inGroup) {
          return <span className="text-slate-500 text-xs" title={t('dharamshala.groupMoneyHint')}>{t('dharamshala.roomBill', { amount: fmtPaise(b.total_paise ?? 0) })}</span>
        }
        const ms = (b as StayRow).members
        if (ms && ms.some(x => x.status === 'checked_in' || x.status === 'confirmed' || x.status === 'booked')) {
          const held = (b.paid_paise ?? 0) - refunded - (b.total_paise ?? 0)
          if ((b.due_paise ?? 0) <= 0 && held > 0) {
            // Paid over the rooms' bills while rooms still stay: held for the
            // group, refunded when its last room checks out.
            return <span className="text-green-700 font-semibold" title={t('dharamshala.groupHeldHint')}>{t('dharamshala.heldForGroup', { amount: fmtPaise(held) })}</span>
          }
        }
        if (b.status === 'cancelled') {
          const held = (b.paid_paise ?? 0) - refunded
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
        const over = (b.paid_paise ?? 0) - refunded - (b.total_paise ?? 0)
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
    sourceColumn<RoomBooking>(t, 'counter', ['hall']),
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: b => {
        // Rooms of one booking at different stages: each stage with its count.
        const ms = (b as StayRow).members
        if (!ms || (b.status as string) !== 'mixed') return statusBadge(b.status)
        const counts = new Map<string, number>()
        for (const x of ms) counts.set(x.status, (counts.get(x.status) ?? 0) + 1)
        return (
          <div className="flex flex-col items-start gap-1">
            {[...counts].map(([st, n]) => <span key={st} className="inline-flex items-center gap-1">{statusBadge(st)}<span className="text-xs text-slate-500">×{n}</span></span>)}
          </div>
        )
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, enteredByOptions, canDelete])

  /**
   * The row's actions, through the table kit: the next step of the stay
   * (Check-In / Check-Out) stays visible with its words, and everything else is
   * a labelled item in the ⋮ menu. The row used to draw up to eleven bare icons
   * side by side, which ran out of the table on an ordinary laptop screen and
   * left the clerk guessing what each icon was.
   */
  /** A package room's way back to its hall booking (tenant migration 063). */
  const openHall = (b: RoomBooking): RowAction => ({
    label: t('dharamshala.openHallBooking'), icon: <PartyPopper size={14} />,
    onClick: () => navigate(`/hall?q=${encodeURIComponent(b.hall_invoice_no ?? b.hall_event_name ?? '')}`),
  })

  function rowActions(b: StayRow): RowAction[] {
    // A group's own entry: what applies to all its rooms at once. Each room's
    // own steps are on its row underneath.
    if (b.members) {
      const ms = b.members
      const waiting = ms.filter(x => x.status === 'confirmed' || x.status === 'booked')
      const staying = ms.filter(x => x.status === 'checked_in')
      const out: RowAction[] = []
      // The next step for the group, with the rooms to pick: some arrive
      // today and the rest tomorrow, some leave early.
      if (waiting.length) {
        out.push({ label: t('dharamshala.checkInGroup', { count: waiting.length }), onClick: () => setGroupCheckinFor(ms), primary: true })
      } else if (staying.length) {
        out.push({ label: t('dharamshala.checkOutGroup', { count: staying.length }), onClick: () => setGroupCheckoutFor(ms), primary: true })
      }
      if (waiting.length && staying.length) {
        out.push({ label: t('dharamshala.checkOutGroup', { count: staying.length }), icon: <Undo2 size={14} />, onClick: () => setGroupCheckoutFor(ms) })
      }
      if (b.hall_booking_id) out.push(openHall(b))
      // A package's rooms are billed on the hall booking: no room bill to print.
      if (!onHallBill(b) && ms.some(x => x.status !== 'cancelled')) {
        out.push({
          label: t('dharamshala.printGroupBill'), icon: <Files size={14} />,
          onClick: () => { printDonationReceipt(ms[0].id, '/room-bookings', 'group-receipt').catch(() => toast.error(t('dharamshala.printFailed'))) },
        })
      }
      // Every room out and the group paid over: its refund, recorded on one of
      // its rooms (the API allows what the GROUP holds over its bills).
      // The group owes more than it has paid: collected on one of its rooms,
      // the group's money is one account.
      if ((b.due_paise ?? 0) > 0) {
        const payOn = ms.find(x => x.status !== 'cancelled') ?? ms[0]
        out.push({ label: t('dharamshala.collectPayment'), icon: <IndianRupee size={14} />, onClick: () => openCollect(payOn) })
      }
      const groupOver = refundable(b)
      if (!waiting.length && !staying.length && groupOver > 0) {
        out.push({ label: t('dharamshala.refund'), icon: <Undo2 size={14} />, onClick: () => openRefund(ms[0], groupOver) })
      }
      // The deposit is taken on one room of the group (the first), and its
      // actions used to live only on that room's row underneath - so after a
      // group checkout the entry offered nothing but the bill, and the deposit
      // looked forgotten. Brought up to the entry, naming the room when more
      // than one holds a deposit.
      const withDeposit = ms.filter(x => Number((x as unknown as Record<string, unknown>).deposit_paise ?? 0) > 0)
      const roomTag = (x: RoomBooking) => withDeposit.length > 1 ? ` · ${t('dharamshala.room')} ${x.room_number ?? ''}` : ''
      const toSettle = withDeposit.filter(x => x.status !== 'cancelled' && depositHeld(x) > 0)
      for (const x of toSettle) {
        out.push({
          label: t('dharamshala.settleDeposit') + roomTag(x), icon: <ShieldCheck size={14} />,
          // Every room out: settling it is the next step, so it shows with its words.
          primary: !waiting.length && !staying.length && toSettle.length === 1,
          onClick: () => openDeposit(x),
        })
      }
      for (const x of withDeposit) {
        out.push({
          label: t('dharamshala.depositReceipt') + roomTag(x), icon: <Receipt size={14} />,
          onClick: () => { printDepositReceipt(x.id).catch(() => toast.error(t('dharamshala.depositDocFailed'))) },
        })
        if ((x as unknown as Record<string, unknown>).deposit_settled_at) {
          out.push({
            label: t('dharamshala.depositRefundVoucher') + roomTag(x), icon: <Undo2 size={14} />,
            onClick: () => { printDepositRefundVoucher(x.id).catch(() => toast.error(t('dharamshala.depositDocFailed'))) },
          })
        }
      }
      const noId = ms.find(x => x.has_id_document === false && x.status !== 'cancelled')
      if (noId) out.push({ label: t('guestId.title'), icon: <IdCard size={14} />, onClick: () => setIdDocsFor(noId) })
      return out
    }
    const open = b.status === 'confirmed' || b.status === 'booked'
    const out: RowAction[] = []
    if (open) out.push({ label: t('dharamshala.checkInAction'), onClick: () => setCheckinFor(b), primary: true })
    if (b.status === 'checked_in') out.push({ label: t('dharamshala.checkOutAction'), onClick: () => setCheckoutFor(b), primary: true })
    if (b.status === 'checked_out' && b.invoice_no) {
      out.push({
        label: t('common.printReceipt', { defaultValue: 'Print receipt' }), icon: <Receipt size={14} />, primary: true,
        onClick: () => { printDonationReceipt(b.id, '/room-bookings').catch(() => {}) },
      })
    }
    if (open || b.status === 'checked_in') {
      out.push({ label: t('roomCharges.title'), icon: <PackagePlus size={14} />, onClick: () => setExtrasFor(b) })
    }
    if (b.hall_booking_id && !(b as StayRow).inGroup) out.push(openHall(b))
    if (b.group_id && b.status !== 'cancelled' && !onHallBill(b)) {
      out.push({
        label: t('dharamshala.printGroupBill'), icon: <Files size={14} />,
        onClick: () => { printDonationReceipt(b.id, '/room-bookings', 'group-receipt').catch(() => toast.error(t('dharamshala.printFailed'))) },
      })
    }
    if (b.status === 'checked_out') out.push({ label: t('dharamshala.viewBill'), icon: <FileText size={14} />, onClick: () => viewBill(b.id) })
    if (!(b as StayRow).inGroup && b.status !== 'cancelled' && (b.due_paise ?? b.balance_paise ?? 0) > 0) {
      out.push({ label: t('dharamshala.collectPayment'), icon: <IndianRupee size={14} />, onClick: () => openCollect(b) })
    }
    // A room of a group: collecting and refunding are the group's (its entry).
    if (!(b as StayRow).inGroup && refundable(b) > 0) out.push({ label: t('dharamshala.refund'), icon: <Undo2 size={14} />, onClick: () => openRefund(b) })
    if (b.status !== 'cancelled' && depositHeld(b) > 0) {
      out.push({
        label: t('dharamshala.settleDeposit'), icon: <ShieldCheck size={14} />,
        onClick: () => openDeposit(b),
      })
    }
    const anyB = b as unknown as Record<string, unknown>
    if (Number(anyB.deposit_paise ?? 0) > 0) {
      out.push({
        label: t('dharamshala.depositReceipt'), icon: <Receipt size={14} />,
        onClick: () => { printDepositReceipt(b.id).catch(() => toast.error(t('dharamshala.depositDocFailed'))) },
      })
    }
    if (anyB.deposit_settled_at) {
      out.push({
        label: t('dharamshala.depositRefundVoucher'), icon: <Undo2 size={14} />,
        onClick: () => { printDepositRefundVoucher(b.id).catch(() => toast.error(t('dharamshala.depositDocFailed'))) },
      })
    }
    if (b.status !== 'cancelled') {
      out.push({ label: t('guestId.title'), icon: <IdCard size={14} />, onClick: () => setIdDocsFor(b) })
      out.push({ label: t('dharamshala.editTimes'), icon: <Clock size={14} />, onClick: () => openTimes(b) })
    }
    if (canDelete && b.status !== 'cancelled') out.push({ label: t('editBooking.title'), icon: <Pencil size={14} />, onClick: () => setEditFor(b) })
    if (open) {
      out.push({ label: t('dharamshala.cancelBooking'), icon: <X size={14} />, onClick: () => setCancelModal({ id: b.id, guestName: b.guest_name }), danger: true })
    }
    if (canDelete) out.push({ label: t('entries.delete'), icon: <Trash2 size={14} />, onClick: () => removeBooking(b), danger: true })
    return out
  }

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
      const rows: RoomBooking[] = data.data || []
      // A group booking that the page cut in two - its first or last row on
      // this page, the rest on the next - is completed here, so the register
      // still shows it as ONE entry. Only the groups at the page's edges can
      // be cut; the rest of the page is whole.
      const edgeGroups = [...new Set([rows[0]?.group_id, rows[rows.length - 1]?.group_id].filter(Boolean))] as string[]
      for (const gid of edgeGroups) {
        try {
          const r = await api.get('/room-bookings', { params: { group_id: gid, limit: 100 } })
          const have = new Set(rows.map(x => x.id))
          const missing: RoomBooking[] = (r.data.data || []).filter((x: RoomBooking) => !have.has(x.id))
          if (missing.length) {
            const at = rows.findIndex(x => x.group_id === gid)
            rows.splice(at + rows.filter(x => x.group_id === gid).length, 0, ...missing)
          }
        } catch { /* the page still shows what it has */ }
      }
      setBookings(rows)
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
          { header: t('website.source.column'), width: 12 },
        ],
        rows: rows.map(b => [
          b.guest_name ?? '', b.guest_mobile ?? '', b.room_number || b.room_id,
          new Date(b.check_in_date).toLocaleDateString('en-IN'),
          new Date(b.check_out_date).toLocaleDateString('en-IN'),
          b.persons_count, b.advance_paise, b.balance_paise,
          statusLabel[b.status] ?? b.status, enteredByText(b, t), sourceLabel(t, b.source),
        ]),
        totals: [
          t('kit.total'), '', '', '', '', '',
          rows.reduce((s, b) => s + b.advance_paise, 0),
          rows.reduce((s, b) => s + b.balance_paise, 0),
          '', '', '',
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
    return depositHeldOf(b)
  }

  async function settleDeposit() {
    if (!depositModal) return
    const held = depositHeld(depositModal)
    const forfeit = forfeitAmt ? parsePaise(forfeitAmt) : 0
    if (forfeit > held) {
      setSettleError(t('dharamshala.forfeitTooLarge', { held: fmtPaise(held) }))
      return
    }
    if (forfeit > 0 && !keptReason.trim()) {
      setSettleError(t('dharamshala.keptReasonRequired'))
      return
    }
    if (held - forfeit > 0 && needsReference(depositModes, refundPayment.payment_mode) && !refundPayment.reference_no.trim()) {
      setSettleError(t('payroll.utrRequired'))
      return
    }
    setSettling(true)
    setSettleError('')
    try {
      // refund_paise is omitted on purpose: the server returns everything not
      // forfeited, so the two can never disagree about what is left.
      const id = depositModal.id
      await api.post(`/room-bookings/${id}/deposit/settle`, {
        forfeit_paise: forfeit,
        payment_mode: refundPayment.payment_mode,
        payment_account_id: refundPayment.payment_account_id || null,
        reference_no: refundPayment.reference_no.trim() || null,
        notes: keptReason.trim() || null,
      })
      toast.success(t('dharamshala.depositSettled'))
      closeDeposit()
      load()
      // The guest signs this for the money back (and what was kept).
      printDepositRefundVoucher(id).catch(() => {})
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
    // Shown and saved as IST wall-clock time, whatever zone the PC is set to.
    const forInput = istInputOf
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
      const forInput = istInputOf
      const body: Record<string, string | null> = {}
      for (const k of ['planned_check_in_at', 'planned_check_out_at', 'checked_in_at', 'checked_out_at'] as const) {
        const now = timesForm[k]
        const was = forInput(timesModal[k])
        if (now === was) continue
        body[k] = now ? (istInputToDate(now)?.toISOString() ?? null) : null
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

  function openRefund(b: RoomBooking, amountPaise = refundable(b)) {
    setRefundModal(b)
    setRefundError('')
    setRefundMode('cash')
    // Prefilled with everything refundable, which is what a cancellation
    // normally gives back. A cashier keeping part of it types a smaller number.
    setRefundAmt((amountPaise / 100).toFixed(2))
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
        label: `${p.payment_mode}${p.reference_no ? ` · ${p.reference_no}` : ''} (${dayOf(p.paid_on)})`,
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
        rows={groupStays(bookings)}
        rowKey={b => b.id}
        rowActions={b => rowActions(b)}
        subRows={b => (b as StayRow).members}
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
      {groupCheckinFor && (
        <GroupCheckinModal rooms={groupCheckinFor} onClose={() => setGroupCheckinFor(null)}
          onDone={() => { setGroupCheckinFor(null); toast.success(t('dharamshala.checkedInGroup')); load() }} />
      )}
      {groupCheckoutFor && (
        <GroupCheckoutModal rooms={groupCheckoutFor} onClose={() => setGroupCheckoutFor(null)}
          onDone={res => {
            setGroupCheckoutFor(null)
            toast.success([t('dharamshala.checkedOutGroup', { count: res.invoices.length }), ...res.invoices,
              ...(res.refunded > 0 ? [t('dharamshala.refundedAmount', { amount: fmtPaise(res.refunded) })] : [])].join(' · '))
            load()
            // As for one room: the deposits of the rooms that left come back at
            // the same desk, one window per room holding one.
            const owed = (groupCheckoutFor ?? []).filter(x => res.ids.includes(x.id) && depositHeld(x) > 0)
            if (owed.length) openDeposit(owed[0], owed.slice(1))
          }} />
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
            // Not for a hall-package room with nothing billed on it: its bill
            // is the hall booking's, and a ₹0 room receipt helps nobody.
            if (b && (res?.invoice_no || !b.hall_booking_id)) {
              printDonationReceipt(b.id, '/room-bookings', b.group_id && !b.hall_booking_id ? 'group-receipt' : 'receipt').catch(() => {})
            }
            // ...and the deposit comes back at the same desk: return it now,
            // against the guest's signature (the client's dharamshala flow).
            if (b && depositHeld(b) > 0) openDeposit(b)
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
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-xl mx-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-navy-900">{t('dharamshala.settleDeposit')}</h3>
                <p className="text-sm text-slate-500">
                  {depositModal.guest_name} · {t('dharamshala.room')} {depositModal.room_number}
                </p>
              </div>
              <button onClick={() => closeDeposit()} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
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
            {forfeitAmt && parsePaise(forfeitAmt) > 0 && (
              <div className="mb-4">
                <label className="form-label" htmlFor="kept-reason">{t('dharamshala.keptReason')}</label>
                <input id="kept-reason" className="form-input" value={keptReason} onChange={e => setKeptReason(e.target.value)}
                  placeholder={t('dharamshala.keptReasonPlaceholder')} maxLength={300} />
              </div>
            )}
            {depositHeld(depositModal) - (forfeitAmt ? parsePaise(forfeitAmt) : 0) > 0 && (
              <div className="mb-4">
                <p className="form-label">{t('dharamshala.refundHow')}</p>
                <PaymentFields idPrefix="deposit-refund" value={refundPayment} onChange={setRefundPayment} direction="out" />
              </div>
            )}
            <p className="text-xs text-slate-500 mb-3">{t('dharamshala.refundVoucherHint')}</p>

            {settleError && <p className="text-sm text-red-600 mb-3">{settleError}</p>}

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => closeDeposit()}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={settleDeposit} disabled={settling}>
                {settling ? t('common.saving') : t('dharamshala.settleAndRefund')}
              </button>
            </div>
          </div>
        </div>
      )}

      {collectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
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
                      <span className="text-slate-400 text-xs ml-1">{dayOf(p.paid_on)}</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('dharamshala.cancelBookingTitle')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('dharamshala.cancelBookingWarning', { name: cancelModal.guestName })}
            </p>
            <div className="mb-4">
              <label className="form-label" htmlFor="rooms-list-cancelReason">{t('dharamshala.reasonOptional')}</label>
              <input id="rooms-list-cancelReason" className="form-input" value={cancelReason}
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
