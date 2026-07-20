import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise, currentFY } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { FySelect } from '../../../components/FySelect'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface GstRow { head: string; amount_paise: number; emphasis?: 'total' | 'net' }

interface GstSummary {
  output_gst: { rooms_paise: number; halls_paise: number; prasad_paise: number; total_paise: number }
  input_gst_paise: number
  net_payable_paise: number
}

export function GstSummaryReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [fy, setFy] = useState(currentFY())
  const [data, setData] = useState<GstSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [fy])

  async function load() {
    setLoading(true)
    try {
      const { data: res } = await api.get('/reports/gst-summary', { params: { fy } })
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const rows: GstRow[] = useMemo(() => {
    if (!data) return []
    return [
      { head: t('reports.gstOutputRooms'), amount_paise: data.output_gst.rooms_paise },
      { head: t('reports.gstOutputHalls'), amount_paise: data.output_gst.halls_paise },
      { head: t('reports.gstOutputPrasad'), amount_paise: data.output_gst.prasad_paise },
      { head: t('reports.gstOutputTotal'), amount_paise: data.output_gst.total_paise, emphasis: 'total' },
      { head: t('reports.gstInput'), amount_paise: data.input_gst_paise },
      { head: t('reports.gstNetPayable'), amount_paise: data.net_payable_paise, emphasis: 'net' },
    ]
  }, [data, t])

  const columns: ColumnDef<GstRow>[] = [
    { key: 'head', label: t('reports.head'), render: r => <span className={r.emphasis ? 'font-bold' : ''}>{r.head}</span> },
    {
      key: 'amount', label: t('common.amount'), align: 'right',
      render: r => (
        <span className={r.emphasis === 'net' ? 'font-bold text-brand-blue' : r.emphasis === 'total' ? 'font-bold' : ''}>
          ₹{fmtPaise(r.amount_paise)}
        </span>
      ),
    },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('reports.gstOutputTotal'), value: `₹${fmtPaise(data.output_gst.total_paise)}` },
    { label: t('reports.gstInput'), value: `₹${fmtPaise(data.input_gst_paise)}` },
    { label: t('reports.gstNetPayable'), value: `₹${fmtPaise(data.net_payable_paise)}`, tone: data.net_payable_paise > 0 ? 'expense' : 'income' },
  ] : []

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.gstSummary'),
        subtitle: `FY ${fy}`,
        filename: `gst-summary-${fy}`,
        columns: [
          { header: t('reports.head'), width: 26 },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: rows.map(r => [r.head, r.amount_paise]),
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.gstSummary')} subtitle={`FY ${fy}`} />

      <div className="flex items-center gap-2 no-print">
        <label className="text-sm font-medium text-slate-600">{t('reports.fy')}</label>
        <FySelect value={fy} onChange={setFy} className="w-32" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.head}
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
