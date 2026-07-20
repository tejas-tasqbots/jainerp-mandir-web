import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { api, fmtPaise, currentFY } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { FySelect } from '../../../components/FySelect'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

type Granularity = 'monthly' | 'weekly'

interface TrendPoint { bucket: string; receipts: number; amount_paise: number }

export function DonationTrendsReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [fy, setFy] = useState(currentFY())
  const [granularity, setGranularity] = useState<Granularity>('monthly')
  const [points, setPoints] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [fy, granularity])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/reports/analytics/donation-trends', { params: { fy, granularity } })
      setPoints(data.data?.points ?? [])
    } catch {
      setPoints([])
    } finally {
      setLoading(false)
    }
  }

  const chartData = useMemo(() => points.map(p => ({
    label: new Date(p.bucket).toLocaleDateString('en-IN', granularity === 'monthly' ? { month: 'short', year: '2-digit' } : { day: '2-digit', month: 'short' }),
    value: p.amount_paise / 100,
  })), [points, granularity])

  const columns: ColumnDef<TrendPoint>[] = [
    {
      key: 'period', label: t('reports.period'),
      render: p => <span className="font-medium">{new Date(p.bucket).toLocaleDateString('en-IN', granularity === 'monthly' ? { month: 'long', year: 'numeric' } : { day: '2-digit', month: 'short', year: 'numeric' })}</span>,
    },
    { key: 'receipts', label: t('kit.receipts'), align: 'right', render: p => <>{p.receipts}</> },
    { key: 'amount', label: t('common.amount'), align: 'right', render: p => <span className="font-semibold">₹{fmtPaise(p.amount_paise)}</span> },
  ]

  async function exportExcel() {
    if (!points.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.donationTrends'),
        subtitle: `FY ${fy} · ${t(`reports.granularity_${granularity}`)}`,
        filename: 'donation-trends',
        columns: [
          { header: t('reports.period'), width: 16 },
          { header: t('kit.receipts'), type: 'number' },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: points.map(p => [String(p.bucket).slice(0, 10), p.receipts, p.amount_paise]),
        totals: [t('kit.total'), points.reduce((s, p) => s + p.receipts, 0), points.reduce((s, p) => s + p.amount_paise, 0)],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.donationTrends')} subtitle={`FY ${fy}`} />

      <div className="flex items-center gap-4 flex-wrap no-print">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">{t('reports.fy')}</label>
          <FySelect value={fy} onChange={setFy} className="w-32" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">{t('reports.granularityLabel')}</label>
          <select className="form-select w-32" value={granularity} onChange={e => setGranularity(e.target.value as Granularity)}>
            <option value="monthly">{t('reports.granularity_monthly')}</option>
            <option value="weekly">{t('reports.granularity_weekly')}</option>
          </select>
        </div>
      </div>

      {!loading && chartData.length > 0 && (
        <div className="card p-4">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={70}
                tickFormatter={(v: number) => `₹${v.toLocaleString('en-IN')}`} />
              <Tooltip formatter={(v: number) => [`₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, '']} separator="" />
              <Bar dataKey="value" fill="var(--color-brand-blue)" radius={[3, 3, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={points}
        rowKey={(p, i) => `${p.bucket}-${i}`}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={points.length || 1}
        total={points.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noData')}
      />
    </div>
  )
}
