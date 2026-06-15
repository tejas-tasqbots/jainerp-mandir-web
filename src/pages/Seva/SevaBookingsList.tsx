import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import type { SevaBooking } from '../../types'

export function SevaBookingsList() {
  const navigate = useNavigate()
  const [bookings, setBookings] = useState<SevaBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10))
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => { load() }, [dateFilter, statusFilter])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ date: dateFilter, limit: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const { data } = await api.get(`/seva-bookings?${params}`)
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

  async function markCompleted(id: string) {
    await api.patch(`/seva-bookings/${id}`, { status: 'completed' })
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Seva Bookings</h1>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm"><Download size={14} /> Export PDF</button>
          <button onClick={() => navigate('/seva/add')} className="btn-primary btn-sm">
            <Plus size={14} /> New Booking
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-600">Date:</label>
        <input type="date" className="form-input w-44" value={dateFilter}
          onChange={e => setDateFilter(e.target.value)} />
        <div className="flex gap-2 ml-4">
          {['all', 'confirmed', 'completed'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs rounded-md font-medium capitalize transition-colors ${statusFilter === s ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Devotee</th>
                <th>Seva</th>
                <th>Date</th>
                <th>Slot</th>
                <th>Amount</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">No seva bookings for this date</td></tr>
              ) : bookings.map(b => (
                <tr key={b.id}>
                  <td>
                    <p className="font-medium">{b.devotee_name}</p>
                    <p className="text-xs text-slate-400">{b.devotee_mobile}</p>
                    {b.gotra && <p className="text-xs text-slate-300">Gotra: {b.gotra}</p>}
                  </td>
                  <td className="text-slate-700">{b.seva_name || '—'}</td>
                  <td className="text-xs">{new Date(b.booking_date).toLocaleDateString('en-IN')}</td>
                  <td className="text-slate-500 text-xs">{b.slot_time || '—'}</td>
                  <td className="font-semibold">₹{fmtPaise(b.amount_paise)}</td>
                  <td><span className="badge-gray">{b.payment_mode}</span></td>
                  <td>{statusBadge(b.status)}</td>
                  <td>
                    {b.status === 'confirmed' && (
                      <button onClick={() => markCompleted(b.id)} className="btn-success btn-sm">
                        Mark Done
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
