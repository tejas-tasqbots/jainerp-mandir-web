import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { printCurrentView } from '../../../lib/downloadReport'
import { api, fmtPaise, currentFY } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { FySelect } from '../../../components/FySelect'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface DepRow {
  id: string
  name: string
  category: string
  purchase_date: string
  purchase_cost_paise: number
  method: string
  rate: number
  opening_wdv_paise: number
  depreciation_paise: number
  closing_wdv_paise: number
  posted: boolean
  is_disposed: boolean
}

interface DepData {
  fy: string
  rows: DepRow[]
  totals: {
    count: number
    pending: number
    purchase_cost_paise: number
    opening_wdv_paise: number
    depreciation_paise: number
    closing_wdv_paise: number
  }
}

/** Asset-wise depreciation for the FY — opening WDV, charge, closing WDV (plan §03). */
export function DepreciationScheduleReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [fy, setFy] = useState(currentFY())
  const [data, setData] = useState<DepData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  useEffect(() => { load() }, [fy])

  async function load() {
    setLoading(true)
    try {
      const { data: res } = await api.get(`/reports/depreciation-schedule?fy=${fy}`)
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  // One row per asset, so the column filters run client-side rather than
  // round-tripping to the API.
  const visible = (data?.rows ?? []).filter(r => {
    const q = search.trim().toLowerCase()
    if (q && !`${r.name} ${r.category}`.toLowerCase().includes(q)) return false
    const pick = (key: string, value: string) => {
      const vals = filterState[key]?.values
      return !vals?.length || vals.includes(value)
    }
    return pick('category', r.category) && pick('method', r.method) && pick('posted', String(r.posted))
  })

  const categories = Array.from(new Set((data?.rows ?? []).map(r => r.category))).sort()

  const columns: ColumnDef<DepRow>[] = [
    {
      key: 'name', label: t('assets.assetName'),
      render: r => (
        <div>
          <span className="font-medium">{r.name}</span>
          {r.is_disposed && <span className="ml-2 badge-gray">{t('assets.disposed')}</span>}
        </div>
      ),
    },
    {
      key: 'category', label: t('common.category'),
      filter: { kind: 'enum', param: 'category', options: categories.map(c => ({ value: c, label: c })) },
    },
    {
      key: 'method', label: t('assets.method'),
      filter: { kind: 'enum', param: 'method', options: [{ value: 'SLM', label: 'SLM' }, { value: 'WDV', label: 'WDV' }] },
      render: r => <span className="badge-gray">{r.method} {r.rate}%</span>,
    },
    { key: 'cost', label: t('assets.cost'), align: 'right', render: r => `₹${fmtPaise(r.purchase_cost_paise)}` },
    { key: 'opening', label: t('reports.openingWdv'), align: 'right', render: r => `₹${fmtPaise(r.opening_wdv_paise)}` },
    {
      key: 'dep', label: t('reports.depreciation'), align: 'right',
      render: r => <span className="text-red-600 font-semibold">₹{fmtPaise(r.depreciation_paise)}</span>,
    },
    {
      key: 'closing', label: t('reports.closingWdv'), align: 'right',
      render: r => <span className="font-semibold">₹{fmtPaise(r.closing_wdv_paise)}</span>,
    },
    {
      key: 'posted', label: t('common.status'),
      filter: { kind: 'enum', param: 'posted', options: [{ value: 'true', label: t('reports.posted') }, { value: 'false', label: t('reports.estimated') }] },
      render: r => r.posted
        ? <span className="badge-green">{t('reports.posted')}</span>
        : <span className="badge-yellow">{t('reports.estimated')}</span>,
    },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('assets.title'), value: String(data.totals.count) },
    { label: t('reports.openingWdv'), value: `₹${fmtPaise(data.totals.opening_wdv_paise)}` },
    { label: t('reports.depreciation'), value: `₹${fmtPaise(data.totals.depreciation_paise)}`, tone: 'expense' },
    { label: t('reports.closingWdv'), value: `₹${fmtPaise(data.totals.closing_wdv_paise)}` },
  ] : []

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.depreciationSchedule'),
        subtitle: `FY ${fy}`,
        filename: `depreciation-schedule-${fy}`,
        columns: [
          { header: t('assets.assetName'), width: 28 },
          { header: t('common.category'), width: 18 },
          { header: t('assets.method'), width: 10 },
          { header: t('assets.cost'), type: 'money' },
          { header: t('reports.openingWdv'), type: 'money' },
          { header: t('reports.depreciation'), type: 'money' },
          { header: t('reports.closingWdv'), type: 'money' },
          { header: t('common.status'), width: 12 },
        ],
        rows: visible.map(r => [
          r.name, r.category, `${r.method} ${r.rate}%`, r.purchase_cost_paise,
          r.opening_wdv_paise, r.depreciation_paise, r.closing_wdv_paise,
          r.posted ? t('reports.posted') : t('reports.estimated'),
        ]),
        totals: [
          t('kit.total'), '', '',
          visible.reduce((s, r) => s + r.purchase_cost_paise, 0),
          visible.reduce((s, r) => s + r.opening_wdv_paise, 0),
          visible.reduce((s, r) => s + r.depreciation_paise, 0),
          visible.reduce((s, r) => s + r.closing_wdv_paise, 0),
          '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.depreciationSchedule')} subtitle={`FY ${fy}`} />

      <div className="flex items-center gap-2 no-print">
        <label className="text-sm font-medium text-slate-600">{t('reports.fy')}</label>
        <FySelect value={fy} onChange={setFy} className="w-32" />
      </div>

      <SummaryStrip stats={stats} />

      {!!data?.totals.pending && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 no-print">
          {t('reports.depreciationPending', { count: data.totals.pending })}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={r => r.id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('assets.searchPlaceholder')}
        filterState={filterState}
        onFilterChange={(key, st) => {
          setFilterState(prev => { const next = { ...prev }; if (st) next[key] = st; else delete next[key]; return next })
        }}
        onClearFilters={() => { setFilterState({}); setSearch('') }}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        page={1}
        limit={visible.length || 1}
        total={visible.length}
        onPageChange={() => {}}
        viewKey="report-depreciation-schedule"
        emptyMessage={t('reports.noData')}
      />
    </div>
  )
}
