import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, X } from 'lucide-react'
import { api, parsePaise } from '../../lib/api'

export function AddBoli() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    devotee_name: '',
    devotee_mobile: '',
    boli_type: 'aarti',
    description: '',
    pledged_amount: '',
    pledge_date: new Date().toISOString().slice(0, 10),
    due_date: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.devotee_name) { setError('Enter devotee name'); return }
    if (!form.pledged_amount || parseFloat(form.pledged_amount) <= 0) { setError('Enter valid pledged amount'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/bolis', {
        devotee_name: form.devotee_name,
        devotee_mobile: form.devotee_mobile || undefined,
        boli_type: form.boli_type,
        description: form.description || undefined,
        pledged_amount_paise: parsePaise(form.pledged_amount),
        pledge_date: form.pledge_date,
        due_date: form.due_date || undefined,
      })
      navigate('/boli')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to save boli')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-navy-900">New Boli (Pledge)</h1>
        <button onClick={() => navigate('/boli')} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Devotee Name *</label>
              <input className="form-input" value={form.devotee_name}
                onChange={e => setForm(f => ({ ...f, devotee_name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Mobile Number</label>
              <input type="tel" className="form-input" value={form.devotee_mobile}
                onChange={e => setForm(f => ({ ...f, devotee_mobile: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Boli Type</label>
              <select className="form-select" value={form.boli_type}
                onChange={e => setForm(f => ({ ...f, boli_type: e.target.value }))}>
                <option value="aarti">Aarti</option>
                <option value="pratistha">Pratistha</option>
                <option value="seva">Seva</option>
                <option value="chadhava">Chadhava</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="form-label">Pledged Amount (₹) *</label>
              <input type="number" min="1" step="0.01" className="form-input" value={form.pledged_amount}
                onChange={e => setForm(f => ({ ...f, pledged_amount: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="form-label">Description</label>
            <input className="form-input" placeholder="e.g. Paryushan first-day aarti" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Pledge Date</label>
              <input type="date" className="form-input" value={form.pledge_date}
                onChange={e => setForm(f => ({ ...f, pledge_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Due Date <span className="text-slate-400 font-normal">(optional)</span></label>
              <input type="date" className="form-input" value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/boli')} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? 'Saving...' : 'Save Boli'}
          </button>
        </div>
      </form>
    </div>
  )
}
