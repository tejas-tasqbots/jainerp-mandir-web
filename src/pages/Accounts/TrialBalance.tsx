import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileDown, Printer } from 'lucide-react'
import { api, fmtPaise, currentFY } from '../../lib/api'
import { FySelect } from '../../components/FySelect'
import { exportRowsCsv, printCurrentView, rsFmt } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'

interface TBRow { account_name: string; debit_paise: number; credit_paise: number }

export function TrialBalance() {
  const { t } = useTranslation()
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
        <div>
          <h1 className="text-xl font-bold text-navy-900">{t('accounts.trialBalanceTitle')}</h1>
          <p className="print-only text-sm text-slate-600 mt-1">{t('accounts.fy')} {fy}</p>
        </div>
        <div className="flex gap-2 no-print">
          <button type="button" onClick={printCurrentView} className="btn-secondary btn-sm">
            <Printer size={14} /> {t('accounts.print')}
          </button>
          <button type="button"
            onClick={() => downloadRowsPdf(`trial-balance-${fy}.pdf`, 'Trial Balance', ['Account', 'Debit', 'Credit'],
              rows.map(r => [r.account_name, r.debit_paise > 0 ? rsFmt(r.debit_paise) : '', r.credit_paise > 0 ? rsFmt(r.credit_paise) : '']),
              { subtitle: `FY ${fy}`, totals: ['Total', rsFmt(totalDebit), rsFmt(totalCredit)] })}
            className="btn-secondary btn-sm">
            <FileDown size={14} /> {t('accounts.downloadPdf')}
          </button>
          <button type="button"
            onClick={() => exportRowsCsv(`trial-balance-${fy}.csv`, ['Account', 'Debit', 'Credit'],
              rows.map(r => [r.account_name, rsFmt(r.debit_paise), rsFmt(r.credit_paise)]))}
            className="btn-secondary btn-sm">
            <Download size={14} /> {t('accounts.exportCsv')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 no-print">
        <label className="text-sm text-slate-500">{t('accounts.fy')}</label>
        <FySelect value={fy} onChange={setFy} />
        {totalDebit === totalCredit && totalDebit > 0 && (
          <span className="badge-green">{t('accounts.balanced')}</span>
        )}
        {totalDebit !== totalCredit && totalDebit > 0 && (
          <span className="badge-red">{t('accounts.imbalanced')}</span>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('accounts.account')}</th><th className="text-right">{t('accounts.debit')}</th><th className="text-right">{t('accounts.credit')}</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={3} className="text-center py-10 text-slate-400">{t('accounts.noDataForFy')}</td></tr>
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
                  <td className="px-4 py-3 font-bold">{t('accounts.total')}</td>
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
