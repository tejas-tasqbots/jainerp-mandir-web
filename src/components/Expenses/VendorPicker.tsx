import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Plus, Search, X } from 'lucide-react'
import { api, apiErrorMessage } from '../../lib/api'

export interface VendorRef { id: string; name: string; mobile?: string | null }

/**
 * Find a vendor in the Vendors / Suppliers master, or add one on the spot.
 *
 * Works like the donor and guest pickers: type a name or mobile, pick from the
 * matches, or add a new vendor with the name typed. The expense form used to
 * take free text with a browser suggestion list, so a typo made a second
 * vendor ("Ayush Kasliwal" and "Ayush Shailendra Kasliwal" in the screenshot)
 * and the vendor's product list could not be found.
 */
export function VendorPicker({ value, onChange, label }: {
  value: VendorRef | null
  onChange: (v: VendorRef | null) => void
  label?: string
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<VendorRef[]>([])
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [mobile, setMobile] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (value) return
    const handle = setTimeout(() => {
      api.get('/vendors', { params: { q: q.trim() || undefined, limit: '20', is_active: 'true' } })
        .then(r => setResults((r.data.data ?? []) as VendorRef[]))
        .catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(handle)
  }, [q, value])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  async function addVendor() {
    if (!q.trim()) return
    setBusy(true); setError('')
    try {
      const { data } = await api.post('/vendors', { name: q.trim(), ...(mobile.trim() ? { mobile: mobile.trim() } : {}) })
      const v = data.data as VendorRef
      onChange({ id: v.id, name: v.name, mobile: v.mobile ?? null })
      setAdding(false); setOpen(false); setQ(''); setMobile('')
    } catch (e) {
      setError(apiErrorMessage(e, t('vendorPicker.addFailed')))
    } finally {
      setBusy(false)
    }
  }

  const exact = results.some(r => r.name.trim().toLowerCase() === q.trim().toLowerCase())

  return (
    <div ref={box} className="relative" data-testid="vendor-picker">
      {label && <label className="form-label">{label}</label>}
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2" data-testid="vendor-selected">
          <Building2 size={15} className="text-green-700 shrink-0" />
          <span className="font-medium text-navy-900">{value.name}</span>
          {value.mobile && <span className="text-xs text-green-700">{value.mobile}</span>}
          <button type="button" className="ml-auto text-slate-400 hover:text-brand-red" onClick={() => onChange(null)}
            aria-label={t('vendorPicker.change')} title={t('vendorPicker.change')}>
            <X size={15} />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="form-input pl-8" value={q} placeholder={t('vendorPicker.search')} aria-label={t('vendorPicker.search')}
              onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true); setAdding(false) }} />
          </div>
          {open && (
            <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-72 overflow-y-auto" role="listbox">
              {results.map(r => (
                <button key={r.id} type="button" role="option" aria-selected={false} data-testid="vendor-option"
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2"
                  onClick={() => { onChange(r); setOpen(false); setQ('') }}>
                  <Building2 size={14} className="text-slate-400" />
                  <span className="text-sm text-navy-900">{r.name}</span>
                  {r.mobile && <span className="text-xs text-slate-400 ml-auto">{r.mobile}</span>}
                </button>
              ))}
              {results.length === 0 && !q.trim() && (
                <p className="px-3 py-2 text-sm text-slate-500">{t('vendorPicker.none')}</p>
              )}
              {q.trim() && !exact && !adding && (
                <button type="button" className="w-full text-left px-3 py-2 border-t border-slate-100 text-sm text-blue-700 hover:bg-blue-50 inline-flex items-center gap-1.5"
                  onClick={() => setAdding(true)} data-testid="vendor-add">
                  <Plus size={14} /> {t('vendorPicker.addNew', { name: q.trim() })}
                </button>
              )}
              {adding && (
                <div className="p-3 border-t border-slate-100 space-y-2">
                  <p className="text-sm font-medium text-navy-900">{t('vendorPicker.addNew', { name: q.trim() })}</p>
                  <input className="form-input" value={mobile} onChange={e => setMobile(e.target.value)} inputMode="tel"
                    placeholder={t('vendorPicker.mobileOptional')} aria-label={t('vendorPicker.mobileOptional')} />
                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <div className="flex gap-2 justify-end">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setAdding(false)}>{t('common.cancel')}</button>
                    <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={addVendor} data-testid="vendor-add-confirm">
                      {busy ? t('common.saving') : t('vendorPicker.add')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
