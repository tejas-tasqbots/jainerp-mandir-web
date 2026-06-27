import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Pencil, X } from 'lucide-react'
import { api } from '../../lib/api'

interface Vendor {
  id: string
  name: string
  contact_person?: string
  mobile?: string
  email?: string
  gstin?: string
  pan_masked?: string
  tds_section?: string
  bank_account?: string
  bank_ifsc?: string
  notes?: string
  is_active: boolean
  created_at: string
}

const emptyForm = {
  name: '', contact_person: '', mobile: '', email: '', gstin: '', pan: '',
  tds_section: '', bank_account: '', bank_ifsc: '', notes: '',
}

export function VendorsPage() {
  const navigate = useNavigate()
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
    setForm({
      name: v.name, contact_person: v.contact_person || '', mobile: v.mobile || '', email: v.email || '',
      gstin: v.gstin || '', pan: '', tds_section: v.tds_section || '',
      bank_account: v.bank_account || '', bank_ifsc: v.bank_ifsc || '', notes: v.notes || '',
    })
    setShowForm(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        contact_person: form.contact_person || undefined,
        mobile: form.mobile || undefined,
        email: form.email || undefined,
        gstin: form.gstin || undefined,
        tds_section: form.tds_section || undefined,
        bank_account: form.bank_account || undefined,
        bank_ifsc: form.bank_ifsc || undefined,
        notes: form.notes || undefined,
      }
      if (form.pan) body.pan_masked = form.pan  // store as entered; backend masks elsewhere
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
                <tr key={v.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/masters/vendors/${v.id}`)}>
                  <td className="font-medium text-brand-blue">{v.name}</td>
                  <td>{v.mobile || '—'}</td>
                  <td className="font-mono text-xs">{v.gstin || '—'}</td>
                  <td className="font-mono text-xs">{v.pan_masked || '—'}</td>
                  <td>{v.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <button type="button" onClick={() => openEdit(v)} className="p-1 text-slate-400 hover:text-brand-blue rounded" title="Edit" aria-label="Edit vendor">
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
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">{editId ? 'Edit Vendor' : 'Add Vendor'}</h3>
              <button type="button" onClick={() => setShowForm(false)} title="Close" aria-label="Close"><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">Name *</label><input className="form-input" placeholder="Vendor name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
                <div><label className="form-label">Contact Person</label><input className="form-input" value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">Mobile</label><input type="tel" className="form-input" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
                <div><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">GSTIN</label><input className="form-input uppercase" placeholder="22ABCDE1234F1Z5" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} /></div>
                <div><label className="form-label">PAN</label><input className="form-input uppercase" placeholder="ABCDE1234F" maxLength={10} value={form.pan} onChange={e => setForm(f => ({ ...f, pan: e.target.value.toUpperCase() }))} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="v-tds" className="form-label">TDS Section</label>
                  <select id="v-tds" className="form-select" value={form.tds_section} onChange={e => setForm(f => ({ ...f, tds_section: e.target.value }))}>
                    <option value="">None</option>
                    <option value="194C">194C</option>
                    <option value="194J">194J</option>
                    <option value="194I">194I</option>
                    <option value="194H">194H</option>
                  </select>
                </div>
                <div><label className="form-label">Bank A/C</label><input className="form-input" placeholder="Account no" value={form.bank_account} onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))} /></div>
                <div><label className="form-label">IFSC</label><input className="form-input uppercase" placeholder="IFSC" value={form.bank_ifsc} onChange={e => setForm(f => ({ ...f, bank_ifsc: e.target.value.toUpperCase() }))} /></div>
              </div>
              <div><label className="form-label">Notes</label><input className="form-input" placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
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
