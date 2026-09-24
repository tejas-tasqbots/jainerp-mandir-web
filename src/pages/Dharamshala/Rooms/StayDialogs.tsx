import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2 } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise, parsePaise } from '../../../lib/api'
import { useToast } from '../../../components/kit/Toast'
import { PaymentSplitInput, emptyPaymentRow, sumPaise, toPayload, type PaymentRow } from '../../../components/PaymentSplitInput'
import { ExtraChargesEditor } from '../../../components/RoomCharges/ExtraChargesEditor'
import { chargesPayload, chargesTotalPaise, type ChargeRow } from '../../../components/RoomCharges/chargeRows'
import type { RoomBooking } from '../../../types'

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

function Shell({ title, sub, children, onClose }: {
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
}

/** "Now", as the local wall-clock value a datetime-local input takes. */
function localNow(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function CheckoutModal({ booking, onClose, onDone }: {
  booking: RoomBooking; onClose: () => void
  onDone: (res: { invoice_no?: string; refunded_paise?: number }) => void
}) {
  const { t } = useTranslation()
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

  const ratePaise = parsePaise(rate || '0')
  const rateChanged = ratePaise !== Number(booking.tariff_per_night_paise ?? 0)
  const outAt = departure ? new Date(departure) : null
  const body = () => ({
    ...(outAt && !Number.isNaN(outAt.getTime()) ? { checked_out_at: outAt.toISOString(), check_out_date: departure.slice(0, 10) } : {}),
    ...(rateChanged ? { tariff_per_night_paise: ratePaise } : {}),
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
    setBusy(true); setError('')
    try {
      const due = preview?.due_paise ?? 0
      const owed = preview?.refund_owed_paise ?? 0
      const { data } = await api.patch(`/room-bookings/${booking.id}/checkout`, {
        ...body(),
        ...(remarks !== (booking.notes ?? '') ? { remarks: remarks.trim() || null } : {}),
        ...(due > 0 ? { payments: toPayload(payRows) } : {}),
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
            onChange={e => setRate(e.target.value)} />
          {rateChanged && <p className="text-xs text-amber-700 mt-1">{t('dharamshala.rateChangedHint')}</p>}
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
            {line(t('dharamshala.roomNights', { count: p.nights, rate: fmtPaise(p.tariff_per_night_paise) }), p.room_paise)}
            {p.existing_charges_paise + p.new_charges_paise > 0 && line(t('roomCharges.heading'), p.existing_charges_paise + p.new_charges_paise)}
            {p.gst_paise > 0 && line(`GST ${p.gst_rate_pct}%`, p.gst_paise)}
            {line(t('dharamshala.total'), p.total_paise, true, 'preview-total')}
            {line(t('dharamshala.alreadyPaid'), p.paid_paise)}
            {p.refunded_paise > 0 && line(t('dharamshala.refunded'), p.refunded_paise)}
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
          </>
        )}
      </div>

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

      <div>
        <label className="form-label" htmlFor="co-remarks">{t('dharamshala.remarks')}</label>
        <textarea id="co-remarks" className="form-textarea" rows={2} maxLength={1000} value={remarks}
          placeholder={t('dharamshala.remarksPlaceholder')} onChange={e => setRemarks(e.target.value)} />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>{t('common.cancel')}</button>
        <button type="button" onClick={submit} disabled={busy || !p} className="btn-primary" data-testid="checkout-confirm">
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
