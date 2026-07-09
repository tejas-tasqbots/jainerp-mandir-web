import { useEffect, useState } from 'react'
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
  const [tab, setTab] = useState<'employees' | 'volunteers'>('employees')
  const [items, setItems] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

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

  function openAdd() { setEditId(null); setForm(emptyForm); setShowForm(true) }
  function openEdit(emp: Employee) {
    setEditId(emp.id)
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
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Users size={18} /> Employees & Volunteers</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> Add {tab === 'employees' ? 'Employee' : 'Volunteer'}</button>
      </div>

      <div className="flex gap-2">
        {(['employees', 'volunteers'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setSearch('') }}
            className={`px-4 py-1.5 text-sm rounded-md font-medium capitalize ${tab === t ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder="Search name, mobile..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Mobile</th><th>{tab === 'employees' ? 'Designation' : 'Role'}</th><th>Department</th><th>Salary</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">No {tab} found</td></tr>
              ) : items.map(emp => (
                <tr key={emp.id}>
                  <td className="font-medium">{emp.name}</td>
                  <td>{emp.mobile || '—'}</td>
                  <td className="text-slate-600">{emp.designation || '—'}</td>
                  <td className="text-slate-600">{emp.department || '—'}</td>
                  <td>{emp.monthly_salary_paise ? `₹${fmtPaise(emp.monthly_salary_paise)}/mo` : '—'}</td>
                  <td>{emp.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}</td>
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
              <h3 className="font-bold text-navy-900">{editId ? 'Edit' : 'Add'} {tab === 'employees' ? 'Employee' : 'Volunteer'}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">Mobile</label><input type="tel" className="form-input" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
                <div><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">Designation</label><input className="form-input" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} /></div>
                <div><label className="form-label">Department</label><input className="form-input" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">Monthly Salary (₹)</label><input type="number" className="form-input" value={form.monthly_salary} onChange={e => setForm(f => ({ ...f, monthly_salary: e.target.value }))} /></div>
                <div><label className="form-label">Joining Date</label><input type="date" className="form-input" value={form.joining_date} onChange={e => setForm(f => ({ ...f, joining_date: e.target.value }))} /></div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
