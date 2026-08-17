import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Trash2, Upload } from 'lucide-react'
import { api } from '../../../lib/api'
import { compressImage } from '../../../lib/imageCompress'

interface Photo { id: string; title?: string; url: string; uploaded_at?: string }

/**
 * Temple photo gallery — shown on the temple's public page in the devotee portal.
 *
 * TWO WAYS IN. A public image URL, and a file picked off the device.
 *
 * The picker exists because "paste a public image URL" assumes the trust
 * already hosts its photos somewhere, which almost none do — the photos are on
 * somebody's phone. Requiring a CDN first made the gallery effectively
 * unusable, and the form rejected an otherwise complete submission with
 * "Image URL is required".
 *
 * An uploaded file is stored as a base64 data URI in gallery.url, which is
 * TEXT. That is the same approach sant profile photos already take, for the
 * same reason: there is no object-storage upload path in this app yet, and a
 * data URI renders in the devotee portal with no further plumbing.
 * compressImage() downscales to 1600px and steps JPEG quality until the result
 * fits the byte budget, so a 6MB phone photo lands around 300KB rather than
 * bloating the row and every page that reads it.
 */
export function GalleryTab() {
  const { t } = useTranslation()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [])
  async function load() { try { const { data } = await api.get('/gallery'); setPhotos(data.data ?? data ?? []) } catch { /* */ } }

  /** Shared by both paths — the API only ever sees a string in `url`. */
  async function post(imageUrl: string) {
    await api.post('/gallery', { title: title.trim() || undefined, url: imageUrl })
    setTitle(''); setUrl('')
    if (fileRef.current) fileRef.current.value = ''
    await load()
  }

  async function add() {
    if (!url.trim()) { setErr(t('settings.gallery.urlRequired')); return }
    setSaving(true); setErr('')
    try { await post(url.trim()) }
    catch (e: any) { setErr(e?.response?.data?.error?.message || t('settings.gallery.addFailed')) }
    finally { setSaving(false) }
  }

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) { setErr(t('settings.gallery.imageOnly')); return }
    setSaving(true); setErr('')
    try {
      // 1600px / ~300KB. Big enough for a public page, small enough that a
      // gallery of twenty does not make the tenant row unwieldy.
      const dataUrl = await compressImage(file, { maxDim: 1600, maxBytes: 300_000 })
      await post(dataUrl)
    } catch (e: any) {
      setErr(e?.response?.data?.error?.message || t('settings.gallery.addFailed'))
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    try { await api.delete(`/gallery/${id}`); await load() } catch { /* */ }
  }

  return (
    <div className="card">
      <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><ImagePlus size={14} /> {t('settings.gallery.heading')}</h3></div>
      <div className="card-body space-y-4">
        <p className="text-xs text-slate-400">{t('settings.gallery.helpText')}</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input className="form-input md:col-span-1" placeholder={t('settings.gallery.captionPlaceholder') as string} value={title} onChange={e => setTitle(e.target.value)} />
          <input className="form-input md:col-span-2" placeholder={t('settings.gallery.urlPlaceholder') as string} value={url} onChange={e => setUrl(e.target.value)} />
        </div>

        {err && <p className="text-red-600 text-sm">{err}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={add} disabled={saving} className="btn-primary btn-sm">
            <ImagePlus size={13} /> {saving ? t('settings.saving') : t('settings.gallery.addPhoto')}
          </button>

          <span className="text-xs text-slate-400">{t('settings.gallery.or')}</span>

          {/* The caption above applies to an uploaded file too, so it is worth
              typing before choosing one. */}
          <button type="button" onClick={() => fileRef.current?.click()} disabled={saving}
            className="btn-secondary btn-sm">
            <Upload size={13} /> {t('settings.gallery.uploadPhoto')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f) }}
          />
        </div>
        <p className="text-xs text-slate-400">{t('settings.gallery.uploadHint')}</p>

        {photos.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
            {photos.map(p => (
              <div key={p.id} className="relative group rounded-lg overflow-hidden border border-slate-200 aspect-square">
                <img src={p.url} alt={p.title || ''} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3' }} />
                {p.title && <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] px-1.5 py-0.5 truncate">{p.title}</div>}
                <button onClick={() => remove(p.id)} className="absolute top-1 right-1 bg-white/90 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand-red">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        {photos.length === 0 && <p className="text-center text-slate-400 text-sm py-4">{t('settings.gallery.noPhotos')}</p>}
      </div>
    </div>
  )
}
