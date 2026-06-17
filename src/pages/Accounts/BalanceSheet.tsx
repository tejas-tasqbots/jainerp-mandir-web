import { useEffect, useState } from 'react'
import { api, fmtPaise, currentFY } from '../../lib/api'

interface CashBankEntry { account: string; type: string; balance_paise: number }

interface BSData {
  fy: string
  assets: {
    cash_and_bank: CashBankEntry[]
    cash_and_bank_total_paise: number
    fixed_assets_paise: number
    loans_given_paise: number
    total_paise: number
  }
  liabilities: {
    creditors_paise: number
    loans_taken_paise: number
    total_paise: number
  }
}

function Row({ label, paise, bold }: { label: string; paise: number; bold?: boolean }) {
  return (
    <tr className={bold ? 'font-bold bg-slate-50' : ''}>
      <td className="px-4 py-2 text-sm">{label}</td>
      <td className="px-4 py-2 text-right text-sm font-mono">₹{fmtPaise(paise)}</td>
    </tr>
  )
}

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

  const totalAssets = data?.assets.total_paise ?? 0
  const totalLiabilities = data?.liabilities.total_paise ?? 0
  const corpus = totalAssets - totalLiabilities

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Balance Sheet</h1>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-500">FY:</label>
        <input className="form-input w-32" value={fy} onChange={e => setFy(e.target.value)} />
        {data && <span className="badge-green">As of end of FY</span>}
      </div>

      {loading && <div className="text-center py-10 text-slate-400">Loading...</div>}
      {!loading && !data && <div className="text-center py-10 text-slate-400">No data available</div>}

      {!loading && data && (
        <div className="grid grid-cols-2 gap-6">
          {/* ── Assets ── */}
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">Assets</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Item</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.assets.cash_and_bank.map((a, i) => (
                    <Row key={i} label={`${a.account} (${a.type})`} paise={a.balance_paise} />
                  ))}
                  <Row label="Fixed Assets (Net)" paise={data.assets.fixed_assets_paise} />
                  {data.assets.loans_given_paise > 0 && (
                    <Row label="Loans Given (Outstanding)" paise={data.assets.loans_given_paise} />
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 font-bold">
                    <td className="px-4 py-2">Total Assets</td>
                    <td className="px-4 py-2 text-right font-mono text-blue-700">₹{fmtPaise(totalAssets)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── Liabilities + Corpus ── */}
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">Liabilities & Corpus</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Item</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.liabilities.creditors_paise > 0 && (
                    <Row label="Creditors (Outstanding)" paise={data.liabilities.creditors_paise} />
                  )}
                  {data.liabilities.loans_taken_paise > 0 && (
                    <Row label="Loans Taken (Outstanding)" paise={data.liabilities.loans_taken_paise} />
                  )}
                  <Row label="Corpus / Net Worth" paise={corpus} bold />
                </tbody>
                <tfoot>
                  <tr className="bg-purple-50 font-bold">
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-right font-mono text-purple-700">₹{fmtPaise(totalAssets)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
