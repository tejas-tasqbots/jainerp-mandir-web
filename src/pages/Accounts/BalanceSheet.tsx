import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileDown, Printer } from 'lucide-react'
import { exportRowsCsv, printCurrentView, rsFmt } from '../../lib/downloadReport'
import { downloadSectionsPdf } from '../../lib/pdfTable'
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
  const { t } = useTranslation()
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
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.balanceSheetTitle')}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={printCurrentView} className="btn-secondary btn-sm">
            <Printer size={14} /> {t('accounts.print')}
          </button>
          <button type="button"
            onClick={() => data && downloadSectionsPdf(`balance-sheet-${fy}.pdf`, 'Balance Sheet', [
              {
                heading: 'Assets',
                headers: ['Item', 'Amount'],
                rows: [
                  ...data.assets.cash_and_bank.map(a => [`${a.account} (${a.type})`, rsFmt(a.balance_paise)]),
                  ['Fixed Assets (Net)', rsFmt(data.assets.fixed_assets_paise)],
                  ...(data.assets.loans_given_paise > 0 ? [['Loans Given (Outstanding)', rsFmt(data.assets.loans_given_paise)]] : []),
                ],
                totals: ['Total Assets', rsFmt(totalAssets)],
              },
              {
                heading: 'Liabilities & Corpus',
                headers: ['Item', 'Amount'],
                rows: [
                  ...(data.liabilities.creditors_paise > 0 ? [['Creditors (Outstanding)', rsFmt(data.liabilities.creditors_paise)]] : []),
                  ...(data.liabilities.loans_taken_paise > 0 ? [['Loans Taken (Outstanding)', rsFmt(data.liabilities.loans_taken_paise)]] : []),
                  ['Corpus / Net Worth', rsFmt(corpus)],
                ],
                totals: ['Total', rsFmt(totalAssets)],
              },
            ], { subtitle: `FY ${fy} (as of year end)` })}
            className="btn-secondary btn-sm">
            <FileDown size={14} /> {t('accounts.downloadPdf')}
          </button>
          <button type="button"
            onClick={() => data && exportRowsCsv(`balance-sheet-${fy}.csv`, ['Section', 'Item', 'Amount'], [
              ...data.assets.cash_and_bank.map(a => ['Assets', `${a.account} (${a.type})`, rsFmt(a.balance_paise)]),
              ['Assets', 'Fixed Assets (Net)', rsFmt(data.assets.fixed_assets_paise)],
              ['Assets', 'Loans Given (Outstanding)', rsFmt(data.assets.loans_given_paise)],
              ['Assets', 'Total Assets', rsFmt(totalAssets)],
              ['Liabilities', 'Creditors (Outstanding)', rsFmt(data.liabilities.creditors_paise)],
              ['Liabilities', 'Loans Taken (Outstanding)', rsFmt(data.liabilities.loans_taken_paise)],
              ['Liabilities', 'Corpus / Net Worth', rsFmt(corpus)],
              ['Liabilities', 'Total', rsFmt(totalAssets)],
            ])}
            className="btn-secondary btn-sm">
            <Download size={14} /> {t('accounts.exportCsv')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-500">{t('accounts.fy')}</label>
        <input className="form-input w-32" value={fy} onChange={e => setFy(e.target.value)} />
        {data && <span className="badge-green">{t('accounts.asOfEndOfFy')}</span>}
      </div>

      {loading && <div className="text-center py-10 text-slate-400">{t('common.loading')}</div>}
      {!loading && !data && <div className="text-center py-10 text-slate-400">{t('accounts.noDataAvailable')}</div>}

      {!loading && data && (
        <div className="grid grid-cols-2 gap-6">
          {/* ── Assets ── */}
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">{t('accounts.assets')}</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{t('accounts.item')}</th><th className="text-right">{t('common.amount')}</th></tr></thead>
                <tbody>
                  {data.assets.cash_and_bank.map((a, i) => (
                    <Row key={i} label={`${a.account} (${a.type})`} paise={a.balance_paise} />
                  ))}
                  <Row label={t('accounts.fixedAssetsNet')} paise={data.assets.fixed_assets_paise} />
                  {data.assets.loans_given_paise > 0 && (
                    <Row label={t('accounts.loansGivenOutstanding')} paise={data.assets.loans_given_paise} />
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 font-bold">
                    <td className="px-4 py-2">{t('accounts.totalAssets')}</td>
                    <td className="px-4 py-2 text-right font-mono text-blue-700">₹{fmtPaise(totalAssets)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── Liabilities + Corpus ── */}
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">{t('accounts.liabilitiesCorpus')}</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{t('accounts.item')}</th><th className="text-right">{t('common.amount')}</th></tr></thead>
                <tbody>
                  {data.liabilities.creditors_paise > 0 && (
                    <Row label={t('accounts.creditorsOutstanding')} paise={data.liabilities.creditors_paise} />
                  )}
                  {data.liabilities.loans_taken_paise > 0 && (
                    <Row label={t('accounts.loansTakenOutstanding')} paise={data.liabilities.loans_taken_paise} />
                  )}
                  <Row label={t('accounts.corpusNetWorth')} paise={corpus} bold />
                </tbody>
                <tfoot>
                  <tr className="bg-purple-50 font-bold">
                    <td className="px-4 py-2">{t('accounts.total')}</td>
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
