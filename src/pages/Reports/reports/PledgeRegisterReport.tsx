import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise, currentFY } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { DataTable, filterStateToParams, type ColumnDef, type ColumnFilterState } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { FySelect } from '../../../components/FySelect'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

const STATUSES = ['pledged', 'partially_paid', 'paid', 'waived'] as const

interface PledgeRow {
  boli_date: string
  donor_name: string
  donor_mobile: string | null
  seva_description: string
  event_name: string | null
  committed_amount_paise: number
  paid_amount_paise: number
  outstanding_paise: number
  status: string
}

export function PledgeRegisterReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [fy, setFy] = useState(currentFY())
  const [rows, setRows] = useState<PledgeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const statusLabel: Record<string, string> = {
    pledged: t('pledges.statusPledged'),
    partially_paid: t('pledges.statusPartial'),
    paid: t('pledges.statusPaid'),
    waived: t('pledges.statusWaived'),
  }

  const columns: ColumnDef<PledgeRow>[] = useMemo(() => [
    { key: 'date', label: t('common.date'), render: r => <span className="text-xs">{new Date(r.boli_date).toLocaleDateString('en-IN')}</span> },
    { key: 'donor', label: t('donations.donor'), render: r => <span className="font-medium">{r.donor_name}</span> },
    { key: 'description', label: t('pledges.description'), render: r => <span className="text-slate-600 block max-w-[220px] truncate">{r.seva_description || '—'}</span> },
    { key: 'event', label: t('pledges.event'), render: r => <span className="text-slate-500 text-xs">{r.event_name || '—'}</span> },
    { key: 'pledged', label: t('pledges.pledged'), align: 'right', render: r => <span className="font-semibold">₹{fmtPaise(r.committed_amount_paise)}</span> },
    { key: 'paid', label: t('pledges.paid'), align: 'right', render: r => <span className="text-green-700">₹{fmtPaise(r.paid_amount_paise)}</span> },
    {
      key: 'outstanding', label: t('pledges.outstanding'), align: 'right',
      render: r => <span className={r.outstanding_paise > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>₹{fmtPaise(r.outstanding_paise)}</span>,
    },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: r => <span>{statusLabel[r.status] ?? r.status}</span>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

  useEffect(() => { load() }, [fy, filterState])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ fy })
      for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
      const { data } = await api.get(`/reports/boli-register?${params}`)
      setRows(data.data?.rows ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const totalPledged = rows.reduce((s, r) => s + Number(r.committed_amount_paise), 0)
  const totalOutstanding = rows.reduce((s, r) => s + Number(r.outstanding_paise), 0)
  const stats: SummaryStat[] = [
    { label: t('pledges.pledged'), value: `₹${fmtPaise(totalPledged)}` },
    { label: t('pledges.outstanding'), value: `₹${fmtPaise(totalOutstanding)}`, tone: totalOutstanding > 0 ? 'expense' : 'default' },
    { label: t('kit.receipts'), value: String(rows.length) },
  ]

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.pledgeRegister'),
        subtitle: `FY ${fy}`,
        filename: 'pledge-register',
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('donations.donor'), width: 24 },
          { header: t('donors.mobile'), width: 15 },
          { header: t('pledges.description'), width: 30 },
          { header: t('pledges.event'), width: 18 },
          { header: t('pledges.pledged'), type: 'money' },
          { header: t('pledges.paid'), type: 'money' },
          { header: t('pledges.outstanding'), type: 'money' },
          { header: t('common.status'), width: 14 },
        ],
        rows: rows.map(r => [
          new Date(r.boli_date).toLocaleDateString('en-IN'), r.donor_name, r.donor_mobile ?? '',
          r.seva_description ?? '', r.event_name ?? '',
          r.committed_amount_paise, r.paid_amount_paise, r.outstanding_paise,
          statusLabel[r.status] ?? r.status,
        ]),
        totals: [t('kit.total'), '', '', '', '', totalPledged, rows.reduce((s, r) => s + r.paid_amount_paise, 0), totalOutstanding, ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.pledgeRegister')} subtitle={`FY ${fy}`} />

      <div className="flex items-center gap-2 no-print">
        <label className="text-sm font-medium text-slate-600">{t('reports.fy')}</label>
        <FySelect value={fy} onChange={setFy} className="form-select w-28" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r, i) => `${r.donor_name}-${r.boli_date}-${i}`}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
        }}
        page={1}
        limit={rows.length || 1}
        total={rows.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noData')}
        onClearFilters={() => setFilterState({})}
      />
    </div>
  )
}
