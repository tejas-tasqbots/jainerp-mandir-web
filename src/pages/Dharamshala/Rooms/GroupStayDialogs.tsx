import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise } from '../../../lib/api'
import { istInputNow, istInputToDate } from '../../../lib/istClock'
import { PaymentSplitInput, emptyPaymentRow, sumPaise, toPayload, type PaymentRow } from '../../../components/PaymentSplitInput'
import type { RoomBooking } from '../../../types'
import { DepositAtCheckout, HallPackageNote, Shell } from './StayDialogs'
import { depositHeldOf } from './deposit'

/**
 * The desk's steps for a GROUP booking - several rooms for one guest, one
 * account (see the API's groupAccount).
 *
 * Asked 2026-09-24: "book 10 rooms, check in 5 and 5 the next day, after 2
 * days check out 3 - how is this managed and how is the billing done?"
 * Rooms arrive and leave at their own times, so both dialogs let the clerk
 * pick which rooms; the money is the group's, so checkout shows every leaving
 * room's bill against what the group has paid, and takes or hands back money
 * once.
 */

const isWaiting = (b: RoomBooking) => b.status === 'confirmed' || b.status === 'booked'
const roomOf = (b: RoomBooking) => b.room_number || b.room_id

function RoomChecklist({ rooms, picked, onChange, detail }: {
  rooms: RoomBooking[]
  picked: string[]
  onChange: (ids: string[]) => void
  detail?: (b: RoomBooking) => React.ReactNode
}) {
  const { t } = useTranslation()
  const all = picked.length === rooms.length
  return (
    <div className="rounded-lg border border-slate-200" data-testid="group-room-list">
      <label className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-sm font-medium text-slate-700 bg-slate-50">
        <input type="checkbox" className="w-4 h-4" checked={all}
          onChange={() => onChange(all ? [] : rooms.map(r => r.id))} />
        {t('dharamshala.allRooms', { count: rooms.length })}
        <span className="ml-auto text-xs text-slate-500">{t('dharamshala.roomsPicked', { count: picked.length })}</span>
      </label>
      <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
        {rooms.map(r => (
          <label key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50" data-testid="group-room">
            <input type="checkbox" className="w-4 h-4" checked={picked.includes(r.id)}
              onChange={e => onChange(e.target.checked ? [...picked, r.id] : picked.filter(x => x !== r.id))} />
            <span className="font-medium text-navy-900">{t('dharamshala.room')} {roomOf(r)}</span>
            <span className="text-xs text-slate-400">{t('dharamshala.personsN', { count: r.persons_count })}</span>
            {detail && <span className="ml-auto text-xs text-slate-600">{detail(r)}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}

/** "Check in 5 of the 10 now": the rooms picked, each checked in as it stands. */
export function GroupCheckinModal({ rooms, onClose, onDone }: {
  rooms: RoomBooking[]; onClose: () => void; onDone: () => void
}) {
  const { t } = useTranslation()
  const waiting = rooms.filter(isWaiting)
  const [picked, setPicked] = useState<string[]>(waiting.map(r => r.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true); setError('')
    const failed: string[] = []
    for (const r of waiting.filter(x => picked.includes(x.id))) {
      try {
        await api.patch(`/room-bookings/${r.id}/checkin`, {})
      } catch (e) {
        failed.push(`${roomOf(r)}: ${apiErrorMessage(e, t('dharamshala.checkinFailed'))}`)
      }
    }
    setBusy(false)
    if (failed.length) { setError(failed.join(' · ')); return }
    onDone()
  }

  return (
    <Shell title={t('dharamshala.groupCheckinTitle')} sub={`${rooms[0]?.guest_name ?? ''} · ${t('dharamshala.roomsCount', { count: rooms.length })}`} onClose={onClose}>
      <p className="text-sm text-slate-600">{t('dharamshala.groupCheckinHint')}</p>
      <RoomChecklist rooms={waiting} picked={picked} onChange={setPicked} />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>{t('common.cancel')}</button>
        <button type="button" onClick={submit} disabled={busy || picked.length === 0} className="btn-success" data-testid="group-checkin-confirm">
          {busy ? t('common.saving') : t('dharamshala.checkInRooms', { count: picked.length })}
        </button>
      </div>
    </Shell>
  )
}

interface GroupPreview {
  rooms: { id: string; room_number?: string; nights: number; total_paise: number }[]
  rooms_total_paise: number
  held_paise: number
  settled_paise: number
  committed_paise: number
  others_open: number
  due_paise: number
  refund_owed_paise: number
  carried_paise: number
}

const localNow = istInputNow

/**
 * "After 2 days check out 3": the rooms picked leave together - each its own
 * bill and invoice - and the group's account says what to collect or hand
 * back. While any room stays, nothing is handed back: the group's money is
 * still backing it.
 */
export function GroupCheckoutModal({ rooms, onClose, onDone }: {
  rooms: RoomBooking[]; onClose: () => void; onDone: (res: { invoices: string[]; refunded: number; ids: string[] }) => void
}) {
  const { t } = useTranslation()
  const staying = rooms.filter(r => r.status === 'checked_in')
  const [picked, setPicked] = useState<string[]>(staying.map(r => r.id))
  const [departure, setDeparture] = useState(localNow())
  const [preview, setPreview] = useState<GroupPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [payRows, setPayRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [refundNow, setRefundNow] = useState(true)
  const [refundMode, setRefundMode] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const outAt = istInputToDate(departure)
  const body = () => ({
    ids: picked,
    ...(outAt && !Number.isNaN(outAt.getTime()) ? { checked_out_at: outAt.toISOString() } : {}),
  })
  const key = JSON.stringify(body())
  const anchor = rooms[0]?.id

  useEffect(() => {
    if (!picked.length) { setPreview(null); return }
    const timer = setTimeout(() => {
      api.post(`/room-bookings/${anchor}/group-checkout-preview`, body())
        .then(r => {
          const p = r.data.data as GroupPreview
          setPreview(p); setPreviewError('')
          setPayRows(prev => prev.length === 1 && !prev[0].reference_no
            ? [{ ...prev[0], amount: p.due_paise ? String(p.due_paise / 100) : '' }]
            : prev)
        })
        .catch(e => setPreviewError(apiErrorMessage(e, t('dharamshala.checkoutFailed'))))
    }, 250)
    return () => clearTimeout(timer)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true); setError('')
    try {
      const due = preview?.due_paise ?? 0
      const owed = preview?.refund_owed_paise ?? 0
      const { data } = await api.post(`/room-bookings/${anchor}/group-checkout`, {
        ...body(),
        // Nothing entered means nothing taken (the balance stays due), never
        // "the whole due in cash".
        ...(due > 0 && sumPaise(payRows) > 0 ? { payments: toPayload(payRows) } : { amount_paise: 0 }),
        ...(owed > 0 && refundNow ? { refund: { payment_mode: refundMode } } : {}),
      })
      const res = data?.data ?? data
      onDone({
        invoices: (res?.rooms ?? []).map((r: { invoice_no?: string }) => r.invoice_no).filter(Boolean),
        refunded: owed > 0 && refundNow ? owed : 0,
        ids: picked,
      })
    } catch (e) {
      setError(apiErrorMessage(e, t('dharamshala.checkoutFailed')))
    } finally {
      setBusy(false)
    }
  }

  const p = preview
  const line = (label: string, value: number, strong = false, testid?: string) => (
    <div className={`flex justify-between ${strong ? 'font-semibold text-navy-900' : 'text-slate-600'}`} data-testid={testid}>
      <span>{label}</span><span>₹{fmtPaise(value)}</span>
    </div>
  )
  const billOf = (id: string) => p?.rooms.find(r => r.id === id)

  return (
    <Shell title={t('dharamshala.groupCheckoutTitle')} sub={`${rooms[0]?.guest_name ?? ''} · ${t('dharamshala.roomsCount', { count: rooms.length })}`} onClose={onClose}>
      <div className="max-w-xs">
        <label className="form-label" htmlFor="gco-departure">{t('dharamshala.departure')}</label>
        <input id="gco-departure" type="datetime-local" className="form-input" value={departure}
          onChange={e => setDeparture(e.target.value)} />
      </div>
      <RoomChecklist rooms={staying} picked={picked} onChange={setPicked}
        detail={r => {
          const b = billOf(r.id)
          return b ? t('dharamshala.roomBillShort', { nights: b.nights, amount: fmtPaise(b.total_paise) }) : null
        }} />

      <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1" data-testid="group-checkout-preview">
        {picked.length === 0 && <p className="text-slate-400">{t('dharamshala.pickRoomsToLeave')}</p>}
        {picked.length > 0 && !p && !previewError && <p className="text-slate-400"><Loader2 size={14} className="inline animate-spin" /> {t('common.loading')}</p>}
        {previewError && <p className="text-red-600">{previewError}</p>}
        {p && picked.length > 0 && (
          <>
            {line(t('dharamshala.leavingRoomsBill', { count: picked.length }), p.rooms_total_paise, true, 'group-leaving-total')}
            {line(t('dharamshala.groupHeld', { count: rooms.length }), p.held_paise)}
            {line(t('dharamshala.groupSettled'), p.settled_paise)}
            {p.due_paise > 0 && (
              <div className="flex justify-between font-semibold text-amber-800" data-testid="group-due">
                <span>{t('dharamshala.dueNow')}</span><span>₹{fmtPaise(p.due_paise)}</span>
              </div>
            )}
            {p.refund_owed_paise > 0 && (
              <div className="flex justify-between font-semibold text-brand-blue" data-testid="group-refund">
                <span>{t('dharamshala.refundToGuest')}</span><span>₹{fmtPaise(p.refund_owed_paise)}</span>
              </div>
            )}
            {p.others_open > 0 && (
              <p className="pt-1 text-xs text-slate-600" data-testid="group-carried">
                {p.carried_paise > 0
                  ? t('dharamshala.groupCarriedNote', { amount: fmtPaise(p.carried_paise), count: p.others_open })
                  : t('dharamshala.groupOthersLater', { count: p.others_open })}
              </p>
            )}
          </>
        )}
      </div>

      {p && p.due_paise > 0 && (
        <div>
          <label className="form-label">{t('dharamshala.collectPayment')}</label>
          <PaymentSplitInput rows={payRows} onChange={setPayRows} totalPaise={p.due_paise} disabled={busy} />
        </div>
      )}
      {p && p.refund_owed_paise > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-blue-900">
            <input type="checkbox" checked={refundNow} onChange={e => setRefundNow(e.target.checked)} className="w-4 h-4" />
            {t('dharamshala.refundNow', { amount: fmtPaise(p.refund_owed_paise) })}
          </label>
          {refundNow && (
            <select className="form-select w-48" value={refundMode} aria-label={t('dharamshala.refundMode')}
              onChange={e => setRefundMode(e.target.value)}>
              <option value="cash">{t('common.cash')}</option>
              <option value="upi">{t('common.upi')}</option>
              <option value="neft">NEFT</option>
              <option value="cheque">{t('common.cheque', { defaultValue: 'Cheque' })}</option>
            </select>
          )}
        </div>
      )}

      {/* A group's deposit is taken on one of its rooms: said here when that
          room is among those leaving, settled next (the register opens it). */}
      <DepositAtCheckout paise={rooms.filter(r => picked.includes(r.id)).reduce((s, r) => s + Math.max(0, depositHeldOf(r)), 0)} />
      {rooms[0] && <HallPackageNote booking={rooms[0]} />}

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>{t('common.cancel')}</button>
        <button type="button" onClick={submit} disabled={busy || !p || picked.length === 0} className="btn-primary" data-testid="group-checkout-confirm">
          {busy
            ? t('common.saving')
            : p && p.due_paise > 0 && sumPaise(payRows) === 0
              ? t('dharamshala.checkoutWithoutPayment')
              : t('dharamshala.checkOutRooms', { count: picked.length })}
        </button>
      </div>
    </Shell>
  )
}
