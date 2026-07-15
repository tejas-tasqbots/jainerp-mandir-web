import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileDown, Printer } from 'lucide-react'
import { exportRowsCsv, printCurrentView, rsFmt } from '../../lib/downloadReport'
import { downloadSectionsPdf } from '../../lib/pdfTable'
import { api, fmtPaise, currentFY } from '../../lib/api'

interface Section { name: string; head?: string; amount_paise: number }
interface IEData {
  income: Section[]
  expenditure: Section[]
  totals: { income_paise: number; expenditure_paise: number; surplus_paise: number }
}

export function IncomeExpenditure() {
  const { t } = useTranslation()
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
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.incomeExpenditureTitle')}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={printCurrentView} className="btn-secondary btn-sm">
            <Printer size={14} /> {t('accounts.print')}
          </button>
          <button type="button"
            onClick={() => data && downloadSectionsPdf(`income-expenditure-${fy}.pdf`, 'Income & Expenditure Account', [
              {
                heading: 'Income',
                headers: ['Source', 'Amount'],
                rows: data.income.map(r => [r.head ?? r.name, rsFmt(r.amount_paise)]),
                totals: ['Total Income', rsFmt(totalIncome)],
              },
              {
                heading: 'Expenditure',
                headers: ['Category', 'Amount'],
                rows: data.expenditure.map(r => [r.head ?? r.name, rsFmt(r.amount_paise)]),
                totals: ['Total Expenditure', rsFmt(totalExpenditure)],
              },
              {
                headers: ['', ''],
                rows: [],
                totals: [surplusPaise >= 0 ? 'Surplus' : 'Deficit', rsFmt(Math.abs(surplusPaise))],
              },
            ], { subtitle: `FY ${fy}` })}
            className="btn-secondary btn-sm">
            <FileDown size={14} /> {t('accounts.downloadPdf')}
          </button>
          <button type="button"
            onClick={() => data && exportRowsCsv(`income-expenditure-${fy}.csv`, ['Section', 'Head', 'Amount'], [
              ...data.income.map(r => ['Income', r.head ?? r.name, rsFmt(r.amount_paise)]),
              ['Income', 'Total Income', rsFmt(totalIncome)],
              ...data.expenditure.map(r => ['Expenditure', r.head ?? r.name, rsFmt(r.amount_paise)]),
              ['Expenditure', 'Total Expenditure', rsFmt(totalExpenditure)],
              ['', surplusPaise >= 0 ? 'Surplus' : 'Deficit', rsFmt(Math.abs(surplusPaise))],
            ])}
            className="btn-secondary btn-sm">
            <Download size={14} /> {t('accounts.exportCsv')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-500">{t('accounts.fy')}</label>
        <input className="form-input w-32" value={fy} onChange={e => setFy(e.target.value)} />
        {data && (
          <span className={surplusPaise >= 0 ? 'badge-green' : 'badge-red'}>
            {surplusPaise >= 0 ? t('accounts.surplus') : t('accounts.deficit')}: ₹{fmtPaise(Math.abs(surplusPaise))}
          </span>
        )}
      </div>

      {loading && <div className="text-center py-10 text-slate-400">{t('common.loading')}</div>}

      {!loading && data && (
        <div className="grid grid-cols-2 gap-6">
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">{t('accounts.income')}</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{t('accounts.source')}</th><th className="text-right">{t('common.amount')}</th></tr></thead>
                <tbody>
                  {data.income.map((r, i) => <tr key={i}><td>{r.head ?? r.name}</td><td className="text-right">₹{fmtPaise(r.amount_paise)}</td></tr>)}
                </tbody>
                <tfoot><tr className="bg-green-50"><td className="px-4 py-2 font-bold">{t('accounts.totalIncome')}</td><td className="px-4 py-2 text-right font-bold text-green-700">₹{fmtPaise(totalIncome)}</td></tr></tfoot>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm text-navy-900">{t('accounts.expenditure')}</h3></div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{t('accounts.category')}</th><th className="text-right">{t('common.amount')}</th></tr></thead>
                <tbody>
                  {data.expenditure.map((r, i) => <tr key={i}><td>{r.head ?? r.name}</td><td className="text-right">₹{fmtPaise(r.amount_paise)}</td></tr>)}
                </tbody>
                <tfoot><tr className="bg-red-50"><td className="px-4 py-2 font-bold">{t('accounts.totalExpenditure')}</td><td className="px-4 py-2 text-right font-bold text-red-600">₹{fmtPaise(totalExpenditure)}</td></tr></tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
