import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, X, Search, Users } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'

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
  const [tab, setTab] = useState<'employees' | 'volunteers'>('employees')
  const [items, setItems] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [search, tab])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (search) params.set('q', search)
      const resource = tab === 'employees' ? 'employees' : 'volunteers'
      const { data } = await api.get(`/${resource}?${params}`)
      setItems(data.data || [])
    } finally {
      setLoading(false)
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
      load()
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e2.response?.data?.error?.message || (resource === 'employees' ? t('employees.couldNotSaveEmployee') : t('employees.couldNotSaveVolunteer')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Users size={18} /> {t('employees.title')}</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> {tab === 'employees' ? t('employees.addEmployee') : t('employees.addVolunteer')}</button>
      </div>

      <div className="flex gap-2">
        {(['employees', 'volunteers'] as const).map(tabKey => (
          <button key={tabKey} onClick={() => { setTab(tabKey); setSearch('') }}
            className={`px-4 py-1.5 text-sm rounded-md font-medium capitalize ${tab === tabKey ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {tabKey === 'employees' ? t('employees.tabEmployees') : t('employees.tabVolunteers')}
          </button>
        ))}
      </div>

      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder={t('employees.searchPlaceholder')}
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('employees.name')}</th><th>{t('employees.mobile')}</th><th>{tab === 'employees' ? t('employees.designation') : t('employees.role')}</th><th>{t('employees.department')}</th><th>{t('employees.salary')}</th><th>{t('employees.status')}</th><th>{t('employees.actions')}</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">{tab === 'employees' ? t('employees.noEmployeesFound') : t('employees.noVolunteersFound')}</td></tr>
              ) : items.map(emp => (
                <tr key={emp.id}>
                  <td className="font-medium">{emp.name}</td>
                  <td>{emp.mobile || '—'}</td>
                  <td className="text-slate-600">{emp.designation || '—'}</td>
                  <td className="text-slate-600">{emp.department || '—'}</td>
                  <td>{emp.monthly_salary_paise ? `₹${fmtPaise(emp.monthly_salary_paise)}${t('employees.perMonth')}` : '—'}</td>
                  <td>{emp.is_active ? <span className="badge-green">{t('employees.active')}</span> : <span className="badge-gray">{t('employees.inactive')}</span>}</td>
                  <td>
                    <button onClick={() => openEdit(emp)} className="p-1 text-slate-400 hover:text-brand-blue rounded"><Pencil size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
