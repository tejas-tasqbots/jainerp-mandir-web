import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'

interface Entry {
  date: string
  type: string
  description: string
  debit_paise: number
  credit_paise: number
  reference?: string
}

export function DayBook() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => { load() }, [from, to])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/accounting/day-book?from=${from}&to=${to}`)
      setEntries(data.data || [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  const totalDebit = entries.reduce((s, e) => s + e.debit_paise, 0)
  const totalCredit = entries.reduce((s, e) => s + e.credit_paise, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Day Book</h1>
        <button onClick={() => window.open(`/api/v1/accounting/day-book?from=${from}&to=${to}&export=pdf`, '_blank')} className="btn-secondary btn-sm">
          <Download size={14} /> Export PDF
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-500">From:</label>
          <input type="date" className="form-input w-40" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-500">To:</label>
          <input type="date" className="form-input w-40" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card"><div className="card-body py-3">
          <p className="text-xs text-slate-400">Total Credits (Income)</p>
          <p className="font-bold text-lg text-green-700">₹{fmtPaise(totalCredit)}</p>
        </div></div>
        <div className="card"><div className="card-body py-3">
          <p className="text-xs text-slate-400">Total Debits (Expense)</p>
          <p className="font-bold text-lg text-red-600">₹{fmtPaise(totalDebit)}</p>
        </div></div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Reference</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">No entries</td></tr>
              ) : entries.map((e, i) => (
                <tr key={i}>
                  <td className="text-xs">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                  <td><span className="badge-blue capitalize">{e.type.replace(/_/g, ' ')}</span></td>
                  <td>{e.description}</td>
                  <td className="font-mono text-xs text-slate-400">{e.reference || '—'}</td>
                  <td className="text-right text-red-600">{e.debit_paise > 0 ? `₹${fmtPaise(e.debit_paise)}` : '—'}</td>
                  <td className="text-right text-green-700">{e.credit_paise > 0 ? `₹${fmtPaise(e.credit_paise)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
