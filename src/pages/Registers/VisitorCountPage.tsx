import { useEffect, useState } from 'react'
import { Save, Users } from 'lucide-react'
import { api } from '../../lib/api'
import type { VisitorCount } from '../../types'

export function VisitorCountPage() {
  const [counts, setCounts] = useState<VisitorCount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [today] = useState(new Date().toISOString().slice(0, 10))
  const [todayRecord, setTodayRecord] = useState<VisitorCount | null>(null)
  const [form, setForm] = useState({ morning_count: '', evening_count: '', notes: '' })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/visitor-counts?limit=30`)
      const all: VisitorCount[] = data.data || []
      setCounts(all)
      const tr = all.find(c => c.count_date === today)
      if (tr) {
        setTodayRecord(tr)
        setForm({
          morning_count: String(tr.morning_count || ''),
          evening_count: String(tr.evening_count || ''),
          notes: tr.notes || '',
        })
      }
    } finally {
      setLoading(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/visitor-counts', {
        count_date: today,
        morning_count: form.morning_count ? parseInt(form.morning_count) : undefined,
        evening_count: form.evening_count ? parseInt(form.evening_count) : undefined,
        notes: form.notes || undefined,
      })
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">Visitor Count Register</h1>

      {/* Today's count entry */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <Users size={15} /> Today's Count ({new Date(today).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })})
          </h3>
          {todayRecord && <span className="badge-blue">Total: {todayRecord.total_count}</span>}
        </div>
        <form onSubmit={save} className="card-body">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="form-label">Morning Count</label>
              <input type="number" min="0" className="form-input" placeholder="0"
                value={form.morning_count} onChange={e => setForm(f => ({ ...f, morning_count: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Evening Count</label>
              <input type="number" min="0" className="form-input" placeholder="0"
                value={form.evening_count} onChange={e => setForm(f => ({ ...f, evening_count: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Notes</label>
              <input className="form-input" placeholder="Optional notes" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="mt-4">
            <button type="submit" disabled={saving} className="btn-primary">
              <Save size={16} /> {saving ? 'Saving...' : todayRecord ? 'Update Count' : 'Save Count'}
            </button>
          </div>
        </form>
      </div>

      {/* History */}
      <div className="card overflow-hidden">
        <div className="card-header"><h3 className="font-semibold text-sm">Recent History</h3></div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Morning</th><th>Evening</th><th>Total</th><th>Notes</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="text-center py-8 text-slate-400">Loading...</td></tr>
                : counts.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-slate-400">No records</td></tr>
                : counts.map(c => (
                  <tr key={c.id}>
                    <td className="text-sm">{new Date(c.count_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                    <td className="text-center">{c.morning_count || '—'}</td>
                    <td className="text-center">{c.evening_count || '—'}</td>
                    <td className="text-center font-bold">{c.total_count}</td>
                    <td className="text-slate-400 text-xs">{c.notes || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
