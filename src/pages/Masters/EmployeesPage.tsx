import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, X, Users } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DataTable, filterStateToParams, type ColumnDef, type ColumnFilterState, type RowAction } from '../../components/kit/DataTable'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface Employee {
  id: string
  name: string
  mobile?: string
  email?: string
  designation?: string
  department?: string
  monthly_salary_paise?: number
  joining_date?: string
  is_active: boolean
  created_at: string
}

const emptyForm = { name: '', mobile: '', email: '', designation: '', department: '', monthly_salary: '', joining_date: '' }

export function EmployeesPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const [tab, setTab] = useState<'employees' | 'volunteers'>('employees')
  const [items, setItems] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const columns: ColumnDef<Employee>[] = useMemo(() => [
    { key: 'name', label: t('employees.name'), render: emp => <span className="font-medium">{emp.name}</span> },
    { key: 'mobile', label: t('employees.mobile'), render: emp => <>{emp.mobile || '—'}</> },
    {
      key: 'designation', label: tab === 'employees' ? t('employees.designation') : t('employees.role'),
      render: emp => <span className="text-slate-600">{emp.designation || '—'}</span>,
    },
    { key: 'department', label: t('employees.department'), render: emp => <span className="text-slate-600">{emp.department || '—'}</span> },
    {
      key: 'salary', label: t('employees.salary'), align: 'right',
      render: emp => <>{emp.monthly_salary_paise ? `₹${fmtPaise(emp.monthly_salary_paise)}${t('employees.perMonth')}` : '—'}</>,
    },
    {
      key: 'status', label: t('employees.status'),
      filter: { kind: 'enum', param: 'is_active', options: [
        { value: 'true', label: t('employees.active') },
        { value: 'false', label: t('employees.inactive') },
      ] },
      render: emp => emp.is_active
        ? <span className="badge-green">{t('employees.active')}</span>
        : <span className="badge-gray">{t('employees.inactive')}</span>,
    },
     
  ], [t, tab])

  useEffect(() => { load() }, [search, tab, filterState])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (search) params.set('q', search)
      for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
      const resource = tab === 'employees' ? 'employees' : 'volunteers'
      const { data } = await api.get(`/${resource}?${params}`)
      setItems(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function exportExcel() {
    if (!items.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: `${t('employees.title')} — ${tab === 'employees' ? t('employees.tabEmployees') : t('employees.tabVolunteers')}`,
        filename: tab,
        columns: [
          { header: t('employees.name'), width: 26 },
          { header: t('employees.mobile'), width: 16 },
          { header: t('employees.email'), width: 24 },
          { header: tab === 'employees' ? t('employees.designation') : t('employees.role'), width: 18 },
          { header: t('employees.department'), width: 16 },
          { header: t('employees.salary'), type: 'money' },
          { header: t('employees.joiningDate'), type: 'date' },
          { header: t('employees.status'), width: 10 },
        ],
        rows: items.map(emp => [
          emp.name, emp.mobile ?? '', emp.email ?? '', emp.designation ?? '', emp.department ?? '',
          emp.monthly_salary_paise ?? 0,
          emp.joining_date ? new Date(emp.joining_date).toLocaleDateString('en-IN') : '',
          emp.is_active ? t('employees.active') : t('employees.inactive'),
        ]),
        totals: [
          t('kit.total'), '', '', '', '',
          items.reduce((s, emp) => s + (emp.monthly_salary_paise ?? 0), 0), '', '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function openAdd() { setEditId(null); setForm(emptyForm); setError(''); setShowForm(true) }
  function openEdit(emp: Employee) {
    setEditId(emp.id)
    setError('')
    setForm({
      name: emp.name, mobile: emp.mobile || '', email: emp.email || '',
      designation: emp.designation || '', department: emp.department || '',
      monthly_salary: emp.monthly_salary_paise ? String(emp.monthly_salary_paise / 100) : '',
      joining_date: emp.joining_date?.slice(0, 10) || '',
    })
    setShowForm(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const resource = tab === 'employees' ? 'employees' : 'volunteers'
    try {
      const body = {
        name: form.name, mobile: form.mobile || undefined, email: form.email || undefined,
        designation: form.designation || undefined, department: form.department || undefined,
        monthly_salary_paise: form.monthly_salary ? parsePaise(form.monthly_salary) : undefined,
        joining_date: form.joining_date || undefined,
      }
      if (editId) await api.patch(`/${resource}/${editId}`, body)
      else await api.post(`/${resource}`, body)
      setShowForm(false); setForm(emptyForm); setEditId(null)
      toast.success(t('common.saved'))
      load()
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e2.response?.data?.error?.message || (resource === 'employees' ? t('employees.couldNotSaveEmployee') : t('employees.couldNotSaveVolunteer')))
    } finally {
      setSaving(false)
    }
  }

  const stats: SummaryStat[] = [
    { label: tab === 'employees' ? t('employees.tabEmployees') : t('employees.tabVolunteers'), value: String(items.length) },
    { label: t('employees.active'), value: String(items.filter(e => e.is_active).length) },
    { label: t('employees.salary'), value: `₹${fmtPaise(items.reduce((s2, e) => s2 + (e.monthly_salary_paise ?? 0), 0))}` },
  ]

  function rowActions(emp: Employee): RowAction[] {
    return [{ label: t('employees.actions'), icon: <Pencil size={14} />, primary: true, onClick: () => openEdit(emp) }]
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('employees.title')} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Users size={18} /> {t('employees.title')}</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> {tab === 'employees' ? t('employees.addEmployee') : t('employees.addVolunteer')}</button>
      </div>

      <div className="flex gap-2 no-print">
        {(['employees', 'volunteers'] as const).map(tabKey => (
          <button key={tabKey} onClick={() => { setTab(tabKey); setSearch('') }}
            className={`px-4 py-1.5 text-sm rounded-md font-medium capitalize ${tab === tabKey ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {tabKey === 'employees' ? t('employees.tabEmployees') : t('employees.tabVolunteers')}
          </button>
        ))}
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="employees-list"
        columns={columns}
        rows={items}
        rowKey={emp => emp.id}
        rowActions={rowActions}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('employees.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
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
        total={items.length}
        onPageChange={() => {}}
        emptyMessage={tab === 'employees' ? t('employees.noEmployeesFound') : t('employees.noVolunteersFound')}
        emptyAction={{ label: tab === 'employees' ? t('employees.addEmployee') : t('employees.addVolunteer'), onClick: openAdd }}
      />

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">{editId ? (tab === 'employees' ? t('employees.editEmployee') : t('employees.editVolunteer')) : (tab === 'employees' ? t('employees.addEmployee') : t('employees.addVolunteer'))}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><label className="form-label">{t('employees.nameRequired')}</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">{t('employees.mobileRequired')}</label><input type="tel" className="form-input" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} required /></div>
                <div><label className="form-label">{t('employees.email')}</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              </div>
              {tab === 'employees' && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="form-label">{t('employees.designationRequired')}</label><input className="form-input" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} required /></div>
                  <div><label className="form-label">{t('employees.department')}</label><input className="form-input" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} /></div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">{t('employees.monthlySalary')}</label><input type="number" className="form-input" value={form.monthly_salary} onChange={e => setForm(f => ({ ...f, monthly_salary: e.target.value }))} /></div>
                <div><label className="form-label">{t('employees.joiningDate')}</label><input type="date" className="form-input" value={form.joining_date} onChange={e => setForm(f => ({ ...f, joining_date: e.target.value }))} /></div>
              </div>
              {error && <p className="text-sm text-brand-red">{error}</p>}
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
