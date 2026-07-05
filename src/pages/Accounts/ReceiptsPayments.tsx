import { useEffect, useState } from 'react'
import { Download, FileDown, Printer } from 'lucide-react'
import { exportRowsCsv, printCurrentView, rsFmt } from '../../lib/downloadReport'
import { downloadSectionsPdf } from '../../lib/pdfTable'
import { api, fmtPaise, currentFY } from '../../lib/api'

interface Section { head?: string; name?: string; amount_paise: number; entries?: number }
interface RPData {
  receipts: Section[]
  payments: Section[]
  totals: { receipts_paise: number; payments_paise: number }
  from: string
  to: string
}

export function ReceiptsPayments() {
  const [data, setData] = useState<RPData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fy, setFy] = useState(currentFY())

  useEffect(() => { load() }, [fy])

  async function load() {
    setLoading(true)
    try {
      const res = await api.get(`/accounting/receipts-payments?fy=${fy}`)
      setData(res.data.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const totalReceipts = data?.totals?.receipts_paise ?? data?.receipts?.reduce((s, r) => s + r.amount_paise, 0) ?? 0
  const totalPayments = data?.totals?.payments_paise ?? data?.payments?.reduce((s, r) => s + r.amount_paise, 0) ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Receipts & Payments</h1>
        <div className="flex gap-2">
          <button type="button" onClick={printCurrentView} className="btn-secondary btn-sm">
            <Printer size={14} /> Print
          </button>
          <button type="button"
            onClick={() => data && downloadSectionsPdf(`receipts-payments-${fy}.pdf`, 'Receipts & Payments Account', [
              {
                heading: 'Receipts',
                headers: ['Source', 'Entries', 'Amount'],
                rows: data.receipts.map(r => [r.head ?? r.name, r.entries ?? '', rsFmt(r.amount_paise)]),
                totals: ['Total Receipts', '', rsFmt(totalReceipts)],
              },
              {
                heading: 'Payments',
                headers: ['Category', 'Entries', 'Amount'],
                rows: data.payments.map(p => [p.head ?? p.name, p.entries ?? '', rsFmt(p.amount_paise)]),
                totals: ['Total Payments', '', rsFmt(totalPayments)],
              },
            ], { subtitle: `FY ${fy}` })}
            className="btn-secondary btn-sm">
            <FileDown size={14} /> Download PDF
          </button>
          <button type="button"
            onClick={() => data && exportRowsCsv(`receipts-payments-${fy}.csv`, ['Section', 'Head', 'Entries', 'Amount'], [
              ...data.receipts.map(r => ['Receipts', r.head ?? r.name ?? '', r.entries ?? '', rsFmt(r.amount_paise)]),
              ['Receipts', 'Total Receipts', '', rsFmt(totalReceipts)],
              ...data.payments.map(p => ['Payments', p.head ?? p.name ?? '', p.entries ?? '', rsFmt(p.amount_paise)]),
              ['Payments', 'Total Payments', '', rsFmt(totalPayments)],
            ])}
            className="btn-secondary btn-sm">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-500">FY:</label>
        <input className="form-input w-32" value={fy} onChange={e => setFy(e.target.value)} placeholder="2025-26" />
      </div>

      {loading && <div className="text-center py-10 text-slate-400">Loading...</div>}

      {!loading && data && (
        <div className="grid grid-cols-2 gap-6">
          {/* Receipts */}
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">Receipts</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Source</th><th className="text-right">Entries</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.receipts.map((r, i) => (
                    <tr key={i}>
                      <td>{r.head ?? r.name}</td>
                      <td className="text-right text-slate-400 text-xs">{r.entries ?? '—'}</td>
                      <td className="text-right">₹{fmtPaise(r.amount_paise)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="bg-green-50">
                  <td className="px-4 py-2 font-bold" colSpan={2}>Total Receipts</td>
                  <td className="px-4 py-2 text-right font-bold text-green-700">₹{fmtPaise(totalReceipts)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>

          {/* Payments */}
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">Payments</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Category</th><th className="text-right">Entries</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.payments.map((p, i) => (
                    <tr key={i}>
                      <td>{p.head ?? p.name}</td>
                      <td className="text-right text-slate-400 text-xs">{p.entries ?? '—'}</td>
                      <td className="text-right">₹{fmtPaise(p.amount_paise)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="bg-red-50">
                  <td className="px-4 py-2 font-bold" colSpan={2}>Total Payments</td>
                  <td className="px-4 py-2 text-right font-bold text-red-600">₹{fmtPaise(totalPayments)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {!loading && !data && (
        <div className="text-center py-16 text-slate-400">No data available for FY {fy}</div>
      )}
    </div>
  )
}
