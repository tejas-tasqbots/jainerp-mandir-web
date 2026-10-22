import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ImagePlus, Loader2, Megaphone, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api, apiErrorMessage, todayIst } from '../../../lib/api'
import { compressImage } from '../../../lib/imageCompress'
import { useToast } from '../../../components/kit/Toast'
import { useConfirm } from '../../../components/ConfirmDialog'

type EventState = 'hidden' | 'scheduled' | 'showing' | 'ended'

interface SiteEvent {
  id: string
  title: string
  details: string | null
  event_from: string | null
  event_to: string | null
  time_text: string | null
  venue: string | null
  link_url: string | null
  link_label: string | null
  show_from: string | null
  show_until: string | null
  is_published: boolean
  popup: boolean
  sort_order: number
  has_image: boolean
  state: EventState
  updated_at: string
}

interface Form {
  title: string
  details: string
  event_from: string
  event_to: string
  time_text: string
  venue: string
  link_url: string
  link_label: string
  show_from: string
  show_until: string
  is_published: boolean
  popup: boolean
}

const EMPTY: Form = {
  title: '', details: '', event_from: '', event_to: '', time_text: '', venue: '', link_url: '', link_label: '',
  show_from: '', show_until: '', is_published: true, popup: false,
}

const STATE_BADGE: Record<EventState, string> = {
  showing: 'badge-green', scheduled: 'badge-blue', ended: 'badge-gray', hidden: 'badge-gray',
}

/** "2026-11-14" → "14 Nov 2026" — a calendar day, never through the PC's zone. */
function dayLabel(day: string | null): string {
  if (!day) return ''
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** A pamphlet thumbnail, read with the signed-in user's token (the list itself carries no image bytes). */
function Thumb({ id, version }: { id: string; version: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    api.get(`/tenants/me/public-site/events/${id}/image`).then(r => { if (live) setSrc(r.data.data?.image ?? null) }).catch(() => {})
    return () => { live = false }
  }, [id, version])
  return src
    ? <img src={src} alt="" className="w-14 h-14 rounded object-cover border border-slate-200 flex-shrink-0" />
    : <div className="w-14 h-14 rounded bg-slate-100 flex-shrink-0" />
}

/**
 * Settings → Website & online payments → Events & pop-ups (tenant migration
 * 070).
 *
 * A programme or notice for the trust's own website: a pamphlet image, the
 * details, and the days the website shows it. Ticked "Open as a pop-up", it
 * also opens over the page when someone visits (once per visit). It shows on
 * the website as soon as it is saved - no deploy, no developer.
 */
export function WebsiteEvents({ siteUrl }: { siteUrl: string | null }) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<SiteEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SiteEvent | 'new' | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [image, setImage] = useState<string | null>(null) // the pamphlet shown in the form
  const [imageChanged, setImageChanged] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/tenants/me/public-site/events')
      setRows(data.data || [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function open(e: SiteEvent | 'new') {
    setError(''); setImageChanged(false); setImage(null)
    if (e === 'new') {
      setForm({ ...EMPTY, show_from: todayIst() })
    } else {
      setForm({
        title: e.title, details: e.details ?? '', event_from: e.event_from ?? '', event_to: e.event_to ?? '',
        time_text: e.time_text ?? '', venue: e.venue ?? '', link_url: e.link_url ?? '', link_label: e.link_label ?? '',
        show_from: e.show_from ?? '', show_until: e.show_until ?? '', is_published: e.is_published, popup: e.popup,
      })
      if (e.has_image) {
        api.get(`/tenants/me/public-site/events/${e.id}/image`).then(r => setImage(r.data.data?.image ?? null)).catch(() => {})
      }
    }
    setEditing(e)
  }

  async function pick(file: File | undefined) {
    if (!file) return
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError(t('website.events.imageType')); return }
    setImageBusy(true); setError('')
    try {
      // A pamphlet is mostly text: keep it larger than a room photo so it stays readable.
      setImage(await compressImage(file, { maxDim: 2000, maxBytes: 700_000 }))
      setImageChanged(true)
    } catch {
      setError(t('website.events.imageFailed'))
    } finally {
      setImageBusy(false)
    }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!editing) return
    if (!form.title.trim()) { setError(t('website.events.titleRequired')); return }
    setBusy(true); setError('')
    const body: Record<string, unknown> = { ...form }
    if (imageChanged) {
      if (image) body.image = image
      else body.remove_image = true
    }
    try {
      if (editing === 'new') await api.post('/tenants/me/public-site/events', body)
      else await api.put(`/tenants/me/public-site/events/${editing.id}`, body)
      toast.success(t('website.events.saved'))
      setEditing(null)
      await load()
    } catch (e) {
      setError(apiErrorMessage(e, t('website.events.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  async function remove(e: SiteEvent) {
    const ok = await confirm({
      title: t('website.events.deleteTitle'), message: t('website.events.deleteMessage', { title: e.title }),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), danger: true,
    })
    if (!ok) return
    try {
      await api.delete(`/tenants/me/public-site/events/${e.id}`)
      toast.success(t('website.events.deleted'))
      await load()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('website.events.saveFailed')))
    }
  }

  const when = (e: Pick<SiteEvent, 'event_from' | 'event_to' | 'time_text'>) => [
    e.event_from ? dayLabel(e.event_from) + (e.event_to ? ` – ${dayLabel(e.event_to)}` : '') : '',
    e.time_text ?? '',
  ].filter(Boolean).join(' · ')

  const popups = rows.filter(r => r.popup && r.state === 'showing')

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm flex items-center gap-2"><Megaphone size={15} /> {t('website.events.heading')}</h3>
        <button type="button" className="btn-primary btn-sm" onClick={() => open('new')}><Plus size={14} /> {t('website.events.add')}</button>
      </div>
      <div className="card-body space-y-3">
        <p className="text-xs text-slate-500">{t('website.events.intro')}</p>
        {popups.length > 1 && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">{t('website.events.manyPopups', { title: popups[0].title })}</p>
        )}
        {loading ? (
          <p className="text-sm text-slate-400 py-4 text-center">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center">
            <CalendarDays size={28} className="text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">{t('website.events.empty')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map(e => (
              <li key={e.id} className="py-3 flex items-start gap-3">
                {e.has_image ? <Thumb id={e.id} version={e.updated_at} /> : (
                  <div className="w-14 h-14 rounded bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center flex-shrink-0">
                    <CalendarDays size={18} className="text-slate-300" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-slate-800 truncate">{e.title}</p>
                  {when(e) && <p className="text-xs text-slate-500">{when(e)}{e.venue ? ` · ${e.venue}` : ''}</p>}
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span className={STATE_BADGE[e.state]}>{t(`website.events.state.${e.state}`)}</span>
                    {e.popup && <span className="badge-yellow">{t('website.events.popupBadge')}</span>}
                    {(e.show_from || e.show_until) && (
                      <span className="text-[11px] text-slate-400">
                        {t('website.events.window', { from: e.show_from ? dayLabel(e.show_from) : '—', until: e.show_until ? dayLabel(e.show_until) : t('website.events.untilOver') })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="p-1.5 rounded text-slate-500 hover:bg-slate-100" onClick={() => open(e)}
                    title={t('common.edit') as string} aria-label={`${t('common.edit')} ${e.title}`}><Pencil size={14} /></button>
                  <button type="button" className="p-1.5 rounded text-red-500 hover:bg-red-50" onClick={() => void remove(e)}
                    title={t('common.delete') as string} aria-label={`${t('common.delete')} ${e.title}`}><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {siteUrl && rows.some(r => r.state === 'showing') && (
          <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">{t('website.events.viewSite')}</a>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="site-event-title">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100">
              <h2 id="site-event-title" className="text-base font-bold text-navy-900">
                {editing === 'new' ? t('website.events.addTitle') : t('website.events.editTitle')}
              </h2>
              <button type="button" onClick={() => setEditing(null)} className="p-1 text-slate-400 hover:text-slate-700" aria-label={t('ui.close') as string}><X size={18} /></button>
            </div>
            <div className="p-6 grid sm:grid-cols-[180px_1fr] gap-5">
              <div className="space-y-2">
                <p className="form-label">{t('website.events.pamphlet')}</p>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={imageBusy}
                  className="w-full aspect-[3/4] rounded-lg border-2 border-dashed border-slate-200 hover:border-brand-red bg-slate-50 flex items-center justify-center overflow-hidden">
                  {imageBusy ? <Loader2 size={20} className="animate-spin text-slate-400" />
                    : image ? <img src={image} alt={t('website.events.pamphlet') as string} className="w-full h-full object-contain bg-white" />
                    : <span className="text-xs text-slate-400 flex flex-col items-center gap-1 p-2 text-center"><ImagePlus size={22} /> {t('website.events.pickImage')}</span>}
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" data-testid="site-event-file"
                  onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} />
                {image && (
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => { setImage(null); setImageChanged(true) }}>
                    {t('website.events.removeImage')}
                  </button>
                )}
                <p className="text-[11px] text-slate-400">{t('website.events.imageHelp')}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="form-label" htmlFor="se-title">{t('website.events.title')} *</label>
                  <input id="se-title" className="form-input" value={form.title} maxLength={200} onChange={e => set('title', e.target.value)}
                    placeholder={t('website.events.titlePlaceholder') as string} />
                </div>
                <div>
                  <label className="form-label" htmlFor="se-details">{t('website.events.details')}</label>
                  <textarea id="se-details" className="form-textarea" rows={4} maxLength={5000} value={form.details} onChange={e => set('details', e.target.value)}
                    placeholder={t('website.events.detailsPlaceholder') as string} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label" htmlFor="se-from">{t('website.events.eventFrom')}</label>
                    <input id="se-from" type="date" className="form-input" value={form.event_from} onChange={e => set('event_from', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="se-to">{t('website.events.eventTo')}</label>
                    <input id="se-to" type="date" className="form-input" min={form.event_from || undefined} value={form.event_to}
                      disabled={!form.event_from} onChange={e => set('event_to', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="se-time">{t('website.events.time')}</label>
                    <input id="se-time" className="form-input" maxLength={100} value={form.time_text} onChange={e => set('time_text', e.target.value)}
                      placeholder={t('website.events.timePlaceholder') as string} />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="se-venue">{t('website.events.venue')}</label>
                    <input id="se-venue" className="form-input" maxLength={255} value={form.venue} onChange={e => set('venue', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="se-link">{t('website.events.link')}</label>
                    <input id="se-link" className="form-input" placeholder="https://" maxLength={500} value={form.link_url} onChange={e => set('link_url', e.target.value.trim())} />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="se-link-label">{t('website.events.linkLabel')}</label>
                    <input id="se-link-label" className="form-input" maxLength={60} value={form.link_label} disabled={!form.link_url}
                      onChange={e => set('link_label', e.target.value)} placeholder={t('website.events.linkLabelPlaceholder') as string} />
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-3 space-y-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t('website.events.whenHeading')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label" htmlFor="se-show-from">{t('website.events.showFrom')}</label>
                      <input id="se-show-from" type="date" className="form-input" value={form.show_from} onChange={e => set('show_from', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="se-show-until">{t('website.events.showUntil')}</label>
                      <input id="se-show-until" type="date" className="form-input" min={form.show_from || undefined} value={form.show_until}
                        onChange={e => set('show_until', e.target.value)} />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">{t('website.events.whenHelp')}</p>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={form.is_published} onChange={e => set('is_published', e.target.checked)} />
                    <span>{t('website.events.published')}</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={form.popup} onChange={e => set('popup', e.target.checked)} />
                    <span>
                      {t('website.events.popup')}
                      <span className="block text-xs text-slate-400">{t('website.events.popupHelp')}</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
            {error && <p className="px-6 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)} disabled={busy}>{t('common.cancel')}</button>
              <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy || imageBusy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t('website.events.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
