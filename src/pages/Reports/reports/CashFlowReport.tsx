import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { printCurrentView } from '../../../lib/downloadReport'
import { api, fmtPaise, currentFY } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { FySelect } from '../../../components/FySelect'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface MonthRow {
  month: string
  label: string
  inflow_paise: number
  outflow_paise: number
  net_paise: number
}

interface CashFlowData {
  fy: string
  months: MonthRow[]
  totals: { inflow_paise: number; outflow_paise: number; net_paise: number }
}

/** Money in / out / net per month of the FY (plan §03 — "trustees understand it instantly"). */
export function CashFlowReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [fy, setFy] = useState(currentFY())
  const [data, setData] = useState<CashFlowData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [fy])

  async function load() {
    setLoading(true)
    try {
      const { data: res } = await api.get(`/reports/cash-flow?fy=${fy}`)
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const months = data?.months ?? []
  const chart = months.map(m => ({
    month: m.label,
    [t('reports.inflow')]: m.inflow_paise / 100,
    [t('reports.outflow')]: m.outflow_paise / 100,
  }))

  const columns: ColumnDef<MonthRow>[] = [
    { key: 'month', label: t('reports.month'), render: m => <span className="font-medium">{m.label}</span> },
    { key: 'in', label: t('reports.inflow'), align: 'right', render: m => <span className="text-green-700">₹{fmtPaise(m.inflow_paise)}</span> },
    { key: 'out', label: t('reports.outflow'), align: 'right', render: m => <span className="text-red-600">₹{fmtPaise(m.outflow_paise)}</span> },
    {
      key: 'net', label: t('reports.net'), align: 'right',
      render: m => <span className={`font-semibold ${m.net_paise >= 0 ? 'text-green-700' : 'text-red-600'}`}>₹{fmtPaise(m.net_paise)}</span>,
    },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('reports.inflow'), value: `₹${fmtPaise(data.totals.inflow_paise)}`, tone: 'income' },
    { label: t('reports.outflow'), value: `₹${fmtPaise(data.totals.outflow_paise)}`, tone: 'expense' },
    { label: t('reports.net'), value: `₹${fmtPaise(data.totals.net_paise)}`, tone: data.totals.net_paise >= 0 ? 'income' : 'expense' },
  ] : []

  async function exportExcel() {
    if (!months.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.cashFlow'),
        subtitle: `FY ${fy}`,
        filename: `cash-flow-${fy}`,
        columns: [
          { header: t('reports.month'), width: 12 },
          { header: t('reports.inflow'), type: 'money' },
          { header: t('reports.outflow'), type: 'money' },
          { header: t('reports.net'), type: 'money' },
        ],
        rows: months.map(m => [m.label, m.inflow_paise, m.outflow_paise, m.net_paise]),
        totals: [t('kit.total'), data?.totals.inflow_paise ?? 0, data?.totals.outflow_paise ?? 0, data?.totals.net_paise ?? 0],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.cashFlow')} subtitle={`FY ${fy}`} />

      <div className="flex items-center gap-2 no-print">
        <label className="text-sm font-medium text-slate-600">{t('reports.fy')}</label>
        <FySelect value={fy} onChange={setFy} className="w-32" />
      </div>

      <SummaryStrip stats={stats} />

      {!loading && months.length > 0 && (
        <div className="card p-4">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={70}
                tickFormatter={(v: number) => `₹${v.toLocaleString('en-IN')}`} />
              <Tooltip formatter={(v: number) => [`₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, '']} separator="" />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey={t('reports.inflow')} fill="#2E7D4F" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey={t('reports.outflow')} fill="#C0554A" radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={months}
        rowKey={m => m.month}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={months.length || 1}
        total={months.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noData')}
      />
    </div>
  )
}
