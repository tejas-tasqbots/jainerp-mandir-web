import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, X, Landmark } from 'lucide-react'
import { api, parsePaise, fmtPaise } from '../../lib/api'
import { printDonationReceipt } from '../../lib/printReceipt'
import { useAccounts, usePaymentModes, autoSelectAccount } from '../../lib/useDropdownOptions'
import { DevoteePicker } from '../../components/DevoteePicker/DevoteePicker'
import { emptyPaymentRow, toPayload, sumPaise, cashPaise, type PaymentRow } from '../../components/PaymentSplitInput'
import { SplitPaymentToggle } from '../../components/SplitPaymentToggle'
import { useProfileStore } from '../../store/profileStore'
import type { DonationCategory, DevoteeSelection } from '../../types'

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/

/** s.80G(5D): a cash gift above ₹2,000 earns no deduction. */
const CASH_80G_LIMIT_PAISE = 2000 * 100

interface Fund { id: string; name: string; fund_type: string }

// The "Donor wants updates about this mandir's events" tick is switched off
// for now (founder request, 2026-09-17). Nothing new is recorded as consent
// while it is off.
const SHOW_EVENT_UPDATES_CONSENT = false as boolean

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

  // Named funds, only to SAY where a gift goes. The counter no longer picks a
  // fund or a fund type: a category names its fund once, in Settings → Masters
  // (tenant-migration 038), and the API files the gift by it. Asking three
  // overlapping questions on every receipt is how a corpus gift ended up
  // counted as income because a dropdown was left on "General".
  const [funds, setFunds] = useState<Fund[]>([])
  // When correcting: what the original was filed under. The API keeps it
  // unless the category changes.
  const [original, setOriginal] = useState<{ category_id: string; fund_id: string | null; fund_type: string | null } | null>(null)
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
    // Every fund, active or not: a category may still point at one that was
    // retired, and its name is what the hint below has to show.
    api.get('/funds', { params: { limit: '200' } })
      .then(r => setFunds(r.data.data ?? [])).catch(() => setFunds([]))
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
      setOriginal({ category_id: d.category_id ?? '', fund_id: d.fund_id ?? null, fund_type: d.fund_type ?? null })
      // A receipt settled in several modes opens with its split. Re-issuing it
      // from the single-mode fields turned 400 cash + 1,000 cheque into one
      // 1,400 cheque, and the cash book lost the 400.
      const tenders = Array.isArray(d.payments) ? d.payments : []
      if (tenders.length > 1) {
        setSplitMode(true)
        setPayRows(tenders.map((p: { payment_mode: string; amount_paise: number; reference_no?: string | null; payment_account_id?: string | null }) => ({
          payment_mode: p.payment_mode,
          amount: String(Number(p.amount_paise) / 100),
          reference_no: p.reference_no ?? '',
          payment_account_id: p.payment_account_id ?? '',
        })))
      }
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
  // Only the CASH part counts against the ₹2,000 limit — the API decides it
  // that way, so ₹1,000 cash + ₹9,000 UPI stays eligible. Derived, not written
  // into the form: switching the mode back to UPI brings the tick back.
  const cashPartPaise = splitMode
    ? cashPaise(payRows)
    : form.payment_mode === 'cash' ? parsePaise(form.amount || '0') : 0
  const cashOver80gLimit = cashPartPaise > CASH_80G_LIMIT_PAISE

  const selectedCategory = categories.find(c => c.id === form.category_id)
  // Where this gift will be filed. Correcting under the same category keeps
  // the original's fund; a new or changed category takes the category's.
  const keepsOriginalFund = !!original && form.category_id === original.category_id
  const fundId = keepsOriginalFund ? original!.fund_id : (selectedCategory?.fund_id ?? null)
  const fund = fundId ? funds.find(f => f.id === fundId) : undefined
  const fundType = keepsOriginalFund ? (original!.fund_type ?? 'general') : (fund?.fund_type ?? 'general')

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
        is_80g_eligible: form.is_80g_eligible && !panBlocked && !temple80gBlocked && !cashOver80gLimit,
        // No fund_id / fund_type: the API takes them from the category (a new
        // gift) or from the original (a correction under the same category).
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
        // Each row carries its own mode, account and reference. The single-mode
        // fields are hidden in this state and none of them is sent: the
        // account in particular used to ride along and the API gave it to
        // every row left on "Default account" — UPI money in Cash in Hand.
        payload.payments = toPayload(payRows)
        payload.payment_mode = payRows[0]?.payment_mode ?? form.payment_mode
      } else {
        if (form.payment_account_id) payload.payment_account_id = form.payment_account_id
        if (form.utr_number) payload.utr_number = form.utr_number
        if (form.cheque_number) payload.cheque_number = form.cheque_number
      }
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

  const isCash = form.payment_mode === 'cash'
  const relevantAccounts = accounts.filter(a => a.type === (isCash ? 'cash' : 'bank'))
  const fundTypeLabel = fundType === 'corpus'
    ? t('donations.fundCorpus')
    : fundType === 'specific' ? t('donations.fundSpecific') : t('donations.fundGeneral')

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

          {/* Category — the only classification the counter makes. */}
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
            {/* Said, not asked. Only when the gift goes somewhere other than
                general income — that is the case a cashier should notice. */}
            {form.category_id && (fund || fundType !== 'general') && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500" data-testid="donation-fund-hint">
                <Landmark size={13} className="mt-px shrink-0 text-slate-400" />
                <span>
                  {fund
                    ? t('donations.goesToFund', { fund: fund.name, type: fundTypeLabel })
                    : t('donations.filedAs', { type: fundTypeLabel })}
                  {fundType === 'corpus' && <span className="block text-slate-400">{t('donations.fundCorpusHint')}</span>}
                </span>
              </p>
            )}
          </div>

          {/* Amount + payment. With split on, the rows below ARE the payment:
              the single mode / account boxes go away rather than sitting there
              meaning nothing. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="donation-amount" className="form-label">{t('donations.amountLabel')}</label>
              <input id="donation-amount" type="number" min="1" step="0.01" className="form-input" placeholder="0.00"
                value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            {!splitMode && (
              <div>
                <label htmlFor="payment-mode" className="form-label">{t('donations.paymentModeLabel')}</label>
                <select id="payment-mode" className="form-select" value={form.payment_mode}
                  onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value, payment_account_id: '' }))}>
                  {paymentModes.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
                </select>
              </div>
            )}
            {!splitMode && relevantAccounts.length > 0 && (
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

          <SplitPaymentToggle
            enabled={splitMode} onEnabledChange={setSplitMode}
            rows={payRows} onRowsChange={setPayRows}
            totalPaise={parsePaise(form.amount || '0')}
            seedMode={form.payment_mode} seedAmount={form.amount}
            seedRef={form.utr_number || form.cheque_number}
            seedAccountId={form.payment_account_id}
          />

          {/* UTR / Cheque — single-mode only; split rows carry their own reference. */}
          {!splitMode && (form.payment_mode === 'upi' || form.payment_mode === 'netbanking' || form.payment_mode === 'online') && (
            <div>
              <label className="form-label">{t('donations.utrNumber')}</label>
              <input className="form-input" placeholder={t('ui.transactionReference')} value={form.utr_number}
                onChange={e => setForm(f => ({ ...f, utr_number: e.target.value }))} />
            </div>
          )}
          {!splitMode && form.payment_mode === 'cheque' && (
            <div>
              <label className="form-label">{t('donations.chequeNumber')}</label>
              <input className="form-input" placeholder={t('ui.chequeNumber')} value={form.cheque_number}
                onChange={e => setForm(f => ({ ...f, cheque_number: e.target.value }))} />
            </div>
          )}

          {/* Event-updates consent. Deliberately unticked by default and hidden
              for anonymous donations: donating is not consent to be contacted,
              and the donor has to be asked out loud at the counter.
              Switched off for now (founder request, 2026-09-17): set
              SHOW_EVENT_UPDATES_CONSENT back to true to restore it. An edited
              donation that already has consent still sends it (see submit). */}
          {SHOW_EVENT_UPDATES_CONSENT && !devotee?.is_anonymous && (
            <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <input type="checkbox" id="wants_updates" checked={form.wants_event_updates}
                onChange={e => setForm(f => ({ ...f, wants_event_updates: e.target.checked }))}
                className="mt-0.5 w-4 h-4 accent-green-600" />
              <label htmlFor="wants_updates" className="text-sm text-slate-700">{t('ui.wantsUpdates')}<span className="block text-xs text-slate-500">{t('ui.askBeforeTicking')}</span>
              </label>
            </div>
          )}

          {/* 80G toggle */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <input type="checkbox" id="is_80g" checked={form.is_80g_eligible && !devotee?.is_anonymous && !panBlocked && !temple80gBlocked && !cashOver80gLimit}
                onChange={e => setForm(f => ({ ...f, is_80g_eligible: e.target.checked }))}
                disabled={!!devotee?.is_anonymous || !selectedCategory?.is_80g_eligible || cashOver80gLimit || panBlocked || temple80gBlocked}
                className="w-4 h-4 accent-green-600" />
              <label htmlFor="is_80g" className="text-sm text-slate-700">
                {t('donations.eightyGEligible')}
                {temple80gBlocked && (
                  <span className="text-orange-500 ml-2 text-xs">{t('donations.templeNo80g')}</span>
                )}
                {devotee?.is_anonymous && (
                  <span className="text-orange-500 ml-2 text-xs">{t('donations.anonymousNo80g')}</span>
                )}
                {!devotee?.is_anonymous && cashOver80gLimit && (
                  <span className="text-orange-500 ml-2 text-xs" data-testid="cash-80g-warning">{t('donations.cashLimitNo80g')}</span>
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
