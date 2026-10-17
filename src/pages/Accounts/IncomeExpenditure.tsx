import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, FileDown, Printer } from 'lucide-react'
import { rsFmt, printCurrentView } from '../../lib/downloadReport'
import { downloadSectionsPdf } from '../../lib/pdfTable'
import { exportXlsx } from '../../lib/exportXlsx'
import { api, fmtPaise, currentFY } from '../../lib/api'
import { FySelect } from '../../components/FySelect'
import { DataTable, type ColumnDef } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { headLabel } from '../../lib/headLabel'
import { useToast } from '../../components/kit/Toast'

interface Section { name: string; head?: string; amount_paise: number }
interface IEData {
  income: Section[]
  expenditure: Section[]
  totals: { income_paise: number; expenditure_paise: number; surplus_paise: number }
}

export function IncomeExpenditure() {
  const { t } = useTranslation()
  const toast = useToast()
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

  const incomeCols: ColumnDef<Section>[] = [
    { key: 'source', label: t('accounts.source'), render: r => headLabel(t, r.head ?? r.name) },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => `₹${fmtPaise(r.amount_paise)}` },
  ]
  const expCols: ColumnDef<Section>[] = [
    { key: 'category', label: t('accounts.category'), render: r => headLabel(t, r.head ?? r.name) },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => `₹${fmtPaise(r.amount_paise)}` },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('accounts.totalIncome'), value: `₹${fmtPaise(totalIncome)}`, tone: 'income' },
    { label: t('accounts.totalExpenditure'), value: `₹${fmtPaise(totalExpenditure)}`, tone: 'expense' },
    { label: surplusPaise >= 0 ? t('accounts.surplus') : t('accounts.deficit'), value: `₹${fmtPaise(Math.abs(surplusPaise))}`, tone: surplusPaise >= 0 ? 'income' : 'expense' },
  ] : []

  async function exportExcel() {
    if (!data) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('accounts.incomeExpenditureTitle'),
        subtitle: `FY ${fy}`,
        filename: `income-expenditure-${fy}`,
        columns: [
          { header: t('accounts.section'), width: 14 }, { header: t('accounts.head'), width: 24 },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: [
          ...data.income.map(r => [t('accounts.income'), headLabel(t, r.head ?? r.name), r.amount_paise]),
          [t('accounts.income'), t('accounts.totalIncome'), totalIncome],
          ...data.expenditure.map(r => [t('accounts.expenditure'), headLabel(t, r.head ?? r.name), r.amount_paise]),
          [t('accounts.expenditure'), t('accounts.totalExpenditure'), totalExpenditure],
          ['', surplusPaise >= 0 ? t('accounts.surplus') : t('accounts.deficit'), Math.abs(surplusPaise)],
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function exportPdf() {
    if (!data) { toast.info(t('kit.nothingToExport')); return }
    downloadSectionsPdf(`income-expenditure-${fy}.pdf`, 'Income & Expenditure Account', [
      { heading: 'Income', headers: ['Source', 'Amount'], rows: data.income.map(r => [r.head ?? r.name, rsFmt(r.amount_paise)]), totals: ['Total Income', rsFmt(totalIncome)] },
      { heading: 'Expenditure', headers: ['Category', 'Amount'], rows: data.expenditure.map(r => [r.head ?? r.name, rsFmt(r.amount_paise)]), totals: ['Total Expenditure', rsFmt(totalExpenditure)] },
      { headers: ['', ''], rows: [], totals: [surplusPaise >= 0 ? 'Surplus' : 'Deficit', rsFmt(Math.abs(surplusPaise))] },
    ], { subtitle: `FY ${fy}` })
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('accounts.incomeExpenditureTitle')} subtitle={`${t('accounts.fy')} ${fy}`} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.incomeExpenditureTitle')}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={exportExcel} className="btn-icon !text-green-700 hover:!bg-green-50" title={t('kit.exportExcel')} aria-label={t('kit.exportExcel')}><FileSpreadsheet size={16} /></button>
          <button type="button" onClick={exportPdf} className="btn-icon !text-red-700 hover:!bg-red-50" title={t('kit.exportPdf')} aria-label={t('kit.exportPdf')}><FileDown size={16} /></button>
          <button type="button" onClick={() => printCurrentView()} className="btn-icon" title={t('kit.print')} aria-label={t('kit.print')}><Printer size={16} /></button>
        </div>
      </div>

      <div className="no-print flex items-center gap-3">
        <label className="text-sm text-slate-500">{t('accounts.fy')}</label>
        <FySelect value={fy} onChange={setFy} />
      </div>

      <SummaryStrip stats={stats} />

      {!loading && !data && <div className="text-center py-16 text-slate-400">{t('accounts.noDataForFyLong', { fy })}</div>}

      {(loading || data) && (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-sm text-navy-900 mb-2">{t('accounts.income')}</h3>
            <DataTable
              columns={incomeCols}
              rows={data?.income ?? []}
              rowKey={(r, i) => `${r.head ?? r.name}-${i}`}
              loading={loading}
              filterState={{}}
              onFilterChange={() => {}}
              page={1}
              limit={(data?.income.length || 1)}
              total={data?.income.length ?? 0}
              onPageChange={() => {}}
              emptyMessage={t('accounts.noDataForFy')}
            />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-navy-900 mb-2">{t('accounts.expenditure')}</h3>
            <DataTable
              columns={expCols}
              rows={data?.expenditure ?? []}
              rowKey={(r, i) => `${r.head ?? r.name}-${i}`}
              loading={loading}
              filterState={{}}
              onFilterChange={() => {}}
              page={1}
              limit={(data?.expenditure.length || 1)}
              total={data?.expenditure.length ?? 0}
              onPageChange={() => {}}
              emptyMessage={t('accounts.noDataForFy')}
            />
          </div>
        </div>
      )}
    </div>
  )
}
