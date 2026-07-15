import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { api, fmtPaise } from '../../../lib/api'
import type { HallBooking } from '../../../types'

export function HallBookingsList() {
  const { t } = useTranslation()
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
    if (s === 'confirmed') return <span className="badge-blue">{t('dharamshala.statusConfirmed')}</span>
    if (s === 'completed') return <span className="badge-green">{t('dharamshala.statusCompleted')}</span>
    return <span className="badge-red">{t('dharamshala.statusCancelled')}</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('dharamshala.hallTitle')}</h1>
        <button onClick={() => navigate('/hall/add')} className="btn-primary btn-sm">
          <Plus size={14} /> {t('dharamshala.newBooking')}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-600">{t('dharamshala.date')}</label>
        <input type="date" className="form-input w-44" value={dateFilter}
          onChange={e => setDateFilter(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('dharamshala.event')}</th>
                <th>{t('dharamshala.hall')}</th>
                <th>{t('common.date')}</th>
                <th>{t('dharamshala.session')}</th>
                <th>{t('dharamshala.total')}</th>
                <th>{t('dharamshala.advance')}</th>
                <th>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">{t('dharamshala.noHallBookings')}</td></tr>
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
