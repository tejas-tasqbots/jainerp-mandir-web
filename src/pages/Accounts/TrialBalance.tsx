import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api, fmtPaise, currentFY } from '../../lib/api'

interface TBRow { account_name: string; debit_paise: number; credit_paise: number }

export function TrialBalance() {
  const [rows, setRows] = useState<TBRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fy, setFy] = useState(currentFY())

  useEffect(() => { load() }, [fy])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/accounting/trial-balance?fy=${fy}`)
      setRows(data.data?.rows || [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const totalDebit = rows.reduce((s, r) => s + r.debit_paise, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit_paise, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Trial Balance</h1>
        <button onClick={() => window.open(`/api/v1/accounting/trial-balance?fy=${fy}&export=pdf`, '_blank')} className="btn-secondary btn-sm">
          <Download size={14} /> Export PDF
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-500">FY:</label>
        <input className="form-input w-32" value={fy} onChange={e => setFy(e.target.value)} placeholder="2025-26" />
        {totalDebit === totalCredit && totalDebit > 0 && (
          <span className="badge-green">Balanced ✓</span>
        )}
        {totalDebit !== totalCredit && totalDebit > 0 && (
          <span className="badge-red">Imbalanced ✗</span>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={3} className="text-center py-10 text-slate-400">No data for this FY</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i}>
                  <td className="font-medium">{r.account_name}</td>
                  <td className="text-right">{r.debit_paise > 0 ? `₹${fmtPaise(r.debit_paise)}` : '—'}</td>
                  <td className="text-right">{r.credit_paise > 0 ? `₹${fmtPaise(r.credit_paise)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-navy-900 text-white">
                  <td className="px-4 py-3 font-bold">Total</td>
                  <td className="px-4 py-3 text-right font-bold">₹{fmtPaise(totalDebit)}</td>
                  <td className="px-4 py-3 text-right font-bold">₹{fmtPaise(totalCredit)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
