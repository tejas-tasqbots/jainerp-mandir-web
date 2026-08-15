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

/**
 * Output GST heads are optional on purpose: the API charges GST only on the
 * counters the trust has a module for — a donation-only trust gets `total_paise`
 * and nothing else — and names what it sent in `included_heads`. Rendering all
 * three unconditionally printed "₹NaN" for the missing ones, and once that is
 * fixed to 0, "Rooms ₹0" beside a real input-credit figure still reads as
 * unbilled takings rather than a counter the trust does not run.
 */
interface GstSummary {
  output_gst: {
    rooms_paise?: number
    halls_paise?: number
    prasad_paise?: number
    total_paise: number
  }
  included_heads?: string[]
  input_gst_paise: number
  net_payable_paise: number
}

const OUTPUT_HEADS: { key: string; labelKey: string }[] = [
  { key: 'rooms', labelKey: 'reports.gstOutputRooms' },
  { key: 'halls', labelKey: 'reports.gstOutputHalls' },
  { key: 'prasad', labelKey: 'reports.gstOutputPrasad' },
]

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
    const out = data.output_gst as Record<string, number | undefined>
    // An API older than `included_heads` sends all three; fall back to whichever
    // keys are actually present rather than inventing zeroes.
    const heads = OUTPUT_HEADS.filter(h =>
      data.included_heads ? data.included_heads.includes(h.key) : out[`${h.key}_paise`] != null)
    return [
      ...heads.map(h => ({ head: t(h.labelKey), amount_paise: out[`${h.key}_paise`] ?? 0 })),
      { head: t('reports.gstOutputTotal'), amount_paise: data.output_gst.total_paise, emphasis: 'total' as const },
      { head: t('reports.gstInput'), amount_paise: data.input_gst_paise },
      { head: t('reports.gstNetPayable'), amount_paise: data.net_payable_paise, emphasis: 'net' as const },
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
