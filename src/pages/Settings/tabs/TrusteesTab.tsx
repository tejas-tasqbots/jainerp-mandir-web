import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import { api } from '../../../lib/api'

interface Trustee {
  id: string
  name: string
  designation?: string | null
  mobile?: string | null
  email?: string | null
  since_year?: number | null
}

const EMPTY = { name: '', designation: '', mobile: '', email: '', since_year: '' }

/** Trustee board management (shown on receipts/80G docs and the public temple page). */
export function TrusteesTab() {
  const [rows, setRows] = useState<Trustee[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    try { const { data } = await api.get('/tenants/me/trustees'); setRows(data.data ?? []) } catch { /* */ }
  }

  function startEdit(t: Trustee) {
    setEditingId(t.id)
    setForm({
      name: t.name ?? '', designation: t.designation ?? '', mobile: t.mobile ?? '',
      email: t.email ?? '', since_year: t.since_year ? String(t.since_year) : '',
    })
  }

  async function save() {
    if (!form.name.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr('')
    const payload = {
      name: form.name.trim(),
      designation: form.designation.trim() || null,
      mobile: form.mobile.trim() || null,
      email: form.email.trim() || null,
      since_year: form.since_year ? Number(form.since_year) : null,
    }
    try {
      if (editingId) await api.patch(`/tenants/me/trustees/${editingId}`, payload)
      else await api.post('/tenants/me/trustees', payload)
      setForm(EMPTY); setEditingId(null); await load()
    } catch (e: any) { setErr(e?.response?.data?.error?.message || 'Could not save trustee') }
    finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this trustee?')) return
    try { await api.delete(`/tenants/me/trustees/${id}`); await load() } catch { /* */ }
  }

  return (
    <div className="card">
      <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><Users size={14} /> Trustees</h3></div>
      <div className="card-body space-y-4">
        <p className="text-xs text-slate-400">
          The trustee board of your mandir. Trustees appear in statutory documents and on your temple's public profile.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <input className="form-input" placeholder="Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className="form-input" placeholder="Designation (President…)" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} />
          <input className="form-input" type="tel" placeholder="Mobile" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} />
          <input className="form-input" type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <input className="form-input" type="number" placeholder="Since year" value={form.since_year} onChange={e => setForm(f => ({ ...f, since_year: e.target.value }))} />
        </div>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            <Plus size={13} /> {saving ? 'Saving…' : editingId ? 'Update Trustee' : 'Add Trustee'}
          </button>
          {editingId && (
            <button onClick={() => { setEditingId(null); setForm(EMPTY) }} className="btn-secondary btn-sm"><X size={13} /> Cancel</button>
          )}
        </div>

        {rows.length > 0 ? (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2">Name</th><th>Designation</th><th>Mobile</th><th>Email</th><th>Since</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{t.name}</td>
                  <td>{t.designation || '—'}</td>
                  <td>{t.mobile || '—'}</td>
                  <td>{t.email || '—'}</td>
                  <td>{t.since_year || '—'}</td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => startEdit(t)} className="text-slate-500 hover:text-navy-900 p-1"><Pencil size={14} /></button>
                    <button onClick={() => remove(t.id)} className="text-slate-500 hover:text-brand-red p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-center text-slate-400 text-sm py-4">No trustees added yet.</p>
        )}
      </div>
    </div>
  )
}
