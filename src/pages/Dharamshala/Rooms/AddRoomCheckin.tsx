import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PaymentFields, emptyPayment, needsReference, type PaymentFieldsValue } from '../../../components/PaymentFields'
import { usePaymentModes } from '../../../lib/useDropdownOptions'
import { printDepositReceipt } from '../../../lib/printVoucher'
import { Camera, Plus, Save, Trash2, X } from 'lucide-react'
import { api, fmtPaise, parsePaise, todayIst, istDayAfter } from '../../../lib/api'
import { DevoteePicker } from '../../../components/DevoteePicker/DevoteePicker'
import { isWellFormedGstin, recipientGstin } from '../../../lib/statutoryIds'
import { compressIdImage } from '../../../lib/idImage'
import type { Room, DevoteeSelection } from '../../../types'
import { RoomPicker, type PickerRoom } from './RoomPicker'
import { ExtraChargesEditor } from '../../../components/RoomCharges/ExtraChargesEditor'
import { chargesPayload, chargesTotalPaise, type ChargeRow } from '../../../components/RoomCharges/chargeRows'
import { useFormDraft } from '../../../lib/formDraft'
import { DraftBar } from '../../../components/kit/DraftBar'

/** The night before `day` (YYYY-MM-DD), for the last night of a stay. */
function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
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

/**
 * A draft from an earlier day comes back starting today, for as many nights
 * as it had: a stay cannot begin in the past, and a check-in date of
 * yesterday would otherwise sit unnoticed until the API refused it.
 */
function freshDates<F extends { check_in_date: string; check_out_date: string }>(f: F): F {
  const today = todayIst()
  if (!f.check_in_date || f.check_in_date >= today) return f
  const nights = Math.max(1, Math.round((Date.parse(`${f.check_out_date}T00:00:00Z`) - Date.parse(`${f.check_in_date}T00:00:00Z`)) / 86_400_000) || 1)
  const out = new Date(Date.parse(`${today}T00:00:00Z`) + nights * 86_400_000).toISOString().slice(0, 10)
  return { ...f, check_in_date: today, check_out_date: out }
}

/** An empty booking form. */
function blankStay() {
  return {
    room_id: '',
    remarks: '',
    check_in_date: todayIst(),
    check_out_date: istDayAfter(todayIst()),
    check_in_time: '12:00',
    check_out_time: '10:00',
    persons_count: '1',
    advance: '',
    guest_gstin: '',
    deposit: '',
  }
}

export function AddRoomCheckin() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<PickerRoom[]>([])
  // The window the rooms on screen were fetched for; loading until it matches.
  const [roomsFor, setRoomsFor] = useState('')
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
  // How the advance and the deposit were paid: mode, the account it reached,
  // and the UTR / cheque number for anything but cash. The form offered Cash
  // or UPI and nothing else, so a UPI advance could not say which payment it
  // was (2026-10-08).
  const [payment, setPayment] = useState<PaymentFieldsValue>(emptyPayment())
  const paymentModes = usePaymentModes()
  const [form, setForm] = useState(() => blankStay())
  // A rate other than the Rooms master's, for every room of this booking, and
  // why (tenant migration 072). Blank = the price list. The API enforces the
  // trust's price control; the field is hidden where prices are fixed.
  const [rateOverride, setRateOverride] = useState('')
  const [rateReason, setRateReason] = useState('')

  // A half-made booking survives being left (lib/formDraft). Identity
  // documents are NOT kept: Aadhaar numbers and ID photos do not belong in
  // browser storage, so they are taken again (the bar says so).
  const restored = useRef(false)
  const wantedTaken = useRef(false)
  // The form as last rendered, for the rooms request that resolves after a
  // draft was put back (its closure still holds the blank first form).
  const formRef = useRef(form)
  useEffect(() => { formRef.current = form })
  const draft = useFormDraft('room-booking', { form, guest, moreRooms, charges, payment }, d => {
    restored.current = true
    setForm(freshDates({ ...blankStay(), ...d.form })); setGuest(d.guest ?? null); setMoreRooms(d.moreRooms ?? [])
    setCharges(d.charges ?? []); setPayment(d.payment ?? emptyPayment())
  }, d => !d.form.room_id && !d.guest && !d.form.advance && !d.form.deposit && !d.form.remarks.trim() && !d.charges.length && !d.moreRooms.length)
  function resetForm() {
    setForm(blankStay()); setGuest(null); setMoreRooms([]); setCharges([]); setPayment(emptyPayment()); setIdRows([newIdRow()]); setError('')
  }

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
      // Same test the API charges GST by (a well-formed GSTIN), so the form
      // never hides the guest GSTIN on a bill that will carry tax, or the reverse.
      setGstRegistered(isWellFormedGstin(p.gstin))
      // Not over a restored draft: its times are the ones the clerk chose.
      if (restored.current) return
      setForm(f => ({
        ...f,
        check_in_time: String(p.default_checkin_time ?? f.check_in_time).slice(0, 5),
        check_out_time: String(p.default_checkout_time ?? f.check_out_time).slice(0, 5),
      }))
    }).catch(() => { /* keep the defaults */ })
  }, [])

  // Every room WITH its verdict for this stay's nights, from the availability
  // board's own endpoint: a room booked, occupied or held for these dates is
  // shown as such instead of being offered and then refused with a 409. The
  // window is the nights slept - arrival to the night before departure - and it
  // is asked again whenever the dates change. (It was every room from
  // GET /rooms, with no idea of the dates.)
  const lastNight = form.check_out_date > form.check_in_date ? dayBefore(form.check_out_date) : form.check_in_date
  useEffect(() => {
    let live = true
    api.get('/rooms/availability', { params: { from: form.check_in_date, to: lastNight } }).then(r => {
      if (!live) return
      const list: PickerRoom[] = r.data?.data ?? r.data ?? []
      setRooms(list)
      // Arriving from the availability board: ?room_id=… pre-selects it, so
      // the cashier doesn't have to find the number again.
      const wanted = new URLSearchParams(window.location.search).get('room_id')
      if (wanted && !wantedTaken.current && list.some(rm => rm.id === wanted)) {
        // Once: a room the clerk later takes off must not come back on a date change.
        wantedTaken.current = true
        // With a restored draft holding other rooms, the clicked one joins them
        // rather than being ignored.
        const current = formRef.current.room_id
        if (current && current !== wanted) {
          setMoreRooms(m => (m.includes(wanted) ? m : [...m, wanted]))
        } else {
          setForm(f => (f.room_id ? f : { ...f, room_id: wanted }))
        }
      }
    }).catch(() => { /* the picker shows no rooms; the API still guards the booking */ })
      .finally(() => { if (live) setRoomsFor(`${form.check_in_date}|${lastNight}`) })
    return () => { live = false }
  }, [form.check_in_date, lastNight])
  const roomsLoading = roomsFor !== `${form.check_in_date}|${lastNight}`

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.room_id) { setError(t('msg.selectRoom')); return }
    if (!guest?.name && !guest?.global_user_id) { setError(t('msg.enterGuestName')); return }
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
    const moneyNow = (form.advance ? parsePaise(form.advance) : 0) + (form.deposit ? parsePaise(form.deposit) : 0)
    if (moneyNow > 0 && needsReference(paymentModes, payment.payment_mode) && !payment.reference_no.trim()) {
      setError(t('payroll.utrRequired'))
      return
    }
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
        payment_mode: payment.payment_mode,
        payment_account_id: payment.payment_account_id || null,
        utr_number: payment.reference_no.trim() || null,
        ...(rateOverride.trim() ? { tariff_per_night_paise: parsePaise(rateOverride), rate_reason: rateReason.trim() || undefined } : {}),
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
          const { data: dep } = await api.post(`/room-bookings/${bookingId}/deposit`, {
            amount_paise: depositPaise,
            payment_mode: payment.payment_mode,
            payment_account_id: payment.payment_account_id || null,
            utr_number: payment.reference_no.trim() || null,
          })
          // The receipt the guest keeps and hands back at checkout.
          const no = (dep?.data ?? dep)?.deposit_receipt_no
          printDepositReceipt(bookingId, no).catch(() => {})
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

  const selectedIds = [form.room_id, ...moreRooms].filter(Boolean)
  const setSelectedIds = (ids: string[]) => {
    setForm(f => ({ ...f, room_id: ids[0] ?? '' }))
    setMoreRooms(ids.slice(1))
  }
  const bookedRooms = selectedIds.map(id => rooms.find(r => r.id === id)).filter(Boolean) as Room[]
  const roomLabel = (r: Room) => `${r.building?.trim() ? `${r.building.trim()} · ` : ''}${r.room_number}`
  const stayNights = Math.max(0, Math.ceil((new Date(form.check_out_date).getTime() - new Date(form.check_in_date).getTime()) / 86400000))
  const roomsPaise = bookedRooms.reduce((s, r) => s + stayNights * (rateOverride.trim() ? parsePaise(rateOverride) : Number(r.tariff_paise)), 0)
  const extrasPaise = chargesTotalPaise(charges)
  const capacity = bookedRooms.reduce((s, r) => s + Number(r.capacity_persons || 0), 0)
  const hasAadhaar = idRows.some(r => r.id_type === 'aadhaar')

  // How the trust's stay policy reads these dates and times (tenant migration
  // 072), from the API's own calculator: an agreed late departure shows what
  // it will add at checkout BEFORE the booking is confirmed.
  const [quote, setQuote] = useState<{ mode: string; price_policy?: string; fees: { description: string; amount_paise: number }[]; explanation: string[] } | null>(null)
  const quotable = !!form.room_id && !!form.check_in_date && !!form.check_out_date && form.check_out_date > form.check_in_date
  useEffect(() => {
    if (!quotable) return
    const timer = setTimeout(() => {
      api.post('/room-bookings/quote', {
        room_id: form.room_id, from_date: form.check_in_date, to_date: form.check_out_date,
        check_in_time: form.check_in_time, check_out_time: form.check_out_time,
        ...(rateOverride.trim() ? { rate_paise: parsePaise(rateOverride) } : {}),
      }).then(r => setQuote(r.data.data)).catch(() => setQuote(null))
    }, 300)
    return () => clearTimeout(timer)
  }, [quotable, form.room_id, form.check_in_date, form.check_out_date, form.check_in_time, form.check_out_time, rateOverride])

  return (
    <div className="max-w-4xl pb-24">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-navy-900">{t('dharamshala.newRoomBooking')}</h1>
          <div className="mt-1">
            <DraftBar draft={draft} onDiscard={resetForm} note={t('drafts.idNotKept')} leaveTo="/rooms" />
          </div>
        </div>
        <button type="button" onClick={() => navigate('/rooms')} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
      </div>

      {/* One section per question the counter asks, in the order it asks them:
          who, which rooms and when, their IDs, any extras, and the money. The
          form used to open on the room and the IDs and ask for the guest halfway
          down, between the deposit and the dates. */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Section n={1} title={t('dharamshala.sectionGuest')}>
          <DevoteePicker label={t('dharamshala.guestLabel')} hideLabel noun="guest" value={guest} onChange={setGuest} showAnonymous={false} required />
          {/* CGST Rule 46(e): the recipient's GSTIN, only for a trust that can
              issue a tax invoice at all. Validated as it is typed. */}
          {gstRegistered && (
            <div className="max-w-sm">
              <label className="form-label" htmlFor="guest-gstin">{t('dharamshala.guestGstin')}</label>
              <input id="guest-gstin" className="form-input" value={form.guest_gstin} maxLength={15} autoComplete="off" spellCheck={false}
                onChange={e => setForm(f => ({ ...f, guest_gstin: e.target.value.toUpperCase() }))} placeholder="27AAATR1234C1Z0" />
              <p className={`text-xs mt-1 ${gstinError ? 'text-red-600' : 'text-slate-500'}`}>{gstinError || t('dharamshala.guestGstinHint')}</p>
            </div>
          )}
        </Section>

        <Section n={2} title={t('dharamshala.sectionStay')}>
          {/* A phone takes one date+time pair per line: two pairs side by
              side pushed the times off the screen. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            <div className="md:col-span-2">
              <label className="form-label" htmlFor="booking-check-in-date">{t('dharamshala.checkInDate')}</label>
              <div className="flex gap-2">
                <input id="booking-check-in-date" type="date" className="form-input min-w-0 flex-1" value={form.check_in_date}
                  onChange={e => setForm(f => ({ ...f, check_in_date: e.target.value }))} />
                <input type="time" className="form-input w-32" data-testid="check-in-time" aria-label={t('dharamshala.checkInTime')}
                  value={form.check_in_time} onChange={e => setForm(f => ({ ...f, check_in_time: e.target.value }))} />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="form-label" htmlFor="booking-check-out-date">{t('dharamshala.checkOutDate')}</label>
              <div className="flex gap-2">
                <input id="booking-check-out-date" type="date" className="form-input min-w-0 flex-1" value={form.check_out_date}
                  onChange={e => setForm(f => ({ ...f, check_out_date: e.target.value }))} />
                <input type="time" className="form-input w-32" data-testid="check-out-time" aria-label={t('dharamshala.checkOutTime')}
                  value={form.check_out_time} onChange={e => setForm(f => ({ ...f, check_out_time: e.target.value }))} />
              </div>
            </div>
            {quote?.price_policy !== 'fixed' && (
              <div data-testid="booking-rate-override" className="sm:col-span-full grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
                <div>
                  <label className="form-label" htmlFor="booking-rate">{t('stayCharge.bookingRate')}</label>
                  <input id="booking-rate" className="form-input" inputMode="decimal" value={rateOverride}
                    placeholder={t('stayCharge.bookingRatePlaceholder')} onChange={e => setRateOverride(e.target.value)} />
                </div>
                {rateOverride.trim() && (
                  <div>
                    <label className="form-label" htmlFor="booking-rate-reason">{t('stayCharge.reasonLabel')}</label>
                    <input id="booking-rate-reason" className="form-input" maxLength={300} value={rateReason} data-testid="booking-rate-reason"
                      placeholder={t('stayCharge.reasonPlaceholder')} onChange={e => setRateReason(e.target.value)} />
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="form-label" htmlFor="booking-persons">{t('dharamshala.personsLabel')}</label>
              {/* Not capped at the rooms' capacity: a family of five in two
                  rooms for two takes an extra bed, which is what the extras
                  price list is for. The form capped it and refused them. It
                  says so instead, and the clerk adds the bed below. */}
              <input id="booking-persons" type="number" min="1" max={99} className="form-input max-w-[10rem]"
                value={form.persons_count} onChange={e => setForm(f => ({ ...f, persons_count: e.target.value }))} />
              {capacity > 0 && Number(form.persons_count) > capacity && (
                <p className="form-hint text-amber-700" data-testid="over-capacity" role="status">
                  {t('dharamshala.overCapacity', { n: Number(form.persons_count), cap: capacity })}
                </p>
              )}
            </div>
          </div>
          <div>
            <p className="form-label">{t('dharamshala.roomsLabel')}</p>
            <RoomPicker rooms={rooms} selected={selectedIds} onChange={setSelectedIds}
              persons={Number(form.persons_count) || undefined} loading={roomsLoading} />
          </div>
        </Section>

        <Section n={3} title={t('guestId.idsHeading', { count: idRows.length })} hint={t('guestId.laterHint')}>
          <div className="space-y-2" data-testid="id-rows">
            {idRows.map((row, i) => (
              <div key={row.key} className="grid gap-2 md:grid-cols-[1.2fr_1fr_1.2fr_auto_auto] items-center rounded-lg border border-slate-200 p-2" data-testid="id-row">
                <input id={`id-holder-${row.key}`} className="form-input" value={row.holder_name} maxLength={120} autoComplete="off"
                  aria-label={t('guestId.holderName')}
                  onChange={e => setRow(row.key, { holder_name: e.target.value })}
                  placeholder={i === 0 && guest?.name ? guest.name : t('guestId.holderName')} />
                <select id={`id-type-${row.key}`} className="form-select" value={row.id_type} aria-label={t('dharamshala.idType')}
                  onChange={e => setRow(row.key, { id_type: e.target.value, id_number: '' })}>
                  <option value="aadhaar">{t('dharamshala.idAadhaar')}</option>
                  <option value="pan">{t('dharamshala.idPan')}</option>
                  <option value="passport">{t('dharamshala.idPassport')}</option>
                  <option value="voter_id">{t('dharamshala.idVoter')}</option>
                  <option value="driving_license">{t('dharamshala.idDl')}</option>
                  <option value="other">{t('guestId.types.other')}</option>
                </select>
                <input id={`id-number-${row.key}`} className="form-input" value={row.id_number} autoComplete="off"
                  aria-label={t('dharamshala.idNumber')}
                  onChange={e => setRow(row.key, { id_number: e.target.value })}
                  placeholder={row.id_type === 'aadhaar' ? 'XXXX XXXX 1234' : t('dharamshala.idNumber')}
                  inputMode={row.id_type === 'aadhaar' ? 'numeric' : 'text'} />
                <label className={`btn-sm inline-flex cursor-pointer whitespace-nowrap ${row.image ? 'btn-success' : 'btn-secondary'}`}
                  title={row.image ? t('guestId.photoAttached') : t('guestId.addPhoto')}>
                  <Camera size={14} /> {row.image ? t('guestId.photoAttached') : t('guestId.photo')}
                  <input type="file" accept="image/*" className="hidden" data-testid="id-photo"
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      try { setRow(row.key, { image: await compressIdImage(file) }) } catch { setError(t('guestId.photoFailed')) }
                    }} />
                </label>
                <button type="button" className="p-1.5 text-slate-400 hover:text-brand-red rounded disabled:invisible"
                  disabled={idRows.length === 1}
                  onClick={() => setIdRows(rows => rows.filter(r => r.key !== row.key))}
                  title={t('guestId.removeRow')} aria-label={t('guestId.removeRow')}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {idRows.length < 12 && (
                <button type="button" className="text-sm text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                  onClick={() => setIdRows(rows => [...rows, newIdRow()])}>
                  <Plus size={14} /> {t('guestId.addAnother')}
                </button>
              )}
              <span className="text-xs text-slate-500">{t('dharamshala.idStoredHint')}</span>
            </div>
            {/* Once, under the rows - not repeated in every Aadhaar row. */}
            {hasAadhaar && <p className="text-xs text-amber-700">{t('guestId.aadhaarHint')}</p>}
          </div>
        </Section>

        <Section n={4} title={t('roomCharges.heading')} hint={t('roomCharges.optionalHint')}>
          <ExtraChargesEditor rows={charges} onChange={setCharges} nights={stayNights}
            rooms={bookedRooms.map(r => ({ id: r.id, label: roomLabel(r) }))} />
        </Section>

        <Section n={5} title={t('dharamshala.sectionPayment')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="booking-advance">{t('dharamshala.advanceAmount')}</label>
              <input id="booking-advance" type="number" min="0" step="0.01" className="form-input" placeholder="0.00"
                value={form.advance} onChange={e => setForm(f => ({ ...f, advance: e.target.value }))} />
            </div>

            <div>
              <label className="form-label" htmlFor="deposit">{t('dharamshala.securityDeposit')}</label>
              <input id="deposit" className="form-input" inputMode="decimal" value={form.deposit} placeholder="0"
                onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))} />
              <p className="text-xs text-slate-500 mt-1">{t('dharamshala.depositHint')}</p>
            </div>
          </div>
          <div className="mt-3">
            <PaymentFields idPrefix="booking-pay" value={payment} onChange={setPayment} />
            <p className="text-xs text-slate-500 mt-1">{t('dharamshala.depositReceiptHint')}</p>
          </div>
          <div>
            <label className="form-label" htmlFor="booking-remarks">{t('dharamshala.remarks')}</label>
            <textarea id="booking-remarks" className="form-textarea" rows={2} maxLength={1000}
              placeholder={t('dharamshala.remarksPlaceholder')}
              value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>
        </Section>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        {/* The total and the button stay in view while the form scrolls. */}
        <div className="sticky bottom-0 z-10 -mx-1 px-5 py-3 bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-sm flex items-center gap-4 flex-wrap"
          data-testid="booking-summary">
          {/* A phone gives the summary the whole width and the buttons a row
              of their own; side by side it was one word per line. */}
          <div className="text-sm text-slate-600 basis-full sm:basis-0 sm:flex-1 min-w-0">
            {bookedRooms.length === 0 ? (
              <span>{t('dharamshala.pickRoomsHint')}</span>
            ) : (
              <>
                {/* Rooms on one line (cut short when there are many), the money
                    on the next; an amount never breaks across lines. */}
                <span className="block truncate font-medium text-navy-900">
                  {t('dharamshala.summaryRooms', { count: bookedRooms.length, rooms: bookedRooms.map(roomLabel).join(', '), nights: stayNights })}
                </span>
                <span className="flex flex-wrap gap-x-3">
                  {extrasPaise > 0 && <span className="whitespace-nowrap">{t('roomCharges.extrasTotal', { amount: fmtPaise(extrasPaise) })}</span>}
                  <span className="whitespace-nowrap font-semibold text-navy-900">{t('dharamshala.beforeTaxTotal', { amount: fmtPaise(roomsPaise + extrasPaise) })}</span>
                </span>
                {quotable && quote && quote.mode !== 'calendar' && (
                  <span className="block text-xs text-slate-500" data-testid="booking-stay-policy" title={quote.explanation.join(' ')}>
                    {t(`stayCharge.mode.${quote.mode}`)}
                    {quote.fees.map(f => (
                      <span key={f.description} className="block text-amber-700" data-testid="booking-stay-fee">
                        {t('stayCharge.atCheckout', { what: f.description, amount: fmtPaise(f.amount_paise) })}
                      </span>
                    ))}
                  </span>
                )}
              </>
            )}
          </div>
          <button type="button" onClick={() => navigate('/rooms')} className="btn-secondary flex-1 sm:flex-none justify-center">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary flex-[2] sm:flex-none justify-center">
            <Save size={16} /> {saving ? t('common.saving') : t('dharamshala.confirmBooking')}
          </button>
        </div>
      </form>
    </div>
  )
}

/** A numbered card: one question the counter asks. */
function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-body space-y-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-navy-900 text-white text-[11px] font-bold">{n}</span>
          <h2 className="font-semibold text-navy-900">{title}</h2>
          {hint && <span className="text-xs text-slate-400 ml-auto">{hint}</span>}
        </div>
        {children}
      </div>
    </section>
  )
}
