import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, FileDown, Printer } from 'lucide-react'
import { rsFmt } from '../../lib/downloadReport'
import { downloadSectionsPdf } from '../../lib/pdfTable'
import { exportXlsx } from '../../lib/exportXlsx'
import { api, fmtPaise, currentFY } from '../../lib/api'
import { FySelect } from '../../components/FySelect'
import { DataTable, type ColumnDef } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface CashBankEntry { account: string; type: string; balance_paise: number }
interface Row { label: string; paise: number; bold?: boolean }

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

export function BalanceSheet() {
  const { t } = useTranslation()
  const toast = useToast()
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

  const assetRows: Row[] = data ? [
    ...data.assets.cash_and_bank.map(a => ({ label: `${a.account} (${a.type})`, paise: a.balance_paise })),
    { label: t('accounts.fixedAssetsNet'), paise: data.assets.fixed_assets_paise },
    ...(data.assets.loans_given_paise > 0 ? [{ label: t('accounts.loansGivenOutstanding'), paise: data.assets.loans_given_paise }] : []),
  ] : []
  const liabilityRows: Row[] = data ? [
    ...(data.liabilities.creditors_paise > 0 ? [{ label: t('accounts.creditorsOutstanding'), paise: data.liabilities.creditors_paise }] : []),
    ...(data.liabilities.loans_taken_paise > 0 ? [{ label: t('accounts.loansTakenOutstanding'), paise: data.liabilities.loans_taken_paise }] : []),
    { label: t('accounts.corpusNetWorth'), paise: corpus, bold: true },
  ] : []

  const rowCols: ColumnDef<Row>[] = [
    { key: 'item', label: t('accounts.item'), render: r => <span className={r.bold ? 'font-bold' : ''}>{r.label}</span> },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => <span className={`font-mono ${r.bold ? 'font-bold' : ''}`}>₹{fmtPaise(r.paise)}</span> },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('accounts.totalAssets'), value: `₹${fmtPaise(totalAssets)}` },
    { label: t('accounts.total'), value: `₹${fmtPaise(totalLiabilities + corpus)}` },
    { label: t('accounts.corpusNetWorth'), value: `₹${fmtPaise(corpus)}`, tone: corpus >= 0 ? 'income' : 'expense' },
  ] : []

  async function exportExcel() {
    if (!data) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('accounts.balanceSheetTitle'),
        subtitle: `FY ${fy} (${t('accounts.asOfEndOfFy')})`,
        filename: `balance-sheet-${fy}`,
        columns: [
          { header: t('accounts.section'), width: 14 }, { header: t('accounts.item'), width: 28 },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: [
          ...assetRows.map(r => [t('accounts.assets'), r.label, r.paise]),
          [t('accounts.assets'), t('accounts.totalAssets'), totalAssets],
          ...liabilityRows.map(r => [t('accounts.liabilitiesCorpus'), r.label, r.paise]),
          [t('accounts.liabilitiesCorpus'), t('accounts.total'), totalAssets],
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function exportPdf() {
    if (!data) { toast.info(t('kit.nothingToExport')); return }
    downloadSectionsPdf(`balance-sheet-${fy}.pdf`, 'Balance Sheet', [
      { heading: 'Assets', headers: ['Item', 'Amount'], rows: assetRows.map(r => [r.label, rsFmt(r.paise)]), totals: ['Total Assets', rsFmt(totalAssets)] },
      { heading: 'Liabilities & Corpus', headers: ['Item', 'Amount'], rows: liabilityRows.map(r => [r.label, rsFmt(r.paise)]), totals: ['Total', rsFmt(totalAssets)] },
    ], { subtitle: `FY ${fy} (as of year end)` })
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('accounts.balanceSheetTitle')} subtitle={`${t('accounts.fy')} ${fy}`} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.balanceSheetTitle')}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={exportExcel} className="btn-icon !text-green-700 hover:!bg-green-50" title={t('kit.exportExcel')} aria-label={t('kit.exportExcel')}><FileSpreadsheet size={16} /></button>
          <button type="button" onClick={exportPdf} className="btn-icon !text-red-700 hover:!bg-red-50" title={t('kit.exportPdf')} aria-label={t('kit.exportPdf')}><FileDown size={16} /></button>
          <button type="button" onClick={() => window.print()} className="btn-icon" title={t('kit.print')} aria-label={t('kit.print')}><Printer size={16} /></button>
        </div>
      </div>

      <div className="no-print flex items-center gap-3">
        <label className="text-sm text-slate-500">{t('accounts.fy')}</label>
        <FySelect value={fy} onChange={setFy} />
        {data && <span className="badge-green">{t('accounts.asOfEndOfFy')}</span>}
      </div>

      <SummaryStrip stats={stats} />

      {!loading && !data && <div className="text-center py-10 text-slate-400">{t('accounts.noDataAvailable')}</div>}

      {(loading || data) && (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-sm text-navy-900 mb-2">{t('accounts.assets')}</h3>
            <DataTable
              columns={rowCols}
              rows={assetRows}
              rowKey={(r, i) => `${r.label}-${i}`}
              loading={loading}
              filterState={{}}
              onFilterChange={() => {}}
              page={1}
              limit={assetRows.length || 1}
              total={assetRows.length}
              onPageChange={() => {}}
              emptyMessage={t('accounts.noDataForFy')}
            />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-navy-900 mb-2">{t('accounts.liabilitiesCorpus')}</h3>
            <DataTable
              columns={rowCols}
              rows={liabilityRows}
              rowKey={(r, i) => `${r.label}-${i}`}
              loading={loading}
              filterState={{}}
              onFilterChange={() => {}}
              page={1}
              limit={liabilityRows.length || 1}
              total={liabilityRows.length}
              onPageChange={() => {}}
              emptyMessage={t('accounts.noDataForFy')}
            />
          </div>
        </div>
      )}
    </div>
  )
}
