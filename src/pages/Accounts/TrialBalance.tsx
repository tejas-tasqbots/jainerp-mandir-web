import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise, currentFY } from '../../lib/api'
import { rsFmt } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'
import { exportXlsx } from '../../lib/exportXlsx'
import { FySelect } from '../../components/FySelect'
import { DataTable, type ColumnDef } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface TBRow { account_id?: string; account_name: string; debit_paise: number; credit_paise: number }

export function TrialBalance() {
  const { t } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const [rows, setRows] = useState<TBRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fy, setFy] = useState(currentFY())
  const [search, setSearch] = useState('')

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

  const q = search.trim().toLowerCase()
  const visible = q ? rows.filter(r => r.account_name.toLowerCase().includes(q)) : rows

  const columns: ColumnDef<TBRow>[] = [
    { key: 'account', label: t('accounts.account'), render: r => <span className="font-medium text-brand-blue">{r.account_name}</span> },
    { key: 'debit', label: t('accounts.debit'), align: 'right', render: r => r.debit_paise > 0 ? `₹${fmtPaise(r.debit_paise)}` : '—' },
    { key: 'credit', label: t('accounts.credit'), align: 'right', render: r => r.credit_paise > 0 ? `₹${fmtPaise(r.credit_paise)}` : '—' },
  ]

  // `/accounting/trial-balance` returns the closing balance of each cash/bank
  // account — an account lands in Credit only when it is overdrawn. So debits
  // can never equal credits for a solvent trust, and the old "Balanced ✓ /
  // Imbalanced ✗" verdict showed a red "Imbalanced ✗" to every temple with
  // money in the bank. Report the net position, which is what these rows add up
  // to, instead of a balance check this report has no basis to make.
  const stats: SummaryStat[] = rows.length ? [
    { label: t('accounts.debit'), value: `₹${fmtPaise(totalDebit)}` },
    { label: t('accounts.credit'), value: `₹${fmtPaise(totalCredit)}` },
    { label: t('accounts.closingBalance'), value: `₹${fmtPaise(totalDebit - totalCredit)}`, tone: 'income' },
  ] : []

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('accounts.trialBalanceTitle'),
        subtitle: `FY ${fy}`,
        filename: `trial-balance-${fy}`,
        columns: [
          { header: t('accounts.account'), width: 26 },
          { header: t('accounts.debit'), type: 'money' },
          { header: t('accounts.credit'), type: 'money' },
        ],
        rows: rows.map(r => [r.account_name, r.debit_paise, r.credit_paise]),
        totals: [t('kit.total'), totalDebit, totalCredit],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function exportPdf() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    downloadRowsPdf(`trial-balance-${fy}.pdf`, 'Trial Balance', ['Account', 'Debit', 'Credit'],
      rows.map(r => [r.account_name, r.debit_paise > 0 ? rsFmt(r.debit_paise) : '', r.credit_paise > 0 ? rsFmt(r.credit_paise) : '']),
      { subtitle: `FY ${fy}`, totals: ['Total', rsFmt(totalDebit), rsFmt(totalCredit)] })
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('accounts.trialBalanceTitle')} subtitle={`${t('accounts.fy')} ${fy}`} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.trialBalanceTitle')}</h1>
      </div>

      <div className="no-print">
        <label className="text-sm text-slate-500 mr-2">{t('accounts.fy')}</label>
        <FySelect value={fy} onChange={setFy} />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="trial-balance-list"
        columns={columns}
        rows={visible}
        rowKey={(r, i) => `${r.account_name}-${i}`}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('accounts.searchAccounts')}
        onExportXlsx={exportExcel}
        onExportPdf={exportPdf}
        onPrint={() => window.print()}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={visible.length || 1}
        total={visible.length}
        onPageChange={() => {}}
        emptyMessage={t('accounts.noDataForFy')}
        // Plan §07: every summary row links down one level (TB → that account's Ledger).
        onRowClick={r => r.account_id && navigate(`/accounts/ledger?account_id=${r.account_id}`)}
      />
    </div>
  )
}
