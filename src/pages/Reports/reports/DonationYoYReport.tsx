import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { api, fmtPaise, currentFY } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { FySelect } from '../../../components/FySelect'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface MonthRow {
  month: string
  current_amount_paise: number
  current_receipts: number
  previous_amount_paise: number
  previous_receipts: number
}

interface YoYData {
  fy: string
  previous_fy: string
  months: MonthRow[]
  total_current_paise: number
  total_previous_paise: number
  growth_pct: number | null
}

export function DonationYoYReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [fy, setFy] = useState(currentFY())
  const [data, setData] = useState<YoYData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [fy])

  async function load() {
    setLoading(true)
    try {
      const { data: res } = await api.get('/reports/analytics/donation-yoy', { params: { fy } })
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const chartData = useMemo(() => (data?.months ?? []).map(m => ({
    month: m.month,
    [data!.fy]: m.current_amount_paise / 100,
    [data!.previous_fy]: m.previous_amount_paise / 100,
  })), [data])

  const columns: ColumnDef<MonthRow>[] = [
    { key: 'month', label: t('reports.month'), render: r => <span className="font-medium">{r.month}</span> },
    { key: 'current', label: data ? `FY ${data.fy}` : '', align: 'right', render: r => <span className="font-semibold">₹{fmtPaise(r.current_amount_paise)}</span> },
    { key: 'previous', label: data ? `FY ${data.previous_fy}` : '', align: 'right', render: r => <span className="text-slate-500">₹{fmtPaise(r.previous_amount_paise)}</span> },
    {
      key: 'change', label: t('reports.change'), align: 'right',
      render: r => {
        if (!r.previous_amount_paise) return <span className="text-slate-300">—</span>
        const pct = ((r.current_amount_paise - r.previous_amount_paise) / r.previous_amount_paise) * 100
        return <span className={pct >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
      },
    },
  ]

  const stats: SummaryStat[] = data ? [
    { label: `FY ${data.fy}`, value: `₹${fmtPaise(data.total_current_paise)}`, tone: 'income' },
    { label: `FY ${data.previous_fy}`, value: `₹${fmtPaise(data.total_previous_paise)}` },
    {
      label: t('reports.growth'),
      value: data.growth_pct == null ? '—' : `${data.growth_pct >= 0 ? '+' : ''}${data.growth_pct.toFixed(1)}%`,
      tone: data.growth_pct == null ? 'default' : data.growth_pct >= 0 ? 'income' : 'expense',
    },
  ] : []

  async function exportExcel() {
    if (!data || !data.months.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.donationYoY'),
        subtitle: `FY ${data.fy} vs FY ${data.previous_fy}`,
        filename: 'donation-yoy',
        columns: [
          { header: t('reports.month'), width: 10 },
          { header: `FY ${data.fy}`, type: 'money' },
          { header: `FY ${data.previous_fy}`, type: 'money' },
        ],
        rows: data.months.map(m => [m.month, m.current_amount_paise, m.previous_amount_paise]),
        totals: [t('kit.total'), data.total_current_paise, data.total_previous_paise],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.donationYoY')} subtitle={data ? `FY ${data.fy} vs FY ${data.previous_fy}` : ''} />

      <div className="flex items-center gap-2 no-print">
        <label className="text-sm font-medium text-slate-600">{t('reports.fy')}</label>
        <FySelect value={fy} onChange={setFy} className="form-select w-28" />
      </div>

      <SummaryStrip stats={stats} />

      {!loading && data && (
        <div className="card p-4">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={70}
                tickFormatter={(v: number) => `₹${v.toLocaleString('en-IN')}`} />
              <Tooltip formatter={(v: number) => [`₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, '']} separator="" />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey={data.previous_fy} fill="#cbd5e1" radius={[3, 3, 0, 0]} maxBarSize={20} />
              <Bar dataKey={data.fy} fill="var(--color-brand-blue)" radius={[3, 3, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={data?.months ?? []}
        rowKey={r => r.month}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={12}
        total={data?.months.length ?? 0}
        onPageChange={() => {}}
        emptyMessage={t('reports.noData')}
      />
    </div>
  )
}
