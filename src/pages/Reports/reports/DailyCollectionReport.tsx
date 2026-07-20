import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface StreamRow { label: string; amount_paise: number; emphasis?: 'total' | 'net' }

interface DailyCollection {
  date: string
  donations_paise: number
  seva_paise: number
  prasad_paise: number
  bhojanshala_paise: number
  room_advance_paise: number
  hall_advance_paise: number
  total_collection_paise: number
  expenses_paise: number
  net_paise: number
}

/** Counter-closing report — every collection stream for one day. */
export function DailyCollectionReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [data, setData] = useState<DailyCollection | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [date])

  async function load() {
    setLoading(true)
    try {
      const { data: res } = await api.get('/reports/daily-collection', { params: { date } })
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const rows: StreamRow[] = useMemo(() => {
    if (!data) return []
    return [
      { label: t('reports.streamDonations'), amount_paise: data.donations_paise },
      { label: t('reports.streamSeva'), amount_paise: data.seva_paise },
      { label: t('reports.streamPrasad'), amount_paise: data.prasad_paise },
      { label: t('reports.streamBhojanshala'), amount_paise: data.bhojanshala_paise },
      { label: t('reports.streamRoomAdvance'), amount_paise: data.room_advance_paise },
      { label: t('reports.streamHallAdvance'), amount_paise: data.hall_advance_paise },
      { label: t('reports.streamTotalCollection'), amount_paise: data.total_collection_paise, emphasis: 'total' },
      { label: t('reports.streamExpenses'), amount_paise: data.expenses_paise },
      { label: t('reports.streamNet'), amount_paise: data.net_paise, emphasis: 'net' },
    ]
  }, [data, t])

  const columns: ColumnDef<StreamRow>[] = [
    {
      key: 'label', label: t('reports.stream'),
      render: r => <span className={r.emphasis ? 'font-bold' : ''}>{r.label}</span>,
    },
    {
      key: 'amount', label: t('common.amount'), align: 'right',
      render: r => (
        <span className={r.emphasis === 'net' ? 'font-bold text-green-700' : r.emphasis === 'total' ? 'font-bold' : ''}>
          ₹{fmtPaise(r.amount_paise)}
        </span>
      ),
    },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('reports.streamTotalCollection'), value: `₹${fmtPaise(data.total_collection_paise)}`, tone: 'income' },
    { label: t('reports.streamExpenses'), value: `₹${fmtPaise(data.expenses_paise)}`, tone: 'expense' },
    { label: t('reports.streamNet'), value: `₹${fmtPaise(data.net_paise)}` },
  ] : []

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.dailyCollection'),
        subtitle: new Date(date).toLocaleDateString('en-IN'),
        filename: `daily-collection-${date}`,
        columns: [
          { header: t('reports.stream'), width: 26 },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: rows.map(r => [r.label, r.amount_paise]),
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.dailyCollection')} subtitle={new Date(date).toLocaleDateString('en-IN')} />

      <div className="flex items-center gap-2 no-print">
        <label htmlFor="dc-date" className="text-sm font-medium text-slate-600">{t('common.date')}</label>
        <input id="dc-date" type="date" className="form-input w-44" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.label}
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
