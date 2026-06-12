import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api, fmtPaise } from '../../../lib/api'
import type { HallBooking } from '../../../types'

export function HallBookingsList() {
  const navigate = useNavigate()
  const [bookings, setBookings] = useState<HallBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => { load() }, [dateFilter])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/hall-bookings?date=${dateFilter}&limit=50`)
      setBookings(data.data || [])
    } catch {
      setBookings([])
    } finally {
      setLoading(false)
    }
  }

  function statusBadge(s: string) {
    if (s === 'confirmed') return <span className="badge-blue">Confirmed</span>
    if (s === 'completed') return <span className="badge-green">Completed</span>
    return <span className="badge-red">Cancelled</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Hall Bookings</h1>
        <button onClick={() => navigate('/hall/add')} className="btn-primary btn-sm">
          <Plus size={14} /> New Booking
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-600">Date:</label>
        <input type="date" className="form-input w-44" value={dateFilter}
          onChange={e => setDateFilter(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Hall</th>
                <th>Date</th>
                <th>Session</th>
                <th>Total</th>
                <th>Advance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">No hall bookings for this date</td></tr>
              ) : bookings.map(b => (
                <tr key={b.id}>
                  <td className="font-medium">{b.event_name}</td>
                  <td className="text-slate-600">{b.hall_name || '—'}</td>
                  <td className="text-xs">{new Date(b.booking_date).toLocaleDateString('en-IN')}</td>
                  <td><span className="badge-blue capitalize">{b.session_type.replace('_', ' ')}</span></td>
                  <td className="font-semibold">₹{fmtPaise(b.total_paise)}</td>
                  <td>₹{fmtPaise(b.advance_paise)}</td>
                  <td>{statusBadge(b.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
