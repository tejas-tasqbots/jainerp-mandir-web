import { useEffect, useState } from 'react'
import { Plus, Save } from 'lucide-react'
import { api } from '../../lib/api'
import type { LostFoundItem } from '../../types'

export function LostFoundPage() {
  const [items, setItems] = useState<LostFoundItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    description: '',
    found_date: new Date().toISOString().slice(0, 10),
    found_location: '',
    notes: '',
  })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/lost-found?limit=50')
      setItems(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/lost-found', {
        description: form.description,
        found_date: form.found_date,
        found_location: form.found_location || undefined,
        notes: form.notes || undefined,
      })
      setForm({ description: '', found_date: new Date().toISOString().slice(0, 10), found_location: '', notes: '' })
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function markClaimed(id: string) {
    const name = window.prompt('Claimant name:')
    const mobile = window.prompt('Claimant mobile:')
    if (!name) return
    await api.patch(`/lost-found/${id}/claim`, { claimant_name: name, claimant_mobile: mobile || undefined })
    load()
  }

  function statusBadge(s: string) {
    if (s === 'unclaimed') return <span className="badge-yellow">Unclaimed</span>
    if (s === 'claimed') return <span className="badge-green">Claimed</span>
    if (s === 'donated') return <span className="badge-blue">Donated</span>
    return <span className="badge-gray">Disposed</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Lost & Found Register</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm">
          <Plus size={14} /> Report Found Item
        </button>
      </div>

      {showForm && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Report Found Item</h3></div>
          <form onSubmit={submit} className="card-body space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Description *</label>
                <input className="form-input" placeholder="Item description" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Found Date</label>
                <input type="date" className="form-input" value={form.found_date}
                  onChange={e => setForm(f => ({ ...f, found_date: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Location Found</label>
                <input className="form-input" placeholder="Where it was found" value={form.found_location}
                  onChange={e => setForm(f => ({ ...f, found_location: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Notes</label>
                <input className="form-input" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary btn-sm"><Save size={14} /> {saving ? 'Saving...' : 'Save'}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Description</th><th>Found Date</th><th>Location</th><th>Status</th><th>Claimant</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading...</td></tr>
                : items.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-slate-400">No items in register</td></tr>
                : items.map(item => (
                  <tr key={item.id}>
                    <td className="font-medium">{item.description}</td>
                    <td className="text-xs">{new Date(item.found_date).toLocaleDateString('en-IN')}</td>
                    <td className="text-slate-500">{item.found_location || '—'}</td>
                    <td>{statusBadge(item.status)}</td>
                    <td>{item.claimant_name || '—'}</td>
                    <td>
                      {item.status === 'unclaimed' && (
                        <button onClick={() => markClaimed(item.id)} className="btn-success btn-sm">Mark Claimed</button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
