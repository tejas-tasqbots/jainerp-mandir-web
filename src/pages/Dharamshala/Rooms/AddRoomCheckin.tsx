import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, X } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../../lib/api'
import { DevoteePicker } from '../../../components/DevoteePicker/DevoteePicker'
import type { Room, DevoteeSelection } from '../../../types'

export function AddRoomCheckin() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<Room[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [guest, setGuest] = useState<DevoteeSelection | null>(null)

  // Lazy initializer: this object was rebuilt on every render even though only
  // the first one is ever used, and it calls Date.now() to do it.
  const [form, setForm] = useState(() => ({
    room_id: '',
    guest_id_type: 'aadhaar',
    check_in_date: new Date().toISOString().slice(0, 10),
    check_out_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    persons_count: '1',
    advance: '',
    payment_mode: 'cash',
    id_proof_number: '',
    deposit: '',
  }))

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

      // The document is stored encrypted (tenant-migration 033); only the last
      // four digits are ever shown again. Sent inside `guest` because that is
      // where DharamshalaService.resolveGuest reads it from — the top-level
      // `guest_id_type` this form used to send reached nothing.
      const idFields = {
        id_proof_type: form.guest_id_type,
        id_proof_number: form.id_proof_number.trim() || null,
      }
      if (guest?.global_user_id) {
        payload.guest = { global_user_id: guest.global_user_id, name: guest.name, mobile: guest.mobile, ...idFields }
      } else if (guest?.name) {
        payload.guest = { name: guest.name, mobile: guest.mobile, ...idFields }
      }

      const { data: created } = await api.post('/room-bookings', payload)
      // A security deposit is not part of the bill, so it is a separate call.
      // The booking already exists by this point: if the deposit fails the
      // cashier is told, and can take it from the rooms list, rather than
      // losing the booking they just made.
      const bookingId = created?.data?.id ?? created?.id
      const depositPaise = form.deposit ? parsePaise(form.deposit) : 0
      if (bookingId && depositPaise > 0) {
        try {
          await api.post(`/room-bookings/${bookingId}/deposit`, {
            amount_paise: depositPaise,
            payment_mode: form.payment_mode,
          })
        } catch {
          setError(t('dharamshala.depositNotTaken'))
          setSaving(false)
          return
        }
      }
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
              {/* The room's name, not `room_type`: no screen writes that
                  column, so it is `non_ac` for every room (RoomAvailability). */}
              {rooms.map(r => (
                <option key={r.id} value={r.id}>
                  {r.room_number}{r.name?.trim() ? ` — ${r.name.trim()}` : ''} (sleeps {r.capacity_persons}) — ₹{fmtPaise(r.tariff_paise)}/night
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="form-label" htmlFor="id-type">{t('dharamshala.idType')}</label>
              <select
                id="id-type" className="form-select" value={form.guest_id_type}
                onChange={e => setForm(f => ({ ...f, guest_id_type: e.target.value }))}
              >
                <option value="aadhaar">{t('dharamshala.idAadhaar')}</option>
                <option value="pan">{t('dharamshala.idPan')}</option>
                <option value="passport">{t('dharamshala.idPassport')}</option>
                <option value="voter_id">{t('dharamshala.idVoter')}</option>
                <option value="driving_license">{t('dharamshala.idDl')}</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="id-number">{t('dharamshala.idNumber')}</label>
              <input
                id="id-number" className="form-input" value={form.id_proof_number}
                onChange={e => setForm(f => ({ ...f, id_proof_number: e.target.value }))}
                placeholder={form.guest_id_type === 'aadhaar' ? '1234 5678 9012' : ''}
                inputMode={form.guest_id_type === 'aadhaar' ? 'numeric' : 'text'}
                autoComplete="off"
              />
              <p className="text-xs text-slate-500 mt-1">{t('dharamshala.idStoredHint')}</p>
            </div>
            <div>
              <label className="form-label" htmlFor="deposit">{t('dharamshala.securityDeposit')}</label>
              <input
                id="deposit" className="form-input" inputMode="decimal" value={form.deposit}
                onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))}
                placeholder="0"
              />
              <p className="text-xs text-slate-500 mt-1">{t('dharamshala.depositHint')}</p>
            </div>
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
              {/* The room's real capacity. The old fallback of 10 applied to
                  every room because `capacity` was never sent, so a clerk could
                  book ten guests into a two-person room. */}
              <input type="number" min="1" max={selectedRoom?.capacity_persons ?? 20} className="form-input"
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
                  tariff: fmtPaise(selectedRoom.tariff_paise),
                  total: fmtPaise(
                    Math.max(0, Math.ceil((new Date(form.check_out_date).getTime() - new Date(form.check_in_date).getTime()) / 86400000)) * selectedRoom.tariff_paise,
                  ),
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
