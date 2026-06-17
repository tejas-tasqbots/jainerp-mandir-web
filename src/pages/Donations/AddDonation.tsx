import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, X, Search } from 'lucide-react'
import { api, parsePaise } from '../../lib/api'
import type { DonationCategory, Donor } from '../../types'

export function AddDonation() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState<DonationCategory[]>([])
  const [donors, setDonors] = useState<Donor[]>([])
  const [donorSearch, setDonorSearch] = useState('')
  const [showDonorDropdown, setShowDonorDropdown] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    donor_id: '',
    donor_name: '',
    donor_mobile: '',
    category_id: '',
    amount: '',
    payment_mode: 'cash',
    utr_number: '',
    cheque_number: '',
    is_80g_eligible: true,
    note: '',
  })

  useEffect(() => {
    api.get('/donations/categories').then(r => setCategories(r.data.data || []))
  }, [])

  useEffect(() => {
    if (donorSearch.length < 2) { setDonors([]); return }
    const t = setTimeout(async () => {
      const { data } = await api.get(`/donors?q=${encodeURIComponent(donorSearch)}&limit=8`)
      setDonors(data.data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [donorSearch])

  // Auto-check 80G: cash > ₹2000 = not eligible
  useEffect(() => {
    const amt = parseFloat(form.amount)
    if (form.payment_mode === 'cash' && amt > 2000) {
      setForm(f => ({ ...f, is_80g_eligible: false }))
    }
  }, [form.amount, form.payment_mode])

  function selectDonor(d: Donor) {
    setForm(f => ({ ...f, donor_id: d.id, donor_name: d.name, donor_mobile: d.mobile }))
    setDonorSearch(d.name)
    setShowDonorDropdown(false)
  }

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
      if (form.donor_id) payload.donor_id = form.donor_id
      else {
        payload.donor_name = form.donor_name
        payload.donor_mobile = form.donor_mobile
      }
      if (form.utr_number) payload.utr_number = form.utr_number
      if (form.cheque_number) payload.cheque_number = form.cheque_number
      if (form.note) payload.note = form.note

      const { data } = await api.post('/donations', payload)
      if (data.data?.receipt_cdn_url) window.open(data.data.receipt_cdn_url, '_blank')
      navigate('/donations')
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
          {/* Donor */}
          <div>
            <label className="form-label">Donor <span className="text-slate-400 font-normal">(optional)</span></label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="form-input pl-9"
                placeholder="Search by name or mobile..."
                value={donorSearch}
                onChange={e => { setDonorSearch(e.target.value); setShowDonorDropdown(true); if (!e.target.value) setForm(f => ({ ...f, donor_id: '', donor_name: '', donor_mobile: '' })) }}
                onFocus={() => setShowDonorDropdown(true)}
              />
              {showDonorDropdown && donors.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {donors.map(d => (
                    <button key={d.id} type="button" onClick={() => selectDonor(d)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                      <span className="font-medium">{d.name}</span>
                      <span className="text-slate-400 ml-2">{d.mobile}</span>
                      {d.city && <span className="text-slate-400 ml-2">• {d.city}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!form.donor_id && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <input className="form-input" placeholder="Donor name" value={form.donor_name}
                  onChange={e => setForm(f => ({ ...f, donor_name: e.target.value }))} />
                <input className="form-input" placeholder="Mobile (optional)" value={form.donor_mobile}
                  onChange={e => setForm(f => ({ ...f, donor_mobile: e.target.value }))} />
              </div>
            )}
          </div>

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

          {/* Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Amount (₹) *</label>
              <input type="number" min="1" step="0.01" className="form-input" placeholder="0.00"
                value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Payment Mode *</label>
              <select className="form-select" value={form.payment_mode}
                onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="cheque">Cheque</option>
                <option value="netbanking">Net Banking</option>
                <option value="online">Online</option>
              </select>
            </div>
          </div>

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
            <input type="checkbox" id="is_80g" checked={form.is_80g_eligible}
              onChange={e => setForm(f => ({ ...f, is_80g_eligible: e.target.checked }))}
              disabled={!selectedCategory?.is_80g_eligible || (form.payment_mode === 'cash' && parseFloat(form.amount) > 2000)}
              className="w-4 h-4 accent-green-600" />
            <label htmlFor="is_80g" className="text-sm text-slate-700">
              80G Eligible donation
              {form.payment_mode === 'cash' && parseFloat(form.amount) > 2000 && (
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
