import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, X } from 'lucide-react'
import { api, parsePaise, fmtPaise } from '../../lib/api'
import { printDonationReceipt } from '../../lib/printReceipt'
import { useAccounts, usePaymentModes, autoSelectAccount } from '../../lib/useDropdownOptions'
import { DevoteePicker } from '../../components/DevoteePicker/DevoteePicker'
import { emptyPaymentRow, toPayload, sumPaise, type PaymentRow } from '../../components/PaymentSplitInput'
import { SplitPaymentToggle } from '../../components/SplitPaymentToggle'
import { useProfileStore } from '../../store/profileStore'
import type { DonationCategory, DevoteeSelection } from '../../types'

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/

export function AddDonation() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id: editId } = useParams()
  const isEdit = !!editId
  const paymentModes = usePaymentModes()
  const accounts = useAccounts()
  // Opt-in multi-tender entry (part cash / part UPI / part cheque).
  const [splitMode, setSplitMode] = useState(false)
  const [payRows, setPayRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [categories, setCategories] = useState<DonationCategory[]>([])
  const [devotee, setDevotee] = useState<DevoteeSelection | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // PAN added inline when the selected donor has none on record (needed for 80G).
  // Sent with the donation as donor.pan — the API saves it onto the donor.
  const [donorPan, setDonorPan] = useState('')
  const [showPanField, setShowPanField] = useState(false)

  const [form, setForm] = useState({
    category_id: '',
    amount: '',
    payment_mode: 'cash',
    payment_account_id: '',
    utr_number: '',
    cheque_number: '',
    is_80g_eligible: true,
    // Opt-in, never pre-ticked. A donation is not agreement to be added to a
    // temple's mailing list — the counter has to ask, and the default is no.
    wants_event_updates: false,
    note: '',
  })

  useEffect(() => {
    api.get('/donation-categories', { params: { is_active: 'true' } }).then(r => setCategories(r.data.data || []))
  }, [])

  // Load existing donation when editing
  useEffect(() => {
    if (!editId) return
    api.get(`/donations/${editId}`).then(r => {
      const d = r.data.data
      setForm({
        category_id: d.category_id ?? '',
        amount: d.amount_paise ? String(fmtPaise(d.amount_paise)).replace(/,/g, '') : '',
        payment_mode: d.payment_mode ?? 'cash',
        payment_account_id: d.payment_account_id ?? '',
        utr_number: d.utr_number ?? '',
        cheque_number: d.cheque_number ?? '',
        is_80g_eligible: d.is_80g_eligible ?? true,
        wants_event_updates: d.wants_event_updates ?? false,
        note: d.notes ?? '',
      })
      if (d.is_anonymous) {
        setDevotee({ is_anonymous: true, anonymous_category: d.anonymous_category })
      } else if (d.donor_id) {
        setDevotee({ name: d.donor_name, mobile: d.donor_mobile, pan_masked: d.donor_pan_masked ?? undefined, is_offline: true })
      }
    }).catch(() => setError('Could not load donation to edit'))
  }, [editId])

  useEffect(() => {
    const id = autoSelectAccount(accounts, form.payment_mode)
    if (id) setForm(f => ({ ...f, payment_account_id: id }))
  }, [form.payment_mode, accounts])

  useEffect(() => {
    const amt = parseFloat(form.amount)
    if (form.payment_mode === 'cash' && amt > 2000) {
      setForm(f => ({ ...f, is_80g_eligible: false }))
    }
  }, [form.amount, form.payment_mode])

  // A PAN typed for one donor must not carry over to the next selection
  useEffect(() => {
    setDonorPan('')
    setShowPanField(false)
  }, [devotee])

  const panValid = PAN_REGEX.test(donorPan)
  // 80G needs the donor's PAN: for a donor with none on record the checkbox stays
  // off/disabled until a valid PAN is typed into the inline Add-PAN field.
  const needsPan = !!devotee && !devotee.is_anonymous && !devotee.pan_masked
  const panBlocked = needsPan && !panValid
  // A temple without an 80G registration cannot issue 80G receipts at all
  // (server enforces via EIGHTY_G_NOT_CONFIGURED; this just explains it up front).
  const profile = useProfileStore(s => s.profile)
  const temple80gBlocked = !!profile && !profile.reg_80g_number

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.category_id) { setError('Select a donation category'); return }
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Enter valid amount'); return }
    // Catch a mismatched split here rather than round-tripping to the API.
    if (splitMode && sumPaise(payRows) !== parsePaise(form.amount)) {
      setError(t('donations.splitMismatch', {
        split: (sumPaise(payRows) / 100).toLocaleString('en-IN'),
        total: parseFloat(form.amount).toLocaleString('en-IN'),
      }))
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        category_id: form.category_id,
        amount_paise: parsePaise(form.amount),
        payment_mode: form.payment_mode,
        is_80g_eligible: form.is_80g_eligible && !panBlocked && !temple80gBlocked,
      }

      // The inline-added PAN rides along so the API saves it onto the donor record.
      const pan = needsPan && panValid ? { pan: donorPan } : undefined
      if (devotee?.is_anonymous) {
        payload.is_anonymous = true
        if (devotee.anonymous_category) payload.anonymous_category = devotee.anonymous_category
      } else if (devotee?.global_user_id) {
        payload.donor = { global_user_id: devotee.global_user_id, name: devotee.name, mobile: devotee.mobile, ...pan }
      } else if (devotee?.name) {
        payload.donor = { name: devotee.name, mobile: devotee.mobile, ...pan }
      }

      if (splitMode) {
        // The API validates that the tenders sum to amount_paise; payment_mode
        // above stays as the primary/first mode for legacy reports.
        payload.payments = toPayload(payRows)
        payload.payment_mode = payRows[0]?.payment_mode ?? form.payment_mode
      }
      if (form.payment_account_id) payload.payment_account_id = form.payment_account_id
      if (!splitMode && form.utr_number) payload.utr_number = form.utr_number
      if (!splitMode && form.cheque_number) payload.cheque_number = form.cheque_number
      if (form.note) payload.notes = form.note
      // Only sent when the donor actually said yes, and never for an anonymous
      // donation — there is no one to link.
      if (form.wants_event_updates && !devotee?.is_anonymous) {
        payload.wants_event_updates = true
      }

      let donationId: string | undefined
      if (isEdit) {
        const { data } = await api.patch(`/donations/${editId}/correct`, payload)
        donationId = data.data?.id
      } else {
        const { data } = await api.post('/donations', payload)
        donationId = data.data?.id
      }
      navigate('/donations')
      if (donationId) {
        setTimeout(() => printDonationReceipt(donationId!).catch(() => {}), 300)
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to save donation')
    } finally {
      setSaving(false)
    }
  }

  const selectedCategory = categories.find(c => c.id === form.category_id)

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-navy-900">{isEdit ? t('donations.editDonation') : t('donations.newDonationTitle')}</h1>
          {isEdit && <p className="text-xs text-amber-600 mt-0.5">{t('donations.editWarning')}</p>}
        </div>
        <button type="button" onClick={() => navigate('/donations')} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          {/* Devotee / Donor picker */}
          <DevoteePicker
            label={t('donations.donorLabel')}
            value={devotee}
            onChange={setDevotee}
            showAnonymous
            showDanPeti
          />

          {/* Category */}
          <div>
            <label htmlFor="donation-category" className="form-label">{t('donations.donationCategory')}</label>
            <select id="donation-category" className="form-select" value={form.category_id}
              onChange={e => {
                const cat = categories.find(c => c.id === e.target.value)
                setForm(f => ({ ...f, category_id: e.target.value, is_80g_eligible: cat?.is_80g_eligible ?? true }))
              }}>
              <option value="">{t('donations.selectCategory')}</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.is_80g_eligible ? ' (80G)' : ''}</option>
              ))}
            </select>
          </div>

          {/* Amount + Payment */}
          {(() => {
            const isCash = form.payment_mode === 'cash'
            const relevantAccounts = accounts.filter(a => a.type === (isCash ? 'cash' : 'bank'))
            return (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">{t('donations.amountLabel')}</label>
                  <input type="number" min="1" step="0.01" className="form-input" placeholder="0.00"
                    value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="payment-mode" className="form-label">{t('donations.paymentModeLabel')}</label>
                  <select id="payment-mode" className="form-select" value={form.payment_mode}
                    onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value, payment_account_id: '' }))}>
                    {paymentModes.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
                  </select>
                </div>
                {relevantAccounts.length > 0 && (
                  <div className="col-span-2">
                    <label htmlFor="payment-account" className="form-label">{t('donations.receivedInAccount')}</label>
                    <select id="payment-account" className="form-select" value={form.payment_account_id}
                      onChange={e => setForm(f => ({ ...f, payment_account_id: e.target.value }))}>
                      <option value="">{t('donations.selectAccount')}</option>
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
            seedRef={form.utr_number || form.cheque_number}
            seedAccountId={form.payment_account_id}
          />

          {/* UTR / Cheque — single-mode only; split rows carry their own reference. */}
          {!splitMode && (form.payment_mode === 'upi' || form.payment_mode === 'netbanking' || form.payment_mode === 'online') && (
            <div>
              <label className="form-label">{t('donations.utrNumber')}</label>
              <input className="form-input" placeholder="Transaction reference" value={form.utr_number}
                onChange={e => setForm(f => ({ ...f, utr_number: e.target.value }))} />
            </div>
          )}
          {!splitMode && form.payment_mode === 'cheque' && (
            <div>
              <label className="form-label">{t('donations.chequeNumber')}</label>
              <input className="form-input" placeholder="Cheque number" value={form.cheque_number}
                onChange={e => setForm(f => ({ ...f, cheque_number: e.target.value }))} />
            </div>
          )}

          {/* Event-updates consent. Deliberately unticked by default and hidden
              for anonymous donations: donating is not consent to be contacted,
              and the donor has to be asked out loud at the counter. */}
          {!devotee?.is_anonymous && (
            <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <input type="checkbox" id="wants_updates" checked={form.wants_event_updates}
                onChange={e => setForm(f => ({ ...f, wants_event_updates: e.target.checked }))}
                className="mt-0.5 w-4 h-4 accent-green-600" />
              <label htmlFor="wants_updates" className="text-sm text-slate-700">
                Donor wants updates about this mandir&rsquo;s events
                <span className="block text-xs text-slate-500">
                  Ask the donor before ticking. Leave unticked if they did not say yes.
                </span>
              </label>
            </div>
          )}

          {/* 80G toggle */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <input type="checkbox" id="is_80g" checked={form.is_80g_eligible && !devotee?.is_anonymous && !panBlocked && !temple80gBlocked}
                onChange={e => setForm(f => ({ ...f, is_80g_eligible: e.target.checked }))}
                disabled={!!devotee?.is_anonymous || !selectedCategory?.is_80g_eligible || (form.payment_mode === 'cash' && parseFloat(form.amount) > 2000) || panBlocked || temple80gBlocked}
                className="w-4 h-4 accent-green-600" />
              <label htmlFor="is_80g" className="text-sm text-slate-700">
                {t('donations.eightyGEligible')}
                {temple80gBlocked && (
                  <span className="text-orange-500 ml-2 text-xs">{t('donations.templeNo80g')}</span>
                )}
                {devotee?.is_anonymous && (
                  <span className="text-orange-500 ml-2 text-xs">{t('donations.anonymousNo80g')}</span>
                )}
                {!devotee?.is_anonymous && form.payment_mode === 'cash' && parseFloat(form.amount) > 2000 && (
                  <span className="text-orange-500 ml-2 text-xs">{t('donations.cashLimitNo80g')}</span>
                )}
                {panBlocked && (
                  <span className="text-orange-500 ml-2 text-xs">{t('donations.panBlockedWarning')}</span>
                )}
              </label>
              {panBlocked && !showPanField && (
                <button type="button" onClick={() => setShowPanField(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 underline underline-offset-2">
                  {t('donations.addPan')}
                </button>
              )}
            </div>
            {needsPan && showPanField && (
              <div className="pl-7 space-y-1">
                <input className="form-input uppercase font-mono w-44" placeholder="ABCDE1234F" maxLength={10}
                  value={donorPan} autoFocus
                  onChange={e => setDonorPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
                {panValid ? (
                  <p className="text-xs text-green-600">{t('donations.panWillBeSaved', { name: devotee?.name || t('donations.theDonor') })}</p>
                ) : (
                  <p className="text-xs text-slate-400">{t('donations.panFormatHint')}</p>
                )}
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="form-label">{t('donations.note')} <span className="text-slate-400 font-normal">{t('donations.optional')}</span></label>
            <textarea className="form-textarea" rows={2} placeholder={t('donations.notePlaceholder')}
              value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/donations')} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? t('common.saving') : isEdit ? t('donations.saveCorrection') : t('donations.saveAndPrint')}
          </button>
        </div>
      </form>
    </div>
  )
}
