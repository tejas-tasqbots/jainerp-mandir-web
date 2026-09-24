import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, X } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, apiErrorMessage, fmtPaise, parsePaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DataTable, filterStateToParams, type ColumnDef, type ColumnFilterState, type RowAction } from '../../components/kit/DataTable'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface Priest {
  id: string
  name: string
  mobile?: string
  email?: string
  specialization?: string
  monthly_stipend_paise?: number
  joining_date?: string
  is_active: boolean
  created_at: string
}

const emptyForm = { name: '', mobile: '', email: '', specialization: '', monthly_stipend: '', joining_date: '' }

export function PriestsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const [priests, setPriests] = useState<Priest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const columns: ColumnDef<Priest>[] = useMemo(() => [
    { key: 'name', label: t('priests.name'), render: p => <span className="font-medium">{p.name}</span> },
    { key: 'mobile', label: t('priests.mobile'), render: p => <>{p.mobile || '—'}</> },
    { key: 'specialization', label: t('priests.specialization'), render: p => <span className="text-slate-600">{p.specialization || '—'}</span> },
    {
      key: 'stipend', label: t('priests.monthlyStipend'), align: 'right',
      render: p => <>{p.monthly_stipend_paise ? `₹${fmtPaise(p.monthly_stipend_paise)}` : '—'}</>,
    },
    {
      key: 'joined', label: t('priests.joined'),
      render: p => <span className="text-xs text-slate-400">{p.joining_date ? new Date(p.joining_date).toLocaleDateString('en-IN') : '—'}</span>,
    },
    {
      key: 'status', label: t('priests.status'),
      filter: { kind: 'enum', param: 'is_active', options: [
        { value: 'true', label: t('priests.active') },
        { value: 'false', label: t('priests.inactive') },
      ] },
      render: p => p.is_active
        ? <span className="badge-green">{t('priests.active')}</span>
        : <span className="badge-gray">{t('priests.inactive')}</span>,
    },
     
  ], [t])

  useEffect(() => { load() }, [search, filterState])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (search) params.set('q', search)
      for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
      const { data } = await api.get(`/priests?${params}`)
      setPriests(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function exportExcel() {
    if (!priests.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('priests.title'),
        filename: 'priests',
        columns: [
          { header: t('priests.name'), width: 26 },
          { header: t('priests.mobile'), width: 16 },
          { header: t('priests.email'), width: 24 },
          { header: t('priests.specialization'), width: 22 },
          { header: t('priests.monthlyStipend'), type: 'money' },
          { header: t('priests.joined'), type: 'date' },
          { header: t('priests.status'), width: 10 },
        ],
        rows: priests.map(p => [
          p.name, p.mobile ?? '', p.email ?? '', p.specialization ?? '',
          p.monthly_stipend_paise ?? 0,
          p.joining_date ? new Date(p.joining_date).toLocaleDateString('en-IN') : '',
          p.is_active ? t('priests.active') : t('priests.inactive'),
        ]),
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function openAdd() { setEditId(null); setForm(emptyForm); setShowForm(true) }
  function openEdit(p: Priest) {
    setEditId(p.id)
    setForm({
      name: p.name, mobile: p.mobile || '', email: p.email || '',
      specialization: p.specialization || '',
      monthly_stipend: p.monthly_stipend_paise ? String(p.monthly_stipend_paise / 100) : '',
      joining_date: p.joining_date?.slice(0, 10) || '',
    })
    setShowForm(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        name: form.name,
        mobile: form.mobile || undefined,
        email: form.email || undefined,
        specialization: form.specialization || undefined,
        monthly_stipend_paise: form.monthly_stipend ? parsePaise(form.monthly_stipend) : undefined,
        joining_date: form.joining_date || undefined,
      }
      if (editId) await api.patch(`/priests/${editId}`, body)
      else await api.post('/priests', body)
      setShowForm(false); setForm(emptyForm); setEditId(null)
      toast.success(t('common.saved'))
      load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  const stats: SummaryStat[] = [
    { label: t('priests.title'), value: String(priests.length) },
    { label: t('priests.active'), value: String(priests.filter(p => p.is_active).length) },
    { label: t('priests.monthlyStipend'), value: `₹${fmtPaise(priests.reduce((s2, p) => s2 + (p.monthly_stipend_paise ?? 0), 0))}` },
  ]

  function rowActions(p: Priest): RowAction[] {
    return [{ label: t('priests.editPriest'), icon: <Pencil size={14} />, primary: true, onClick: () => openEdit(p) }]
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('priests.title')} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('priests.title')}</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> {t('priests.addPriest')}</button>
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="priests-list"
        columns={columns}
        rows={priests}
        rowKey={p => p.id}
        rowActions={rowActions}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('priests.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        filterState={filterState}
        onFilterChange={(key, st) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (st) next[key] = st
            else delete next[key]
            return next
          })
        }}
        page={1}
        limit={200}
        total={priests.length}
        onPageChange={() => {}}
        emptyMessage={t('priests.noPriestsFound')}
        emptyAction={{ label: t('priests.addPriest'), onClick: openAdd }}
      />

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">{editId ? t('priests.editPriest') : t('priests.addPriest')}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><label className="form-label">{t('priests.nameRequired')}</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label" htmlFor="priests-page-email">{t('priests.mobile')}</label><input type="tel" className="form-input" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
                <div><label className="form-label" htmlFor="priests-page-specialization">{t('priests.email')}</label><input id="priests-page-email" type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              </div>
              <div><label className="form-label">{t('priests.specialization')}</label><input id="priests-page-specialization" className="form-input" placeholder={t('priests.specializationPlaceholder')} value={form.specialization} onChange={e => setForm(f => ({ ...f, specialization: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label" htmlFor="priests-page-joining-date">{t('priests.monthlyStipendAmount')}</label><input type="number" className="form-input" value={form.monthly_stipend} onChange={e => setForm(f => ({ ...f, monthly_stipend: e.target.value }))} /></div>
                <div><label className="form-label">{t('priests.joiningDate')}</label><input id="priests-page-joining-date" type="date" className="form-input" value={form.joining_date} onChange={e => setForm(f => ({ ...f, joining_date: e.target.value }))} /></div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
