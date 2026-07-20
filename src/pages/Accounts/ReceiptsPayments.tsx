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

interface Section { head?: string; name?: string; amount_paise: number; entries?: number }
interface RPData {
  receipts: Section[]
  payments: Section[]
  totals: { receipts_paise: number; payments_paise: number }
  from: string
  to: string
}

export function ReceiptsPayments() {
  const { t } = useTranslation()
  const toast = useToast()
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

  const receiptCols: ColumnDef<Section>[] = [
    { key: 'source', label: t('accounts.source'), render: r => r.head ?? r.name },
    { key: 'entries', label: t('accounts.entries'), align: 'right', render: r => <span className="text-slate-400 text-xs">{r.entries ?? '—'}</span> },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => `₹${fmtPaise(r.amount_paise)}` },
  ]
  const paymentCols: ColumnDef<Section>[] = [
    { key: 'category', label: t('accounts.category'), render: r => r.head ?? r.name },
    { key: 'entries', label: t('accounts.entries'), align: 'right', render: r => <span className="text-slate-400 text-xs">{r.entries ?? '—'}</span> },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => `₹${fmtPaise(r.amount_paise)}` },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('accounts.totalReceiptsRow'), value: `₹${fmtPaise(totalReceipts)}`, tone: 'income' },
    { label: t('accounts.totalPaymentsRow'), value: `₹${fmtPaise(totalPayments)}`, tone: 'expense' },
  ] : []

  async function exportExcel() {
    if (!data) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('accounts.receiptsPaymentsTitle'),
        subtitle: `FY ${fy}`,
        filename: `receipts-payments-${fy}`,
        columns: [
          { header: t('accounts.section'), width: 12 }, { header: t('accounts.head'), width: 24 },
          { header: t('accounts.entries'), width: 8 }, { header: t('common.amount'), type: 'money' },
        ],
        rows: [
          ...data.receipts.map(r => [t('accounts.receipts'), r.head ?? r.name ?? '', r.entries ?? '', r.amount_paise]),
          [t('accounts.receipts'), t('accounts.totalReceiptsRow'), '', totalReceipts],
          ...data.payments.map(p => [t('accounts.payments'), p.head ?? p.name ?? '', p.entries ?? '', p.amount_paise]),
          [t('accounts.payments'), t('accounts.totalPaymentsRow'), '', totalPayments],
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function exportPdf() {
    if (!data) { toast.info(t('kit.nothingToExport')); return }
    downloadSectionsPdf(`receipts-payments-${fy}.pdf`, 'Receipts & Payments Account', [
      {
        heading: 'Receipts', headers: ['Source', 'Entries', 'Amount'],
        rows: data.receipts.map(r => [r.head ?? r.name, r.entries ?? '', rsFmt(r.amount_paise)]),
        totals: ['Total Receipts', '', rsFmt(totalReceipts)],
      },
      {
        heading: 'Payments', headers: ['Category', 'Entries', 'Amount'],
        rows: data.payments.map(p => [p.head ?? p.name, p.entries ?? '', rsFmt(p.amount_paise)]),
        totals: ['Total Payments', '', rsFmt(totalPayments)],
      },
    ], { subtitle: `FY ${fy}` })
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('accounts.receiptsPaymentsTitle')} subtitle={`${t('accounts.fy')} ${fy}`} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.receiptsPaymentsTitle')}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={exportExcel} className="btn-icon !text-green-700 hover:!bg-green-50" title={t('kit.exportExcel')} aria-label={t('kit.exportExcel')}><FileSpreadsheet size={16} /></button>
          <button type="button" onClick={exportPdf} className="btn-icon !text-red-700 hover:!bg-red-50" title={t('kit.exportPdf')} aria-label={t('kit.exportPdf')}><FileDown size={16} /></button>
          <button type="button" onClick={() => window.print()} className="btn-icon" title={t('kit.print')} aria-label={t('kit.print')}><Printer size={16} /></button>
        </div>
      </div>

      <div className="no-print">
        <label className="text-sm text-slate-500 mr-2">{t('accounts.fy')}</label>
        <FySelect value={fy} onChange={setFy} />
      </div>

      <SummaryStrip stats={stats} />

      {!loading && !data && <div className="text-center py-16 text-slate-400">{t('accounts.noDataForFyLong', { fy })}</div>}

      {(loading || data) && (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-sm text-navy-900 mb-2">{t('accounts.receipts')}</h3>
            <DataTable
              columns={receiptCols}
              rows={data?.receipts ?? []}
              rowKey={(r, i) => `${r.head ?? r.name}-${i}`}
              loading={loading}
              filterState={{}}
              onFilterChange={() => {}}
              page={1}
              limit={(data?.receipts.length || 1)}
              total={data?.receipts.length ?? 0}
              onPageChange={() => {}}
              emptyMessage={t('accounts.noDataForFy')}
            />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-navy-900 mb-2">{t('accounts.payments')}</h3>
            <DataTable
              columns={paymentCols}
              rows={data?.payments ?? []}
              rowKey={(r, i) => `${r.head ?? r.name}-${i}`}
              loading={loading}
              filterState={{}}
              onFilterChange={() => {}}
              page={1}
              limit={(data?.payments.length || 1)}
              total={data?.payments.length ?? 0}
              onPageChange={() => {}}
              emptyMessage={t('accounts.noDataForFy')}
            />
          </div>
        </div>
      )}
    </div>
  )
}
