import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save, Calculator } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, fmtPaise, parsePaise, currentFY, todayIst } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { DataTable, filterStateToParams, type ColumnDef, type ColumnFilterState } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { FySelect } from '../../components/FySelect'
import type { FixedAsset } from '../../types'

const PAGE_SIZE = 20

export function FixedAssets() {
  const { t } = useTranslation()
  const toast = useToast()
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [meta, setMeta] = useState<{ total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [depModal, setDepModal] = useState(false)
  const [depFy, setDepFy] = useState(currentFY())
  const [running, setRunning] = useState(false)
  const [form, setForm] = useState({
    name: '', purchase_date: todayIst(),
    purchase_cost: '', useful_life_years: '5',
    depreciation_method: 'SLM', depreciation_rate: '20',
  })

  // NOTE: these columns are not marked `sortable` — DataTable only sorts when
  // the page also supplies `onSortChange`, and this screen does not. With the
  // flag but no handler the header still rendered `cursor-pointer`, so it
  // looked clickable and did nothing. Wiring sort here needs the resource
  // API's `?sort=<column>&order=` shape and a key→column map.
  const columns: ColumnDef<FixedAsset>[] = [
    { key: 'name', label: t('accounts.asset'), render: a => <span className="font-medium">{a.name}</span> },
    { key: 'purchase_date', label: t('accounts.purchaseDate'), render: a => <span className="text-xs text-slate-500">{new Date(a.purchase_date).toLocaleDateString('en-IN')}</span> },
    { key: 'cost', label: t('accounts.cost'), align: 'right', render: a => `₹${fmtPaise(a.purchase_cost_paise)}` },
    {
      key: 'method', label: t('accounts.method'),
      filter: { kind: 'enum', param: 'depreciation_method', options: [{ value: 'SLM', label: 'SLM' }, { value: 'WDV', label: 'WDV' }] },
      render: a => a.depreciation_method,
    },
    { key: 'rate', label: t('accounts.rate'), align: 'right', render: a => `${a.depreciation_rate}%` },
    { key: 'depreciation', label: t('accounts.depreciation'), align: 'right', render: a => `₹${fmtPaise(a.accumulated_depreciation_paise)}` },
    { key: 'wdv', label: t('accounts.wdv'), align: 'right', render: a => <span className="font-semibold">₹{fmtPaise(a.purchase_cost_paise - a.accumulated_depreciation_paise)}</span> },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'is_active', options: [{ value: 'true', label: t('accounts.active') }, { value: 'false', label: t('accounts.disposed') }] },
      render: a => a.is_active ? <span className="badge-green">{t('accounts.active')}</span> : <span className="badge-gray">{t('accounts.disposed')}</span>,
    },
  ]

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit) })
    if (search) params.set('q', search)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, search, filterState])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/fixed-assets?${buildParams(PAGE_SIZE, page)}`)
      setAssets(data.data || [])
      setMeta(data.meta || null)
    } catch {
      setAssets([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }

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
      setForm({ name: '', purchase_date: todayIst(), purchase_cost: '', useful_life_years: '5', depreciation_method: 'SLM', depreciation_rate: '20' })
      toast.success(t('accounts.assetAdded'))
      setPage(1)
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('accounts.assetAddFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function runDepreciation() {
    setRunning(true)
    try {
      const { data } = await api.post('/fixed-assets/depreciation/run', { fy: depFy })
      const d = data.data || {}
      toast.success(d.assets_charged
        ? t('accounts.depreciationPosted', { fy: d.fy, count: d.assets_charged, amount: fmtPaise(d.total_depreciation_paise) })
        : t('accounts.depreciationNone', { fy: d.fy }))
      setDepModal(false)
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('accounts.couldNotRunDepreciation'))
    } finally {
      setRunning(false)
    }
  }

  const stats: SummaryStat[] = meta ? [
    { label: t('accounts.cost'), value: `₹${fmtPaise(assets.reduce((s, a) => s + a.purchase_cost_paise, 0))}` },
    { label: t('accounts.depreciation'), value: `₹${fmtPaise(assets.reduce((s, a) => s + a.accumulated_depreciation_paise, 0))}`, tone: 'expense' },
    { label: t('accounts.wdv'), value: `₹${fmtPaise(assets.reduce((s, a) => s + (a.purchase_cost_paise - a.accumulated_depreciation_paise), 0))}` },
  ] : []

  async function exportExcel() {
    try {
      const { data } = await api.get(`/fixed-assets?${buildParams(1000)}`)
      const rows: FixedAsset[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('accounts.fixedAssetsTitle'),
        filename: 'fixed-assets',
        columns: [
          { header: t('accounts.asset'), width: 24 }, { header: t('accounts.purchaseDate'), type: 'date' },
          { header: t('accounts.cost'), type: 'money' }, { header: t('accounts.method'), width: 10 },
          { header: t('accounts.rate'), width: 8 }, { header: t('accounts.depreciation'), type: 'money' },
          { header: t('accounts.wdv'), type: 'money' }, { header: t('common.status'), width: 10 },
        ],
        rows: rows.map(a => [
          a.name, new Date(a.purchase_date).toLocaleDateString('en-IN'), a.purchase_cost_paise, a.depreciation_method,
          a.depreciation_rate, a.accumulated_depreciation_paise, a.purchase_cost_paise - a.accumulated_depreciation_paise,
          a.is_active ? t('accounts.active') : t('accounts.disposed'),
        ]),
        totals: [t('kit.total'), '', rows.reduce((s, a) => s + a.purchase_cost_paise, 0), '', '', rows.reduce((s, a) => s + a.accumulated_depreciation_paise, 0), rows.reduce((s, a) => s + (a.purchase_cost_paise - a.accumulated_depreciation_paise), 0), ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('accounts.fixedAssetsTitle')} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.fixedAssetsTitle')}</h1>
        <div className="flex gap-2">
          <button onClick={() => setDepModal(true)} className="btn-secondary btn-sm" title={t('accounts.runDepreciationTooltip')}>
            <Calculator size={14} /> {t('accounts.runDepreciation')}
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm"><Plus size={14} /> {t('accounts.addAsset')}</button>
        </div>
      </div>

      {showForm && (
        <div className="card no-print">
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

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="fixed-assets-list"
        columns={columns}
        rows={assets}
        rowKey={a => a.id}
        loading={loading}
        searchValue={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder={t('accounts.searchAssets')}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => { const next = { ...prev }; if (s) next[key] = s; else delete next[key]; return next })
          setPage(1)
        }}
        page={page}
        limit={PAGE_SIZE}
        total={meta?.total ?? 0}
        onPageChange={setPage}
        emptyMessage={t('accounts.noAssets')}
        emptyAction={{ label: t('accounts.addAsset'), onClick: () => setShowForm(true) }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />

      {depModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('accounts.runDepreciation')}</h3>
            <p className="text-sm text-slate-500 mb-4">{t('accounts.runDepreciationPrompt')}</p>
            <FySelect value={depFy} onChange={setDepFy} className="w-full mb-4" />
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setDepModal(false)} className="btn-secondary">{t('common.cancel')}</button>
              <button type="button" onClick={runDepreciation} disabled={running} className="btn-primary">
                {running ? t('accounts.running') : t('accounts.runDepreciation')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
