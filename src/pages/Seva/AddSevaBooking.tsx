import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, X } from 'lucide-react'
import { api, parsePaise, fmtPaise } from '../../lib/api'
import type { Seva } from '../../types'

export function AddSevaBooking() {
  const navigate = useNavigate()
  const [sevas, setSevas] = useState<Seva[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    seva_id: '',
    devotee_name: '',
    devotee_mobile: '',
    gotra: '',
    sankalp_names: '',
    booking_date: new Date().toISOString().slice(0, 10),
    slot_time: '',
    amount: '',
    payment_mode: 'cash',
  })

  useEffect(() => {
    api.get('/sevas?is_active=true').then(r => setSevas(r.data.data || []))
  }, [])

  const selectedSeva = sevas.find(s => s.id === form.seva_id)
  useEffect(() => {
    if (selectedSeva) setForm(f => ({ ...f, amount: String(selectedSeva.price_paise / 100) }))
  }, [form.seva_id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.seva_id) { setError('Select a seva'); return }
    if (!form.devotee_name) { setError('Enter devotee name'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/seva-bookings', {
        seva_id: form.seva_id,
        devotee_name: form.devotee_name,
        devotee_mobile: form.devotee_mobile,
        gotra: form.gotra || undefined,
        sankalp_names: form.sankalp_names || undefined,
        booking_date: form.booking_date,
        slot_time: form.slot_time || undefined,
        amount_paise: parsePaise(form.amount),
        payment_mode: form.payment_mode,
      })
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
        <h1 className="text-xl font-bold text-navy-900">New Seva Booking</h1>
        <button onClick={() => navigate('/seva')} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <div>
            <label className="form-label">Seva / Pooja *</label>
            <select className="form-select" value={form.seva_id}
              onChange={e => setForm(f => ({ ...f, seva_id: e.target.value }))}>
              <option value="">Select seva...</option>
              {sevas.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} — ₹{fmtPaise(s.price_paise)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Devotee Name *</label>
              <input className="form-input" placeholder="Full name" value={form.devotee_name}
                onChange={e => setForm(f => ({ ...f, devotee_name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Mobile Number</label>
              <input type="tel" className="form-input" placeholder="10-digit mobile" value={form.devotee_mobile}
                onChange={e => setForm(f => ({ ...f, devotee_mobile: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Gotra</label>
              <input className="form-input" placeholder="Gotra (if required)" value={form.gotra}
                onChange={e => setForm(f => ({ ...f, gotra: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Sankalp / Names</label>
              <input className="form-input" placeholder="Names for sankalp" value={form.sankalp_names}
                onChange={e => setForm(f => ({ ...f, sankalp_names: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Booking Date *</label>
              <input type="date" className="form-input" value={form.booking_date}
                onChange={e => setForm(f => ({ ...f, booking_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Slot Time</label>
              <input type="time" className="form-input" value={form.slot_time}
                onChange={e => setForm(f => ({ ...f, slot_time: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Amount (₹) *</label>
              <input type="number" min="1" step="0.01" className="form-input" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Payment Mode</label>
              <select className="form-select" value={form.payment_mode}
                onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="online">Online (Prepaid)</option>
              </select>
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/seva')} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? 'Saving...' : 'Book Seva'}
          </button>
        </div>
      </form>
    </div>
  )
}
