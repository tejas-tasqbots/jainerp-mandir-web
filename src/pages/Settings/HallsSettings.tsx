import { useEffect, useState } from 'react'
import { Plus, Pencil, X } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'

interface Hall { id: string; name: string; capacity_persons: number; hourly_tariff_paise: number; session_tariff_paise: number; fullday_tariff_paise: number; gst_rate: number; is_available: boolean }

const BLANK = { name: '', capacity_persons: '50', hourly_tariff_paise: '', session_tariff_paise: '', fullday_tariff_paise: '', gst_rate: '18' }

export function HallsSettings() {
  const [halls, setHalls] = useState<Hall[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Hall | null>(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  function load() {
    api.get('/halls?limit=200').then(r => setHalls(r.data.data || [])).catch(() => {})
  }

  function openAdd() { setEditing(null); setForm(BLANK); setShowForm(true) }
  function openEdit(h: Hall) {
    setEditing(h)
    setForm({
      name: h.name, capacity_persons: String(h.capacity_persons),
      hourly_tariff_paise: String(h.hourly_tariff_paise / 100),
      session_tariff_paise: String(h.session_tariff_paise / 100),
      fullday_tariff_paise: String(h.fullday_tariff_paise / 100),
      gst_rate: String(h.gst_rate),
    })
    setShowForm(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        capacity_persons: Number(form.capacity_persons),
        hourly_tariff_paise: parsePaise(form.hourly_tariff_paise || '0'),
        session_tariff_paise: parsePaise(form.session_tariff_paise || '0'),
        fullday_tariff_paise: parsePaise(form.fullday_tariff_paise || '0'),
        gst_rate: Number(form.gst_rate),
      }
      if (editing) await api.patch(`/halls/${editing.id}`, payload)
      else await api.post('/halls', payload)
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
        <h1 className="text-xl font-bold text-navy-900">Hall Master</h1>
        <button className="btn-primary btn-sm" onClick={openAdd}><Plus size={14} /> Add Hall</button>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr><th>NAME</th><th>CAPACITY</th><th>HOURLY (₹)</th><th>HALF-DAY (₹)</th><th>FULL DAY (₹)</th><th>GST</th><th>STATUS</th><th>ACTIONS</th></tr>
          </thead>
          <tbody>
            {halls.map(h => (
              <tr key={h.id}>
                <td className="font-medium">{h.name}</td>
                <td>{h.capacity_persons}</td>
                <td>₹{fmtPaise(h.hourly_tariff_paise)}</td>
                <td>₹{fmtPaise(h.session_tariff_paise)}</td>
                <td>₹{fmtPaise(h.fullday_tariff_paise)}</td>
                <td>{h.gst_rate}%</td>
                <td><span className={h.is_available ? 'badge-green' : 'badge-red'}>{h.is_available ? 'Available' : 'Booked'}</span></td>
                <td>
                  <button onClick={() => openEdit(h)} className="text-slate-400 hover:text-navy-900 p-1"><Pencil size={13} /></button>
                </td>
              </tr>
            ))}
            {halls.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">No halls added yet</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy-900">{editing ? 'Edit Hall' : 'Add Hall'}</h3>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Hall Name *</label>
                  <input className="form-input" required value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Capacity (persons)</label>
                  <input type="number" min="1" className="form-input" value={form.capacity_persons} onChange={e => set('capacity_persons', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="form-label">Hourly (₹)</label>
                  <input type="number" min="0" step="0.01" className="form-input" value={form.hourly_tariff_paise} onChange={e => set('hourly_tariff_paise', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Half-day (₹)</label>
                  <input type="number" min="0" step="0.01" className="form-input" value={form.session_tariff_paise} onChange={e => set('session_tariff_paise', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Full day (₹)</label>
                  <input type="number" min="0" step="0.01" className="form-input" value={form.fullday_tariff_paise} onChange={e => set('fullday_tariff_paise', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="form-label">GST %</label>
                <select className="form-select" value={form.gst_rate} onChange={e => set('gst_rate', e.target.value)}>
                  {[0, 5, 12, 18].map(g => <option key={g} value={g}>{g}%</option>)}
                </select>
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
