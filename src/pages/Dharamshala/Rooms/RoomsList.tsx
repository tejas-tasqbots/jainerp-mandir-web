import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { api, fmtPaise } from '../../../lib/api'
import type { RoomBooking } from '../../../types'
import { useConfirm } from '../../../components/ConfirmDialog'

export function RoomsList() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [bookings, setBookings] = useState<RoomBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [cancelModal, setCancelModal] = useState<{ id: string; guestName: string } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => { load() }, [statusFilter])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const { data } = await api.get(`/room-bookings?${params}`)
      setBookings(data.data || [])
    } catch {
      setBookings([])
    } finally {
      setLoading(false)
    }
  }

  function statusBadge(s: string) {
    if (s === 'booked' || s === 'confirmed') return <span className="badge-blue">Booked</span>
    if (s === 'checked_in') return <span className="badge-green">Checked In</span>
    if (s === 'checked_out') return <span className="badge-gray">Checked Out</span>
    return <span className="badge-red">Cancelled</span>
  }

  async function checkin(id: string) {
    if (!(await confirm({ title: 'Confirm check-in', message: 'Confirm check-in for this booking?', confirmLabel: 'Check in' }))) return
    try {
      await api.patch(`/room-bookings/${id}/checkin`, {})
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      alert(err.response?.data?.error?.message || 'Check-in failed')
    }
  }

  async function checkout(id: string) {
    if (!(await confirm({ title: 'Confirm check-out', message: 'Confirm check-out for this booking?', confirmLabel: 'Check out' }))) return
    try {
      await api.patch(`/room-bookings/${id}/checkout`, {})
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      alert(err.response?.data?.error?.message || 'Check-out failed')
    }
  }

  async function confirmCancel() {
    if (!cancelModal) return
    setCancelling(true)
    try {
      await api.patch(`/room-bookings/${cancelModal.id}/cancel`, { reason: cancelReason || undefined })
      setCancelModal(null)
      setCancelReason('')
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      alert(err.response?.data?.error?.message || 'Cancellation failed')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Dharamshala — Rooms</h1>
        <button onClick={() => navigate('/rooms/checkin')} className="btn-primary btn-sm">
          <Plus size={14} /> New Booking
        </button>
      </div>

      <div className="flex gap-2">
        {['all', 'confirmed', 'checked_in', 'checked_out', 'cancelled'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize ${statusFilter === s ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {s === 'all' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Guest</th>
                <th>Room</th>
                <th>Check-In</th>
                <th>Check-Out</th>
                <th>Persons</th>
                <th>Advance</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">No bookings found</td></tr>
              ) : bookings.map(b => (
                <tr key={b.id}>
                  <td>
                    <p className="font-medium">{b.guest_name}</p>
                    <p className="text-xs text-slate-400">{b.guest_mobile}</p>
                  </td>
                  <td className="text-slate-600">{b.room_number || b.room_id}</td>
                  <td className="text-xs">{new Date(b.check_in_date).toLocaleDateString('en-IN')}</td>
                  <td className="text-xs">{new Date(b.check_out_date).toLocaleDateString('en-IN')}</td>
                  <td className="text-center">{b.persons_count}</td>
                  <td>₹{fmtPaise(b.advance_paise)}</td>
                  <td className={b.balance_paise > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
                    ₹{fmtPaise(b.balance_paise)}
                  </td>
                  <td>{statusBadge(b.status)}</td>
                  <td>
                    <div className="flex gap-1">
                      {(b.status === 'confirmed' || b.status === 'booked') && (
                        <button onClick={() => checkin(b.id)} className="btn-success btn-sm">Check-In</button>
                      )}
                      {b.status === 'checked_in' && (
                        <button onClick={() => checkout(b.id)} className="btn-secondary btn-sm">Check-Out</button>
                      )}
                      {(b.status === 'confirmed' || b.status === 'booked') && (
                        <button
                          onClick={() => setCancelModal({ id: b.id, guestName: b.guest_name })}
                          className="p-1 text-slate-400 hover:text-brand-red rounded"
                          title="Cancel booking"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cancel confirmation modal */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">Cancel Booking</h3>
            <p className="text-sm text-slate-500 mb-4">
              Cancel booking for <span className="font-semibold text-navy-900">{cancelModal.guestName}</span>?
            </p>
            <div className="mb-4">
              <label className="form-label">Reason (optional)</label>
              <input className="form-input" value={cancelReason}
                onChange={e => setCancelReason(e.target.value)} placeholder="e.g. Guest request, no-show..." />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setCancelModal(null); setCancelReason('') }} className="btn-secondary">Keep Booking</button>
              <button onClick={confirmCancel} disabled={cancelling} className="btn-danger">
                {cancelling ? 'Cancelling...' : 'Cancel Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
