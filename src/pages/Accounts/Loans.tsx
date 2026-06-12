import { useEffect, useState } from 'react'
import { Plus, Save } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import type { Loan } from '../../types'

export function Loans() {
  const [loans, setLoans] = useState<Loan[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    type: 'taken', party_name: '', principal: '',
    interest_rate: '0', start_date: new Date().toISOString().slice(0, 10), end_date: '',
  })

  useEffect(() => {
    api.get('/loans').then(r => setLoans(r.data.data || [])).finally(() => setLoading(false))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/loans', {
        type: form.type,
        party_name: form.party_name,
        principal_paise: parsePaise(form.principal),
        interest_rate: parseFloat(form.interest_rate),
        start_date: form.start_date,
        end_date: form.end_date || undefined,
      })
      setShowForm(false)
      api.get('/loans').then(r => setLoans(r.data.data || []))
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Loans Register</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm"><Plus size={14} /> Add Loan</button>
      </div>

      {showForm && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Record Loan</h3></div>
          <form onSubmit={submit} className="card-body space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="form-label">Type</label>
                <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="taken">Loan Taken</option><option value="given">Loan Given</option>
                </select>
              </div>
              <div><label className="form-label">Party Name *</label><input className="form-input" value={form.party_name} onChange={e => setForm(f => ({ ...f, party_name: e.target.value }))} required /></div>
              <div><label className="form-label">Principal (₹) *</label><input type="number" className="form-input" value={form.principal} onChange={e => setForm(f => ({ ...f, principal: e.target.value }))} required /></div>
              <div><label className="form-label">Interest Rate (%)</label><input type="number" step="0.01" className="form-input" value={form.interest_rate} onChange={e => setForm(f => ({ ...f, interest_rate: e.target.value }))} /></div>
              <div><label className="form-label">Start Date</label><input type="date" className="form-input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
              <div><label className="form-label">End Date</label><input type="date" className="form-input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
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
            <thead><tr><th>Type</th><th>Party</th><th>Principal</th><th>Interest</th><th>Repaid</th><th>Outstanding</th><th>Start</th><th>Status</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">Loading...</td></tr>
                : loans.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">No loans</td></tr>
                : loans.map(l => (
                  <tr key={l.id}>
                    <td><span className={l.type === 'taken' ? 'badge-red' : 'badge-green'}>{l.type}</span></td>
                    <td className="font-medium">{l.party_name}</td>
                    <td>₹{fmtPaise(l.principal_paise)}</td>
                    <td>{l.interest_rate}%</td>
                    <td className="text-green-700">₹{fmtPaise(l.repaid_paise)}</td>
                    <td className="font-semibold">{l.principal_paise - l.repaid_paise > 0 ? `₹${fmtPaise(l.principal_paise - l.repaid_paise)}` : '—'}</td>
                    <td className="text-xs">{new Date(l.start_date).toLocaleDateString('en-IN')}</td>
                    <td>{l.status === 'active' ? <span className="badge-blue">Active</span> : <span className="badge-gray">Closed</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
