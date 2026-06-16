import { useEffect, useState } from 'react'
import { Plus, Pencil, X } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'

interface Seva { id: string; name: string; description: string | null; price_paise: number; timings: string[] | null; max_per_slot: number; is_active: boolean; sort_order: number }

const BLANK = { name: '', description: '', price_paise: '', timings: '', max_per_slot: '1', sort_order: '0' }

export function SevasSettings() {
  const [sevas, setSevas] = useState<Seva[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Seva | null>(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  function load() {
    api.get('/services?limit=200').then(r => setSevas(r.data.data || [])).catch(() => {})
  }

  function openAdd() { setEditing(null); setForm(BLANK); setShowForm(true) }
  function openEdit(s: Seva) {
    setEditing(s)
    setForm({
      name: s.name, description: s.description || '',
      price_paise: String(s.price_paise / 100),
      timings: (s.timings || []).join(', '),
      max_per_slot: String(s.max_per_slot),
      sort_order: String(s.sort_order),
    })
    setShowForm(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const timingsArr = form.timings
        ? form.timings.split(',').map(t => t.trim()).filter(Boolean)
        : []
      const payload = {
        name: form.name,
        description: form.description || null,
        price_paise: parsePaise(form.price_paise || '0'),
        timings: timingsArr,
        max_per_slot: Number(form.max_per_slot) || 1,
        sort_order: Number(form.sort_order) || 0,
      }
      if (editing) await api.patch(`/services/${editing.id}`, payload)
      else await api.post('/services', payload)
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Seva Master</h1>
        <button className="btn-primary btn-sm" onClick={openAdd}><Plus size={14} /> Add Seva</button>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr><th>NAME</th><th>DESCRIPTION</th><th>PRICE (₹)</th><th>TIMINGS</th><th>MAX/DAY</th><th>ACTIONS</th></tr>
          </thead>
          <tbody>
            {sevas.map(s => (
              <tr key={s.id}>
                <td className="font-medium">{s.name}</td>
                <td className="text-sm text-slate-400 max-w-xs truncate">{s.description || '—'}</td>
                <td>₹{fmtPaise(s.price_paise)}</td>
                <td className="text-sm text-slate-500">{(s.timings || []).join(', ') || 'All day'}</td>
                <td>{s.max_per_slot}</td>
                <td>
                  <button onClick={() => openEdit(s)} className="text-slate-400 hover:text-navy-900 p-1"><Pencil size={13} /></button>
                </td>
              </tr>
            ))}
            {sevas.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">No sevas added yet</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy-900">{editing ? 'Edit Seva' : 'Add Seva'}</h3>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <form onSubmit={save} className="space-y-3">
              <div>
                <label className="form-label">Seva Name *</label>
                <input className="form-input" required value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Description</label>
                <input className="form-input" placeholder="e.g. Morning/evening aarti" value={form.description} onChange={e => set('description', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Price (₹) *</label>
                  <input type="number" min="0" step="0.01" className="form-input" required value={form.price_paise} onChange={e => set('price_paise', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Max per slot</label>
                  <input type="number" min="1" className="form-input" value={form.max_per_slot} onChange={e => set('max_per_slot', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="form-label">Timings <span className="text-slate-400 font-normal">(comma-separated, e.g. 06:00-07:00, 18:00-19:00)</span></label>
                <input className="form-input" placeholder="06:00-07:00, 18:00-19:00" value={form.timings} onChange={e => set('timings', e.target.value)} />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
