import { useEffect, useState } from 'react'
import { Plus, Search, Pencil, X } from 'lucide-react'
import { api } from '../../lib/api'

interface Vendor {
  id: string
  name: string
  mobile?: string
  email?: string
  gstin?: string
  pan_masked?: string
  address?: string
  is_active: boolean
  created_at: string
}

const emptyForm = { name: '', mobile: '', email: '', gstin: '', address: '' }

export function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
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
      const { data } = await api.get(`/vendors?${params}`)
      setVendors(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  function openAdd() { setEditId(null); setForm(emptyForm); setShowForm(true) }
  function openEdit(v: Vendor) {
    setEditId(v.id)
    setForm({ name: v.name, mobile: v.mobile || '', email: v.email || '', gstin: v.gstin || '', address: v.address || '' })
    setShowForm(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = { name: form.name, mobile: form.mobile || undefined, email: form.email || undefined, gstin: form.gstin || undefined, address: form.address || undefined }
      if (editId) await api.patch(`/vendors/${editId}`, body)
      else await api.post('/vendors', body)
      setShowForm(false)
      setForm(emptyForm)
      setEditId(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Vendors / Suppliers</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> Add Vendor</button>
      </div>

      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder="Search name, mobile, GSTIN..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Mobile</th><th>GSTIN</th><th>PAN</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : vendors.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">No vendors found</td></tr>
              ) : vendors.map(v => (
                <tr key={v.id}>
                  <td className="font-medium">{v.name}</td>
                  <td>{v.mobile || '—'}</td>
                  <td className="font-mono text-xs">{v.gstin || '—'}</td>
                  <td className="font-mono text-xs">{v.pan_masked || '—'}</td>
                  <td>{v.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}</td>
                  <td>
                    <button onClick={() => openEdit(v)} className="p-1 text-slate-400 hover:text-brand-blue rounded" title="Edit">
                      <Pencil size={14} />
                    </button>
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
              <h3 className="font-bold text-navy-900">{editId ? 'Edit Vendor' : 'Add Vendor'}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">Mobile</label><input type="tel" className="form-input" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
                <div><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              </div>
              <div><label className="form-label">GSTIN</label><input className="form-input uppercase" placeholder="22ABCDE1234F1Z5" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} /></div>
              <div><label className="form-label">Address</label><input className="form-input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
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
