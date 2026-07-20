import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

type Bucket = '0-30' | '31-60' | '60+'

interface CreditorRaw {
  id: string
  vendor_name: string | null
  description: string
  due_date: string | null
  original_amount_paise: number
  paid_amount_paise: number
  status: string
  created_at: string
}

interface AgingRow extends CreditorRaw {
  outstanding_paise: number
  ageDays: number
  bucket: Bucket
}

const BUCKETS: Bucket[] = ['0-30', '31-60', '60+']

function bucketFor(days: number): Bucket {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  return '60+'
}

/**
 * Payables aging — every open (non-paid) creditor bucketed by days since its
 * due date (falls back to created_at when no due date was set). Trustees use
 * this to see what's overdue and by how much, not just the raw total.
 */
export function CreditorAgingReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [raw, setRaw] = useState<CreditorRaw[]>([])
  const [loading, setLoading] = useState(true)
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const bucketLabel: Record<Bucket, string> = {
    '0-30': t('reports.aging0to30'),
    '31-60': t('reports.aging31to60'),
    '60+': t('reports.aging60plus'),
  }

  const columns: ColumnDef<AgingRow>[] = useMemo(() => [
    { key: 'vendor', label: t('creditors.vendorPayee'), render: r => <span className="font-medium">{r.vendor_name || '—'}</span> },
    { key: 'description', label: t('creditors.description'), render: r => <span className="text-slate-600">{r.description}</span> },
    { key: 'outstanding', label: t('creditors.outstanding'), align: 'right', render: r => <span className="font-semibold text-red-600">₹{fmtPaise(r.outstanding_paise)}</span> },
    {
      key: 'age', label: t('reports.ageDays'), align: 'right',
      render: r => <span className={r.ageDays > 60 ? 'text-red-600 font-semibold' : r.ageDays > 30 ? 'text-amber-600' : 'text-slate-600'}>{r.ageDays}</span>,
    },
    {
      key: 'bucket', label: t('reports.agingBucket'),
      filter: { kind: 'enum', param: 'bucket', options: BUCKETS.map(b => ({ value: b, label: bucketLabel[b] })) },
      render: r => (
        <span className={r.bucket === '60+' ? 'badge-red' : r.bucket === '31-60' ? 'badge-yellow' : 'badge-gray'}>
          {bucketLabel[r.bucket]}
        </span>
      ),
    },
    {
      key: 'due', label: t('creditors.dueDate'),
      render: r => <span className="text-xs text-slate-400">{r.due_date ? new Date(r.due_date).toLocaleDateString('en-IN') : '—'}</span>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      // Open payables only — a settled creditor has nothing left to age.
      const { data } = await api.get('/creditors', { params: { limit: '200', status: 'pending,partially_paid' } })
      setRaw(data.data || [])
    } catch {
      setRaw([])
    } finally {
      setLoading(false)
    }
  }

  const today = Date.now()
  const rows: AgingRow[] = useMemo(() => raw
    .map(r => {
      const outstanding = r.original_amount_paise - r.paid_amount_paise
      const anchor = new Date(r.due_date || r.created_at).getTime()
      const ageDays = Math.max(0, Math.floor((today - anchor) / 86_400_000))
      return { ...r, outstanding_paise: outstanding, ageDays, bucket: bucketFor(ageDays) }
    })
    .filter(r => r.outstanding_paise > 0)
    .sort((a, b) => b.ageDays - a.ageDays),
  [raw, today])

  const visible = useMemo(() => {
    const bucketSel = filterState.bucket?.values
    return bucketSel?.length ? rows.filter(r => bucketSel.includes(r.bucket)) : rows
  }, [rows, filterState])

  const bucketTotals = useMemo(() => {
    const totals: Record<Bucket, number> = { '0-30': 0, '31-60': 0, '60+': 0 }
    for (const r of rows) totals[r.bucket] += r.outstanding_paise
    return totals
  }, [rows])

  const stats: SummaryStat[] = [
    { label: bucketLabel['0-30'], value: `₹${fmtPaise(bucketTotals['0-30'])}` },
    { label: bucketLabel['31-60'], value: `₹${fmtPaise(bucketTotals['31-60'])}`, tone: bucketTotals['31-60'] > 0 ? 'expense' : 'default' },
    { label: bucketLabel['60+'], value: `₹${fmtPaise(bucketTotals['60+'])}`, tone: bucketTotals['60+'] > 0 ? 'expense' : 'default' },
    { label: t('kit.total'), value: `₹${fmtPaise(rows.reduce((s, r) => s + r.outstanding_paise, 0))}` },
  ]

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.creditorAging'),
        subtitle: new Date().toLocaleDateString('en-IN'),
        filename: 'creditor-aging',
        columns: [
          { header: t('creditors.vendorPayee'), width: 24 },
          { header: t('creditors.description'), width: 30 },
          { header: t('creditors.outstanding'), type: 'money' },
          { header: t('reports.ageDays'), type: 'number' },
          { header: t('reports.agingBucket'), width: 12 },
          { header: t('creditors.dueDate'), type: 'date' },
        ],
        rows: visible.map(r => [
          r.vendor_name ?? '', r.description, r.outstanding_paise, r.ageDays, bucketLabel[r.bucket],
          r.due_date ? new Date(r.due_date).toLocaleDateString('en-IN') : '',
        ]),
        totals: [t('kit.total'), '', visible.reduce((s, r) => s + r.outstanding_paise, 0), '', '', ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.creditorAging')} subtitle={new Date().toLocaleDateString('en-IN')} />

      <SummaryStrip stats={stats} />

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={r => r.id}
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
        limit={visible.length || 1}
        total={visible.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noOpenPayables')}
        onClearFilters={() => setFilterState({})}
      />
    </div>
  )
}
