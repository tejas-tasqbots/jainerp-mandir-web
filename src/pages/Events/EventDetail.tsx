import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Send } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import type { Event, EventRegistration } from '../../types'

export function EventDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [registrations, setRegistrations] = useState<EventRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [announcing, setAnnouncing] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [showAnnounce, setShowAnnounce] = useState(false)

  useEffect(() => { if (id) load() }, [id])

  async function load() {
    setLoading(true)
    try {
      const [evResp, regResp] = await Promise.allSettled([
        api.get(`/events/${id}`),
        api.get(`/events/${id}/registrations`),
      ])
      if (evResp.status === 'fulfilled') setEvent(evResp.value.data.data)
      if (regResp.status === 'fulfilled') setRegistrations(regResp.value.data.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function announce() {
    if (!announcement.trim()) return
    setAnnouncing(true)
    try {
      await api.post(`/events/${id}/announce`, { message: announcement, channels: ['push', 'sms'] })
      setAnnouncement('')
      setShowAnnounce(false)
      alert('Announcement sent!')
    } catch {
      alert('Failed to send announcement')
    } finally {
      setAnnouncing(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-cta border-t-transparent rounded-full animate-spin" /></div>
  if (!event) return <div className="text-center py-20 text-slate-400">Event not found</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/events')} className="btn-icon"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold text-navy-900">{event.name}</h1>
        <span className={`${event.status === 'completed' ? 'badge-green' : event.status === 'executing' ? 'badge-yellow' : 'badge-blue'}`}>
          {event.status}
        </span>
        <div className="flex-1" />
        <button onClick={() => setShowAnnounce(!showAnnounce)} className="btn-secondary btn-sm">
          <Send size={14} /> Announce
        </button>
      </div>

      {showAnnounce && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Send Announcement</h3></div>
          <div className="card-body space-y-3">
            <textarea className="form-textarea" rows={3} placeholder="Announcement message..."
              value={announcement} onChange={e => setAnnouncement(e.target.value)} />
            <div className="flex gap-3">
              <button onClick={announce} disabled={announcing || !announcement.trim()} className="btn-primary btn-sm">
                <Send size={14} /> {announcing ? 'Sending...' : 'Send Now'}
              </button>
              <button onClick={() => setShowAnnounce(false)} className="btn-secondary btn-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <div className="card-body py-3">
            <p className="text-xs text-slate-400">Start Date</p>
            <p className="font-semibold">{new Date(event.start_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        <div className="card">
          <div className="card-body py-3">
            <p className="text-xs text-slate-400">End Date</p>
            <p className="font-semibold">{new Date(event.end_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        <div className="card">
          <div className="card-body py-3">
            <p className="text-xs text-slate-400">Budget</p>
            <p className="font-semibold">{event.estimated_budget_paise ? `₹${fmtPaise(event.estimated_budget_paise)}` : 'Not set'}</p>
          </div>
        </div>
      </div>

      {event.allow_registration && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-sm text-navy-900">Registrations</h3>
            <span className="badge-blue">{registrations.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Mobile</th><th>Attendees</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {registrations.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-6 text-slate-400">No registrations yet</td></tr>
                ) : registrations.map(r => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.registrant_name}</td>
                    <td>{r.mobile}</td>
                    <td className="text-center">{r.attendee_count}</td>
                    <td>{r.amount_paise ? `₹${fmtPaise(r.amount_paise)}` : '—'}</td>
                    <td><span className={r.status === 'attended' ? 'badge-green' : r.status === 'cancelled' ? 'badge-red' : 'badge-blue'}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
