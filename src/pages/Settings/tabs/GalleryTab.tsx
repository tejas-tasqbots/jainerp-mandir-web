import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Trash2 } from 'lucide-react'
import { api } from '../../../lib/api'

interface Photo { id: string; title?: string; url: string; uploaded_at?: string }

/** Temple photo gallery — shown on the temple's public page in the devotee portal. */
export function GalleryTab() {
  const { t } = useTranslation()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() { try { const { data } = await api.get('/gallery'); setPhotos(data.data ?? data ?? []) } catch { /* */ } }

  async function add() {
    if (!url.trim()) { setErr(t('settings.gallery.urlRequired')); return }
    setSaving(true); setErr('')
    try {
      await api.post('/gallery', { title: title.trim() || undefined, url: url.trim() })
      setTitle(''); setUrl(''); await load()
    } catch (e: any) { setErr(e?.response?.data?.error?.message || t('settings.gallery.addFailed')) }
    finally { setSaving(false) }
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
        <button onClick={add} disabled={saving} className="btn-primary btn-sm"><ImagePlus size={13} /> {saving ? t('settings.saving') : t('settings.gallery.addPhoto')}</button>

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
