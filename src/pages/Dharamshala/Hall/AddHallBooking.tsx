import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, X } from 'lucide-react'
import { api, parsePaise } from '../../../lib/api'
import type { Hall } from '../../../types'

export function AddHallBooking() {
  const navigate = useNavigate()
  const [halls, setHalls] = useState<Hall[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    hall_id: '',
    event_name: '',
    booking_date: new Date().toISOString().slice(0, 10),
    session_type: 'full_day',
    advance: '',
    payment_mode: 'cash',
    contact_name: '',
    contact_mobile: '',
  })

  useEffect(() => {
    api.get('/halls').then(r => setHalls(r.data.data || []))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.hall_id) { setError('Select a hall'); return }
    if (!form.event_name) { setError('Enter event name'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/hall-bookings', {
        hall_id: form.hall_id,
        event_name: form.event_name,
        booking_date: form.booking_date,
        session_type: form.session_type,
        advance_paise: form.advance ? parsePaise(form.advance) : 0,
        payment_mode: form.payment_mode,
        contact_name: form.contact_name,
        contact_mobile: form.contact_mobile,
      })
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
        <h1 className="text-xl font-bold text-navy-900">New Hall Booking</h1>
        <button onClick={() => navigate('/hall')} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <div>
            <label className="form-label">Hall *</label>
            <select className="form-select" value={form.hall_id}
              onChange={e => setForm(f => ({ ...f, hall_id: e.target.value }))}>
              <option value="">Select hall...</option>
              {halls.map(h => (
                <option key={h.id} value={h.id}>{h.name} (capacity: {h.capacity})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">Event Name *</label>
            <input className="form-input" placeholder="Function / event name" value={form.event_name}
              onChange={e => setForm(f => ({ ...f, event_name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Booking Date *</label>
              <input type="date" className="form-input" value={form.booking_date}
                onChange={e => setForm(f => ({ ...f, booking_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Session</label>
              <select className="form-select" value={form.session_type}
                onChange={e => setForm(f => ({ ...f, session_type: e.target.value }))}>
                <option value="morning">Morning (6AM–12PM)</option>
                <option value="evening">Evening (12PM–8PM)</option>
                <option value="full_day">Full Day</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Contact Name</label>
              <input className="form-input" placeholder="Organizer name" value={form.contact_name}
                onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Contact Mobile</label>
              <input type="tel" className="form-input" placeholder="Mobile number" value={form.contact_mobile}
                onChange={e => setForm(f => ({ ...f, contact_mobile: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Advance Amount (₹)</label>
              <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00"
                value={form.advance} onChange={e => setForm(f => ({ ...f, advance: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Payment Mode</label>
              <select className="form-select" value={form.payment_mode}
                onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/hall')} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? 'Saving...' : 'Confirm Booking'}
          </button>
        </div>
      </form>
    </div>
  )
}
