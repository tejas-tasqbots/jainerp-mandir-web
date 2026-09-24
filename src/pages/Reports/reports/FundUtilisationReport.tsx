import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { printCurrentView } from '../../../lib/downloadReport'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'
import { statusLabel } from '../../../lib/statusLabel'

interface FundRow {
  fund: string
  fund_id: string | null
  fund_type: string
  is_restricted: boolean
  received_paise: number
  received_count: number
  applied_paise: number
  applied_count: number
  balance_paise: number
  over_applied: boolean
}

interface FundData {
  from: string
  to: string
  rows: FundRow[]
  totals: { received_paise: number; applied_paise: number; balance_paise: number }
  restricted_over_applied: string[]
}

/**
 * What each fund received, what it paid for, and what is left.
 *
 * The question the donation-by-category report cannot answer. Donations have
 * always carried a fund; expenses did not, so a trust could show what came in
 * and never what it was spent on — which is the half an auditor asks about. A
 * Jain trust may not apply Dev Dravya to Sadharan or Jivdaya purposes, and
 * until tenant-migration 036 there was no way to demonstrate it had not.
 */
export function FundUtilisationReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('report-fund-utilisation', 'thisFY'))
  const [data, setData] = useState<FundData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [range])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data: res } = await api.get(`/reports/fund-utilisation?${params}`)
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const rows = data?.rows ?? []

  const columns: ColumnDef<FundRow>[] = [
    {
      key: 'fund', label: t('reports.fund'),
      render: r => (
        <div>
          <span className="font-medium">{r.fund}</span>
          {r.is_restricted && <span className="badge-yellow ml-2">{t('reports.restricted')}</span>}
          {/* Unallocated is not a fund — it is everything written before the
              fund dimension existed, kept visible rather than spread across
              the real funds. */}
          {!r.fund_id && <span className="text-xs text-slate-500 block">{t('reports.unallocatedHint')}</span>}
        </div>
      ),
    },
    { key: 'type', label: t('reports.fundType'), render: r => <span className="text-xs text-slate-500">{statusLabel(t, r.fund_type)}</span> },
    { key: 'received', label: t('reports.received'), align: 'right', render: r => <span className="text-green-700">₹{fmtPaise(r.received_paise)}</span> },
    { key: 'applied', label: t('reports.applied'), align: 'right', render: r => <span className="text-red-600">₹{fmtPaise(r.applied_paise)}</span> },
    {
      key: 'balance', label: t('reports.fundBalance'), align: 'right',
      render: r => (
        <span className={r.over_applied ? 'font-semibold text-red-600' : 'font-semibold'}>
          ₹{fmtPaise(r.balance_paise)}
          {r.over_applied && r.is_restricted && <AlertTriangle size={13} className="inline ml-1" aria-hidden />}
        </span>
      ),
    },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('reports.received'), value: `₹${fmtPaise(data.totals.received_paise)}`, tone: 'income' },
    { label: t('reports.applied'), value: `₹${fmtPaise(data.totals.applied_paise)}`, tone: 'expense' },
    { label: t('reports.fundBalance'), value: `₹${fmtPaise(data.totals.balance_paise)}` },
    { label: t('reports.funds'), value: String(rows.length) },
  ] : []

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.fundUtilisation'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'fund-utilisation',
        columns: [
          { header: t('reports.fund'), width: 26 },
          { header: t('reports.fundType'), width: 12 },
          { header: t('reports.received'), type: 'money' },
          { header: t('reports.applied'), type: 'money' },
          { header: t('reports.fundBalance'), type: 'money' },
        ],
        rows: rows.map(r => [r.fund, r.fund_type, r.received_paise, r.applied_paise, r.balance_paise]),
        totals: [t('kit.total'), '', data?.totals.received_paise ?? 0, data?.totals.applied_paise ?? 0, data?.totals.balance_paise ?? 0],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.fundUtilisation')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey="report-fund-utilisation" />
      </div>

      <SummaryStrip stats={stats} />

      {/* The finding this report exists to surface: a restricted fund that has
          paid out more than it ever received. For an unrestricted general fund
          that is ordinary; for Dev Dravya it is the audit question. */}
      {!!data?.restricted_over_applied?.length && (
        <div className="card border-l-4 border-red-500">
          <div className="card-body flex gap-3 items-start">
            <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium text-red-700">{t('reports.overApplied')}</p>
              <p className="text-sm text-slate-600">
                {t('reports.overAppliedHint', { funds: data.restricted_over_applied.join(', ') })}
              </p>
            </div>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.fund_id ?? r.fund}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
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
