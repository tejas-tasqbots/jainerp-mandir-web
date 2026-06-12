import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, X } from 'lucide-react'
import { api, parsePaise } from '../../../lib/api'
import type { Room } from '../../../types'

export function AddRoomCheckin() {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<Room[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    room_id: '',
    guest_name: '',
    guest_mobile: '',
    guest_id_type: 'aadhaar',
    check_in_date: new Date().toISOString().slice(0, 10),
    check_out_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    persons_count: '1',
    advance: '',
    payment_mode: 'cash',
  })

  useEffect(() => {
    api.get('/rooms?is_available=true').then(r => setRooms(r.data.data || []))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.room_id) { setError('Select a room'); return }
    if (!form.guest_name) { setError('Enter guest name'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/room-bookings', {
        room_id: form.room_id,
        guest_name: form.guest_name,
        guest_mobile: form.guest_mobile,
        guest_id_type: form.guest_id_type,
        check_in_date: form.check_in_date,
        check_out_date: form.check_out_date,
        persons_count: parseInt(form.persons_count),
        advance_paise: form.advance ? parsePaise(form.advance) : 0,
        payment_mode: form.payment_mode,
      })
      navigate('/rooms')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to create booking')
    } finally {
      setSaving(false)
    }
  }

  const selectedRoom = rooms.find(r => r.id === form.room_id)

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-navy-900">New Room Booking</h1>
        <button onClick={() => navigate('/rooms')} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <div>
            <label className="form-label">Room *</label>
            <select className="form-select" value={form.room_id}
              onChange={e => setForm(f => ({ ...f, room_id: e.target.value }))}>
              <option value="">Select available room...</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>
                  {r.room_number} — {r.room_type} ({r.capacity} persons) — ₹{(r.tariff_per_night_paise/100).toLocaleString('en-IN')}/night
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Guest Name *</label>
              <input className="form-input" placeholder="Full name" value={form.guest_name}
                onChange={e => setForm(f => ({ ...f, guest_name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Mobile Number</label>
              <input type="tel" className="form-input" placeholder="10-digit mobile" value={form.guest_mobile}
                onChange={e => setForm(f => ({ ...f, guest_mobile: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="form-label">Check-In Date *</label>
              <input type="date" className="form-input" value={form.check_in_date}
                onChange={e => setForm(f => ({ ...f, check_in_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Check-Out Date *</label>
              <input type="date" className="form-input" value={form.check_out_date}
                onChange={e => setForm(f => ({ ...f, check_out_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Persons</label>
              <input type="number" min="1" max={selectedRoom?.capacity || 10} className="form-input"
                value={form.persons_count} onChange={e => setForm(f => ({ ...f, persons_count: e.target.value }))} />
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
              </select>
            </div>
          </div>

          {selectedRoom && form.check_in_date && form.check_out_date && (
            <div className="bg-blue-50 rounded-md p-3 text-sm">
              <p className="text-blue-800 font-medium">Booking Summary</p>
              <p className="text-blue-600 mt-1">
                {Math.max(0, Math.ceil((new Date(form.check_out_date).getTime() - new Date(form.check_in_date).getTime()) / 86400000))} nights
                × ₹{(selectedRoom.tariff_per_night_paise/100).toLocaleString('en-IN')} = ₹{((Math.max(0, Math.ceil((new Date(form.check_out_date).getTime() - new Date(form.check_in_date).getTime()) / 86400000)) * selectedRoom.tariff_per_night_paise) / 100).toLocaleString('en-IN')}
              </p>
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/rooms')} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? 'Saving...' : 'Confirm Booking'}
          </button>
        </div>
      </form>
    </div>
  )
}
