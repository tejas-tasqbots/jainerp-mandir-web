import { useEffect, useState } from 'react'
import { Plus, Pencil, X } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'

interface Room { id: string; room_number: string; name: string | null; floor: number; room_type: string; capacity_persons: number; tariff_paise: number; gst_rate: number; is_available: boolean }

const BLANK = { room_number: '', name: '', floor: '1', room_type: 'non_ac', capacity_persons: '2', tariff_paise: '', gst_rate: '0' }
const ROOM_TYPES = ['non_ac', 'ac', 'dormitory', 'suite', 'vip']

export function RoomsSettings() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Room | null>(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  function load() {
    api.get('/rooms?limit=200').then(r => setRooms(r.data.data || [])).catch(() => {})
  }

  function openAdd() { setEditing(null); setForm(BLANK); setShowForm(true) }
  function openEdit(r: Room) {
    setEditing(r)
    setForm({
      room_number: r.room_number, name: r.name || '', floor: String(r.floor),
      room_type: r.room_type, capacity_persons: String(r.capacity_persons),
      tariff_paise: String(r.tariff_paise / 100), gst_rate: String(r.gst_rate),
    })
    setShowForm(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        room_number: form.room_number, name: form.name || null,
        floor: Number(form.floor), room_type: form.room_type,
        capacity_persons: Number(form.capacity_persons),
        tariff_paise: parsePaise(form.tariff_paise || '0'),
        gst_rate: Number(form.gst_rate),
      }
      if (editing) await api.patch(`/rooms/${editing.id}`, payload)
      else await api.post('/rooms', payload)
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
        <h1 className="text-xl font-bold text-navy-900">Room Master</h1>
        <button className="btn-primary btn-sm" onClick={openAdd}><Plus size={14} /> Add Room</button>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr><th>ROOM NO</th><th>FLOOR</th><th>TYPE</th><th>CAPACITY</th><th>TARIFF (₹)</th><th>GST</th><th>STATUS</th><th>ACTIONS</th></tr>
          </thead>
          <tbody>
            {rooms.map(r => (
              <tr key={r.id}>
                <td className="font-medium">{r.room_number}{r.name && <span className="text-slate-400 ml-1 text-xs">· {r.name}</span>}</td>
                <td>{r.floor}</td>
                <td className="capitalize text-sm">{r.room_type.replace('_', ' ')}</td>
                <td>{r.capacity_persons}</td>
                <td>₹{fmtPaise(r.tariff_paise)}</td>
                <td>{r.gst_rate}%</td>
                <td><span className={r.is_available ? 'badge-green' : 'badge-red'}>{r.is_available ? 'Available' : 'Occupied'}</span></td>
                <td>
                  <button onClick={() => openEdit(r)} className="text-slate-400 hover:text-navy-900 p-1"><Pencil size={13} /></button>
                </td>
              </tr>
            ))}
            {rooms.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">No rooms added yet</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy-900">{editing ? 'Edit Room' : 'Add Room'}</h3>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Room No. *</label>
                  <input className="form-input" required value={form.room_number} onChange={e => set('room_number', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Name / Label</label>
                  <input className="form-input" placeholder="e.g. Deluxe AC" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Floor</label>
                  <input type="number" min="0" className="form-input" value={form.floor} onChange={e => set('floor', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Capacity (persons)</label>
                  <input type="number" min="1" className="form-input" value={form.capacity_persons} onChange={e => set('capacity_persons', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="form-label">Room Type</label>
                <select className="form-select" value={form.room_type} onChange={e => set('room_type', e.target.value)}>
                  {ROOM_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').toUpperCase()}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Tariff per night (₹)</label>
                  <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00" value={form.tariff_paise} onChange={e => set('tariff_paise', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">GST %</label>
                  <select className="form-select" value={form.gst_rate} onChange={e => set('gst_rate', e.target.value)}>
                    {[0, 5, 12, 18].map(g => <option key={g} value={g}>{g}%</option>)}
                  </select>
                </div>
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
