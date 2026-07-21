import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { CitySelect, CountrySelect, StateSelect } from '../../components/GeoSelect'
import { isValidPhone, PhoneInput } from '../../components/PhoneInput'
import { DataTable, filterStateToParams, type ColumnDef, type ColumnFilterState } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { Donor } from '../../types'
import { DONOR_TAG_OPTIONS } from '../../lib/donorTags'

const PAGE_SIZE = 20

const emptyForm = {
  name: '', mobile: '', email: '', gotra: '', country: 'India', city: '', state: '', address: '', pan: '', is_80g_eligible: true,
}

export function DonorList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const [donors, setDonors] = useState<Donor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const columns: ColumnDef<Donor>[] = useMemo(() => [
    {
      key: 'name', label: t('donors.name'),
      render: d => (
        <div>
          <p className="font-medium">{d.name}</p>
          {d.gotra && <p className="text-xs text-slate-400">{t('donors.gotraLabel', { gotra: d.gotra })}</p>}
        </div>
      ),
    },
    { key: 'mobile', label: t('donors.mobile'), render: d => <>{d.mobile}</> },
    {
      key: 'city', label: t('donors.city'),
      render: d => <span className="text-slate-600">{d.city || '—'}{d.state ? `, ${d.state}` : ''}</span>,
    },
    {
      key: 'pan', label: t('donors.pan'),
      render: d => <span className="font-mono text-xs">{d.pan_masked || '—'}</span>,
    },
    {
      key: 'thisFy', label: t('donors.thisFy'), align: 'right',
      render: d => (
        <span className="font-medium text-green-700">
          {d.cumulative_amount_current_fy_paise ? `₹${fmtPaise(d.cumulative_amount_current_fy_paise)}` : '—'}
        </span>
      ),
    },
    {
      key: 'tags', label: t('donors.tags'),
      filter: { kind: 'enum', param: 'tag', options: DONOR_TAG_OPTIONS.map(tg => ({ value: tg, label: tg })) },
      render: d => d.tags?.length ? (
        <div className="flex flex-wrap gap-1">
          {d.tags.map(tg => <span key={tg} className="badge-blue">{tg}</span>)}
        </div>
      ) : <span className="text-slate-300">—</span>,
    },
    {
      key: 'status', label: t('donors.status'),
      render: d => d.is_active
        ? <span className="badge-green">{t('donors.active')}</span>
        : <span className="badge-gray">{t('donors.inactive')}</span>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

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
      const { data } = await api.get(`/donors?${buildParams(PAGE_SIZE, page)}`)
      setDonors(data.data || [])
      setTotal(data.meta?.total || 0)
    } catch {
      setDonors([])
    } finally {
      setLoading(false)
    }
  }

  async function exportExcel() {
    try {
      const { data } = await api.get(`/donors?${buildParams(200)}`)
      const rows: Donor[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('donors.title'),
        filename: 'donors',
        columns: [
          { header: t('donors.name'), width: 26 },
          { header: t('donors.gotra'), width: 14 },
          { header: t('donors.mobile'), width: 16 },
          { header: t('donors.email'), width: 24 },
          { header: t('donors.city'), width: 18 },
          { header: t('donors.state'), width: 16 },
          { header: t('donors.pan'), width: 13 },
          { header: t('donors.thisFy'), type: 'money' },
          { header: t('donors.tags'), width: 20 },
          { header: t('donors.status'), width: 10 },
        ],
        rows: rows.map(d => [
          d.name, d.gotra ?? '', d.mobile ?? '', d.email ?? '', d.city ?? '', d.state ?? '',
          d.pan_masked ?? '', d.cumulative_amount_current_fy_paise ?? 0, (d.tags ?? []).join(', '),
          d.is_active ? t('donors.active') : t('donors.inactive'),
        ]),
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function f(k: keyof typeof form, v: string | boolean) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function addDonor(e: React.FormEvent) {
    e.preventDefault()
    if (form.mobile && !isValidPhone(form.mobile)) {
      setError('Enter a valid mobile number')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { data } = await api.post('/donors', {
        name: form.name,
        mobile: form.mobile || undefined,
        email: form.email || undefined,
        gotra: form.gotra || undefined,
        country: form.country || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        address: form.address || undefined,
        pan: form.pan || undefined,
      })
      setShowAdd(false)
      setForm(emptyForm)
      navigate(`/donors/${data.data.id}`)
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e2.response?.data?.error?.message || 'Failed to add donor')
    } finally {
      setSaving(false)
    }
  }


  // Donor rollup per plan §06 (lifetime/FY giving visible on the list).
  const fyGiving = donors.reduce((s2, d) => s2 + (d.cumulative_amount_current_fy_paise ?? 0), 0)
  const activeDonors = donors.filter(d => d.is_active).length
  const stats: SummaryStat[] = [
    { label: t('donors.summaryDonors'), value: String(total || donors.length) },
    { label: t('donors.summaryActive'), value: String(activeDonors) },
    { label: t('donors.summaryThisFy'), value: `₹${fmtPaise(fyGiving)}`, tone: 'income' },
  ]

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('donors.title')} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('donors.title')}</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary btn-sm">
          <Plus size={14} /> {t('donors.addDonor')}
        </button>
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="donors-list"
        columns={columns}
        rows={donors}
        rowKey={d => d.id}
        loading={loading}
        searchValue={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder={t('donors.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
          setPage(1)
        }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
        page={page}
        limit={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        emptyMessage={t('donors.noDonorsFound')}
        emptyAction={{ label: t('donors.addDonor'), onClick: () => setShowAdd(true) }}
        onRowClick={d => navigate(`/donors/${d.id}`)}
      />

      {/* Add Donor Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">{t('donors.addNewDonor')}</h3>
              <button onClick={() => { setShowAdd(false); setForm(emptyForm); setError('') }} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
            <form onSubmit={addDonor} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="form-label">{t('donors.fullName')}</label>
                  <input className="form-input" value={form.name} onChange={e => f('name', e.target.value)} required />
                </div>
                <div>
                  <label className="form-label">{t('donors.mobile')}</label>
                  <PhoneInput value={form.mobile} onChange={v => f('mobile', v)} />
                </div>
                <div>
                  <label className="form-label">{t('donors.email')}</label>
                  <input type="email" className="form-input" value={form.email} onChange={e => f('email', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">{t('donors.gotra')}</label>
                  <input className="form-input" value={form.gotra} onChange={e => f('gotra', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">{t('donors.pan')}</label>
                  <input className="form-input uppercase" placeholder="ABCDE1234F" value={form.pan}
                    onChange={e => f('pan', e.target.value.toUpperCase())} maxLength={10} />
                </div>
                <div>
                  <label className="form-label">{t('donors.country')}</label>
                  <CountrySelect value={form.country} onChange={c => { f('country', c); f('state', ''); f('city', '') }} />
                </div>
                {(!form.country || form.country === 'India') ? (
                  <>
                    <div>
                      <label className="form-label">{t('donors.state')}</label>
                      <StateSelect value={form.state} onChange={s => { f('state', s); f('city', '') }} />
                    </div>
                    <div>
                      <label className="form-label">{t('donors.city')}</label>
                      <CitySelect state={form.state} value={form.city} onChange={c => f('city', c)} />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="form-label">{t('donors.stateProvince')}</label>
                      <input className="form-input" value={form.state} onChange={e => f('state', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">{t('donors.city')}</label>
                      <input className="form-input" value={form.city} onChange={e => f('city', e.target.value)} />
                    </div>
                  </>
                )}
                <div className="col-span-2">
                  <label className="form-label">{t('donors.address')}</label>
                  <input className="form-input" value={form.address} onChange={e => f('address', e.target.value)} />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowAdd(false); setForm(emptyForm); setError('') }} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('donors.adding') : t('donors.addDonor')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
