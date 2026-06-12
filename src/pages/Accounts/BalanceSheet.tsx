import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api, fmtPaise, currentFY } from '../../lib/api'

interface Section { name: string; amount_paise: number }
interface BSData { assets: Section[]; liabilities: Section[] }

export function BalanceSheet() {
  const [data, setData] = useState<BSData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fy, setFy] = useState(currentFY())

  useEffect(() => { load() }, [fy])

  async function load() {
    setLoading(true)
    try {
      const res = await api.get(`/accounting/balance-sheet?fy=${fy}`)
      setData(res.data.data)
    } catch { setData(null) } finally { setLoading(false) }
  }

  const totalAssets = data?.assets?.reduce((s, r) => s + r.amount_paise, 0) || 0
  const totalLiabilities = data?.liabilities?.reduce((s, r) => s + r.amount_paise, 0) || 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Balance Sheet</h1>
        <button onClick={() => window.open(`/api/v1/accounting/balance-sheet?fy=${fy}&export=pdf`, '_blank')} className="btn-secondary btn-sm">
          <Download size={14} /> Export PDF
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-500">FY:</label>
        <input className="form-input w-32" value={fy} onChange={e => setFy(e.target.value)} />
        {totalAssets === totalLiabilities && totalAssets > 0 && <span className="badge-green">Balanced ✓</span>}
      </div>

      {loading && <div className="text-center py-10 text-slate-400">Loading...</div>}

      {!loading && data && (
        <div className="grid grid-cols-2 gap-6">
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">Assets</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Item</th><th className="text-right">Amount</th></tr></thead>
                <tbody>{data.assets.map((r, i) => <tr key={i}><td>{r.name}</td><td className="text-right">₹{fmtPaise(r.amount_paise)}</td></tr>)}</tbody>
                <tfoot><tr className="bg-blue-50"><td className="px-4 py-2 font-bold">Total Assets</td><td className="px-4 py-2 text-right font-bold text-blue-700">₹{fmtPaise(totalAssets)}</td></tr></tfoot>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">Liabilities & Corpus</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Item</th><th className="text-right">Amount</th></tr></thead>
                <tbody>{data.liabilities.map((r, i) => <tr key={i}><td>{r.name}</td><td className="text-right">₹{fmtPaise(r.amount_paise)}</td></tr>)}</tbody>
                <tfoot><tr className="bg-purple-50"><td className="px-4 py-2 font-bold">Total</td><td className="px-4 py-2 text-right font-bold text-purple-700">₹{fmtPaise(totalLiabilities)}</td></tr></tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
