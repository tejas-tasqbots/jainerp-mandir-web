import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save, Calculator } from 'lucide-react'
import { api, fmtPaise, parsePaise, currentFY } from '../../lib/api'
import type { FixedAsset } from '../../types'

export function FixedAssets() {
  const { t } = useTranslation()
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [form, setForm] = useState({
    name: '', purchase_date: new Date().toISOString().slice(0, 10),
    purchase_cost: '', useful_life_years: '5',
    depreciation_method: 'SLM', depreciation_rate: '20',
  })

  useEffect(() => {
    api.get('/fixed-assets').then(r => setAssets(r.data.data || [])).finally(() => setLoading(false))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/fixed-assets', {
        name: form.name,
        purchase_date: form.purchase_date,
        purchase_cost_paise: parsePaise(form.purchase_cost),
        useful_life_years: parseInt(form.useful_life_years),
        depreciation_method: form.depreciation_method,
        depreciation_rate: parseFloat(form.depreciation_rate),
      })
      setShowForm(false)
      api.get('/fixed-assets').then(r => setAssets(r.data.data || []))
    } finally { setSaving(false) }
  }

  async function runDepreciation() {
    const fy = window.prompt(t('accounts.runDepreciationPrompt'), currentFY())
    if (!fy) return
    setRunning(true)
    try {
      const { data } = await api.post('/fixed-assets/depreciation/run', { fy })
      const d = data.data || {}
      alert(d.assets_charged
        ? t('accounts.depreciationPosted', { fy: d.fy, count: d.assets_charged, amount: fmtPaise(d.total_depreciation_paise) })
        : t('accounts.depreciationNone', { fy: d.fy }))
      api.get('/fixed-assets').then(r => setAssets(r.data.data || []))
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e.response?.data?.error?.message || t('accounts.couldNotRunDepreciation'))
    } finally { setRunning(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.fixedAssetsTitle')}</h1>
        <div className="flex gap-2">
          <button onClick={runDepreciation} disabled={running} className="btn-secondary btn-sm" title={t('accounts.runDepreciationTooltip')}>
            <Calculator size={14} /> {running ? t('accounts.running') : t('accounts.runDepreciation')}
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm"><Plus size={14} /> {t('accounts.addAsset')}</button>
        </div>
      </div>

      {showForm && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('accounts.addFixedAsset')}</h3></div>
          <form onSubmit={submit} className="card-body space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="form-label">{t('accounts.assetName')}</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div><label className="form-label">{t('accounts.purchaseDate')}</label><input type="date" className="form-input" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} /></div>
              <div><label className="form-label">{t('accounts.cost')}</label><input type="number" className="form-input" value={form.purchase_cost} onChange={e => setForm(f => ({ ...f, purchase_cost: e.target.value }))} required /></div>
              <div><label className="form-label">{t('accounts.usefulLife')}</label><input type="number" min="1" className="form-input" value={form.useful_life_years} onChange={e => setForm(f => ({ ...f, useful_life_years: e.target.value }))} /></div>
              <div><label className="form-label">{t('accounts.method')}</label>
                <select className="form-select" value={form.depreciation_method} onChange={e => setForm(f => ({ ...f, depreciation_method: e.target.value }))}>
                  <option value="SLM">SLM</option><option value="WDV">WDV</option>
                </select>
              </div>
              <div><label className="form-label">{t('accounts.rate')}</label><input type="number" className="form-input" value={form.depreciation_rate} onChange={e => setForm(f => ({ ...f, depreciation_rate: e.target.value }))} /></div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary btn-sm"><Save size={14} /> {saving ? t('common.saving') : t('common.save')}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('accounts.asset')}</th><th>{t('accounts.purchaseDate')}</th><th>{t('accounts.cost')}</th><th>{t('accounts.method')}</th><th>{t('accounts.rate')}</th><th>{t('accounts.depreciation')}</th><th>{t('accounts.wdv')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">{t('common.loading')}</td></tr>
                : assets.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">{t('accounts.noAssets')}</td></tr>
                : assets.map(a => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.name}</td>
                    <td className="text-xs">{new Date(a.purchase_date).toLocaleDateString('en-IN')}</td>
                    <td>₹{fmtPaise(a.purchase_cost_paise)}</td>
                    <td>{a.depreciation_method}</td>
                    <td>{a.depreciation_rate}%</td>
                    <td>₹{fmtPaise(a.accumulated_depreciation_paise)}</td>
                    <td className="font-semibold">₹{fmtPaise(a.purchase_cost_paise - a.accumulated_depreciation_paise)}</td>
                    <td>{a.active ? <span className="badge-green">{t('accounts.active')}</span> : <span className="badge-gray">{t('accounts.disposed')}</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
