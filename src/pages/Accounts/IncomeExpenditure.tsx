import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, fmtPaise, currentFY } from '../../lib/api'

interface Section { name: string; head?: string; amount_paise: number }
interface IEData {
  income: Section[]
  expenditure: Section[]
  totals: { income_paise: number; expenditure_paise: number; surplus_paise: number }
}

export function IncomeExpenditure() {
  const [data, setData] = useState<IEData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fy, setFy] = useState(currentFY())

  useEffect(() => { load() }, [fy])

  async function load() {
    setLoading(true)
    try {
      const res = await api.get(`/accounting/income-expenditure?fy=${fy}`)
      setData(res.data.data)
    } catch { setData(null) } finally { setLoading(false) }
  }

  const totalIncome = data?.totals?.income_paise ?? data?.income?.reduce((s, r) => s + r.amount_paise, 0) ?? 0
  const totalExpenditure = data?.totals?.expenditure_paise ?? data?.expenditure?.reduce((s, r) => s + r.amount_paise, 0) ?? 0
  const surplusPaise = data?.totals?.surplus_paise ?? (totalIncome - totalExpenditure)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Income & Expenditure</h1>
        <button type="button" onClick={printCurrentView} className="btn-secondary btn-sm">
          <Printer size={14} /> Print / PDF
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-500">FY:</label>
        <input className="form-input w-32" value={fy} onChange={e => setFy(e.target.value)} />
        {data && (
          <span className={surplusPaise >= 0 ? 'badge-green' : 'badge-red'}>
            {surplusPaise >= 0 ? 'Surplus' : 'Deficit'}: ₹{fmtPaise(Math.abs(surplusPaise))}
          </span>
        )}
      </div>

      {loading && <div className="text-center py-10 text-slate-400">Loading...</div>}

      {!loading && data && (
        <div className="grid grid-cols-2 gap-6">
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">Income</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Source</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.income.map((r, i) => <tr key={i}><td>{r.head ?? r.name}</td><td className="text-right">₹{fmtPaise(r.amount_paise)}</td></tr>)}
                </tbody>
                <tfoot><tr className="bg-green-50"><td className="px-4 py-2 font-bold">Total Income</td><td className="px-4 py-2 text-right font-bold text-green-700">₹{fmtPaise(totalIncome)}</td></tr></tfoot>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">Expenditure</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Category</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.expenditure.map((r, i) => <tr key={i}><td>{r.head ?? r.name}</td><td className="text-right">₹{fmtPaise(r.amount_paise)}</td></tr>)}
                </tbody>
                <tfoot><tr className="bg-red-50"><td className="px-4 py-2 font-bold">Total Expenditure</td><td className="px-4 py-2 text-right font-bold text-red-600">₹{fmtPaise(totalExpenditure)}</td></tr></tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
