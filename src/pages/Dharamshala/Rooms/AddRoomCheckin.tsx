import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, X } from 'lucide-react'
import { api, parsePaise } from '../../../lib/api'
import { DevoteePicker } from '../../../components/DevoteePicker/DevoteePicker'
import type { Room, DevoteeSelection } from '../../../types'

export function AddRoomCheckin() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<Room[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [guest, setGuest] = useState<DevoteeSelection | null>(null)

  const [form, setForm] = useState({
    room_id: '',
    guest_id_type: 'aadhaar',
    check_in_date: new Date().toISOString().slice(0, 10),
    check_out_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    persons_count: '1',
    advance: '',
    payment_mode: 'cash',
  })

  useEffect(() => {
    api.get('/rooms?is_available=true').then(r => {
      const list = r.data.data || []
      setRooms(list)
      // Arriving from the availability board: ?room_id=… pre-selects it, so
      // the cashier doesn't have to find the number again in the dropdown.
      const wanted = new URLSearchParams(window.location.search).get('room_id')
      if (wanted && list.some((rm: Room) => rm.id === wanted)) {
        setForm(f => ({ ...f, room_id: wanted }))
      }
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.room_id) { setError('Select a room'); return }
    if (!guest?.name && !guest?.global_user_id) { setError('Enter guest name'); return }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        room_id: form.room_id,
        guest_id_type: form.guest_id_type,
        check_in_date: form.check_in_date,
        check_out_date: form.check_out_date,
        persons_count: parseInt(form.persons_count),
        advance_paise: form.advance ? parsePaise(form.advance) : 0,
        payment_mode: form.payment_mode,
      }

      if (guest?.global_user_id) {
        payload.guest = { global_user_id: guest.global_user_id, name: guest.name, mobile: guest.mobile }
      } else if (guest?.name) {
        payload.guest = { name: guest.name, mobile: guest.mobile }
      }

      await api.post('/room-bookings', payload)
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
        <h1 className="text-xl font-bold text-navy-900">{t('dharamshala.newRoomBooking')}</h1>
        <button onClick={() => navigate('/rooms')} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <div>
            <label className="form-label">{t('dharamshala.roomLabel')}</label>
            <select className="form-select" value={form.room_id}
              onChange={e => setForm(f => ({ ...f, room_id: e.target.value }))}>
              <option value="">{t('dharamshala.selectAvailableRoom')}</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>
                  {r.room_number} — {r.room_type} ({r.capacity} persons) — ₹{(r.tariff_per_night_paise/100).toLocaleString('en-IN')}/night
                </option>
              ))}
            </select>
          </div>

          <DevoteePicker
            label={t('dharamshala.guestLabel')}
            value={guest}
            onChange={setGuest}
            showAnonymous={false}
            required
          />

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="form-label">{t('dharamshala.checkInDate')}</label>
              <input type="date" className="form-input" value={form.check_in_date}
                onChange={e => setForm(f => ({ ...f, check_in_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('dharamshala.checkOutDate')}</label>
              <input type="date" className="form-input" value={form.check_out_date}
                onChange={e => setForm(f => ({ ...f, check_out_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('dharamshala.personsLabel')}</label>
              <input type="number" min="1" max={selectedRoom?.capacity || 10} className="form-input"
                value={form.persons_count} onChange={e => setForm(f => ({ ...f, persons_count: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('dharamshala.advanceAmount')}</label>
              <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00"
                value={form.advance} onChange={e => setForm(f => ({ ...f, advance: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('dharamshala.paymentMode')}</label>
              <select className="form-select" value={form.payment_mode}
                onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                <option value="cash">{t('common.cash')}</option>
                <option value="upi">{t('common.upi')}</option>
              </select>
            </div>
          </div>

          {selectedRoom && form.check_in_date && form.check_out_date && (
            <div className="bg-blue-50 rounded-md p-3 text-sm">
              <p className="text-blue-800 font-medium">{t('dharamshala.bookingSummary')}</p>
              <p className="text-blue-600 mt-1">
                {t('dharamshala.nightsSummary', {
                  nights: Math.max(0, Math.ceil((new Date(form.check_out_date).getTime() - new Date(form.check_in_date).getTime()) / 86400000)),
                  tariff: (selectedRoom.tariff_per_night_paise/100).toLocaleString('en-IN'),
                  total: ((Math.max(0, Math.ceil((new Date(form.check_out_date).getTime() - new Date(form.check_in_date).getTime()) / 86400000)) * selectedRoom.tariff_per_night_paise) / 100).toLocaleString('en-IN'),
                })}
              </p>
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/rooms')} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? t('common.saving') : t('dharamshala.confirmBooking')}
          </button>
        </div>
      </form>
    </div>
  )
}
