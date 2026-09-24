import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Camera, Plus, Save, Trash2, X } from 'lucide-react'
import { api, fmtPaise, parsePaise, todayIst, istDayAfter } from '../../../lib/api'
import { DevoteePicker } from '../../../components/DevoteePicker/DevoteePicker'
import { recipientGstin } from '../../../lib/statutoryIds'
import { compressIdImage } from '../../../lib/idImage'
import type { Room, DevoteeSelection } from '../../../types'
import { fetchAllPages } from '../../../lib/fetchAllPages'
import { ExtraChargesEditor } from '../../../components/RoomCharges/ExtraChargesEditor'
import { chargesPayload, chargesTotalPaise, type ChargeRow } from '../../../components/RoomCharges/chargeRows'

/**
 * Is housekeeping holding this room for the date being booked?
 *
 * Mirrors the API gate exactly (dharamshala.service.ts `availability`): a hold
 * is about today. A room dirty this morning is fine for a stay next week.
 */
function heldByHousekeeping(room: Room, checkInDate: string): boolean {
  const status = room.housekeeping_status
  if (!status || status === 'ready') return false
  const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
  return String(checkInDate).slice(0, 10) <= todayIst
}

/** One ID handed over at the counter: whose, which, the number, the photo. */
interface IdRow {
  key: number
  holder_name: string
  id_type: string
  id_number: string
  image: string | null
}

let idRowSeq = 0
function newIdRow(): IdRow {
  idRowSeq += 1
  return { key: idRowSeq, holder_name: '', id_type: 'aadhaar', id_number: '', image: null }
}

export function AddRoomCheckin() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<Room[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [guest, setGuest] = useState<DevoteeSelection | null>(null)
  // Every ID handed over at the counter (tenant migrations 055/056): a family
  // or a group shares one booking and gives one ID each, so this is a list,
  // each row naming whose ID it is. Starts with one empty row; a row left
  // blank is simply not sent ("no ID yet" is allowed).
  const [idRows, setIdRows] = useState<IdRow[]>(() => [newIdRow()])
  const setRow = (key: number, patch: Partial<IdRow>) =>
    setIdRows(rows => rows.map(r => (r.key === key ? { ...r, ...patch } : r)))
  // Most temple trusts are NOT GST-registered, and a recipient's GSTIN is
  // meaningless on a bill that carries no tax - the trust has no standing to
  // issue a tax invoice at all (s.31 CGST). So the field is not merely optional
  // for them, it is noise at the counter, and it stays hidden.
  const [gstRegistered, setGstRegistered] = useState(false)

  // Lazy initializer: this object was rebuilt on every render even though only
  // the first one is ever used, and it calls Date.now() to do it.
  // Several rooms for one guest in one booking ("Room Book Multiple at time
  // with one Guest Name"). The first is `form.room_id`; these follow it, and
  // the API books them as one group with one combined bill.
  const [moreRooms, setMoreRooms] = useState<string[]>([])
  const [charges, setCharges] = useState<ChargeRow[]>([])
  const [form, setForm] = useState(() => ({
    room_id: '',
    remarks: '',
    check_in_date: todayIst(),
    check_out_date: istDayAfter(todayIst()),
    // Pre-filled from the trust's policy below. A booking has always had two
    // DATES and no times, so "rooms from 12, vacate by 10" lived on a board in
    // the lobby and the bill could state neither (tenant migration 043).
    check_in_time: '12:00',
    check_out_time: '10:00',
    persons_count: '1',
    advance: '',
    payment_mode: 'cash',
    guest_gstin: '',
    deposit: '',
  }))

  // Validated as the counter types. The same rule the API applies on submit
  // (recipientGstin, shared), so the clerk is never told a number is fine and
  // then refused - and a mistyped GSTIN is caught while the guest is still at
  // the window rather than after they have gone.
  const gstinCheck = recipientGstin(gstRegistered ? form.guest_gstin : '')
  const gstinError = gstRegistered && form.guest_gstin.trim() ? (gstinCheck.error ?? null) : null

  // The trust's own check-in/checkout times. Failing to load them is not worth
  // an error: the form keeps the 12:00/10:00 defaults, which is what the
  // migration defaults the columns to anyway.
  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = r.data?.data ?? r.data ?? {}
      // `is_gst_registered` is the flag; a GSTIN on file without it is a trust
      // that entered the number and has not turned GST on, and its receipts
      // carry no tax either way.
      setGstRegistered(Boolean(p.is_gst_registered) && Boolean(String(p.gstin ?? '').trim()))
      setForm(f => ({
        ...f,
        check_in_time: String(p.default_checkin_time ?? f.check_in_time).slice(0, 5),
        check_out_time: String(p.default_checkout_time ?? f.check_out_time).slice(0, 5),
      }))
    }).catch(() => { /* keep the defaults */ })
  }, [])

  useEffect(() => {
    // EVERY room, page by page. This asked for one page with no limit, which
    // the API answers with the first 50 - so a dharamshala with more rooms than
    // that could not book room 51 onward from this form at all.
    fetchAllPages<Room>('/rooms', { is_available: 'true' }).then(list => {
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
    // A malformed GSTIN stops the booking rather than being dropped silently.
    // Dropping it would produce a room bill that looks complete and is not a
    // valid tax invoice for the company that just paid for the room.
    if (gstinError) { setError(gstinError); return }
    const idDocuments = idRows
      .filter(r => r.id_number.trim() || r.image)
      .map(r => ({
        id_type: r.id_type,
        id_number: r.id_number.trim() || null,
        // Blank = the booking's own guest, named so the register never shows
        // an ID without an owner.
        holder_name: r.holder_name.trim() || guest?.name || null,
        image: r.image,
      }))
    // Each photo is shrunk to ~0.2-1.4 MB, and the request carries them all.
    const photoChars = idDocuments.reduce((s, d) => s + (d.image?.length ?? 0), 0)
    if (photoChars > 8_500_000) { setError(t('guestId.tooManyPhotos')); return }
    setSaving(true)
    setError('')
    try {
      const roomIds = [form.room_id, ...moreRooms.filter(id => id && id !== form.room_id)]
      const payload: Record<string, unknown> = {
        room_ids: roomIds,
        // Extra bed, food, other charges - each on the room it is for.
        charges: chargesPayload(charges),
        ...(form.remarks.trim() ? { remarks: form.remarks.trim() } : {}),
        // Validated by the API before the booking is made, so one bad ID
        // refuses the booking instead of filing half of them.
        id_documents: idDocuments,
        check_in_date: form.check_in_date,
        check_out_date: form.check_out_date,
        check_in_time: form.check_in_time,
        check_out_time: form.check_out_time,
        persons_count: parseInt(form.persons_count),
        advance_paise: form.advance ? parsePaise(form.advance) : 0,
        payment_mode: form.payment_mode,
      }

      // The IDs travel as `id_documents` above; only the GSTIN rides with the guest.
      const idFields = {
        // Normalised, not as typed: the API stores what it is given, and
        // "27aaatr1234c1z0" on an invoice is not a GSTIN anybody can look up.
        gstin: gstinCheck.gstin,
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
  const bookedRooms = [form.room_id, ...moreRooms].map(id => rooms.find(r => r.id === id)).filter(Boolean) as Room[]
  const roomLabel = (r: Room) => `${r.building?.trim() ? `${r.building.trim()} · ` : ''}${r.room_number}`
  const stayNights = Math.max(0, Math.ceil((new Date(form.check_out_date).getTime() - new Date(form.check_in_date).getTime()) / 86400000))
  const roomsPaise = bookedRooms.reduce((s, r) => s + stayNights * Number(r.tariff_paise), 0)
  const extrasPaise = chargesTotalPaise(charges)

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
              {/* A room housekeeping is holding is shown and disabled rather
                  than hidden: the cashier looking for room 104 needs to be told
                  it is being cleaned, not left wondering where it went. Dated
                  like the API gate - the hold only blocks a stay starting
                  today, so a booking for next week may still use it. */}
              {rooms.map(r => {
                const held = heldByHousekeeping(r, form.check_in_date)
                return (
                  <option key={r.id} value={r.id} disabled={held}>
                    {r.building?.trim() ? `${r.building.trim()} · ` : ''}{r.room_number}{r.name?.trim() ? ` — ${r.name.trim()}` : ''}
                    {' '}{t('dharamshala.sleepsN', { n: r.capacity_persons })} — ₹{fmtPaise(r.tariff_paise)}{t('dharamshala.perNightSuffix')}
                    {held ? ` — ${t(`housekeeping.status.${r.housekeeping_status}`)}` : ''}
                  </option>
                )
              })}
            </select>
            {/* More rooms for the same guest. Picked one at a time from the rooms
                not yet taken; each shows as a chip that can be removed. */}
            {form.room_id && (
              <div className="mt-2 space-y-2" data-testid="more-rooms">
                {moreRooms.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {moreRooms.map(id => {
                      const r = rooms.find(x => x.id === id)
                      return r ? (
                        <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-sm text-blue-800" data-testid="more-room">
                          {roomLabel(r)} · ₹{fmtPaise(r.tariff_paise)}
                          <button type="button" className="text-blue-400 hover:text-brand-red" aria-label={t('dharamshala.removeRoom')}
                            onClick={() => setMoreRooms(ids => ids.filter(x => x !== id))}><X size={13} /></button>
                        </span>
                      ) : null
                    })}
                  </div>
                )}
                <select className="form-select" value="" aria-label={t('dharamshala.addAnotherRoom')} data-testid="add-room"
                  onChange={e => { const v = e.target.value; if (v) setMoreRooms(ids => [...ids, v]) }}>
                  <option value="">{t('dharamshala.addAnotherRoom')}</option>
                  {rooms.filter(r => r.id !== form.room_id && !moreRooms.includes(r.id) && !heldByHousekeeping(r, form.check_in_date)).map(r => (
                    <option key={r.id} value={r.id}>{roomLabel(r)}{r.name?.trim() ? ` — ${r.name.trim()}` : ''} — ₹{fmtPaise(r.tariff_paise)}{t('dharamshala.perNightSuffix')}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 space-y-3" data-testid="id-rows">
              <div className="flex items-baseline justify-between">
                <span className="form-label mb-0">{t('guestId.idsHeading', { count: idRows.length })}</span>
                <span className="text-xs text-slate-400">{t('guestId.laterHint')}</span>
              </div>
              {idRows.map((row, i) => (
                <div key={row.key} className="rounded-lg border border-slate-200 p-3 space-y-2" data-testid="id-row">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="form-label" htmlFor={`id-holder-${row.key}`}>{t('guestId.holderName')}</label>
                      <input
                        id={`id-holder-${row.key}`} className="form-input" value={row.holder_name}
                        onChange={e => setRow(row.key, { holder_name: e.target.value })}
                        placeholder={i === 0 ? (guest?.name || t('guestId.holderPlaceholder')) : t('guestId.holderPlaceholder')}
                        maxLength={120} autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor={`id-type-${row.key}`}>{t('dharamshala.idType')}</label>
                      <select
                        id={`id-type-${row.key}`} className="form-select" value={row.id_type}
                        onChange={e => setRow(row.key, { id_type: e.target.value, id_number: '' })}
                      >
                        <option value="aadhaar">{t('dharamshala.idAadhaar')}</option>
                        <option value="pan">{t('dharamshala.idPan')}</option>
                        <option value="passport">{t('dharamshala.idPassport')}</option>
                        <option value="voter_id">{t('dharamshala.idVoter')}</option>
                        <option value="driving_license">{t('dharamshala.idDl')}</option>
                        <option value="other">{t('guestId.types.other')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label" htmlFor={`id-number-${row.key}`}>{t('dharamshala.idNumber')}</label>
                      <input
                        id={`id-number-${row.key}`} className="form-input" value={row.id_number}
                        onChange={e => setRow(row.key, { id_number: e.target.value })}
                        placeholder={row.id_type === 'aadhaar' ? 'XXXX XXXX 1234' : ''}
                        inputMode={row.id_type === 'aadhaar' ? 'numeric' : 'text'}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  {row.id_type === 'aadhaar' && (
                    <p className="text-xs text-amber-700">{t('guestId.aadhaarHint')}</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="btn-secondary btn-sm inline-flex cursor-pointer">
                      <Camera size={14} /> {row.image ? t('guestId.retake') : t('guestId.addPhoto')}
                      <input
                        type="file" accept="image/*" className="hidden" data-testid="id-photo"
                        onChange={async e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          try { setRow(row.key, { image: await compressIdImage(file) }) } catch { setError(t('guestId.photoFailed')) }
                        }}
                      />
                    </label>
                    {row.image && <span className="text-xs text-green-700">{t('guestId.photoAttached')}</span>}
                    {idRows.length > 1 && (
                      <button
                        type="button" className="ml-auto p-1 text-slate-400 hover:text-brand-red rounded"
                        onClick={() => setIdRows(rows => rows.filter(r => r.key !== row.key))}
                        title={t('guestId.removeRow')} aria-label={t('guestId.removeRow')}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {idRows.length < 12 && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => setIdRows(rows => [...rows, newIdRow()])}>
                  <Plus size={14} /> {t('guestId.addAnother')}
                </button>
              )}
              <p className="text-xs text-slate-500">{t('dharamshala.idStoredHint')}</p>
            </div>
            {/* CGST Rule 46(e): the recipient's GSTIN. Optional, because most
                guests are individuals who have none — but without it a company
                sending staff cannot claim input tax credit on the invoice, and
                there was previously nowhere to put it at all.

                Validated as you type rather than on submit: a GSTIN is fifteen
                characters of state code, PAN and check digit, and finding out
                it was mistyped after the guest has walked away is too late. */}
            {gstRegistered && <div>
              <label className="form-label" htmlFor="guest-gstin">{t('dharamshala.guestGstin')}</label>
              <input
                id="guest-gstin" className="form-input" value={form.guest_gstin}
                onChange={e => setForm(f => ({ ...f, guest_gstin: e.target.value.toUpperCase() }))}
                placeholder="27AAATR1234C1Z0"
                maxLength={15}
                autoComplete="off"
                spellCheck={false}
              />
              <p className={`text-xs mt-1 ${gstinError ? 'text-red-600' : 'text-slate-500'}`}>
                {gstinError || t('dharamshala.guestGstinHint')}
              </p>
            </div>}
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

          {/* Date AND time. The times are stated on the bill, which is what the
              client asked for — and a guest arriving at 2:30 pm and leaving at
              10 am was previously recorded as "19 Sep to 21 Sep", which
              settles no argument about a late checkout. */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="form-label">{t('dharamshala.checkInDate')}</label>
              <input type="date" className="form-input" value={form.check_in_date}
                onChange={e => setForm(f => ({ ...f, check_in_date: e.target.value }))} />
              <input
                type="time" className="form-input mt-1.5" data-testid="check-in-time"
                aria-label={t('dharamshala.checkInTime')}
                value={form.check_in_time}
                onChange={e => setForm(f => ({ ...f, check_in_time: e.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">{t('dharamshala.checkOutDate')}</label>
              <input type="date" className="form-input" value={form.check_out_date}
                onChange={e => setForm(f => ({ ...f, check_out_date: e.target.value }))} />
              <input
                type="time" className="form-input mt-1.5" data-testid="check-out-time"
                aria-label={t('dharamshala.checkOutTime')}
                value={form.check_out_time}
                onChange={e => setForm(f => ({ ...f, check_out_time: e.target.value }))}
              />
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

          {/* Extras taken with the booking - an extra bed for the third
              person, food - and anything the counter wants on record. */}
          <div>
            <p className="form-label">{t('roomCharges.heading')}</p>
            <ExtraChargesEditor rows={charges} onChange={setCharges} nights={stayNights}
              rooms={bookedRooms.map(r => ({ id: r.id, label: roomLabel(r) }))} />
          </div>
          <div>
            <label className="form-label" htmlFor="booking-remarks">{t('dharamshala.remarks')}</label>
            <textarea id="booking-remarks" className="form-textarea" rows={2} maxLength={1000}
              placeholder={t('dharamshala.remarksPlaceholder')}
              value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>

          {selectedRoom && form.check_in_date && form.check_out_date && (
            <div className="bg-blue-50 rounded-md p-3 text-sm" data-testid="booking-summary">
              <p className="text-blue-800 font-medium">{t('dharamshala.bookingSummary')}</p>
              {bookedRooms.map(r => (
                <p key={r.id} className="text-blue-600 mt-1">
                  {bookedRooms.length > 1 ? `${roomLabel(r)}: ` : ''}
                  {t('dharamshala.nightsSummary', {
                    nights: stayNights, tariff: fmtPaise(r.tariff_paise), total: fmtPaise(stayNights * Number(r.tariff_paise)),
                  })}
                </p>
              ))}
              {extrasPaise > 0 && <p className="text-blue-600 mt-1">{t('roomCharges.extrasTotal', { amount: fmtPaise(extrasPaise) })}</p>}
              {(bookedRooms.length > 1 || extrasPaise > 0) && (
                <p className="text-blue-800 font-semibold mt-1">{t('dharamshala.beforeTaxTotal', { amount: fmtPaise(roomsPaise + extrasPaise) })}</p>
              )}
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
