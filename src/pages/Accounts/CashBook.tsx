import { useEffect, useState } from 'react'
import { Download, FileDown, Printer } from 'lucide-react'
import { api, fmtPaise, currentFY } from '../../lib/api'
import { exportRowsCsv, printCurrentView, rsFmt } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'

interface Entry {
  date: string
  description: string
  debit_paise: number
  credit_paise: number
  balance_paise: number
  reference?: string
}

export function CashBook({ bankMode = false }: { bankMode?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01')
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => { load() }, [from, to, bankMode])

  async function load() {
    setLoading(true)
    try {
      const type = bankMode ? 'bank' : 'cash'
      const { data } = await api.get(`/accounting/ledger?type=${type}&from=${from}&to=${to}`)
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
        <h1 className="text-xl font-bold text-navy-900">{bankMode ? 'Bank Book' : 'Cash Book'}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={printCurrentView} className="btn-secondary btn-sm">
            <Printer size={14} /> Print
          </button>
          <button type="button"
            onClick={() => downloadRowsPdf(`${bankMode ? 'bank' : 'cash'}-book-${from}_${to}.pdf`,
              bankMode ? 'Bank Book' : 'Cash Book',
              ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'],
              entries.map(e => [e.date, e.description, e.reference, rsFmt(e.debit_paise), rsFmt(e.credit_paise), rsFmt(e.balance_paise)]),
              { subtitle: `${from} to ${to}`, totals: ['Total', '', '', rsFmt(totalDebit), rsFmt(totalCredit), ''] })}
            className="btn-secondary btn-sm">
            <FileDown size={14} /> Download PDF
          </button>
          <button type="button"
            onClick={() => exportRowsCsv(`${bankMode ? 'bank' : 'cash'}-book-${from}_${to}.csv`,
              ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'],
              entries.map(e => [e.date, e.description, e.reference, rsFmt(e.debit_paise), rsFmt(e.credit_paise), rsFmt(e.balance_paise)]))}
            className="btn-secondary btn-sm">
            <Download size={14} /> Export CSV
          </button>
        </div>
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

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card"><div className="card-body py-3">
          <p className="text-xs text-slate-400">Total Receipts</p>
          <p className="font-bold text-lg text-green-700">₹{fmtPaise(totalCredit)}</p>
        </div></div>
        <div className="card"><div className="card-body py-3">
          <p className="text-xs text-slate-400">Total Payments</p>
          <p className="font-bold text-lg text-red-600">₹{fmtPaise(totalDebit)}</p>
        </div></div>
        <div className="card"><div className="card-body py-3">
          <p className="text-xs text-slate-400">Closing Balance</p>
          <p className={`font-bold text-lg ${totalCredit >= totalDebit ? 'text-navy-900' : 'text-red-600'}`}>
            ₹{fmtPaise(Math.abs(totalCredit - totalDebit))}
          </p>
        </div></div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Reference</th><th className="text-right">Receipts (Cr)</th><th className="text-right">Payments (Dr)</th><th className="text-right">Balance</th></tr>
            </thead>
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
                  <td className="text-right font-medium text-green-700">{e.credit_paise > 0 ? `₹${fmtPaise(e.credit_paise)}` : '—'}</td>
                  <td className="text-right font-medium text-red-600">{e.debit_paise > 0 ? `₹${fmtPaise(e.debit_paise)}` : '—'}</td>
                  <td className="text-right font-semibold">₹{fmtPaise(e.balance_paise)}</td>
                </tr>
              ))}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr className="bg-navy-50">
                  <td colSpan={3} className="px-4 py-2 font-semibold text-sm">Total</td>
                  <td className="px-4 py-2 text-right font-bold text-green-700">₹{fmtPaise(totalCredit)}</td>
                  <td className="px-4 py-2 text-right font-bold text-red-600">₹{fmtPaise(totalDebit)}</td>
                  <td className="px-4 py-2 text-right font-bold">—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
