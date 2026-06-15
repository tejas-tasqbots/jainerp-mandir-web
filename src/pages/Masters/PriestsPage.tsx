import { useEffect, useState } from 'react'
import { Plus, Pencil, X, Search } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'

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
  const [priests, setPriests] = useState<Priest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [search])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (search) params.set('q', search)
      const { data } = await api.get(`/priests?${params}`)
      setPriests(data.data || [])
    } finally {
      setLoading(false)
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
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Priests</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> Add Priest</button>
      </div>

      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder="Search name, mobile..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Mobile</th><th>Specialization</th><th>Monthly Stipend</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : priests.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">No priests found</td></tr>
              ) : priests.map(p => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.mobile || '—'}</td>
                  <td className="text-slate-600">{p.specialization || '—'}</td>
                  <td>{p.monthly_stipend_paise ? `₹${fmtPaise(p.monthly_stipend_paise)}` : '—'}</td>
                  <td className="text-xs text-slate-400">{p.joining_date ? new Date(p.joining_date).toLocaleDateString('en-IN') : '—'}</td>
                  <td>{p.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}</td>
                  <td>
                    <button onClick={() => openEdit(p)} className="p-1 text-slate-400 hover:text-brand-blue rounded"><Pencil size={14} /></button>
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
              <h3 className="font-bold text-navy-900">{editId ? 'Edit Priest' : 'Add Priest'}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">Mobile</label><input type="tel" className="form-input" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
                <div><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              </div>
              <div><label className="form-label">Specialization</label><input className="form-input" placeholder="e.g. Vedic rituals, Sanskrit" value={form.specialization} onChange={e => setForm(f => ({ ...f, specialization: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">Monthly Stipend (₹)</label><input type="number" className="form-input" value={form.monthly_stipend} onChange={e => setForm(f => ({ ...f, monthly_stipend: e.target.value }))} /></div>
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
