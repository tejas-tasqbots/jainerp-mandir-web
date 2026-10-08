import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise, parsePaise } from '../../lib/api'
import { useToast } from '../../components/kit/Toast'
import { useConfirm } from '../../components/ConfirmDialog'

/**
 * Settings → Hall packages, and what each venue costs per rate category
 * (tenant migration 061).
 *
 * Asked for 2026-10-08: "with the hall they can provide full rooms, lawns,
 * multiple halls and multiple rooms … and different charges for different
 * people". A package is a bundle — several halls and lawns, the rooms that go
 * with them — at one price per day or half-day; a rate category (Sangh member,
 * non-member …) may carry its own price for any package or venue. The
 * generic master editor cannot express a bundle or a price grid, so this is
 * its own screen.
 */

interface Hall { id: string; name: string; venue_type?: string | null }
interface Room { id: string; room_number: string; building?: string | null }
interface RateCategory { id: string; name: string; is_active?: boolean }
interface PackagePrice { rate_category_id: string; rate_category_name?: string; fullday_paise: number; session_paise: number }
interface HallPackage {
  id: string; name: string; description?: string | null; inclusions?: string | null
  fullday_price_paise: number; session_price_paise: number; gst_rate: number | null
  is_active: boolean; sort_order: number
  venues: Hall[]; rooms: Room[]; prices: PackagePrice[]
}
interface VenueRates {
  hall_id: string; name: string; venue_type: string
  standard: { fullday_paise: number; session_paise: number; hourly_paise: number }
  rates: { rate_category_id: string; fullday_paise: number; session_paise: number; hourly_paise: number }[]
}

const rupees = (p: number) => (p ? String(p / 100) : '')

type Draft = Omit<Partial<HallPackage>, 'prices'> & { prices: Record<string, { full: string; half: string }> }

export function HallPackagesEditor() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const [packages, setPackages] = useState<HallPackage[]>([])
  const [halls, setHalls] = useState<Hall[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [cats, setCats] = useState<RateCategory[]>([])
  const [rates, setRates] = useState<VenueRates[]>([])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const [p, h, r, c, vr] = await Promise.all([
      api.get('/hall-packages', { params: { all: 'true' } }).then(x => x.data.data ?? []).catch(() => []),
      api.get('/halls', { params: { limit: '200' } }).then(x => x.data.data ?? []).catch(() => []),
      api.get('/rooms', { params: { limit: '500' } }).then(x => x.data.data ?? []).catch(() => []),
      api.get('/rate-categories', { params: { limit: '100' } }).then(x => (x.data.data ?? []).filter((c: RateCategory) => c.is_active !== false)).catch(() => []),
      api.get('/hall-rates').then(x => x.data.data ?? []).catch(() => []),
    ])
    setPackages(p); setHalls(h); setRooms(r); setCats(c); setRates(vr)
  }
  useEffect(() => { void load() }, [])

  function startNew() {
    setError('')
    setEditing({ name: '', description: '', inclusions: '', fullday_price_paise: 0, session_price_paise: 0, gst_rate: null,
      is_active: true, sort_order: 0, venues: [], rooms: [], prices: {} })
  }
  function startEdit(p: HallPackage) {
    setError('')
    const prices: Record<string, { full: string; half: string }> = {}
    for (const x of p.prices) prices[x.rate_category_id] = { full: rupees(x.fullday_paise), half: rupees(x.session_paise) }
    setEditing({ ...p, prices })
  }
  const toggle = <T extends { id: string }>(list: T[] | undefined, item: T): T[] =>
    (list ?? []).some(x => x.id === item.id) ? (list ?? []).filter(x => x.id !== item.id) : [...(list ?? []), item]

  async function save() {
    if (!editing) return
    setSaving(true)
    setError('')
    try {
      const body = {
        name: editing.name, description: editing.description || null, inclusions: editing.inclusions || null,
        fullday_price_paise: editing.fullday_price_paise ?? 0, session_price_paise: editing.session_price_paise ?? 0,
        gst_rate: editing.gst_rate ?? null, is_active: editing.is_active !== false, sort_order: editing.sort_order ?? 0,
        hall_ids: (editing.venues ?? []).map(v => v.id), room_ids: (editing.rooms ?? []).map(r => r.id),
        prices: Object.entries(editing.prices).map(([rate_category_id, v]) => ({
          rate_category_id, fullday_paise: v.full ? parsePaise(v.full) : 0, session_paise: v.half ? parsePaise(v.half) : 0,
        })),
      }
      if (editing.id) await api.patch(`/hall-packages/${editing.id}`, body)
      else await api.post('/hall-packages', body)
      toast.success(t('hallPackages.saved'))
      setEditing(null)
      await load()
    } catch (e) {
      setError(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function remove(p: HallPackage) {
    if (!(await confirm({ title: t('hallPackages.deleteTitle'), message: t('hallPackages.deleteMessage', { name: p.name }), confirmLabel: t('common.delete') }))) return
    try { await api.delete(`/hall-packages/${p.id}`); await load() } catch (e) { toast.error(apiErrorMessage(e, t('common.saveFailed'))) }
  }

  // Venue prices per category: edited in place, saved per venue.
  const [rateDraft, setRateDraft] = useState<Record<string, Record<string, { full: string; half: string; hour: string }>>>({})
  useEffect(() => {
    const d: typeof rateDraft = {}
    for (const v of rates) {
      d[v.hall_id] = {}
      for (const r of v.rates) d[v.hall_id][r.rate_category_id] = { full: rupees(r.fullday_paise), half: rupees(r.session_paise), hour: rupees(r.hourly_paise) }
    }
    setRateDraft(d)
  }, [rates])
  async function saveRates(hallId: string) {
    try {
      await api.patch(`/hall-rates/${hallId}`, {
        rates: Object.entries(rateDraft[hallId] ?? {}).map(([rate_category_id, v]) => ({
          rate_category_id, fullday_paise: v.full ? parsePaise(v.full) : 0, session_paise: v.half ? parsePaise(v.half) : 0, hourly_paise: v.hour ? parsePaise(v.hour) : 0,
        })),
      })
      toast.success(t('hallPackages.ratesSaved'))
      await load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    }
  }
  const setRate = (hallId: string, catId: string, k: 'full' | 'half' | 'hour', v: string) =>
    setRateDraft(d => ({ ...d, [hallId]: { ...(d[hallId] ?? {}), [catId]: { ...(d[hallId]?.[catId] ?? { full: '', half: '', hour: '' }), [k]: v } } }))

  return (
    <div className="space-y-5" data-testid="hall-packages-editor">
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-navy-900">{t('hallPackages.title')}</h3>
            <p className="text-xs text-slate-500">{t('hallPackages.hint')}</p>
          </div>
          {!editing && <button className="btn-primary btn-sm" onClick={startNew} data-testid="package-new"><Plus size={14} /> {t('hallPackages.add')}</button>}
        </div>
        <div className="card-body space-y-3">
          {!packages.length && !editing && <p className="text-sm text-slate-400">{t('hallPackages.none')}</p>}
          {!editing && packages.map(p => (
            <div key={p.id} className={`rounded-lg border p-3 ${p.is_active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`} data-testid={`package-${p.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-navy-900">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.venues.map(v => v.name).join(' + ')}
                    {p.rooms.length > 0 && ` · ${t('hallPackages.roomsCount', { count: p.rooms.length })}`}
                  </p>
                  {p.inclusions && <p className="text-xs text-slate-500 mt-1">{p.inclusions}</p>}
                </div>
                <div className="text-right text-sm whitespace-nowrap">
                  <p><b>₹{fmtPaise(p.fullday_price_paise)}</b> <span className="text-xs text-slate-500">{t('hallPackages.perFullDay')}</span></p>
                  {p.session_price_paise > 0 && <p><b>₹{fmtPaise(p.session_price_paise)}</b> <span className="text-xs text-slate-500">{t('hallPackages.perHalfDay')}</span></p>}
                  {p.prices.length > 0 && <p className="text-xs text-slate-500">{p.prices.map(x => `${x.rate_category_name}: ₹${fmtPaise(x.fullday_paise)}`).join(' · ')}</p>}
                </div>
                <div className="flex gap-1">
                  <button className="p-1.5 text-slate-500 hover:text-navy-900" onClick={() => startEdit(p)} aria-label={t('common.edit')}><Pencil size={14} /></button>
                  <button className="p-1.5 text-slate-400 hover:text-red-600" onClick={() => remove(p)} aria-label={t('common.delete')}><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}

          {editing && (
            <div className="rounded-lg border border-navy-200 bg-slate-50 p-4 space-y-3" data-testid="package-form">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="pkg-name">{t('settings.masters.fields.name')}</label>
                  <input id="pkg-name" className="form-input" value={editing.name ?? ''} placeholder={t('hallPackages.namePlaceholder') as string}
                    onChange={e => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="pkg-incl">{t('hallPackages.inclusions')}</label>
                  <input id="pkg-incl" className="form-input" value={editing.inclusions ?? ''} placeholder={t('hallPackages.inclusionsPlaceholder') as string}
                    onChange={e => setEditing({ ...editing, inclusions: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="pkg-full">{t('hallPackages.fullDayPrice')}</label>
                  <input id="pkg-full" className="form-input" inputMode="decimal" value={rupees(editing.fullday_price_paise ?? 0)}
                    onChange={e => setEditing({ ...editing, fullday_price_paise: e.target.value ? parsePaise(e.target.value) : 0 })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="pkg-half">{t('hallPackages.halfDayPrice')}</label>
                  <input id="pkg-half" className="form-input" inputMode="decimal" value={rupees(editing.session_price_paise ?? 0)}
                    onChange={e => setEditing({ ...editing, session_price_paise: e.target.value ? parsePaise(e.target.value) : 0 })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="pkg-gst">{t('settings.masters.fields.gstPercent')}</label>
                  <input id="pkg-gst" className="form-input" inputMode="decimal" placeholder={t('hallPackages.gstFromHall') as string}
                    value={editing.gst_rate ?? ''} onChange={e => setEditing({ ...editing, gst_rate: e.target.value === '' ? null : Number(e.target.value) })} />
                </div>
                <label className="flex items-center gap-2 text-sm mt-6">
                  <input type="checkbox" checked={editing.is_active !== false} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
                  {t('hallPackages.active')}
                </label>
              </div>

              <div>
                <p className="form-label">{t('hallPackages.venues')}</p>
                <div className="flex flex-wrap gap-2">
                  {halls.map(h => {
                    const on = (editing.venues ?? []).some(v => v.id === h.id)
                    return (
                      <button key={h.id} type="button" onClick={() => setEditing({ ...editing, venues: toggle(editing.venues, h) })}
                        className={`rounded-full border px-3 py-1 text-xs ${on ? 'bg-navy-900 text-white border-navy-900' : 'bg-white border-slate-300 text-slate-600'}`}>
                        {h.name}{h.venue_type && h.venue_type !== 'hall' ? ` · ${t(`hallPackages.venue.${h.venue_type}`)}` : ''}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="form-label">{t('hallPackages.rooms')} <span className="text-xs font-normal text-slate-400">{t('hallPackages.roomsHint')}</span></p>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {rooms.map(r => {
                    const on = (editing.rooms ?? []).some(x => x.id === r.id)
                    return (
                      <button key={r.id} type="button" onClick={() => setEditing({ ...editing, rooms: toggle(editing.rooms, r) })}
                        className={`rounded border px-2 py-0.5 text-xs font-mono ${on ? 'bg-navy-900 text-white border-navy-900' : 'bg-white border-slate-300 text-slate-600'}`}>
                        {r.building ? `${r.building}-` : ''}{r.room_number}
                      </button>
                    )
                  })}
                </div>
              </div>

              {cats.length > 0 && (
                <div>
                  <p className="form-label">{t('hallPackages.pricesByCategory')}</p>
                  <table className="text-sm">
                    <thead><tr className="text-xs text-slate-500"><th className="text-left pr-4">{t('hallPackages.rateCategory')}</th><th className="pr-2">{t('hallPackages.fullDay')}</th><th>{t('hallPackages.halfDay')}</th></tr></thead>
                    <tbody>
                      {cats.map(c => (
                        <tr key={c.id}>
                          <td className="pr-4 py-1">{c.name}</td>
                          <td className="pr-2 py-1"><input className="form-input !py-1 w-28" inputMode="decimal" placeholder={t('hallPackages.standard') as string}
                            value={editing.prices[c.id]?.full ?? ''} aria-label={`${c.name} ${t('hallPackages.fullDay')}`}
                            onChange={e => setEditing({ ...editing, prices: { ...editing.prices, [c.id]: { ...(editing.prices[c.id] ?? { full: '', half: '' }), full: e.target.value } } })} /></td>
                          <td className="py-1"><input className="form-input !py-1 w-28" inputMode="decimal" placeholder={t('hallPackages.standard') as string}
                            value={editing.prices[c.id]?.half ?? ''} aria-label={`${c.name} ${t('hallPackages.halfDay')}`}
                            onChange={e => setEditing({ ...editing, prices: { ...editing.prices, [c.id]: { ...(editing.prices[c.id] ?? { full: '', half: '' }), half: e.target.value } } })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-slate-500 mt-1">{t('hallPackages.blankIsStandard')}</p>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button className="btn-secondary btn-sm" onClick={() => setEditing(null)}><X size={14} /> {t('common.cancel')}</button>
                <button className="btn-primary btn-sm" onClick={save} disabled={saving} data-testid="package-save"><Save size={14} /> {saving ? t('common.saving') : t('common.save')}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-navy-900">{t('hallPackages.venueRates')}</h3>
          <p className="text-xs text-slate-500">{cats.length ? t('hallPackages.venueRatesHint') : t('hallPackages.addCategoriesFirst')}</p>
        </div>
        {cats.length > 0 && (
          <div className="card-body overflow-x-auto space-y-4">
            {rates.map(v => (
              <div key={v.hall_id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium">{v.name} <span className="text-xs text-slate-500">· {t('hallPackages.standard')}: ₹{fmtPaise(v.standard.fullday_paise)} / ₹{fmtPaise(v.standard.session_paise)} / ₹{fmtPaise(v.standard.hourly_paise)}</span></p>
                  <button className="btn-secondary btn-sm" onClick={() => saveRates(v.hall_id)}><Save size={13} /> {t('common.save')}</button>
                </div>
                <table className="text-sm">
                  <thead><tr className="text-xs text-slate-500"><th className="text-left pr-4">{t('hallPackages.rateCategory')}</th><th className="pr-2">{t('hallPackages.fullDay')}</th><th className="pr-2">{t('hallPackages.halfDay')}</th><th>{t('hallPackages.perHour')}</th></tr></thead>
                  <tbody>
                    {cats.map(c => (
                      <tr key={c.id}>
                        <td className="pr-4 py-1">{c.name}</td>
                        {(['full', 'half', 'hour'] as const).map(k => (
                          <td key={k} className="pr-2 py-1">
                            <input className="form-input !py-1 w-24" inputMode="decimal" placeholder={t('hallPackages.standard') as string}
                              aria-label={`${v.name} ${c.name} ${k}`}
                              value={rateDraft[v.hall_id]?.[c.id]?.[k] ?? ''} onChange={e => setRate(v.hall_id, c.id, k, e.target.value)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
