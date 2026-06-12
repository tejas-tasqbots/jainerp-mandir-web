import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import type { Account, LedgerEntry } from '../../types'

export function Ledger() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01')
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => {
    api.get('/accounts?is_active=true').then(r => setAccounts(r.data.data || []))
  }, [])

  useEffect(() => { if (accountId) load() }, [accountId, from, to])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/accounting/ledger?account_id=${accountId}&from=${from}&to=${to}`)
      setEntries(data.data || [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Ledger</h1>
        {accountId && (
          <button onClick={() => window.open(`/api/v1/accounting/ledger?account_id=${accountId}&from=${from}&to=${to}&export=pdf`, '_blank')} className="btn-secondary btn-sm">
            <Download size={14} /> Export PDF
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <label className="form-label">Account</label>
          <select className="form-select w-64" value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">Select account...</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 text-sm mt-5">
          <label className="text-slate-500">From:</label>
          <input type="date" className="form-input w-40" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 text-sm mt-5">
          <label className="text-slate-500">To:</label>
          <input type="date" className="form-input w-40" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      {!accountId && (
        <div className="text-center py-16 text-slate-400">Select an account to view its ledger</div>
      )}

      {accountId && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-10 text-slate-400">Loading...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-10 text-slate-400">No entries for this period</td></tr>
                ) : entries.map((e, i) => (
                  <tr key={i}>
                    <td className="text-xs">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                    <td>{e.description}</td>
                    <td className="font-mono text-xs text-slate-400">{e.reference || '—'}</td>
                    <td className="text-right text-red-600">{e.debit_paise > 0 ? `₹${fmtPaise(e.debit_paise)}` : '—'}</td>
                    <td className="text-right text-green-700">{e.credit_paise > 0 ? `₹${fmtPaise(e.credit_paise)}` : '—'}</td>
                    <td className="text-right font-semibold">₹{fmtPaise(e.balance_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
