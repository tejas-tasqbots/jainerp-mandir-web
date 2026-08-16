import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, ImagePlus, Link2, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { compressImage } from '../../../lib/imageCompress'
import { DarshanTimings } from '../../../components/DarshanTimings'
import { MulnayakPicker } from '../../../components/MulnayakPicker'

interface ProfileLink { id: string; kind: string; label?: string | null; url: string }
interface Publication {
  id: string
  title: string
  kind: string
  language?: string | null
  year?: number | null
  publisher?: string | null
  isbn?: string | null
  description?: string | null
  url?: string | null
  has_cover?: boolean
}

/** Platforms with a known label. `other` carries its own. */
const LINK_KINDS = [
  'website', 'youtube', 'facebook', 'instagram', 'x', 'whatsapp',
  'telegram', 'linkedin', 'email', 'phone', 'other',
]
const PUB_KINDS = ['book', 'article', 'discourse', 'commentary', 'translation', 'other']

/**
 * The trust's **public** profile — what a devotee reads before giving or
 * travelling, as opposed to the operational record on the Profile tab.
 *
 * The split matters: Profile holds GSTIN, bank details and 80G registrations,
 * which are the trust's own books and are locked once verified. This is the
 * trust speaking in its own name, so it stays freely editable — and is
 * `temple_admin` only, enforced server-side.
 */
export function PublicProfileTab() {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    about: '', founded_year: '' as string | number, main_deity: '',
    darshan_timings: '', languages: '' as string,
  })
  const [links, setLinks] = useState<ProfileLink[]>([])
  const [pubs, setPubs] = useState<Publication[]>([])
  const [newLink, setNewLink] = useState({ kind: 'website', label: '', url: '' })
  const [newPub, setNewPub] = useState({
    title: '', kind: 'book', language: '', year: '', publisher: '', description: '', url: '',
  })
  /**
   * Cover art, compressed in the browser to a data: URI before it is sent —
   * the API stores it inline (so covers survive redeploys and land in DB
   * backups) and caps the payload at ~1 MB. 600px is plenty for a thumbnail
   * beside a title; sending the camera original would blow that ceiling and be
   * refused with a message the trustee cannot act on.
   */
  const [cover, setCover] = useState<{ dataUri: string; name: string } | null>(null)
  const [templeType, setTempleType] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const [p, l, b] = await Promise.all([
        api.get('/tenants/me/public-profile'),
        api.get('/tenants/me/links'),
        api.get('/tenants/me/publications'),
      ])
      const d = p.data.data ?? {}
      setForm({
        about: d.about ?? '',
        founded_year: d.founded_year ?? '',
        main_deity: d.main_deity ?? '',
        darshan_timings: d.darshan_timings ?? '',
        languages: (d.languages ?? []).join(', '),
      })
      setTempleType(d.temple_type ?? null)
      setLinks(l.data.data ?? [])
      setPubs(b.data.data ?? [])
    } catch { /* keep whatever is on screen */ }
  }

  /** The server's message is written for the trustee — show it, don't replace it. */
  function fail(e: any) {
    setErr(e?.response?.data?.error?.message ?? 'Could not save. Please try again.')
    setOk('')
  }

  async function saveProfile() {
    setSaving(true); setErr(''); setOk('')
    try {
      await api.patch('/tenants/me/public-profile', {
        about: form.about,
        founded_year: form.founded_year === '' ? null : Number(form.founded_year),
        main_deity: form.main_deity,
        darshan_timings: form.darshan_timings,
        // Comma-separated in the box, an array on the wire — trustees type
        // "Hindi, Gujarati", not JSON.
        languages: form.languages.split(',').map(s => s.trim()).filter(Boolean),
      })
      setOk(t('common.saved', 'Saved'))
      await load()
    } catch (e) { fail(e) } finally { setSaving(false) }
  }

  async function addLink() {
    if (!newLink.url.trim()) { setErr('A link needs a URL'); return }
    setSaving(true); setErr(''); setOk('')
    try {
      await api.post('/tenants/me/links', {
        kind: newLink.kind,
        label: newLink.label.trim() || undefined,
        url: newLink.url.trim(),
      })
      setNewLink({ kind: 'website', label: '', url: '' })
      await load()
    } catch (e) { fail(e) } finally { setSaving(false) }
  }

  async function removeLink(id: string) {
    try { await api.delete(`/tenants/me/links/${id}`); await load() } catch (e) { fail(e) }
  }

  async function pickCover(file: File) {
    setErr('')
    try {
      const dataUri = await compressImage(file, { maxDim: 600, maxBytes: 250_000 })
      setCover({ dataUri, name: file.name })
    } catch {
      setErr('Could not read that image. Try a JPEG or PNG.')
    }
  }

  async function addPub() {
    if (!newPub.title.trim()) { setErr('A publication needs a title'); return }
    setSaving(true); setErr(''); setOk('')
    try {
      await api.post('/tenants/me/publications', {
        title: newPub.title.trim(),
        kind: newPub.kind,
        language: newPub.language.trim() || undefined,
        year: newPub.year === '' ? undefined : Number(newPub.year),
        publisher: newPub.publisher.trim() || undefined,
        description: newPub.description.trim() || undefined,
        url: newPub.url.trim() || undefined,
        cover_base64: cover?.dataUri,
        // The API validates the data-URI prefix, so the MIME must match what
        // compressImage actually produced rather than the file's own type.
        cover_mime: cover ? cover.dataUri.slice(5, cover.dataUri.indexOf(';')) : undefined,
      })
      setNewPub({ title: '', kind: 'book', language: '', year: '', publisher: '', description: '', url: '' })
      setCover(null)
      await load()
    } catch (e) { fail(e) } finally { setSaving(false) }
  }

  async function removePub(id: string) {
    try { await api.delete(`/tenants/me/publications/${id}`); await load() } catch (e) { fail(e) }
  }

  return (
    <div className="space-y-6">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {ok && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</div>}

      {/* ── the trust in its own words ─────────────────────────────────── */}
      <section className="card p-4">
        <h3 className="text-sm font-semibold text-slate-700">
          {t('settings.publicProfile.heading', 'What devotees see')}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {t('settings.publicProfile.hint',
            'This appears on your temple page in the devotee app. It is separate from the registration and bank details on the Profile tab.')}
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="form-label">{t('settings.publicProfile.about', 'About this trust')}</label>
            <textarea className="form-input" rows={5} value={form.about}
              placeholder="A Digambar Jain trust serving pilgrims since 1893…"
              onChange={e => setForm(f => ({ ...f, about: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('settings.publicProfile.foundedYear', 'Founded in')}</label>
              <input className="form-input" type="number" value={form.founded_year}
                placeholder="1893"
                onChange={e => setForm(f => ({ ...f, founded_year: e.target.value }))} />
            </div>
            <MulnayakPicker
              label={t('settings.publicProfile.mainDeity', 'Mulnayak / main deity')}
              value={form.main_deity}
              templeType={templeType}
              onChange={v => setForm(f => ({ ...f, main_deity: v }))}
            />
          </div>

          {/* Picked, not typed — but a value that does not parse stays exactly
              as written, so festival exceptions phrased in the trust's own words
              are never rewritten. */}
          <DarshanTimings
            label={t('settings.publicProfile.timings', 'Darshan timings')}
            value={form.darshan_timings}
            onChange={v => setForm(f => ({ ...f, darshan_timings: v }))}
            hint={t('settings.publicProfile.timingsHint', 'Most mandirs close midday — set both sessions.')}
          />

          <div>
            <label className="form-label">{t('settings.publicProfile.languages', 'Languages spoken')}</label>
            <input className="form-input" value={form.languages}
              placeholder="Hindi, Gujarati, English"
              onChange={e => setForm(f => ({ ...f, languages: e.target.value }))} />
          </div>

          <button onClick={saveProfile} disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </button>
        </div>
      </section>

      {/* ── links ──────────────────────────────────────────────────────── */}
      <section className="card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Link2 size={16} /> {t('settings.publicProfile.links', 'Website & social links')}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          One account per platform — adding a second replaces the first. Use “Other” for anything else.
        </p>

        <div className="mt-3 space-y-2">
          {links.map(l => (
            <div key={l.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <span className="w-24 shrink-0 text-xs font-medium capitalize text-slate-500">{l.kind}</span>
              <a href={l.url} target="_blank" rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm text-brand-red hover:underline">
                {l.label || l.url}
              </a>
              <button onClick={() => removeLink(l.id)} className="p-1 text-slate-400 hover:text-red-600"
                aria-label={t('ui.removeLink')}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {links.length === 0 && <p className="text-sm text-slate-400">{t('ui.noLinks')}</p>}
        </div>

        <div className="mt-3 grid grid-cols-12 gap-2">
          <select className="form-input col-span-3" value={newLink.kind}
            onChange={e => setNewLink(l => ({ ...l, kind: e.target.value }))}>
            {LINK_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <input className="form-input col-span-3" placeholder={t('ui.labelOpt')} value={newLink.label}
            onChange={e => setNewLink(l => ({ ...l, label: e.target.value }))} />
          <input className="form-input col-span-4" placeholder="youtube.com/@yourtemple" value={newLink.url}
            onChange={e => setNewLink(l => ({ ...l, url: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && addLink()} />
          <button onClick={addLink} disabled={saving} className="btn-secondary col-span-2">
            <Plus size={15} /> Add
          </button>
        </div>
      </section>

      {/* ── publications ───────────────────────────────────────────────── */}
      <section className="card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <BookOpen size={16} /> {t('settings.publicProfile.publications', 'Books & publications')}
        </h3>
        <p className="mt-1 text-xs text-slate-500">{t('ui.worksHelp')}</p>

        <div className="mt-3 space-y-2">
          {pubs.map(p => (
            <div key={p.id} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-slate-100">
                {p.has_cover
                  ? <BookOpen size={15} className="text-brand-red" />
                  : <BookOpen size={15} className="text-slate-300" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{p.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {[p.kind, p.language, p.year, p.publisher].filter(Boolean).join(' · ')}
                </p>
                {p.description && <p className="mt-1 text-xs text-slate-500">{p.description}</p>}
              </div>
              <button onClick={() => removePub(p.id)} className="p-1 text-slate-400 hover:text-red-600"
                aria-label={t('ui.removePublication')}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {pubs.length === 0 && <p className="text-sm text-slate-400">{t('ui.nothingPublished')}</p>}
        </div>

        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-12 gap-2">
            <input className="form-input col-span-6" placeholder={t('ui.titleReq')} value={newPub.title}
              onChange={e => setNewPub(p => ({ ...p, title: e.target.value }))} />
            <select className="form-input col-span-3" value={newPub.kind}
              onChange={e => setNewPub(p => ({ ...p, kind: e.target.value }))}>
              {PUB_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input className="form-input col-span-3" type="number" placeholder={t('ui.year')} value={newPub.year}
              onChange={e => setNewPub(p => ({ ...p, year: e.target.value }))} />
          </div>
          <div className="grid grid-cols-12 gap-2">
            <input className="form-input col-span-3" placeholder={t('ui.language')} value={newPub.language}
              onChange={e => setNewPub(p => ({ ...p, language: e.target.value }))} />
            <input className="form-input col-span-4" placeholder={t('ui.publisher')} value={newPub.publisher}
              onChange={e => setNewPub(p => ({ ...p, publisher: e.target.value }))} />
            <input className="form-input col-span-5" placeholder={t('ui.linkOpt')} value={newPub.url}
              onChange={e => setNewPub(p => ({ ...p, url: e.target.value }))} />
          </div>
          <textarea className="form-input" rows={2} placeholder={t('ui.shortDescription')} value={newPub.description}
            onChange={e => setNewPub(p => ({ ...p, description: e.target.value }))} />

          <div className="flex items-center gap-3">
            {cover ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <img src={cover.dataUri} alt="" className="h-10 w-8 rounded object-cover" />
                <span className="max-w-[12rem] truncate text-xs text-slate-600">{cover.name}</span>
                <button onClick={() => setCover(null)} aria-label={t('ui.removeCover')}
                  className="p-0.5 text-slate-400 hover:text-red-600">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="btn-secondary cursor-pointer">
                <ImagePlus size={15} />{t('ui.coverImage')}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void pickCover(f); e.target.value = '' }} />
              </label>
            )}
            <button onClick={addPub} disabled={saving} className="btn-secondary">
              <Plus size={15} />{t('ui.addPublication')}</button>
          </div>
        </div>
      </section>
    </div>
  )
}
