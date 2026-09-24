import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Contact as IdCard, Eye, Loader2, ShieldAlert, Trash2, X } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise, istDate, parsePaise } from '../../../lib/api'
import { compressIdImage } from '../../../lib/idImage'
import { useApiGet } from '../../../lib/useApiGet'
import { useAuthStore } from '../../../store/authStore'
import { useToast } from '../../../components/kit/Toast'
import { fetchAllPages } from '../../../lib/fetchAllPages'
import type { RoomBooking } from '../../../types'

/**
 * A guest's identity documents, on the room booking (tenant migration 055).
 *
 * Asked for: several IDs per guest — type, number, photo — encrypted, addable
 * after the booking ("they will say just book it, we will provide you the id"),
 * the photo view-only for the temple admin and never downloadable.
 *
 * Decided with the founder after reviewing Indian practice (2026-09-23):
 * Aadhaar keeps its LAST FOUR digits only and the photo should be of the
 * masked Aadhaar; other IDs keep the full number, encrypted; photos and full
 * numbers are deleted after the trust's retention period (default 3 years).
 */

const ID_TYPES = ['aadhaar', 'passport', 'driving_license', 'voter_id', 'pan', 'other'] as const

interface IdDoc {
  id: string
  id_type: string
  holder_name: string | null
  masked: string | null
  has_image: boolean
  has_full_number: boolean
  uploaded_by_name: string | null
  created_at: string
  purged_at: string | null
  purge_after: string | null
  added_for_this_booking: boolean
}

function useIdTypeLabel() {
  const { t } = useTranslation()
  return (type: string) => t(`guestId.types.${type}`, { defaultValue: type })
}

export function IdDocumentsModal({ booking, onClose, onChanged }: {
  booking: RoomBooking
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const typeLabel = useIdTypeLabel()
  const isAdmin = !!useAuthStore(s => s.user?.roles)?.includes('temple_admin')
  const [type, setType] = useState<string>('aadhaar')
  const [holder, setHolder] = useState('')
  const [number, setNumber] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<IdDoc | null>(null)
  const [reason, setReason] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const list = useApiGet<{ data?: { documents?: IdDoc[]; retention_years?: number } }>(`/room-bookings/${booking.id}/id-documents`)
  const docs: IdDoc[] | null = list.failed ? [] : list.loading && !list.data ? null : list.data?.data?.documents ?? []
  const retention = list.data?.data?.retention_years ?? 3
  const load = list.refresh

  async function pick(file: File | undefined) {
    if (!file) return
    setError('')
    try {
      setImage(await compressIdImage(file))
    } catch {
      setError(t('guestId.photoFailed'))
    }
  }

  async function save() {
    if (!number.trim() && !image) { setError(t('guestId.needNumberOrPhoto')); return }
    setBusy(true)
    setError('')
    try {
      await api.post(`/room-bookings/${booking.id}/id-documents`, {
        id_type: type, id_number: number.trim() || null, image,
        // Blank = the booking's own guest.
        holder_name: holder.trim() || booking.guest_name || null,
      })
      toast.success(t('guestId.saved'))
      setNumber('')
      setHolder('')
      setImage(null)
      if (fileRef.current) fileRef.current.value = ''
      load()
      onChanged()
    } catch (e) {
      setError(apiErrorMessage(e, t('guestId.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  async function confirmRemove() {
    if (!removing || reason.trim().length < 3) return
    setBusy(true)
    try {
      await api.delete(`/id-documents/${removing.id}`, { data: { reason: reason.trim() } })
      toast.success(t('guestId.removed'))
      setRemoving(null)
      setReason('')
      load()
      onChanged()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('guestId.removeFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-bold text-navy-900 flex items-center gap-2"><IdCard size={18} /> {t('guestId.title')}</h3>
            <p className="text-sm text-slate-500">{booking.guest_name} · {t('dharamshala.room')} {booking.room_number}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        {/* On file */}
        {list.failed && <p className="text-sm text-brand-red mb-2">{t('guestId.loadFailed')}</p>}
        {docs === null ? (
          <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {t('common.loading')}</p>
        ) : docs.length === 0 ? (
          <p className="text-sm bg-amber-50 text-amber-800 rounded-lg px-3 py-2 flex items-center gap-2">
            <ShieldAlert size={14} /> {t('guestId.noneYet')}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {docs.map(d => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    {d.holder_name && <span className="text-slate-900">{d.holder_name} · </span>}
                    {typeLabel(d.id_type)} <span className="font-mono text-slate-600 ml-1">{d.masked ?? ''}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {d.purged_at
                      ? t('guestId.purged', { date: new Date(d.purged_at).toLocaleDateString('en-IN') })
                      : <>
                          {d.has_image ? t('guestId.hasPhoto') : t('guestId.noPhoto')}
                          {d.uploaded_by_name && <> · {t('guestId.addedBy', { name: d.uploaded_by_name })}</>}
                          {' · '}{new Date(d.created_at).toLocaleDateString('en-IN')}
                          {d.purge_after && <> · {t('guestId.deletesOn', { date: new Date(d.purge_after).toLocaleDateString('en-IN') })}</>}
                        </>}
                  </p>
                </div>
                {isAdmin && !d.purged_at && (
                  <div className="flex gap-1 shrink-0">
                    {(d.has_image || d.has_full_number) && (
                      <button onClick={() => setViewing(d.id)} className="btn-secondary btn-sm" title={t('guestId.view')}>
                        <Eye size={13} /> {t('guestId.view')}
                      </button>
                    )}
                    <button
                      onClick={() => { setRemoving(d); setReason('') }}
                      className="p-1.5 text-slate-400 hover:text-brand-red rounded"
                      title={t('guestId.remove')} aria-label={t('guestId.remove')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Add */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h4 className="text-sm font-semibold text-navy-900 mb-3">{t('guestId.add')}</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="form-label" htmlFor="gid-holder">{t('guestId.holderName')}</label>
              <input
                id="gid-holder" className="form-input" value={holder} maxLength={120} autoComplete="off"
                onChange={e => setHolder(e.target.value)}
                placeholder={booking.guest_name || t('guestId.holderPlaceholder')}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="gid-type">{t('dharamshala.idType')}</label>
              <select id="gid-type" className="form-select" value={type} onChange={e => { setType(e.target.value); setNumber('') }}>
                {ID_TYPES.map(x => <option key={x} value={x}>{typeLabel(x)}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="gid-number">
                {type === 'aadhaar' ? t('guestId.aadhaarLast4') : t('dharamshala.idNumber')}
              </label>
              <input
                id="gid-number" className="form-input" value={number} autoComplete="off"
                onChange={e => setNumber(e.target.value)}
                inputMode={type === 'aadhaar' ? 'numeric' : 'text'}
                maxLength={type === 'aadhaar' ? 14 : 30}
                placeholder={type === 'aadhaar' ? 'XXXX XXXX 1234' : ''}
              />
            </div>
          </div>
          {type === 'aadhaar' && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5 mt-2">{t('guestId.aadhaarHint')}</p>
          )}
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <input
              ref={fileRef} id="gid-photo" type="file" accept="image/*" className="hidden"
              onChange={e => void pick(e.target.files?.[0])}
            />
            <button type="button" className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
              <Camera size={14} /> {image ? t('guestId.retake') : t('guestId.addPhoto')}
            </button>
            {image && (
              <span className="text-xs text-green-700">
                {t('guestId.photoReady', { size: fmtKb(image) })}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-3">{t('guestId.notice', { years: retention })}</p>
          {error && <p className="text-sm text-brand-red mt-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="btn-secondary btn-sm">{t('common.close')}</button>
            <button onClick={() => void save()} disabled={busy} className="btn-primary btn-sm">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null} {t('guestId.save')}
            </button>
          </div>
        </div>
      </div>

      {viewing && <IdViewer docId={viewing} onClose={() => setViewing(null)} />}

      {removing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('guestId.removeTitle')}</h3>
            <p className="text-sm text-slate-500 mb-3">
              {typeLabel(removing.id_type)} {removing.masked} — {t('guestId.removeBody')}
            </p>
            <label className="form-label" htmlFor="gid-reason">{t('guestId.reason')}</label>
            <input id="gid-reason" className="form-input" value={reason} onChange={e => setReason(e.target.value)} autoFocus />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRemoving(null)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
              <button onClick={() => void confirmRemove()} disabled={busy || reason.trim().length < 3} className="btn-danger btn-sm">
                {t('guestId.remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtKb(dataUrl: string): string {
  const bytes = (dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * The temple admin's view of a document: drawn onto a canvas with the viewer's
 * name and the time tiled across it, never as an <img> — so there is no "Save
 * image as…", nothing to drag out, and the print stylesheet does not show it.
 * The data is dropped the moment the viewer closes. A screenshot cannot be
 * prevented by any web page; the watermark is what makes a leaked copy
 * traceable to whoever made it, and the server logs every view.
 */
function IdViewer({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const typeLabel = useIdTypeLabel()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<{ id_type: string; masked: string | null; id_number: string | null; image: string | null; watermark: string; guest_name: string; holder_name: string | null } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api.post(`/id-documents/${docId}/view`, {})
      .then(r => { if (live) setDoc(r.data.data) })
      .catch(e => { if (live) setError(apiErrorMessage(e, t('guestId.viewFailed'))) })
    return () => { live = false; setDoc(null) }
  }, [docId, t])

  useEffect(() => {
    if (!doc?.image || !canvasRef.current) return
    const canvas = canvasRef.current
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 900 / img.width)
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.font = `${Math.max(12, Math.round(canvas.width / 45))}px sans-serif`
      ctx.fillStyle = 'rgba(200, 30, 30, 0.28)'
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(-Math.PI / 7)
      const step = Math.max(40, Math.round(canvas.height / 5))
      for (let y = -canvas.height; y <= canvas.height; y += step) {
        ctx.fillText(doc.watermark, -canvas.width, y)
        ctx.fillText(doc.watermark, -canvas.width / 4, y + step / 2)
      }
      ctx.restore()
      img.src = ''
    }
    img.src = doc.image
  }, [doc])

  useEffect(() => {
    // In the desktop app, keep the window out of screenshots and screen
    // recording while the photo is open (Electron setContentProtection). A
    // browser has no such control — there the watermark and the audit row are
    // the protection.
    const desktop = (window as unknown as {
      electronAPI?: { setContentProtection?: (on: boolean) => Promise<boolean> }
    }).electronAPI
    void desktop?.setContentProtection?.(true)
    return () => { void desktop?.setContentProtection?.(false) }
  }, [])

  useEffect(() => {
    // Ctrl/Cmd+S and +P do nothing useful here, and Escape closes.
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if ((e.ctrlKey || e.metaKey) && ['s', 'p'].includes(e.key.toLowerCase())) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 no-print select-none"
      role="dialog" aria-modal="true" onContextMenu={e => e.preventDefault()}
    >
      <div className="bg-white rounded-xl shadow-xl p-4 w-full max-w-4xl mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-navy-900">{doc ? `${typeLabel(doc.id_type)} — ${doc.holder_name || doc.guest_name}` : t('guestId.view')}</h3>
            {doc && (
              <p className="text-sm text-slate-600 font-mono">
                {doc.id_number ?? doc.masked}
                {doc.id_type === 'aadhaar' && <span className="font-sans text-xs text-slate-400 ml-2">{t('guestId.aadhaarOnlyLast4')}</span>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}><X size={18} /></button>
        </div>
        {error && <p className="text-sm text-brand-red">{error}</p>}
        {!doc && !error && <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {t('common.loading')}</p>}
        {doc?.image && <canvas ref={canvasRef} className="max-w-full h-auto mx-auto rounded border border-slate-200" draggable={false} />}
        {doc && !doc.image && <p className="text-sm text-slate-500">{t('guestId.noPhoto')}</p>}
        <p className="text-xs text-slate-400 mt-3">{t('guestId.viewNotice')}</p>
      </div>
    </div>
  )
}

/**
 * The temple admin's edit of a booking — the safe edits (founder, 2026-09-23):
 * guest details, persons and notes at any time; room, dates and rate only until
 * checkout, and the API recalculates the bill. After checkout the money fields
 * are locked and the form says how to correct one.
 */
export function EditBookingModal({ booking, onClose, onSaved }: {
  booking: RoomBooking & { guest_email?: string | null; guest_address?: string | null; guest_gstin?: string | null; notes?: string | null }
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const finalBill = booking.status === 'checked_out'
  const [rooms, setRooms] = useState<{ id: string; room_number: string; name?: string | null }[]>([])
  const [f, setF] = useState({
    name: booking.guest_name ?? '',
    mobile: booking.guest_mobile ?? '',
    email: booking.guest_email ?? '',
    address: booking.guest_address ?? '',
    gstin: booking.guest_gstin ?? '',
    persons: String(booking.persons_count ?? 1),
    notes: booking.notes ?? '',
    room_id: booking.room_id,
    // istDate, not .slice(0, 10): a Postgres DATE serialises as the UTC
    // instant of IST midnight, so slicing it shows (and would send) the day before.
    check_in_date: istDate(booking.check_in_date),
    check_out_date: istDate(booking.check_out_date),
    rate: fmtPaise(booking.tariff_per_night_paise ?? 0).replace(/,/g, ''),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAllPages<{ id: string; room_number: string; name?: string | null }>('/rooms').then(setRooms).catch(() => setRooms([]))
  }, [])

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }))

  async function save() {
    setBusy(true)
    setError('')
    // Only what changed goes up — an untouched field must not overwrite what
    // another screen set in the meantime.
    const guest: Record<string, string | null> = {}
    if (f.name.trim() !== (booking.guest_name ?? '')) guest.name = f.name.trim()
    if (f.mobile.trim() !== (booking.guest_mobile ?? '')) guest.mobile = f.mobile.trim()
    if (f.email.trim() !== (booking.guest_email ?? '')) guest.email = f.email.trim() || null
    if (f.address.trim() !== (booking.guest_address ?? '')) guest.address = f.address.trim() || null
    if (f.gstin.trim().toUpperCase() !== (booking.guest_gstin ?? '')) guest.gstin = f.gstin.trim() || null
    const body: Record<string, unknown> = {}
    if (Object.keys(guest).length) body.guest = guest
    if (Number(f.persons) !== booking.persons_count) body.persons_count = Number(f.persons)
    if (f.notes !== (booking.notes ?? '')) body.notes = f.notes
    if (!finalBill) {
      if (f.room_id !== booking.room_id) body.room_id = f.room_id
      if (f.check_in_date !== istDate(booking.check_in_date)) body.check_in_date = f.check_in_date
      if (f.check_out_date !== istDate(booking.check_out_date)) body.check_out_date = f.check_out_date
      const ratePaise = parsePaise(f.rate)
      if (ratePaise !== Number(booking.tariff_per_night_paise)) body.tariff_per_night_paise = ratePaise
    }
    if (!Object.keys(body).length) { setBusy(false); onClose(); return }
    try {
      const { data } = await api.patch(`/room-bookings/${booking.id}`, body)
      toast.success(data.data?.recalculated
        ? t('editBooking.savedRecalculated', { total: fmtPaise(data.data.total_paise) })
        : t('editBooking.saved'))
      onSaved()
    } catch (e) {
      setError(apiErrorMessage(e, t('editBooking.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-bold text-navy-900">{t('editBooking.title')}</h3>
            <p className="text-sm text-slate-500">{booking.invoice_no ?? ''} · {t('dharamshala.room')} {booking.room_number}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}><X size={18} /></button>
        </div>

        <h4 className="text-sm font-semibold text-navy-900 mb-2">{t('editBooking.guest')}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="form-label" htmlFor="eb-name">{t('common.name')}</label><input id="eb-name" className="form-input" value={f.name} onChange={set('name')} /></div>
          <div><label className="form-label" htmlFor="eb-mobile">{t('donors.mobile')}</label><input id="eb-mobile" className="form-input" value={f.mobile} onChange={set('mobile')} inputMode="tel" /></div>
          <div><label className="form-label" htmlFor="eb-email">{t('common.email')}</label><input id="eb-email" className="form-input" value={f.email} onChange={set('email')} type="email" /></div>
          <div><label className="form-label" htmlFor="eb-gstin">GSTIN</label><input id="eb-gstin" className="form-input uppercase" value={f.gstin} onChange={set('gstin')} maxLength={15} /></div>
          <div className="sm:col-span-2"><label className="form-label" htmlFor="eb-address">{t('editBooking.address')}</label><input id="eb-address" className="form-input" value={f.address} onChange={set('address')} /></div>
          <div><label className="form-label" htmlFor="eb-persons">{t('dharamshala.persons')}</label><input id="eb-persons" className="form-input" type="number" min={1} max={99} value={f.persons} onChange={set('persons')} /></div>
          <div className="sm:col-span-2"><label className="form-label" htmlFor="eb-notes">{t('editBooking.notes')}</label><textarea id="eb-notes" className="form-input" rows={2} value={f.notes} onChange={set('notes')} /></div>
        </div>

        <h4 className="text-sm font-semibold text-navy-900 mt-5 mb-2">{t('editBooking.stay')}</h4>
        {finalBill && <p className="text-xs bg-amber-50 text-amber-800 rounded px-2 py-1.5 mb-2">{t('editBooking.finalHint')}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="eb-room">{t('dharamshala.room')}</label>
            <select id="eb-room" className="form-select" value={f.room_id} onChange={set('room_id')} disabled={finalBill}>
              {!rooms.some(r => r.id === f.room_id) && <option value={f.room_id}>{booking.room_number}</option>}
              {rooms.map(r => <option key={r.id} value={r.id}>{r.room_number}{r.name ? ` — ${r.name}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="eb-rate">{t('editBooking.rate')}</label>
            <input id="eb-rate" className="form-input" inputMode="decimal" value={f.rate} onChange={set('rate')} disabled={finalBill} />
          </div>
          <div>
            <label className="form-label" htmlFor="eb-in">{t('dharamshala.checkIn')}</label>
            <input id="eb-in" className="form-input" type="date" value={f.check_in_date} onChange={set('check_in_date')} disabled={finalBill} />
          </div>
          <div>
            <label className="form-label" htmlFor="eb-out">{t('dharamshala.checkOut')}</label>
            <input id="eb-out" className="form-input" type="date" value={f.check_out_date} onChange={set('check_out_date')} disabled={finalBill} />
          </div>
        </div>
        {!finalBill && <p className="text-xs text-slate-500 mt-2">{t('editBooking.recalcHint')}</p>}

        {error && <p className="text-sm text-brand-red mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary btn-sm">{t('common.cancel')}</button>
          <button onClick={() => void save()} disabled={busy} className="btn-primary btn-sm">
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
