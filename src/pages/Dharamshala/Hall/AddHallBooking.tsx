import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Plus, Save, Trash2, X } from 'lucide-react'
import { api, fmtPaise, parsePaise, todayIst } from '../../../lib/api'
import { DevoteePicker } from '../../../components/DevoteePicker/DevoteePicker'
import { PaymentSplitInput, emptyPaymentRow, sumPaise, toPayload, type PaymentRow } from '../../../components/PaymentSplitInput'
import { usePaymentModes } from '../../../lib/useDropdownOptions'
import { isWellFormedGstin, recipientGstin } from '../../../lib/statutoryIds'
import type { Hall, DevoteeSelection } from '../../../types'
import { useFormDraft } from '../../../lib/formDraft'
import { DraftBar } from '../../../components/kit/DraftBar'
import { useToast } from '../../../components/kit/Toast'

/**
 * A hall booking: one venue or a package, for one or more days, at the
 * booker's rate category, with extras — priced LIVE by the same server
 * function the booking goes through (POST /hall-bookings/quote), so the desk
 * sees the bill before it is made and the two cannot disagree.
 *
 * 2026-10-08: "in hall there can be multiple packages — with the hall they can
 * provide full rooms, lawns, multiple halls and multiple rooms and many extra
 * and different charges — and they have different charges for different
 * people". Tenant migration 061.
 */

interface Pkg { id: string; name: string; inclusions?: string | null; venues: { id: string; name: string }[]; rooms: { id: string; room_number: string }[]; is_active: boolean }
interface Cat { id: string; name: string; is_active?: boolean }
interface ChargeItem { id: string; name: string; default_rate_paise: number; per_day: boolean; is_active?: boolean }
interface Room { id: string; room_number: string; building?: string | null }
interface ExtraRow { key: number; charge_item_id: string; description: string; qty: string; rate: string; per_day: boolean }
interface Quote {
  quote: { days: number; day_price_paise: number; list_price_paise: number; base_paise: number; overridden: boolean; charges_paise: number; subtotal_paise: number; extras: { description: string; amount_paise: number }[] }
  gst_rate: number; gst_paise: number; total_paise: number; exempt_reason: string | null
  venues: { id: string; name: string }[]; rooms: { id: string; room_number: string }[]
  conflicts: { venues: { venue: string; invoice_no: string; from_date: string; to_date: string; event_name?: string }[]; rooms: { room_number: string; invoice_no: string }[] }
}

let rowKey = 1

const blankForm = () => ({
  hall_id: '', package_id: '', rate_category_id: '',
  event_name: '', booking_date: todayIst(), end_date: '', session_type: 'full_day', hours: '',
  booker_gstin: '', notes: '',
})

/** What a draft keeps (lib/formDraft): the whole form, payments included. */
interface HallDraft {
  mode: 'venue' | 'package'
  form: ReturnType<typeof blankForm>
  extraVenues: string[]
  roomIds: string[] | null
  extras: ExtraRow[]
  override: { on: boolean; amount: string; reason: string }
  payRows: PaymentRow[]
  booker: DevoteeSelection | null
}

export function AddHallBooking() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  // /hall/:id/edit changes a booking (2026-10-11); /hall/add makes one.
  const { id: editId } = useParams()
  const editing = !!editId
  const [loaded, setLoaded] = useState<{ invoice_no: string | null; paid_paise: number; total_paise: number; status: string } | null>(null)
  const [changeReason, setChangeReason] = useState('')
  const paymentModes = usePaymentModes()
  const [halls, setHalls] = useState<Hall[]>([])
  const [packages, setPackages] = useState<Pkg[]>([])
  const [cats, setCats] = useState<Cat[]>([])
  const [items, setItems] = useState<ChargeItem[]>([])
  const [allRooms, setAllRooms] = useState<Room[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [booker, setBooker] = useState<DevoteeSelection | null>(null)
  const [gstRegistered, setGstRegistered] = useState(false)
  const [mode, setMode] = useState<'venue' | 'package'>('venue')
  const [form, setForm] = useState(blankForm)
  const [extraVenues, setExtraVenues] = useState<string[]>([])
  const [roomIds, setRoomIds] = useState<string[] | null>(null)
  const [extras, setExtras] = useState<ExtraRow[]>([])
  const [override, setOverride] = useState({ on: false, amount: '', reason: '' })
  const [payRows, setPayRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState('')

  const gstinCheck = recipientGstin(gstRegistered ? form.booker_gstin : '')
  const gstinError = gstRegistered && form.booker_gstin.trim() ? (gstinCheck.error ?? null) : null

  useEffect(() => {
    api.get('/halls').then(r => setHalls((r.data.data || []).filter((h: Hall) => h.is_available !== false))).catch(() => {})
    api.get('/hall-packages').then(r => setPackages(r.data.data || [])).catch(() => {})
    api.get('/rate-categories', { params: { limit: '100' } }).then(r => setCats((r.data.data || []).filter((c: Cat) => c.is_active !== false))).catch(() => {})
    api.get('/hall-charge-items', { params: { limit: '100' } }).then(r => setItems((r.data.data || []).filter((c: ChargeItem) => c.is_active !== false))).catch(() => {})
    api.get('/rooms', { params: { limit: '500' } }).then(r => setAllRooms(r.data.data || [])).catch(() => {})
    api.get('/tenants/me').then(r => {
      const p = r.data?.data ?? r.data ?? {}
      // Same test the API charges GST by (a well-formed GSTIN), so the form
      // never hides the guest GSTIN on a bill that will carry tax, or the reverse.
      setGstRegistered(isWellFormedGstin(p.gstin))
    }).catch(() => {})
  }, [])

  const pkg = packages.find(p => p.id === form.package_id) ?? null
  // Choosing a package brings its rooms; the desk can still add or drop one.
  // Not when the package arrives with a draft or a booking being edited: their
  // rooms are already the chosen ones.
  const keepRooms = useRef(false)
  useEffect(() => {
    if (keepRooms.current) { keepRooms.current = false; return }
    setRoomIds(pkg ? pkg.rooms.map(r => r.id) : null)
  }, [form.package_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draft (new bookings only) ─────────────────────────────────────────
  const draftValue: HallDraft = { mode, form, extraVenues, roomIds, extras, override, payRows, booker }
  const draft = useFormDraft<HallDraft>('hall-booking', draftValue, d => {
    keepRooms.current = !!d.form?.package_id
    setMode(d.mode); setForm({ ...blankForm(), ...d.form }); setExtraVenues(d.extraVenues ?? [])
    setRoomIds(d.roomIds ?? null); setExtras((d.extras ?? []).map(x => ({ ...x, key: rowKey++ })))
    setOverride(d.override ?? { on: false, amount: '', reason: '' }); setPayRows(d.payRows?.length ? d.payRows : [emptyPaymentRow()])
    setBooker(d.booker ?? null)
  }, d => !d.form.hall_id && !d.form.package_id && !d.form.event_name.trim() && !d.booker && !d.extras.length && !d.form.notes.trim(),
  !editing)
  function resetForm() {
    setMode('venue'); setForm(blankForm()); setExtraVenues([]); setRoomIds(null); setExtras([])
    setOverride({ on: false, amount: '', reason: '' }); setPayRows([emptyPaymentRow()]); setBooker(null); setError('')
  }

  // ── Edit: the booking as it stands ───────────────────────────────────
  useEffect(() => {
    if (!editId) return
    api.get(`/hall-bookings/${editId}/bill`).then(r => {
      const b = r.data?.data ?? r.data
      const venueIds: string[] = (b.venues ?? []).map((v: { id: string }) => v.id)
      keepRooms.current = !!b.package_id
      setMode(b.package_id ? 'package' : 'venue')
      setForm({
        hall_id: b.package_id ? '' : (b.hall_id ?? ''), package_id: b.package_id ?? '', rate_category_id: b.rate_category_id ?? '',
        event_name: b.event_name ?? '', booking_date: String(b.booking_date).slice(0, 10),
        end_date: b.end_date ? String(b.end_date).slice(0, 10) : '', session_type: b.session_type ?? 'full_day',
        hours: b.hours ? String(b.hours) : '', booker_gstin: b.booker_gstin ?? '', notes: b.notes ?? '',
      })
      // Venues beyond the hall itself are the "also book" ones; a package's
      // own venues come back from the server when it prices, so they are dropped.
      setExtraVenues(venueIds.filter(v => v !== b.hall_id))
      setRoomIds((b.rooms ?? []).map((x: { id: string }) => x.id))
      setExtras((b.charges ?? []).map((c: { charge_item_id?: string | null; description: string; qty: number; days?: number; rate_paise: number }) => ({
        key: rowKey++, charge_item_id: c.charge_item_id ?? '', description: c.description, qty: String(c.qty),
        rate: String(Number(c.rate_paise) / 100), per_day: Number(c.days ?? 1) > 1,
      })))
      if (b.price_override_reason) {
        setOverride({ on: true, amount: String((Number(b.subtotal_paise) - Number(b.charges_paise ?? 0)) / 100), reason: b.price_override_reason })
      }
      setBooker(b.booker_name ? ({ name: b.booker_name, mobile: b.booker_mobile ?? '' } as DevoteeSelection) : null)
      setLoaded({ invoice_no: b.invoice_no ?? null, paid_paise: Number(b.paid_paise ?? 0), total_paise: Number(b.total_paise ?? 0), status: b.status ?? 'confirmed' })
    }).catch(() => setError(t('hallEdit.loadFailed')))
  }, [editId]) // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo(() => ({
    ...(mode === 'package' ? { package_id: form.package_id || null } : { hall_id: form.hall_id || null }),
    rate_category_id: form.rate_category_id || null,
    booking_date: form.booking_date,
    end_date: form.end_date && form.end_date !== form.booking_date ? form.end_date : null,
    session_type: form.session_type,
    hours: form.session_type === 'hourly' ? Number(form.hours || 0) : null,
    hall_ids: extraVenues,
    ...(roomIds !== null ? { room_ids: roomIds } : {}),
    charges: extras.filter(e => e.description.trim() || e.charge_item_id).map(e => ({
      charge_item_id: e.charge_item_id || null,
      description: e.description,
      qty: Number(e.qty || 1),
      rate_paise: e.rate ? parsePaise(e.rate) : 0,
      per_day: e.per_day,
    })),
    ...(override.on ? { price_override_paise: override.amount === '' ? null : parsePaise(override.amount), price_override_reason: override.reason } : {}),
    // An edit is not a clash with itself.
    ...(editId ? { exclude_booking_id: editId } : {}),
  }), [mode, form, extraVenues, roomIds, extras, override, editId])

  // Live price: re-asked whenever anything that changes it changes.
  const seq = useRef(0)
  useEffect(() => {
    const ready = mode === 'package' ? !!form.package_id : !!form.hall_id
    if (!ready || !form.booking_date) { setQuote(null); setQuoteError(''); return }
    const mine = ++seq.current
    const h = setTimeout(() => {
      api.post('/hall-bookings/quote', body)
        .then(r => { if (mine === seq.current) { setQuote(r.data.data ?? r.data); setQuoteError('') } })
        .catch(e => { if (mine === seq.current) { setQuote(null); setQuoteError(e?.response?.data?.error?.message ?? t('hallPackages.quoteFailed')) } })
    }, 250)
    return () => clearTimeout(h)
  }, [body]) // eslint-disable-line react-hooks/exhaustive-deps

  function addExtra(itemId: string) {
    const it = items.find(i => i.id === itemId)
    setExtras(x => [...x, {
      key: rowKey++, charge_item_id: it?.id ?? '', description: it?.name ?? '',
      qty: '1', rate: it && Number(it.default_rate_paise) > 0 ? String(it.default_rate_paise / 100) : '', per_day: !!it?.per_day,
    }])
  }

  const refNeeded = (code: string) => paymentModes.find(m => m.code === code)?.requires_reference ?? code !== 'cash'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'venue' && !form.hall_id) { setError(t('msg.selectHall')); return }
    if (mode === 'package' && !form.package_id) { setError(t('hallPackages.choosePackage')); return }
    if (!form.event_name) { setError(t('msg.enterEventName')); return }
    if (gstinError) { setError(gstinError); return }
    if (override.on && !override.reason.trim()) { setError(t('hallPackages.overrideReasonRequired')); return }
    if (quote?.conflicts.venues.length || quote?.conflicts.rooms.length) { setError(t('hallPackages.resolveClashes')); return }
    if (editing) { await saveEdit(); return }
    if (payRows.some(r => Number(r.amount) > 0 && refNeeded(r.payment_mode) && !r.reference_no?.trim())) {
      setError(t('pledges.utrRequired')); return
    }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        ...body,
        event_name: form.event_name,
        notes: form.notes || null,
        booker_gstin: gstinCheck.gstin,
        payments: toPayload(payRows),
        advance_paise: sumPaise(payRows),
        payment_mode: payRows[0]?.payment_mode ?? 'cash',
      }
      if (booker?.global_user_id) payload.booker = { global_user_id: booker.global_user_id, name: booker.name, mobile: booker.mobile }
      else if (booker?.name) payload.booker = { name: booker.name, mobile: booker.mobile }
      await api.post('/hall-bookings', payload)
      draft.clear()
      navigate('/hall')
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      setError(ex.response?.data?.error?.message || t('hallPackages.bookingFailed'))
    } finally {
      setSaving(false)
    }
  }

  const closed = editing && loaded && loaded.status !== 'confirmed' ? loaded.status : null

  async function saveEdit() {
    if (!changeReason.trim()) { setError(t('hallEdit.reasonRequired')); return }
    setSaving(true)
    setError('')
    try {
      const { exclude_booking_id: _x, ...rest } = body as Record<string, unknown>
      const { data } = await api.put(`/hall-bookings/${editId}`, {
        ...rest,
        event_name: form.event_name,
        notes: form.notes || null,
        booker_gstin: gstinCheck.gstin,
        ...(booker?.name ? { booker: { name: booker.name, mobile: booker.mobile ?? '' } } : {}),
        change_reason: changeReason.trim(),
      })
      const res = data?.data ?? data
      const changes: string[] = res?.changes ?? []
      toast.success(changes.length ? `${t('hallEdit.saved')} · ${changes.join(' · ')}` : t('hallEdit.savedNoChange'))
      if (Number(res?.refund_due_paise) > 0) toast.info(t('hallEdit.refundDue', { amount: fmtPaise(res.refund_due_paise) }))
      navigate(`/hall?q=${encodeURIComponent(res?.invoice_no ?? loaded?.invoice_no ?? '')}`)
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      setError(ex.response?.data?.error?.message || t('hallEdit.failed'))
    } finally {
      setSaving(false)
    }
  }

  const venueOptions = halls.filter(h => mode === 'venue' ? h.id !== form.hall_id : !(pkg?.venues ?? []).some(v => v.id === h.id))
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? 'bg-navy-900 text-white border-navy-900' : 'bg-white border-slate-300 text-slate-600'}`

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-navy-900">
            {editing ? t('hallEdit.title', { ref: loaded?.invoice_no ?? '' }) : t('dharamshala.newHallBooking')}
          </h1>
          {!editing && (
            <div className="mt-1">
              <DraftBar draft={draft} onDiscard={resetForm} leaveTo="/hall" />
            </div>
          )}
        </div>
        <button onClick={() => navigate('/hall')} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="card">
          <div className="card-body space-y-5">
            {packages.length > 0 && (
              <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit" role="tablist">
                {(['venue', 'package'] as const).map(m => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} data-testid={`hall-mode-${m}`}
                    onClick={() => setMode(m)}
                    className={`px-4 py-1.5 text-sm font-medium ${mode === m ? 'bg-navy-900 text-white' : 'bg-white text-slate-600'}`}>
                    {t(m === 'venue' ? 'hallPackages.oneVenue' : 'hallPackages.package')}
                  </button>
                ))}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {mode === 'venue' ? (
                <div>
                  <label className="form-label" htmlFor="add-hall-booking-hall-id">{t('dharamshala.hallLabel')}</label>
                  <select id="add-hall-booking-hall-id" className="form-select" value={form.hall_id}
                    onChange={e => setForm(f => ({ ...f, hall_id: e.target.value }))}>
                    <option value="">{t('dharamshala.selectHall')}</option>
                    {halls.map(h => <option key={h.id} value={h.id}>{h.name} {t('dharamshala.hallCapacity', { capacity: h.capacity_persons })}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="form-label" htmlFor="hall-package">{t('hallPackages.package')}</label>
                  <select id="hall-package" className="form-select" value={form.package_id}
                    onChange={e => setForm(f => ({ ...f, package_id: e.target.value }))}>
                    <option value="">{t('hallPackages.choosePackage')}</option>
                    {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {pkg && <p className="text-xs text-slate-500 mt-1">{pkg.venues.map(v => v.name).join(' + ')}{pkg.inclusions ? ` · ${pkg.inclusions}` : ''}</p>}
                </div>
              )}
              <div>
                <label className="form-label" htmlFor="hall-rate-cat">{t('hallPackages.rateCategory')}</label>
                <select id="hall-rate-cat" className="form-select" value={form.rate_category_id}
                  onChange={e => setForm(f => ({ ...f, rate_category_id: e.target.value }))}>
                  <option value="">{t('hallPackages.standard')}</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="form-label" htmlFor="add-hall-booking-event-name">{t('dharamshala.eventName')}</label>
              <input id="add-hall-booking-event-name" className="form-input" placeholder={t('dharamshala.eventNamePlaceholder')} value={form.event_name}
                onChange={e => setForm(f => ({ ...f, event_name: e.target.value }))} />
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <label className="form-label" htmlFor="add-hall-booking-booking-date">{t('hallPackages.fromDate')}</label>
                <input id="add-hall-booking-booking-date" type="date" className="form-input" value={form.booking_date}
                  onChange={e => setForm(f => ({ ...f, booking_date: e.target.value }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="hall-end-date">{t('hallPackages.toDate')}</label>
                <input id="hall-end-date" type="date" className="form-input" value={form.end_date} min={form.booking_date}
                  onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="add-hall-booking-session-type">{t('dharamshala.sessionLabel')}</label>
                <select id="add-hall-booking-session-type" className="form-select" value={form.session_type}
                  onChange={e => setForm(f => ({ ...f, session_type: e.target.value }))}>
                  <option value="full_day">{t('dharamshala.sessionFullDay')}</option>
                  <option value="morning">{t('dharamshala.sessionMorning')}</option>
                  <option value="evening">{t('dharamshala.sessionEvening')}</option>
                  {mode === 'venue' && <option value="hourly">{t('dharamshala.sessionHourly')}</option>}
                </select>
              </div>
              {form.session_type === 'hourly' && (
                <div>
                  <label className="form-label" htmlFor="hall-hours">{t('hallPackages.hours')}</label>
                  <input id="hall-hours" className="form-input" inputMode="decimal" value={form.hours}
                    onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} />
                </div>
              )}
            </div>

            {venueOptions.length > 0 && (
              <div>
                <p className="form-label">{t('hallPackages.alsoBook')} <span className="text-xs font-normal text-slate-400">{t('hallPackages.alsoBookHint')}</span></p>
                <div className="flex flex-wrap gap-2">
                  {venueOptions.map(h => (
                    <button key={h.id} type="button" className={chip(extraVenues.includes(h.id))}
                      onClick={() => setExtraVenues(v => v.includes(h.id) ? v.filter(x => x !== h.id) : [...v, h.id])}>{h.name}</button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="form-label">{t('hallPackages.roomsHeld')} <span className="text-xs font-normal text-slate-400">{t('hallPackages.roomsHeldHint')}</span></p>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto" data-testid="hall-rooms">
                {allRooms.map(r => {
                  const on = (roomIds ?? []).includes(r.id)
                  return (
                    <button key={r.id} type="button" className={`rounded border px-2 py-0.5 text-xs font-mono ${on ? 'bg-navy-900 text-white border-navy-900' : 'bg-white border-slate-300 text-slate-600'}`}
                      onClick={() => setRoomIds(ids => { const cur = ids ?? []; return cur.includes(r.id) ? cur.filter(x => x !== r.id) : [...cur, r.id] })}>
                      {r.building ? `${r.building}-` : ''}{r.room_number}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <p className="form-label">{t('hallPackages.extras')}</p>
                <select className="form-select !w-auto !py-1 text-xs" value="" aria-label={t('hallPackages.addExtra')}
                  onChange={e => { if (e.target.value) addExtra(e.target.value === '__other__' ? '' : e.target.value) }}>
                  <option value="">+ {t('hallPackages.addExtra')}</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.name}{Number(i.default_rate_paise) > 0 ? ` · ₹${fmtPaise(i.default_rate_paise)}` : ''}{i.per_day ? ` / ${t('hallPackages.perDay')}` : ''}</option>)}
                  <option value="__other__">{t('expenseItems.otherCategory')}</option>
                </select>
              </div>
              {extras.length > 0 && (
                <div className="space-y-2 mt-2" data-testid="hall-extras">
                  {extras.map(x => {
                    const fixed = !!x.charge_item_id && Number(items.find(i => i.id === x.charge_item_id)?.default_rate_paise ?? 0) > 0
                    return (
                      <div key={x.key} className="grid grid-cols-[1fr_4.5rem_6rem_auto_2rem] gap-2 items-center">
                        <input className="form-input !py-1" value={x.description} disabled={!!x.charge_item_id} placeholder={t('hallPackages.extraName') as string}
                          onChange={e => setExtras(v => v.map(r => r.key === x.key ? { ...r, description: e.target.value } : r))} />
                        <input className="form-input !py-1 text-right" inputMode="decimal" value={x.qty} aria-label={t('hallPackages.qty')}
                          onChange={e => setExtras(v => v.map(r => r.key === x.key ? { ...r, qty: e.target.value } : r))} />
                        <input className="form-input !py-1 text-right" inputMode="decimal" value={x.rate} disabled={fixed} placeholder="₹" aria-label={t('roomCharges.rate')}
                          onChange={e => setExtras(v => v.map(r => r.key === x.key ? { ...r, rate: e.target.value } : r))} />
                        <label className="text-xs text-slate-500 flex items-center gap-1">
                          <input type="checkbox" checked={x.per_day} disabled={!!x.charge_item_id}
                            onChange={e => setExtras(v => v.map(r => r.key === x.key ? { ...r, per_day: e.target.checked } : r))} />
                          {t('hallPackages.perDay')}
                        </label>
                        <button type="button" className="text-slate-400 hover:text-red-500" aria-label={t('common.delete')}
                          onClick={() => setExtras(v => v.filter(r => r.key !== x.key))}><Trash2 size={14} /></button>
                      </div>
                    )
                  })}
                </div>
              )}
              {!items.length && !extras.length && (
                <button type="button" className="text-xs text-navy-700 inline-flex items-center gap-1 mt-1" onClick={() => addExtra('')}>
                  <Plus size={12} /> {t('hallPackages.addExtra')}
                </button>
              )}
            </div>

            {gstRegistered && <div>
              <label className="form-label" htmlFor="booker-gstin">{t('dharamshala.guestGstin')}</label>
              <input id="booker-gstin" className="form-input" value={form.booker_gstin} maxLength={15} autoComplete="off" spellCheck={false}
                onChange={e => setForm(f => ({ ...f, booker_gstin: e.target.value.toUpperCase() }))} placeholder="27AAATR1234C1Z0" />
              <p className={`text-xs mt-1 ${gstinError ? 'text-red-600' : 'text-slate-500'}`}>{gstinError || t('dharamshala.guestGstinHint')}</p>
            </div>}

            <DevoteePicker label={t('dharamshala.bookerContact')} noun="guest" value={booker} onChange={setBooker} showAnonymous={false} />

            {editing ? (
              // Money is not edited here: what was paid stays on the booking,
              // and the balance is collected from the list as before.
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600" data-testid="hall-edit-paid">
                {t('hallEdit.paidSoFar', { amount: fmtPaise(loaded?.paid_paise ?? 0) })}
              </div>
            ) : (
              <div>
                <p className="form-label">{t('dharamshala.advanceAmount')}</p>
                <PaymentSplitInput rows={payRows} onChange={setPayRows} totalPaise={quote?.total_paise ?? 0} />
              </div>
            )}

            <div>
              <label className="form-label" htmlFor="hall-notes">{t('dharamshala.remarks')}</label>
              <textarea id="hall-notes" className="form-textarea" rows={2} maxLength={1000} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {editing && (
              <div>
                <label className="form-label" htmlFor="hall-change-reason">{t('hallEdit.reason')} *</label>
                <input id="hall-change-reason" className="form-input" maxLength={300} value={changeReason}
                  placeholder={t('hallEdit.reasonPlaceholder') as string} onChange={e => setChangeReason(e.target.value)} />
              </div>
            )}

            {/* Only a confirmed booking changes: the API refuses the rest, so
                the page says so before anything is typed. */}
            {closed && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="hall-edit-closed">
                {t('hallEdit.closed', { status: t(`dharamshala.status${closed === 'cancelled' ? 'Cancelled' : 'Completed'}`, { defaultValue: closed }) })}
              </p>
            )}
            {error && <p className="text-red-600 text-sm" data-testid="hall-error">{error}</p>}
          </div>
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
            <button type="button" onClick={() => navigate('/hall')} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={saving || !!closed} className="btn-primary" data-testid="hall-confirm">
              <Save size={16} /> {saving ? t('common.saving') : editing ? t('hallEdit.save') : t('dharamshala.confirmBooking')}
            </button>
          </div>
        </div>

        {/* The bill as it stands, from the server. */}
        <aside className="card h-fit lg:sticky lg:top-4" data-testid="hall-quote">
          <div className="card-header font-semibold text-navy-900">{t('hallPackages.priceSummary')}</div>
          <div className="card-body text-sm space-y-2">
            {!quote && !quoteError && <p className="text-slate-400">{t('hallPackages.pickToPrice')}</p>}
            {quoteError && <p className="text-red-600">{quoteError}</p>}
            {quote && (
              <>
                <div className="flex justify-between"><span>{t('hallPackages.perDayPrice')}</span><span>₹{fmtPaise(quote.quote.day_price_paise)}</span></div>
                <div className="flex justify-between"><span>{t('hallPackages.daysLabel', { count: quote.quote.days })}</span><span className={quote.quote.overridden ? 'line-through text-slate-400' : ''}>₹{fmtPaise(quote.quote.list_price_paise)}</span></div>
                {quote.quote.overridden && <div className="flex justify-between text-amber-700"><span>{t('hallPackages.agreedPrice')}</span><span>₹{fmtPaise(quote.quote.base_paise)}</span></div>}
                {quote.quote.extras.map((x, i) => <div key={i} className="flex justify-between text-slate-600"><span>+ {x.description}</span><span>₹{fmtPaise(x.amount_paise)}</span></div>)}
                {quote.gst_paise > 0 && <div className="flex justify-between text-slate-600"><span>GST {quote.gst_rate}%</span><span>₹{fmtPaise(quote.gst_paise)}</span></div>}
                {quote.exempt_reason && <p className="text-xs text-green-700">{t('hallPackages.gstExempt')}</p>}
                <div className="flex justify-between border-t pt-2 font-bold text-base"><span>{t('dharamshala.total')}</span><span data-testid="hall-quote-total">₹{fmtPaise(quote.total_paise)}</span></div>
                {editing && loaded ? (
                  <>
                    {loaded.total_paise !== quote.total_paise && (
                      <div className="flex justify-between text-slate-500" data-testid="hall-edit-was"><span>{t('hallEdit.wasTotal')}</span><span>₹{fmtPaise(loaded.total_paise)}</span></div>
                    )}
                    <div className="flex justify-between text-slate-600"><span>{t('hallEdit.paid')}</span><span>₹{fmtPaise(loaded.paid_paise)}</span></div>
                    {loaded.paid_paise > quote.total_paise ? (
                      <div className="flex justify-between font-semibold text-brand-blue" data-testid="hall-edit-refund"><span>{t('hallEdit.refundToBooker')}</span><span>₹{fmtPaise(loaded.paid_paise - quote.total_paise)}</span></div>
                    ) : (
                      <div className="flex justify-between font-semibold"><span>{t('hallPackages.balanceLater')}</span><span>₹{fmtPaise(quote.total_paise - loaded.paid_paise)}</span></div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-slate-600"><span>{t('hallPackages.advanceNow')}</span><span>₹{fmtPaise(sumPaise(payRows))}</span></div>
                    <div className="flex justify-between font-semibold"><span>{t('hallPackages.balanceLater')}</span><span>₹{fmtPaise(Math.max(0, quote.total_paise - sumPaise(payRows)))}</span></div>
                  </>
                )}
                <p className="text-xs text-slate-500">{quote.venues.map(v => v.name).join(' + ')}{quote.rooms.length ? ` · ${t('hallPackages.roomsCount', { count: quote.rooms.length })}` : ''}</p>
                {(quote.conflicts.venues.length > 0 || quote.conflicts.rooms.length > 0) && (
                  <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800" data-testid="hall-clash">
                    <p className="font-semibold flex items-center gap-1"><AlertTriangle size={12} /> {t('hallPackages.clash')}</p>
                    {quote.conflicts.venues.map((c, i) => <p key={`v${i}`}>{c.venue} — {c.invoice_no}{c.event_name ? ` (${c.event_name})` : ''}</p>)}
                    {quote.conflicts.rooms.map((c, i) => <p key={`r${i}`}>{t('dharamshala.room')} {c.room_number} — {c.invoice_no}</p>)}
                  </div>
                )}
              </>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-600 pt-2 border-t">
              <input type="checkbox" checked={override.on} data-testid="hall-override"
                onChange={e => setOverride(o => ({ ...o, on: e.target.checked, amount: e.target.checked && quote ? String(quote.quote.list_price_paise / 100) : '' }))} />
              {t('hallPackages.changePrice')}
            </label>
            {override.on && (
              <div className="space-y-2">
                <input className="form-input !py-1" inputMode="decimal" value={override.amount} aria-label={t('hallPackages.agreedPrice')}
                  onChange={e => setOverride(o => ({ ...o, amount: e.target.value }))} />
                <input className="form-input !py-1" value={override.reason} placeholder={t('hallPackages.overrideReason') as string}
                  aria-label={t('hallPackages.overrideReason')} onChange={e => setOverride(o => ({ ...o, reason: e.target.value }))} />
                <p className="text-xs text-slate-500">{t('hallPackages.overrideHint')}</p>
              </div>
            )}
          </div>
        </aside>
      </form>
    </div>
  )
}
