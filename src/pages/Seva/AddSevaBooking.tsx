import { useEffect, useState } from 'react'
import { autoPrintSlip } from '../../lib/printReceipt'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, X } from 'lucide-react'
import { api, parsePaise, fmtPaise, todayIst } from '../../lib/api'
import { useAccounts, usePaymentModes, autoSelectAccount } from '../../lib/useDropdownOptions'
import { emptyPaymentRow, toPayload, sumPaise, type PaymentRow } from '../../components/PaymentSplitInput'
import { SplitPaymentToggle } from '../../components/SplitPaymentToggle'
import { DevoteePicker } from '../../components/DevoteePicker/DevoteePicker'
import type { Seva, DevoteeSelection } from '../../types'
import { paymentModeOptionLabel } from '../../lib/paymentModeLabel'

export function AddSevaBooking() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [sevas, setSevas] = useState<Seva[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const paymentModes = usePaymentModes()
  const accounts = useAccounts()
  // Opt-in multi-tender entry (part cash / part UPI / part cheque).
  const [splitMode, setSplitMode] = useState(false)
  const [payRows, setPayRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [devotee, setDevotee] = useState<DevoteeSelection | null>(null)

  const [form, setForm] = useState({
    seva_id: '',
    gotra: '',
    sankalp_names: '',
    booking_date: todayIst(),
    slot_time: '',
    amount: '',
    payment_mode: 'cash',
    payment_account_id: '',
  })

  useEffect(() => {
    api.get('/sevas?is_active=true').then(r => setSevas(r.data.data || []))
  }, [])

  const selectedSeva = sevas.find(s => s.id === form.seva_id)
  useEffect(() => {
    if (selectedSeva) setForm(f => ({ ...f, amount: String(selectedSeva.price_paise / 100) }))
  }, [form.seva_id])

  useEffect(() => {
    const id = autoSelectAccount(accounts, form.payment_mode)
    if (id) setForm(f => ({ ...f, payment_account_id: id }))
  }, [form.payment_mode, accounts])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.seva_id) { setError(t('msg.selectSeva')); return }
    if (!devotee && true) { /* devotee optional — anonymous allowed */ }
    setSaving(true)
    setError('')
    try {
      // Catch a mismatched split before round-tripping to the API.
      if (splitMode && sumPaise(payRows) !== parsePaise(form.amount)) {
        setError(t('donations.splitMismatch', { split: (sumPaise(payRows) / 100).toLocaleString('en-IN'), total: parseFloat(form.amount).toLocaleString('en-IN') }))
        setSaving(false); return
      }
      const payload: Record<string, unknown> = {
        seva_id: form.seva_id,
        gotra: form.gotra || undefined,
        sankalp_names: form.sankalp_names || undefined,
        booking_date: form.booking_date,
        slot_time: form.slot_time || undefined,
        amount_paise: parsePaise(form.amount),
        payment_mode: form.payment_mode,
        // Single mode only: with a split, each row names its own account, and
        // a top-level one would be the hidden single-mode box's.
        payment_account_id: splitMode ? undefined : (form.payment_account_id || undefined),
      }

      if (devotee?.is_anonymous) {
        payload.is_anonymous = true
      } else if (devotee?.global_user_id) {
        payload.devotee = { global_user_id: devotee.global_user_id, name: devotee.name, mobile: devotee.mobile }
      } else if (devotee?.name) {
        payload.devotee = { name: devotee.name, mobile: devotee.mobile }
      }

      if (splitMode) {
        payload.payments = toPayload(payRows)
        payload.payment_mode = payRows[0]?.payment_mode ?? form.payment_mode
      }
      const { data } = await api.post('/seva-bookings', payload)
      // Auto-print the seva slip, when the trust has asked for it. Fired before
      // navigating and not awaited: the booking is saved, and a printer that
      // does not answer must not hold the operator on this form (see
      // autoPrintSlip, which swallows its own errors for the same reason).
      if (data?.data?.id) void autoPrintSlip(data.data.id, '/seva-bookings', data.data.receipt)
      navigate('/seva')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to save booking')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-navy-900">{t('seva.newBookingTitle')}</h1>
        <button onClick={() => navigate('/seva')} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <div>
            <label className="form-label" htmlFor="add-seva-booking-seva-id">{t('seva.sevaPoojaLabel')}</label>
            <select id="add-seva-booking-seva-id" className="form-select" value={form.seva_id}
              onChange={e => setForm(f => ({ ...f, seva_id: e.target.value }))}>
              <option value="">{t('seva.selectSeva')}</option>
              {sevas.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} — ₹{fmtPaise(s.price_paise)}
                </option>
              ))}
            </select>
          </div>

          <DevoteePicker
            label={t('seva.devoteeLabel')}
            value={devotee}
            onChange={setDevotee}
            showAnonymous
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label" htmlFor="add-seva-booking-gotra">{t('seva.gotra')}</label>
              <input id="add-seva-booking-gotra" className="form-input" placeholder={t('seva.gotraPlaceholder')} value={form.gotra}
                onChange={e => setForm(f => ({ ...f, gotra: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="add-seva-booking-sankalp-names">{t('seva.sankalpNames')}</label>
              <input id="add-seva-booking-sankalp-names" className="form-input" placeholder={t('seva.sankalpPlaceholder')} value={form.sankalp_names}
                onChange={e => setForm(f => ({ ...f, sankalp_names: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label" htmlFor="add-seva-booking-booking-date">{t('seva.bookingDate')}</label>
              <input id="add-seva-booking-booking-date" type="date" className="form-input" value={form.booking_date}
                onChange={e => setForm(f => ({ ...f, booking_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="add-seva-booking-slot-time">{t('seva.slotTime')}</label>
              <input id="add-seva-booking-slot-time" type="time" className="form-input" value={form.slot_time}
                onChange={e => setForm(f => ({ ...f, slot_time: e.target.value }))} />
            </div>
          </div>

          {(() => {
            const isCash = form.payment_mode === 'cash'
            const relevantAccounts = accounts.filter(a => a.type === (isCash ? 'cash' : 'bank'))
            return (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label" htmlFor="add-seva-booking-amount">{t('seva.amountLabel')}</label>
                  <input id="add-seva-booking-amount" type="number" min="1" step="0.01" className="form-input" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                {/* With split on, the rows below are the payment. */}
                {!splitMode && (
                  <div>
                    <label className="form-label" htmlFor="add-seva-booking-payment-mode">{t('seva.paymentMode')}</label>
                    <select id="add-seva-booking-payment-mode" className="form-select" value={form.payment_mode}
                      onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value, payment_account_id: '' }))}>
                      {paymentModes.map(m => <option key={m.code} value={m.code}>{paymentModeOptionLabel(t, m)}</option>)}
                    </select>
                  </div>
                )}
                {!splitMode && relevantAccounts.length > 0 && (
                  <div className="col-span-2">
                    <label className="form-label" htmlFor="add-seva-booking-payment-account-id">{t('seva.receivedInAccount')}</label>
                    <select id="add-seva-booking-payment-account-id" className="form-select" value={form.payment_account_id}
                      onChange={e => setForm(f => ({ ...f, payment_account_id: e.target.value }))}>
                      <option value="">{t('seva.selectAccount')}</option>
                      {relevantAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.bank_name ? ` — ${a.bank_name}` : ''}{a.account_number ? ` (${a.account_number})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )
          })()}

          <SplitPaymentToggle
            enabled={splitMode} onEnabledChange={setSplitMode}
            rows={payRows} onRowsChange={setPayRows}
            totalPaise={Math.round(Number(form.amount || 0) * 100)}
            seedMode={form.payment_mode} seedAmount={form.amount}
            seedAccountId={form.payment_account_id}
            hintKey="common.splitPaymentHintGeneric"
          />

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/seva')} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? t('common.saving') : t('seva.bookSeva')}
          </button>
        </div>
      </form>
    </div>
  )
}
