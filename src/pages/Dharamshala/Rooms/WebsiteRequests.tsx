import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  BedDouble, CheckCircle, CloudOff, Copy, Globe, Loader2, MessageCircle, RefreshCw, Search, XCircle,
} from 'lucide-react'
import { api, apiErrorMessage, fmtPaise } from '../../../lib/api'
import { useToast } from '../../../components/kit/Toast'
import { useIsOnline } from '../../../lib/useIsOnline'
import { useAuthStore } from '../../../store/authStore'
import { canSeeRoles } from '../../../lib/rbac'

type Status = 'new' | 'confirmed' | 'paid' | 'rejected'

/** One kind of room asked for: "2 AC rooms" (tenant migration 070). */
interface RequestLine {
  room_type: string
  /** The website card it was asked from (type + tariff + beds) and that card's name. */
  category?: string | null
  label?: string | null
  rooms: number
  estimate_paise: number | null
}

interface BookingRequest {
  id: string
  ref: string
  room_type: string | null
  /** Every kind of room asked for; an old one-kind request comes as one line, "any room" as none. */
  lines: RequestLine[]
  /** What the website showed the yatri for the rooms, priced by the server. */
  estimate_paise: number | null
  check_in_date: string
  check_out_date: string
  nights: number
  persons_count: number
  rooms_wanted: number
  guest_name: string
  guest_mobile: string
  guest_email: string | null
  guest_city: string | null
  notes: string | null
  status: string
  booking_id: string | null
  amount_due_paise: number
  paid_paise: number
  paid_at: string | null
  pay_url: string | null
  review_note: string | null
  reviewed_by_name?: string | null
  reviewed_at: string | null
  room_numbers: string | null
  invoice_no?: string | null
  created_at: string
}

interface FreeRoom {
  id: string
  room_number: string
  name: string | null
  building: string | null
  floor: number | null
  room_type: string | null
  capacity_persons: number
  tariff_paise: number
  category?: string
  matches_type: boolean
}

const TABS: Status[] = ['new', 'confirmed', 'paid', 'rejected']

/** "2026-10-29" → "29 Oct" — read as a calendar day, never through the PC's zone. */
function dayLabel(day: string): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

/**
 * Rooms → Website requests: room requests from the trust's own website
 * (Settings → Website & online payments, "request" mode).
 *
 * The yatri asked for dates, people and a kind of room; the office picks the
 * rooms and confirms. Confirming books them like the counter does and gives a
 * pay link for the advance, which the office sends from its own WhatsApp. Lives
 * on the central server, so the desktop app shows it only while online.
 */
export function WebsiteRequests() {
  const { t } = useTranslation()
  const toast = useToast()
  const online = useIsOnline()
  const roles = useAuthStore(s => s.user?.roles)
  const canAct = canSeeRoles(['cashier'], roles)
  const [tab, setTab] = useState<Status>('new')
  const [rows, setRows] = useState<BookingRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [review, setReview] = useState<(BookingRequest & { free_rooms: FreeRoom[] }) | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [amountDue, setAmountDue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [rejecting, setRejecting] = useState<BookingRequest | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    if (online === false) return
    setLoading(true)
    try {
      const { data } = await api.get('/booking-requests', { params: { status: tab, q: q.trim() || undefined, limit: 100 } })
      setRows(data.data || [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [tab, q, online])

  useEffect(() => { void load() }, [load])

  async function openReview(r: BookingRequest) {
    setReviewError(''); setPicked([]); setAmountDue(''); setNote('')
    try {
      const { data } = await api.get(`/booking-requests/${r.id}`)
      setReview(data.data)
      // Pre-pick as many rooms of each kind as were asked for, cheapest first
      // (as the website priced them); "any room" takes the first free ones.
      const free = data.data.free_rooms as FreeRoom[]
      const lines: RequestLine[] = data.data.lines ?? []
      const match = lines.length
        ? lines.flatMap(l => free.filter(f => l.category ? f.category === l.category : (f.room_type || 'standard') === l.room_type)
            .sort((a, b) => a.tariff_paise - b.tariff_paise).slice(0, l.rooms).map(f => f.id))
        : free.slice(0, r.rooms_wanted).map(f => f.id)
      setPicked(match)
    } catch (e) {
      toast.error(apiErrorMessage(e, t('website.requests.loadFailed')))
    }
  }

  async function confirm() {
    if (!review) return
    if (!picked.length) { setReviewError(t('website.requests.pickRoom')); return }
    setBusy(true); setReviewError('')
    try {
      const body: Record<string, unknown> = { room_ids: picked, note: note.trim() || undefined }
      if (amountDue.trim() !== '') body.amount_due_paise = Math.round(Number(amountDue) * 100)
      const { data } = await api.patch(`/booking-requests/${review.id}/confirm`, body)
      setReview(null)
      toast.success(t('website.requests.confirmedToast', { ref: data.data.ref }))
      setTab('confirmed')
      await load()
    } catch (e) {
      setReviewError(apiErrorMessage(e, t('website.requests.confirmFailed')))
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    if (!rejecting) return
    if (!reason.trim()) return
    setBusy(true)
    try {
      await api.patch(`/booking-requests/${rejecting.id}/reject`, { reason: reason.trim() })
      setRejecting(null); setReason(''); setReview(null)
      await load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('website.requests.rejectFailed')))
    } finally {
      setBusy(false)
    }
  }

  function payMessage(r: BookingRequest): string {
    return t('website.requests.payMessage', {
      name: r.guest_name, ref: r.ref, from: dayLabel(r.check_in_date), to: dayLabel(r.check_out_date),
      rooms: r.room_numbers ?? '', amount: fmtPaise(r.amount_due_paise), link: r.pay_url ?? '',
    })
  }

  function copyLink(r: BookingRequest) {
    navigator.clipboard?.writeText(payMessage(r)).then(() => toast.success(t('website.settings.copied'))).catch(() => {})
  }

  function whatsapp(r: BookingRequest) {
    const digits = r.guest_mobile.replace(/\D/g, '')
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(payMessage(r))}`, '_blank', 'noopener')
  }

  if (online === false) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-bold text-navy-900">{t('website.requests.title')}</h1>
        <div className="card py-16 text-center">
          <CloudOff size={36} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium text-sm">{t('donationRequests.offlineTitle')}</p>
          <p className="text-slate-400 text-xs mt-1">{t('donationRequests.offlineBody')}</p>
        </div>
      </div>
    )
  }

  const typeLabel = (v: string | null) => v ? t(`website.rooms.types.${v}`, { defaultValue: v }) : t('website.requests.anyRoom')
  /** "2 × AC Room, 1 × Non-AC Room", or "Any room · 2 rooms". */
  const wantsLabel = (r: BookingRequest) => r.lines?.length
    ? r.lines.map(l => `${l.rooms} × ${l.label || typeLabel(l.room_type)}`).join(', ')
    : `${typeLabel(null)} · ${t('website.requests.roomsCount', { count: r.rooms_wanted })}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Globe size={18} className="text-brand-red" /> {t('website.requests.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('website.requests.subtitle')}</p>
        </div>
        <button onClick={() => void load()} className="btn-secondary btn-sm" title={t('ui.refresh') as string}><RefreshCw size={14} /></button>
      </div>

      <div className="relative w-full sm:w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder={t('website.requests.search') as string} value={q} onChange={e => setQ(e.target.value)} />
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map(s => (
          <button key={s} onClick={() => setTab(s)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${tab === s ? 'border-brand-red text-brand-red' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t(`website.requests.tabs.${s}`)}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">{t(`website.requests.empty.${tab}`)}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('website.requests.guest')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('website.requests.stay')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('website.requests.wants')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('common.status')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{r.guest_name}</p>
                    <p className="text-xs text-slate-400 tabular-nums">{r.guest_mobile}{r.guest_city ? ` · ${r.guest_city}` : ''}</p>
                    <p className="text-[11px] text-slate-400 font-mono">{r.ref}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p>{dayLabel(r.check_in_date)} → {dayLabel(r.check_out_date)}</p>
                    <p className="text-xs text-slate-400">{t('website.requests.nights', { count: r.nights })}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{wantsLabel(r)}</p>
                    <p className="text-xs text-slate-400">
                      {t('website.requests.persons', { count: r.persons_count })}
                      {r.estimate_paise != null && ` · ${t('website.requests.estimate', { amount: fmtPaise(r.estimate_paise) })}`}
                    </p>
                    {r.notes && <p className="text-xs text-slate-500 italic max-w-[220px] truncate" title={r.notes}>“{r.notes}”</p>}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'new' && <span className="badge-blue">{t('website.requests.tabs.new')}</span>}
                    {r.status === 'confirmed' && (
                      <div className="space-y-0.5">
                        <span className="badge-blue">{t('website.requests.tabs.confirmed')}</span>
                        <p className="text-xs text-slate-500">{t('website.requests.rooms')}: {r.room_numbers}</p>
                        {r.amount_due_paise > 0
                          ? <p className="text-xs text-amber-700">{t('website.requests.due', { amount: fmtPaise(r.amount_due_paise) })}</p>
                          : <p className="text-xs text-slate-500">{t('website.requests.payAtDesk')}</p>}
                      </div>
                    )}
                    {r.status === 'paid' && (
                      <div className="space-y-0.5">
                        <span className="badge-green">{t('website.requests.tabs.paid')}</span>
                        <p className="text-xs text-green-700">₹{fmtPaise(r.paid_paise)} · {r.room_numbers}</p>
                      </div>
                    )}
                    {r.status === 'rejected' && (
                      <div>
                        <span className="badge-red">{t('website.requests.tabs.rejected')}</span>
                        {r.review_note && <p className="text-xs text-red-500 max-w-[200px] truncate" title={r.review_note}>{r.review_note}</p>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      {r.status === 'new' && canAct && (
                        <>
                          <button onClick={() => void openReview(r)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700">
                            <BedDouble size={12} /> {t('website.requests.assign')}
                          </button>
                          <button onClick={() => { setRejecting(r); setReason('') }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-slate-200 text-slate-700 hover:bg-slate-300">
                            <XCircle size={12} /> {t('donationRequests.reject')}
                          </button>
                        </>
                      )}
                      {r.status === 'confirmed' && r.pay_url && (
                        <>
                          <button onClick={() => whatsapp(r)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700">
                            <MessageCircle size={12} /> {t('website.requests.sendWhatsapp')}
                          </button>
                          <button onClick={() => copyLink(r)} className="p-1.5 rounded text-slate-500 hover:bg-slate-100" title={t('website.requests.copyLink') as string}>
                            <Copy size={14} />
                          </button>
                        </>
                      )}
                      {r.status === 'confirmed' && !r.pay_url && r.amount_due_paise > 0 && (
                        <span className="text-xs text-amber-600" title={t('website.requests.noSiteUrlHelp') as string}>{t('website.requests.noSiteUrl')}</span>
                      )}
                      {(r.status === 'confirmed' || r.status === 'paid') && r.invoice_no && (
                        <Link to={`/rooms?q=${encodeURIComponent(r.invoice_no)}`} className="text-xs text-blue-600 hover:underline">{t('website.requests.openBooking')}</Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {review && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={() => setReview(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-navy-900">{review.guest_name} · <span className="font-mono text-sm">{review.ref}</span></h2>
                <p className="text-xs text-slate-500">
                  {dayLabel(review.check_in_date)} → {dayLabel(review.check_out_date)} · {t('website.requests.nights', { count: review.nights })} · {t('website.requests.persons', { count: review.persons_count })} · {wantsLabel(review)}
                  {review.estimate_paise != null && ` · ${t('website.requests.estimate', { amount: fmtPaise(review.estimate_paise) })}`}
                </p>
              </div>
              <button onClick={() => setReview(null)} className="p-1 text-slate-400 hover:text-slate-700"><XCircle size={18} /></button>
            </div>
            {review.notes && <p className="text-sm bg-slate-50 rounded p-2 italic">“{review.notes}”</p>}

            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{t('website.requests.freeRooms', { count: review.rooms_wanted })}</p>
              {review.free_rooms.length === 0 ? (
                <p className="text-sm text-amber-700">{t('website.requests.noneFree')}</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {/* The kinds asked for first, so the pre-picked rooms are in view. */}
                  {[...review.free_rooms].sort((a, b) => Number(b.matches_type) - Number(a.matches_type)).map(f => (
                    <label key={f.id} className={`flex items-start gap-2 border rounded-md p-2 cursor-pointer text-sm ${picked.includes(f.id) ? 'border-brand-red bg-red-50' : 'border-slate-200'} ${f.matches_type ? '' : 'opacity-70'}`}>
                      <input type="checkbox" className="mt-1" checked={picked.includes(f.id)}
                        onChange={e => setPicked(p => e.target.checked ? [...p, f.id] : p.filter(x => x !== f.id))} />
                      <span>
                        <b>{f.room_number}</b>{f.name ? ` · ${f.name}` : ''}
                        <span className="block text-xs text-slate-500">
                          {typeLabel(f.room_type)} · {t('website.requests.sleeps', { count: f.capacity_persons })} · ₹{fmtPaise(f.tariff_paise)}/{t('website.requests.night')}
                          {f.building ? ` · ${f.building}` : ''}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="form-label" htmlFor="br-amount-due">{t('website.requests.amountDue')}</label>
                <input id="br-amount-due" type="number" min="0" className="form-input" placeholder={t('website.requests.amountDueAuto') as string}
                  value={amountDue} onChange={e => setAmountDue(e.target.value)} />
                <p className="text-xs text-slate-400 mt-1">{t('website.requests.amountDueHelp')}</p>
              </div>
              <div>
                <label className="form-label" htmlFor="br-note">{t('website.requests.note')}</label>
                <input id="br-note" className="form-input" value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </div>
            {reviewError && <p className="text-sm text-red-600">{reviewError}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={() => { setRejecting(review); setReason('') }} className="btn-secondary"><XCircle size={14} /> {t('donationRequests.reject')}</button>
              <button onClick={() => void confirm()} disabled={busy || !picked.length} className="btn-primary">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} {t('website.requests.confirm', { count: picked.length })}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-navy-900">{t('website.requests.rejectTitle')}</h2>
            <p className="text-sm text-slate-500">{t('website.requests.rejectHelp')}</p>
            <textarea className="form-textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus
              placeholder={t('website.requests.rejectPlaceholder') as string} aria-label={t('common.reason') as string} />
            <div className="flex justify-end gap-3">
              <button onClick={() => setRejecting(null)} className="btn-secondary" disabled={busy}>{t('common.cancel')}</button>
              <button onClick={() => void reject()} disabled={busy || !reason.trim()} className="btn-primary bg-red-600 hover:bg-red-700">
                <XCircle size={14} /> {t('donationRequests.rejectRequest')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
