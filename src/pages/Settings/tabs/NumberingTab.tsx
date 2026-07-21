import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, RotateCcw } from 'lucide-react'
import { api } from '../../../lib/api'
import { useToast } from '../../../components/kit/Toast'

interface Series {
  type: string
  prefix: string
  issued: number
  next_no: number
  sample: string
}

/** Settings → Numbering: receipt/invoice prefixes and next number per series (plan §17). */
export function NumberingTab() {
  const { t } = useTranslation()
  const toast = useToast()
  const [fy, setFy] = useState('')
  const [rows, setRows] = useState<Series[]>([])
  const [draft, setDraft] = useState<Record<string, { prefix: string; next_no: string }>>({})
  const [loading, setLoading] = useState(true)
  const [savingType, setSavingType] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/tenants/me/numbering')
      const series: Series[] = data.data?.series ?? []
      setFy(data.data?.fy ?? '')
      setRows(series)
      setDraft(Object.fromEntries(series.map(s => [s.type, { prefix: s.prefix, next_no: String(s.next_no) }])))
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  function edit(type: string, key: 'prefix' | 'next_no', value: string) {
    setDraft(d => ({ ...d, [type]: { ...d[type], [key]: value } }))
  }

  function isDirty(s: Series) {
    const d = draft[s.type]
    return !!d && (d.prefix !== s.prefix || d.next_no !== String(s.next_no))
  }

  async function save(s: Series) {
    const d = draft[s.type]
    if (!d) return
    setSavingType(s.type)
    try {
      const { data } = await api.patch(`/tenants/me/numbering/${s.type}`, {
        prefix: d.prefix,
        next_no: Number(d.next_no),
      })
      const updated: Series = data.data
      setRows(r => r.map(x => (x.type === s.type ? updated : x)))
      setDraft(dd => ({ ...dd, [s.type]: { prefix: updated.prefix, next_no: String(updated.next_no) } }))
      toast.success(t('settings.numbering.saved'))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('common.saveFailed'))
    } finally {
      setSavingType('')
    }
  }

  // Live sample so the effect of a prefix/number change is visible before saving.
  function sampleFor(s: Series) {
    const d = draft[s.type]
    if (!d) return s.sample
    const n = Number(d.next_no)
    const num = Number.isInteger(n) && n > 0 ? n : s.next_no
    return `${d.prefix.toUpperCase() || s.prefix}/${fy}/${String(num).padStart(6, '0')}`
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">{t('settings.numbering.heading')}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{t('settings.numbering.subheading', { fy })}</p>
      </div>

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-200">
                  <th className="px-4 py-2.5 font-semibold">{t('settings.numbering.series')}</th>
                  <th className="px-4 py-2.5 font-semibold w-40">{t('settings.numbering.prefix')}</th>
                  <th className="px-4 py-2.5 font-semibold w-32">{t('settings.numbering.nextNo')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('settings.numbering.nextReceipt')}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.type} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{t(`settings.numbering.type.${s.type}`, s.type)}</div>
                      <div className="text-xs text-slate-400">
                        {t('settings.numbering.issuedCount', { count: s.issued })}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <input className="form-input uppercase" maxLength={20}
                        value={draft[s.type]?.prefix ?? ''}
                        onChange={e => edit(s.type, 'prefix', e.target.value)} />
                    </td>
                    <td className="px-4 py-2.5">
                      <input className="form-input" type="number" min={s.issued + 1}
                        value={draft[s.type]?.next_no ?? ''}
                        onChange={e => edit(s.type, 'next_no', e.target.value)} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-slate-600">{sampleFor(s)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {isDirty(s) && (
                        <>
                          <button type="button" className="btn-secondary btn-sm mr-1.5"
                            onClick={() => setDraft(d => ({ ...d, [s.type]: { prefix: s.prefix, next_no: String(s.next_no) } }))}
                            aria-label={t('common.reset')}>
                            <RotateCcw size={13} />
                          </button>
                          <button type="button" className="btn-primary btn-sm"
                            disabled={savingType === s.type} onClick={() => save(s)}>
                            <Save size={13} /> {t('common.save')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">{t('settings.numbering.note')}</p>
    </div>
  )
}
