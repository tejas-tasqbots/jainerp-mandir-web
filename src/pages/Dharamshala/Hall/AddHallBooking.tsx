import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, X } from 'lucide-react'
import { api, parsePaise } from '../../../lib/api'
import { DevoteePicker } from '../../../components/DevoteePicker/DevoteePicker'
import { emptyPaymentRow, toPayload, type PaymentRow } from '../../../components/PaymentSplitInput'
import { SplitPaymentToggle } from '../../../components/SplitPaymentToggle'
import { recipientGstin } from '../../../lib/statutoryIds'
import type { Hall, DevoteeSelection } from '../../../types'

export function AddHallBooking() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [halls, setHalls] = useState<Hall[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Opt-in multi-tender entry for the advance taken at booking.
  const [splitMode, setSplitMode] = useState(false)
  const [payRows, setPayRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [booker, setBooker] = useState<DevoteeSelection | null>(null)

  const [form, setForm] = useState({
    hall_id: '',
    event_name: '',
    booking_date: new Date().toISOString().slice(0, 10),
    session_type: 'full_day',
    advance: '',
    payment_mode: 'cash',
    booker_gstin: '',
  })

  // A hall is let to firms far more often than a room is - a wedding, a
  // conference - so the recipient's GSTIN matters more on this form than
  // anywhere else in the module. Rule 46(e): without it the company cannot
  // claim input tax credit on the invoice they just paid.
  //
  // Same shared rule the API applies on submit, so the clerk is never told a
  // number is fine and then refused.
  const gstinCheck = recipientGstin(form.booker_gstin)
  const gstinError = form.booker_gstin.trim() ? (gstinCheck.error ?? null) : null

  useEffect(() => {
    api.get('/halls').then(r => setHalls(r.data.data || []))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.hall_id) { setError('Select a hall'); return }
    if (!form.event_name) { setError('Enter event name'); return }
    // Stops the booking rather than dropping the number: a hall invoice that
    // looks complete and is not a valid tax invoice is the worse outcome.
    if (gstinError) { setError(gstinError); return }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        hall_id: form.hall_id,
        event_name: form.event_name,
        booking_date: form.booking_date,
        session_type: form.session_type,
        advance_paise: form.advance ? parsePaise(form.advance) : 0,
        payment_mode: form.payment_mode,
        // Normalised, not as typed. A hall booking records its booker inline
        // rather than through a guest record, so this goes at the top level
        // (tenant migration 049 adds hall_bookings.booker_gstin).
        booker_gstin: gstinCheck.gstin,
      }

      if (booker?.global_user_id) {
        payload.booker = { global_user_id: booker.global_user_id, name: booker.name, mobile: booker.mobile }
      } else if (booker?.name) {
        payload.booker = { name: booker.name, mobile: booker.mobile }
      }

      if (splitMode) {
        // Tenders for the advance; the API sums them into advance_paise.
        payload.payments = toPayload(payRows)
        payload.payment_mode = payRows[0]?.payment_mode ?? form.payment_mode
      }
      await api.post('/hall-bookings', payload)
      navigate('/hall')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to create booking')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-navy-900">{t('dharamshala.newHallBooking')}</h1>
        <button onClick={() => navigate('/hall')} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <div>
            <label className="form-label">{t('dharamshala.hallLabel')}</label>
            <select className="form-select" value={form.hall_id}
              onChange={e => setForm(f => ({ ...f, hall_id: e.target.value }))}>
              <option value="">{t('dharamshala.selectHall')}</option>
              {halls.map(h => (
                <option key={h.id} value={h.id}>{h.name} {t('dharamshala.hallCapacity', { capacity: h.capacity_persons })}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">{t('dharamshala.eventName')}</label>
            <input className="form-input" placeholder={t('dharamshala.eventNamePlaceholder')} value={form.event_name}
              onChange={e => setForm(f => ({ ...f, event_name: e.target.value }))} />
          </div>

          {/* CGST Rule 46(e). Beside the event name because it belongs with the
              party details, not with the money. */}
          <div>
            <label className="form-label" htmlFor="booker-gstin">{t('dharamshala.guestGstin')}</label>
            <input
              id="booker-gstin" className="form-input" value={form.booker_gstin}
              onChange={e => setForm(f => ({ ...f, booker_gstin: e.target.value.toUpperCase() }))}
              placeholder="27AAATR1234C1Z0"
              maxLength={15}
              autoComplete="off"
              spellCheck={false}
            />
            <p className={`text-xs mt-1 ${gstinError ? 'text-red-600' : 'text-slate-500'}`}>
              {gstinError || t('dharamshala.guestGstinHint')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('dharamshala.bookingDate')}</label>
              <input type="date" className="form-input" value={form.booking_date}
                onChange={e => setForm(f => ({ ...f, booking_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('dharamshala.sessionLabel')}</label>
              <select className="form-select" value={form.session_type}
                onChange={e => setForm(f => ({ ...f, session_type: e.target.value }))}>
                <option value="morning">{t('dharamshala.sessionMorning')}</option>
                <option value="evening">{t('dharamshala.sessionEvening')}</option>
                <option value="full_day">{t('dharamshala.sessionFullDay')}</option>
                <option value="hourly">{t('dharamshala.sessionHourly')}</option>
              </select>
            </div>
          </div>

          <DevoteePicker
            label={t('dharamshala.bookerContact')}
            value={booker}
            onChange={setBooker}
            showAnonymous={false}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('dharamshala.advanceAmount')}</label>
              <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00"
                value={form.advance} onChange={e => setForm(f => ({ ...f, advance: e.target.value }))} />
            </div>
            {/* With split on, the rows below are the payment. */}
            {!splitMode && (
              <div>
                <label className="form-label">{t('dharamshala.paymentMode')}</label>
                <select className="form-select" value={form.payment_mode}
                  onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                  <option value="cash">{t('common.cash')}</option>
                  <option value="upi">{t('common.upi')}</option>
                  <option value="cheque">{t('common.cheque')}</option>
                </select>
              </div>
            )}
          </div>

          <SplitPaymentToggle
            enabled={splitMode} onEnabledChange={setSplitMode}
            rows={payRows} onRowsChange={setPayRows}
            totalPaise={Math.round(Number(form.advance || 0) * 100)}
            seedMode={form.payment_mode} seedAmount={form.advance}
            hintKey="common.splitPaymentHintGeneric"
          />

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/hall')} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? t('common.saving') : t('dharamshala.confirmBooking')}
          </button>
        </div>
      </form>
    </div>
  )
}
