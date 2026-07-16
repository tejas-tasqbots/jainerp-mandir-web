import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileDown, Printer } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { exportRowsCsv, printCurrentView, rsFmt } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'

interface Entry {
  date: string
  type: string
  description: string
  debit_paise: number
  credit_paise: number
  reference?: string
}

export function DayBook() {
  const { t } = useTranslation()
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
        <div>
          <h1 className="text-xl font-bold text-navy-900">{t('accounts.dayBookTitle')}</h1>
          <p className="print-only text-sm text-slate-600 mt-1">{from} — {to}</p>
        </div>
        <div className="flex gap-2 no-print">
          <button type="button" onClick={printCurrentView} className="btn-secondary btn-sm">
            <Printer size={14} /> {t('accounts.print')}
          </button>
          <button type="button"
            onClick={() => downloadRowsPdf(`day-book-${from}_${to}.pdf`, 'Day Book',
              ['Date', 'Type', 'Description', 'Reference', 'Debit', 'Credit'],
              entries.map(e => [e.date, e.type, e.description, e.reference, rsFmt(e.debit_paise), rsFmt(e.credit_paise)]),
              { subtitle: `${from} to ${to}`, totals: ['Total', '', '', '', rsFmt(totalDebit), rsFmt(totalCredit)] })}
            className="btn-secondary btn-sm">
            <FileDown size={14} /> {t('accounts.downloadPdf')}
          </button>
          <button type="button"
            onClick={() => exportRowsCsv(`day-book-${from}_${to}.csv`,
              ['Date', 'Type', 'Description', 'Reference', 'Debit', 'Credit'],
              entries.map(e => [e.date, e.type, e.description, e.reference, rsFmt(e.debit_paise), rsFmt(e.credit_paise)]))}
            className="btn-secondary btn-sm">
            <Download size={14} /> {t('accounts.exportCsv')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 no-print">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-500">{t('accounts.from')}</label>
          <input type="date" className="form-input w-40" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-500">{t('accounts.to')}</label>
          <input type="date" className="form-input w-40" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card"><div className="card-body py-3">
          <p className="text-xs text-slate-400">{t('accounts.totalCreditsIncome')}</p>
          <p className="font-bold text-lg text-green-700">₹{fmtPaise(totalCredit)}</p>
        </div></div>
        <div className="card"><div className="card-body py-3">
          <p className="text-xs text-slate-400">{t('accounts.totalDebitsExpense')}</p>
          <p className="font-bold text-lg text-red-600">₹{fmtPaise(totalDebit)}</p>
        </div></div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('accounts.date')}</th><th>{t('accounts.type')}</th><th>{t('accounts.description')}</th><th>{t('accounts.reference')}</th><th className="text-right">{t('accounts.debit')}</th><th className="text-right">{t('accounts.credit')}</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">{t('accounts.noEntries')}</td></tr>
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
