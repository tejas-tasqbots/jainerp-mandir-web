import { stayStepText, type StayStep } from '../../../lib/stayCharge'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2 } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise, parsePaise } from '../../../lib/api'
import { istInputNow, istInputToDate } from '../../../lib/istClock'
import { useToast } from '../../../components/kit/Toast'
import { PaymentSplitInput, emptyPaymentRow, rowsMissingReference, sumPaise, toPayload, type PaymentRow } from '../../../components/PaymentSplitInput'
import { usePaymentModes } from '../../../lib/useDropdownOptions'
import { ExtraChargesEditor } from '../../../components/RoomCharges/ExtraChargesEditor'
import { chargesPayload, chargesTotalPaise, type ChargeRow } from '../../../components/RoomCharges/chargeRows'
import type { RoomBooking } from '../../../types'
import { depositHeldOf } from './deposit'

/**
 * The three desk dialogs of a stay (tenant migration 057): check-in, extras
 * during the stay, and checkout.
 *
 * Asked for 2026-09-24: "this room booking from edit can be done while the room
 * checkin ... edit option should be there for this ... while check out also
 * edit can be done ... if user have given advance of 15000Rs but the charges is
 * while check out is 10000Rs only so while checkout remaining amount will be
 * refunded and proper bill with proper template will be given".
 */

interface StayCharge { id: string; description: string; qty: number; nights: number; rate_paise: number; amount_paise: number; stage: string }

export function Shell({ title, sub, children, onClose }: {
  title: string; sub: string; children: React.ReactNode; onClose: () => void
}) {
  // Escape closes, as every other dialog in the app does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[92vh] flex flex-col">
        <div className="px-6 pt-5 pb-3 border-b border-slate-100">
          <h3 className="font-bold text-navy-900">{title}</h3>
          <p className="text-sm text-slate-500">{sub}</p>
        </div>
        <div className="px-6 py-4 overflow-y-auto space-y-4">{children}</div>
      </div>
    </div>
  )
}

/** The extras already on a stay, each removable while the bill is open. */
function ExistingCharges({ charges, onRemove, busyId }: {
  charges: StayCharge[]; onRemove?: (c: StayCharge) => void; busyId?: string | null
}) {
  const { t } = useTranslation()
  if (!charges.length) return null
  return (
    <div className="rounded-lg border border-slate-200 divide-y divide-slate-100" data-testid="existing-charges">
      {charges.map(c => (
        <div key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="existing-charge">
          <span className="flex-1">
            {c.description}
            <span className="text-slate-400 text-xs ml-1.5">
              {c.qty !== 1 ? `${c.qty} × ` : ''}₹{fmtPaise(c.rate_paise)}{c.nights !== 1 ? ` × ${c.nights} ${t('roomCharges.nightsShort')}` : ''}
            </span>
          </span>
          <span className="font-semibold">₹{fmtPaise(c.amount_paise)}</span>
          {onRemove && (
            <button type="button" className="p-1 text-slate-400 hover:text-brand-red rounded disabled:opacity-40"
              disabled={busyId === c.id} onClick={() => onRemove(c)}
              title={t('roomCharges.remove')} aria-label={`${t('roomCharges.remove')} ${c.description}`}>
              {busyId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function useStayCharges(bookingId: string) {
  const [charges, setCharges] = useState<StayCharge[]>([])
  const reload = () => api.get(`/room-bookings/${bookingId}/bill`)
    .then(r => setCharges((r.data.data?.charges ?? []) as StayCharge[]))
    .catch(() => setCharges([]))
  useEffect(() => { reload() }, [bookingId]) // eslint-disable-line react-hooks/exhaustive-deps
  return { charges, reload }
}

// ── Check-in ────────────────────────────────────────────────────────────────

export function CheckinModal({ booking, onClose, onDone }: {
  booking: RoomBooking; onClose: () => void; onDone: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [persons, setPersons] = useState(String(booking.persons_count ?? 1))
  const [remarks, setRemarks] = useState(booking.notes ?? '')
  const [rows, setRows] = useState<ChargeRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nights = Number(booking.nights ?? 1)

  async function submit() {
    setBusy(true); setError('')
    try {
      await api.patch(`/room-bookings/${booking.id}/checkin`, {
        persons: Number(persons) || undefined,
        ...(remarks !== (booking.notes ?? '') ? { remarks: remarks.trim() || null } : {}),
        charges: chargesPayload(rows),
      })
      toast.success(t('dharamshala.checkinSuccess'))
      onDone()
    } catch (e) {
      setError(apiErrorMessage(e, t('dharamshala.checkinFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={t('dharamshala.confirmCheckinTitle')} sub={`${booking.guest_name} · ${t('dharamshala.room')} ${booking.room_number ?? ''}`} onClose={onClose}>
      <p className="text-sm text-slate-600">{t('dharamshala.confirmCheckinMessage')}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label" htmlFor="ci-persons">{t('dharamshala.personsLabel')}</label>
          <input id="ci-persons" type="number" min="1" max="99" className="form-input" value={persons}
            onChange={e => setPersons(e.target.value)} />
        </div>
      </div>
      <div>
        <p className="form-label">{t('roomCharges.heading')}</p>
        <p className="text-xs text-slate-500 mb-2">{t('roomCharges.checkinHint')}</p>
        <ExtraChargesEditor rows={rows} onChange={setRows} nights={nights} />
      </div>
      <div>
        <label className="form-label" htmlFor="ci-remarks">{t('dharamshala.remarks')}</label>
        <textarea id="ci-remarks" className="form-textarea" rows={2} maxLength={1000} value={remarks}
          placeholder={t('dharamshala.remarksPlaceholder')} onChange={e => setRemarks(e.target.value)} />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>{t('common.cancel')}</button>
        <button type="button" onClick={submit} className="btn-success" disabled={busy} data-testid="checkin-confirm">
          {busy ? t('common.saving') : t('dharamshala.checkInButton')}
        </button>
      </div>
    </Shell>
  )
}

// ── Extras during the stay ──────────────────────────────────────────────────

export function ExtrasModal({ booking, onClose, onDone }: {
  booking: RoomBooking; onClose: () => void; onDone: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const { charges, reload } = useStayCharges(booking.id)
  const [rows, setRows] = useState<ChargeRow[]>([])
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [total, setTotal] = useState<number>(Number(booking.total_paise ?? 0))

  async function remove(c: StayCharge) {
    setRemoving(c.id); setError('')
    try {
      const { data } = await api.delete(`/room-bookings/${booking.id}/charges/${c.id}`)
      setTotal(Number(data.data?.total_paise ?? total))
      await reload()
      onDone()
    } catch (e) {
      setError(apiErrorMessage(e, t('roomCharges.saveFailed')))
    } finally {
      setRemoving(null)
    }
  }

  async function save() {
    const list = chargesPayload(rows)
    if (!list.length) { onClose(); return }
    setBusy(true); setError('')
    try {
      const { data } = await api.post(`/room-bookings/${booking.id}/charges`, { charges: list })
      setTotal(Number(data.data?.total_paise ?? total))
      toast.success(t('roomCharges.saved', { total: fmtPaise(Number(data.data?.total_paise ?? 0)) }))
      setRows([])
      await reload()
      onDone()
    } catch (e) {
      setError(apiErrorMessage(e, t('roomCharges.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={t('roomCharges.title')} sub={`${booking.guest_name} · ${t('dharamshala.room')} ${booking.room_number ?? ''}`} onClose={onClose}>
      <ExistingCharges charges={charges} onRemove={remove} busyId={removing} />
      {!charges.length && <p className="text-sm text-slate-500">{t('roomCharges.none')}</p>}
      <ExtraChargesEditor rows={rows} onChange={setRows} nights={Number(booking.nights ?? 1)} />
      <p className="text-sm text-slate-600" data-testid="extras-bill-total">
        {t('roomCharges.billNow', { total: fmtPaise(total + (rows.length ? chargesTotalPaise(rows) : 0)) })}
      </p>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>{t('common.close')}</button>
        <button type="button" onClick={save} className="btn-primary" disabled={busy || !rows.length} data-testid="extras-save">
          {busy ? t('common.saving') : t('roomCharges.addToBill')}
        </button>
      </div>
    </Shell>
  )
}

// ── Checkout ────────────────────────────────────────────────────────────────

interface Preview {
  nights: number; tariff_per_night_paise: number; room_paise: number
  existing_charges_paise: number; new_charges_paise: number
  subtotal_paise: number; gst_paise: number; gst_rate_pct: number; total_paise: number
  paid_paise: number; refunded_paise: number; due_paise: number; refund_owed_paise: number
  /** How the stay was charged under the booking's own policy (tenant migration 072). */
  policy_charges_paise?: number
  stay?: {
    mode: string; minutes: number; nights: number; explanation: string[]; steps?: StayStep[]
    fees: { kind: 'early' | 'late' | 'short_stay'; description: string; amount_paise: number; waived: boolean }[]
  }
  list_rate_paise?: number; calculated_paise?: number; accommodation_paise?: number
  price_policy?: 'fixed' | 'controlled' | 'flexible'; discount_limit_percent?: number
  adjusted?: boolean; discount_paise?: number
  adjustment_error?: { code: string; message: string } | null
  /** A room of a group booking: the group's account (the API settles against it). */
  group?: {
    rooms: number; others_open: number; held_paise: number
    settled_paise: number; committed_paise: number; carried_paise: number
  } | null
}

/** "Now", as the IST wall-clock value a datetime-local input takes. */
const localNow = istInputNow

/**
 * The deposit, said at checkout. It is not on the bill - it is the guest's
 * money - and the clerk settles it in its own window, which the register
 * opens as soon as the checkout is saved. Without this line the checkout
 * gave no hint a deposit was still owed back.
 */
export function DepositAtCheckout({ paise }: { paise: number }) {
  const { t } = useTranslation()
  if (paise <= 0) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="checkout-deposit">
      <p className="font-semibold">{t('dharamshala.depositAtCheckout', { amount: fmtPaise(paise) })}</p>
      <p className="text-xs mt-1">{t('dharamshala.depositAtCheckoutHint')}</p>
    </div>
  )
}

/**
 * A hall-package room (tenant migration 063): its nights are on the hall
 * booking's bill, so the room shows ₹0 - said, or it reads as a free stay.
 * Extras added here are the only thing billed on the room.
 */
export function HallPackageNote({ booking }: { booking: RoomBooking }) {
  const { t } = useTranslation()
  if (!booking.hall_booking_id) return null
  return (
    <p className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900" data-testid="hall-package-note">
      {t('dharamshala.hallPackageCheckoutNote', { event: booking.hall_event_name ?? '', ref: booking.hall_invoice_no ?? '' })}
    </p>
  )
}

export function CheckoutModal({ booking, onClose, onDone }: {
  booking: RoomBooking; onClose: () => void
  onDone: (res: { invoice_no?: string; refunded_paise?: number }) => void
}) {
  const { t } = useTranslation()
  const paymentModes = usePaymentModes()
  const { charges, reload } = useStayCharges(booking.id)
  const [departure, setDeparture] = useState(localNow)
  const [rate, setRate] = useState(String(Number(booking.tariff_per_night_paise ?? 0) / 100))
  const [rows, setRows] = useState<ChargeRow[]>([])
  const [remarks, setRemarks] = useState(booking.notes ?? '')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [payRows, setPayRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [refundNow, setRefundNow] = useState(true)
  const [refundMode, setRefundMode] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Early/late lines the desk waives, and why the charge differs from the
  // price list (tenant migration 072). The API decides whether it may.
  const [waive, setWaive] = useState<{ early: boolean; late: boolean }>({ early: false, late: false })
  const [reason, setReason] = useState('')

  const ratePaise = parsePaise(rate || '0')
  const rateChanged = ratePaise !== Number(booking.tariff_per_night_paise ?? 0)
  const outAt = istInputToDate(departure)
  const waived = (['early', 'late'] as const).filter(k => waive[k])
  const body = () => ({
    ...(outAt && !Number.isNaN(outAt.getTime()) ? { checked_out_at: outAt.toISOString(), check_out_date: departure.slice(0, 10) } : {}),
    ...(rateChanged ? { tariff_per_night_paise: ratePaise } : {}),
    ...(waived.length ? { waive: waived } : {}),
    ...(reason.trim() ? { rate_reason: reason.trim() } : {}),
    charges: chargesPayload(rows),
  })

  // The bill as it would be posted, recomputed as the clerk edits. Debounced so
  // typing a rate does not send a request per keystroke.
  const key = JSON.stringify(body())
  useEffect(() => {
    const timer = setTimeout(() => {
      api.post(`/room-bookings/${booking.id}/checkout-preview`, body())
        .then(r => {
          const p = r.data.data as Preview
          setPreview(p)
          setPreviewError('')
          setPayRows(prev => prev.length === 1 && !prev[0].reference_no
            ? [{ ...prev[0], amount: p.due_paise ? String(p.due_paise / 100) : '' }]
            : prev)
        })
        .catch(e => setPreviewError(apiErrorMessage(e, t('dharamshala.checkoutFailed'))))
    }, 250)
    return () => clearTimeout(timer)
  }, [key, charges.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function removeCharge(c: StayCharge) {
    setRemoving(c.id)
    try {
      await api.delete(`/room-bookings/${booking.id}/charges/${c.id}`)
      await reload()
    } catch (e) {
      setError(apiErrorMessage(e, t('roomCharges.saveFailed')))
    } finally {
      setRemoving(null)
    }
  }

  async function submit() {
    // A UPI / cheque part names its transaction, as at booking.
    if ((preview?.due_paise ?? 0) > 0 && rowsMissingReference(payRows, paymentModes)) {
      setError(t('payroll.utrRequired')); return
    }
    setBusy(true); setError('')
    try {
      const due = preview?.due_paise ?? 0
      const owed = preview?.refund_owed_paise ?? 0
      const { data } = await api.patch(`/room-bookings/${booking.id}/checkout`, {
        ...body(),
        ...(remarks !== (booking.notes ?? '') ? { remarks: remarks.trim() || null } : {}),
        // "Check out without payment" must take nothing: with no tender list
        // the API books the whole due as cash, so say zero.
        ...(due > 0 && sumPaise(payRows) > 0 ? { payments: toPayload(payRows) } : { amount_paise: 0 }),
        ...(owed > 0 && refundNow ? { refund: { payment_mode: refundMode } } : {}),
      })
      onDone(data?.data ?? data)
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

  return (
    <Shell title={t('dharamshala.checkoutTitle')} sub={`${booking.guest_name} · ${t('dharamshala.room')} ${booking.room_number ?? ''}`} onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-3">
        <div>
          <label className="form-label" htmlFor="co-departure">{t('dharamshala.departure')}</label>
          <input id="co-departure" type="datetime-local" className="form-input" value={departure}
            onChange={e => setDeparture(e.target.value)} />
        </div>
        <div>
          <label className="form-label" htmlFor="co-rate">{t('editBooking.rate')}</label>
          <input id="co-rate" type="number" min="0" step="0.01" className="form-input" value={rate}
            disabled={preview?.price_policy === 'fixed'} data-testid="co-rate"
            onChange={e => setRate(e.target.value)} />
          {preview?.price_policy === 'fixed'
            ? <p className="text-xs text-slate-500 mt-1">{t('stayCharge.fixedHint')}</p>
            : rateChanged && <p className="text-xs text-amber-700 mt-1">{t('dharamshala.rateChangedHint')}</p>}
        </div>
      </div>

      <div>
        <p className="form-label">{t('roomCharges.heading')}</p>
        <ExistingCharges charges={charges} onRemove={removeCharge} busyId={removing} />
        <div className="mt-2">
          <ExtraChargesEditor rows={rows} onChange={setRows} nights={p?.nights ?? Number(booking.nights ?? 1)} />
        </div>
      </div>

      <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1" data-testid="checkout-preview">
        {!p && !previewError && <p className="text-slate-400"><Loader2 size={14} className="inline animate-spin" /> {t('common.loading')}</p>}
        {previewError && <p className="text-red-600">{previewError}</p>}
        {p && (
          <>
            {p.nights > 0 && line(t(p.stay?.mode === 'rolling_24h' ? 'stayCharge.roomDays' : 'dharamshala.roomNights', { count: p.nights, rate: fmtPaise(p.tariff_per_night_paise) }), p.room_paise)}
            {/* The stay policy's own lines, each waivable unless prices are fixed. */}
            {(p.stay?.fees ?? []).map(f => (
              <div key={f.kind} className={`flex justify-between gap-2 ${f.waived ? 'text-slate-400 line-through' : 'text-slate-600'}`} data-testid={`stay-fee-${f.kind}`}>
                <span className="flex items-center gap-2">
                  {f.kind !== 'short_stay' && p.price_policy !== 'fixed' && (
                    <input type="checkbox" className="w-3.5 h-3.5" aria-label={t('stayCharge.waive')} title={t('stayCharge.waive')}
                      data-testid={`waive-${f.kind}`} checked={waive[f.kind]}
                      onChange={e => setWaive(w => ({ ...w, [f.kind]: e.target.checked }))} />
                  )}
                  {f.description}
                </span>
                <span>₹{fmtPaise(f.amount_paise)}</span>
              </div>
            ))}
            {p.existing_charges_paise + p.new_charges_paise - (p.policy_charges_paise ?? 0) > 0
              && line(t('roomCharges.heading'), p.existing_charges_paise + p.new_charges_paise - (p.policy_charges_paise ?? 0))}
            {p.gst_paise > 0 && line(`GST ${p.gst_rate_pct}%`, p.gst_paise)}
            {line(t('dharamshala.total'), p.total_paise, true, 'preview-total')}
            {/* A room of a group booking settles against the group's money,
                not what happened to be taken on this room. */}
            {p.group ? (
              <>
                {line(t('dharamshala.groupHeld', { count: p.group.rooms }), p.group.held_paise)}
                {line(t('dharamshala.groupSettled'), p.group.settled_paise)}
              </>
            ) : (
              <>
                {line(t('dharamshala.alreadyPaid'), p.paid_paise)}
                {p.refunded_paise > 0 && line(t('dharamshala.refunded'), p.refunded_paise)}
              </>
            )}
            {p.due_paise > 0 && (
              <div className="flex justify-between font-semibold text-amber-800" data-testid="preview-due">
                <span>{t('dharamshala.dueNow')}</span><span>₹{fmtPaise(p.due_paise)}</span>
              </div>
            )}
            {p.refund_owed_paise > 0 && (
              <div className="flex justify-between font-semibold text-brand-blue" data-testid="preview-refund">
                <span>{t('dharamshala.refundToGuest')}</span><span>₹{fmtPaise(p.refund_owed_paise)}</span>
              </div>
            )}
            {p.group && p.group.others_open > 0 && (
              <p className="pt-1 text-xs text-slate-600" data-testid="preview-group-note">
                {p.group.carried_paise > 0
                  ? t('dharamshala.groupCarriedNote', { amount: fmtPaise(p.group.carried_paise), count: p.group.others_open })
                  : t('dharamshala.groupOthersLater', { count: p.group.others_open })}
              </p>
            )}
          </>
        )}
      </div>

      {p?.stay && p.stay.explanation.length > 0 && (
        <details className="text-xs text-slate-500" data-testid="stay-explanation">
          <summary className="cursor-pointer">{t('stayCharge.howCharged')}</summary>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {(p.stay.steps?.length ? p.stay.steps : p.stay.explanation.map(x => ({ code: '', text: x })))
              .map((x, i) => <li key={i}>{x.code ? stayStepText(t, x as StayStep, p.stay?.explanation[i]) : String((x as { text: string }).text)}</li>)}
          </ul>
        </details>
      )}

      {/* A charge that differs from the price list needs a reason, kept with
          the booking; past a cashier's limit the API refuses it (072). */}
      {p && (p.adjusted || p.adjustment_error) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2 text-sm" data-testid="rate-adjustment">
          <p className="text-amber-900">
            {t('stayCharge.priceList', { list: fmtPaise(p.calculated_paise ?? 0), charged: fmtPaise(p.accommodation_paise ?? 0) })}
          </p>
          <label className="form-label" htmlFor="co-rate-reason">{t('stayCharge.reasonLabel')}</label>
          <input id="co-rate-reason" className="form-input" maxLength={300} value={reason} data-testid="co-rate-reason"
            placeholder={t('stayCharge.reasonPlaceholder')} onChange={e => setReason(e.target.value)} />
          {p.adjustment_error && p.adjustment_error.code !== 'REASON_REQUIRED' && (
            <p className="text-red-700 text-xs" data-testid="rate-adjustment-error">{p.adjustment_error.message}</p>
          )}
        </div>
      )}

      {p && p.due_paise > 0 && (
        <div>
          <label className="form-label">{t('dharamshala.collectPayment')}</label>
          <PaymentSplitInput rows={payRows} onChange={setPayRows} totalPaise={p.due_paise} disabled={busy} />
          <p className="text-xs text-slate-400 mt-2">{t('dharamshala.partialPaymentHint')}</p>
        </div>
      )}
      {p && p.refund_owed_paise > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2" data-testid="checkout-refund">
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
          {!refundNow && <p className="text-xs text-blue-800">{t('dharamshala.refundLaterHint')}</p>}
        </div>
      )}

      <DepositAtCheckout paise={depositHeldOf(booking)} />
      <HallPackageNote booking={booking} />

      <div>
        <label className="form-label" htmlFor="co-remarks">{t('dharamshala.remarks')}</label>
        <textarea id="co-remarks" className="form-textarea" rows={2} maxLength={1000} value={remarks}
          placeholder={t('dharamshala.remarksPlaceholder')} onChange={e => setRemarks(e.target.value)} />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>{t('common.cancel')}</button>
        <button type="button" onClick={submit} disabled={busy || !p || !!p.adjustment_error} className="btn-primary" data-testid="checkout-confirm">
          {busy
            ? t('common.saving')
            : p && p.due_paise > 0 && sumPaise(payRows) === 0
              ? t('dharamshala.checkoutWithoutPayment')
              : t('dharamshala.checkOutButton')}
        </button>
      </div>
    </Shell>
  )
}
