import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise, currentFY } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { FySelect } from '../../../components/FySelect'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface TopDonorRow {
  id: string
  name: string
  mobile: string | null
  city: string | null
  amount_paise: number
  receipts: number
}

export function TopDonorsReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [fy, setFy] = useState(currentFY())
  const [limit, setLimit] = useState('20')
  const [rows, setRows] = useState<TopDonorRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [fy, limit])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/reports/analytics/top-donors', { params: { fy, limit } })
      const raw = data.data?.rows ?? data.data ?? []
      setRows(raw)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnDef<TopDonorRow>[] = useMemo(() => [
    {
      key: 'rank', label: t('reports.rank'), align: 'right',
      render: (_r, i) => <span className="text-slate-400 font-mono text-xs">{i + 1}</span>,
    },
    { key: 'name', label: t('donations.donor'), render: r => <span className="font-medium">{r.name}</span> },
    { key: 'mobile', label: t('donors.mobile'), render: r => <>{r.mobile || '—'}</> },
    { key: 'city', label: t('donors.city'), render: r => <span className="text-slate-500">{r.city || '—'}</span> },
    { key: 'receipts', label: t('kit.receipts'), align: 'right', render: r => <>{r.receipts}</> },
    { key: 'amount', label: t('common.amount'), align: 'right', render: r => <span className="font-semibold">₹{fmtPaise(r.amount_paise)}</span> },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

  const totalAmount = rows.reduce((s, r) => s + Number(r.amount_paise), 0)

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.topDonors'),
        subtitle: `FY ${fy}`,
        filename: 'top-donors',
        columns: [
          { header: t('reports.rank'), type: 'number', width: 8 },
          { header: t('donations.donor'), width: 26 },
          { header: t('donors.mobile'), width: 16 },
          { header: t('donors.city'), width: 18 },
          { header: t('kit.receipts'), type: 'number' },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: rows.map((r, i) => [i + 1, r.name, r.mobile ?? '', r.city ?? '', r.receipts, r.amount_paise]),
        totals: [t('kit.total'), '', '', '', rows.reduce((s, r) => s + r.receipts, 0), totalAmount],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.topDonors')} subtitle={`FY ${fy}`} />

      <div className="flex items-center gap-4 flex-wrap no-print">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">{t('reports.fy')}</label>
          <FySelect value={fy} onChange={setFy} className="form-select w-28" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">{t('reports.limitLabel')}</label>
          <select className="form-select w-24" value={limit} onChange={e => setLimit(e.target.value)}>
            {['10', '20', '50', '100'].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r, i) => `${r.id}-${i}`}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={rows.length || 1}
        total={rows.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noData')}
      />
    </div>
  )
}
