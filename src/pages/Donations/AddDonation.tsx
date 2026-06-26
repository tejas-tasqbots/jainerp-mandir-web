import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, X } from 'lucide-react'
import { api, parsePaise } from '../../lib/api'
import { printDonationReceipt } from '../../lib/printReceipt'
import { useAccounts, usePaymentModes, autoSelectAccount } from '../../lib/useDropdownOptions'
import { DevoteePicker } from '../../components/DevoteePicker/DevoteePicker'
import type { DonationCategory, DevoteeSelection } from '../../types'

export function AddDonation() {
  const navigate = useNavigate()
  const paymentModes = usePaymentModes()
  const accounts = useAccounts()
  const [categories, setCategories] = useState<DonationCategory[]>([])
  const [devotee, setDevotee] = useState<DevoteeSelection | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    category_id: '',
    amount: '',
    payment_mode: 'cash',
    payment_account_id: '',
    utr_number: '',
    cheque_number: '',
    is_80g_eligible: true,
    note: '',
  })

  useEffect(() => {
    api.get('/donation-categories', { params: { is_active: 'true' } }).then(r => setCategories(r.data.data || []))
  }, [])

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.category_id) { setError('Select a donation category'); return }
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Enter valid amount'); return }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        category_id: form.category_id,
        amount_paise: parsePaise(form.amount),
        payment_mode: form.payment_mode,
        is_80g_eligible: form.is_80g_eligible,
      }

      if (devotee?.is_anonymous) {
        payload.is_anonymous = true
        if (devotee.anonymous_category) payload.anonymous_category = devotee.anonymous_category
      } else if (devotee?.global_user_id) {
        payload.donor = { global_user_id: devotee.global_user_id, name: devotee.name, mobile: devotee.mobile }
      } else if (devotee?.name) {
        payload.donor = { name: devotee.name, mobile: devotee.mobile }
      }

      if (form.payment_account_id) payload.payment_account_id = form.payment_account_id
      if (form.utr_number) payload.utr_number = form.utr_number
      if (form.cheque_number) payload.cheque_number = form.cheque_number
      if (form.note) payload.note = form.note

      const { data } = await api.post('/donations', payload)
      const donationId = data.data?.id
      navigate('/donations')
      if (donationId) {
        setTimeout(() => printDonationReceipt(donationId).catch(() => {}), 300)
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
        <h1 className="text-xl font-bold text-navy-900">New Donation</h1>
        <button onClick={() => navigate('/donations')} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          {/* Devotee / Donor picker */}
          <DevoteePicker
            label="Donor"
            value={devotee}
            onChange={setDevotee}
            showAnonymous
            showDanPeti
          />

          {/* Category */}
          <div>
            <label className="form-label">Donation Category *</label>
            <select className="form-select" value={form.category_id}
              onChange={e => {
                const cat = categories.find(c => c.id === e.target.value)
                setForm(f => ({ ...f, category_id: e.target.value, is_80g_eligible: cat?.is_80g_eligible ?? true }))
              }}>
              <option value="">Select category...</option>
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
                  <label className="form-label">Amount (₹) *</label>
                  <input type="number" min="1" step="0.01" className="form-input" placeholder="0.00"
                    value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Payment Mode *</label>
                  <select className="form-select" value={form.payment_mode}
                    onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value, payment_account_id: '' }))}>
                    {paymentModes.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
                  </select>
                </div>
                {relevantAccounts.length > 0 && (
                  <div className="col-span-2">
                    <label className="form-label">Received in Account *</label>
                    <select className="form-select" value={form.payment_account_id}
                      onChange={e => setForm(f => ({ ...f, payment_account_id: e.target.value }))}>
                      <option value="">Select account…</option>
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

          {/* UTR / Cheque */}
          {(form.payment_mode === 'upi' || form.payment_mode === 'netbanking' || form.payment_mode === 'online') && (
            <div>
              <label className="form-label">UTR Number</label>
              <input className="form-input" placeholder="Transaction reference" value={form.utr_number}
                onChange={e => setForm(f => ({ ...f, utr_number: e.target.value }))} />
            </div>
          )}
          {form.payment_mode === 'cheque' && (
            <div>
              <label className="form-label">Cheque Number</label>
              <input className="form-input" placeholder="Cheque number" value={form.cheque_number}
                onChange={e => setForm(f => ({ ...f, cheque_number: e.target.value }))} />
            </div>
          )}

          {/* 80G toggle */}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="is_80g" checked={form.is_80g_eligible && !devotee?.is_anonymous}
              onChange={e => setForm(f => ({ ...f, is_80g_eligible: e.target.checked }))}
              disabled={!!devotee?.is_anonymous || !selectedCategory?.is_80g_eligible || (form.payment_mode === 'cash' && parseFloat(form.amount) > 2000)}
              className="w-4 h-4 accent-green-600" />
            <label htmlFor="is_80g" className="text-sm text-slate-700">
              80G Eligible donation
              {devotee?.is_anonymous && (
                <span className="text-orange-500 ml-2 text-xs">(Anonymous / Dan Peti gifts are not 80G eligible)</span>
              )}
              {!devotee?.is_anonymous && form.payment_mode === 'cash' && parseFloat(form.amount) > 2000 && (
                <span className="text-orange-500 ml-2 text-xs">(Cash &gt;₹2,000 is not 80G eligible)</span>
              )}
            </label>
          </div>

          {/* Note */}
          <div>
            <label className="form-label">Note <span className="text-slate-400 font-normal">(optional)</span></label>
            <textarea className="form-textarea" rows={2} placeholder="Any additional notes..."
              value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/donations')} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? 'Saving...' : 'Save & Print Receipt'}
          </button>
        </div>
      </form>
    </div>
  )
}
