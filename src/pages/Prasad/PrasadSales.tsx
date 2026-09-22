import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Receipt, ShoppingCart, Trash2 } from 'lucide-react'
import { fmtPaise } from '../../lib/api'
import { useApiGet } from '../../lib/useApiGet'
import { printCurrentView } from '../../lib/downloadReport'
import { printDonationReceipt } from '../../lib/printReceipt'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { DataTable, type ColumnDef, type RowAction } from '../../components/kit/DataTable'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { useCanDeleteEntries, useDeleteEntry } from '../../components/deleteEntry'

interface SaleLine { item_id?: string; name?: string; qty?: number; amount_paise?: number }

interface PrasadSale {
  id: string
  items: SaleLine[] | string
  total_paise: number | string
  payment_mode: string
  invoice_no: string | null
  buyer_name: string | null
  buyer_mobile: string | null
  is_anonymous?: boolean
  created_at: string
}

const PAGE_SIZE = 50

function linesOf(s: PrasadSale): SaleLine[] {
  if (Array.isArray(s.items)) return s.items
  try { return JSON.parse(s.items) as SaleLine[] } catch { return [] }
}

/**
 * Prasad sales register — every sale from the counter, with its receipt.
 *
 * The counter screen only ever showed the sale just made, so a mistaken sale
 * could not be found again, reprinted or taken back. This is where it can be:
 * reprint the slip, and (temple admin) delete it — which puts the items back
 * on the shelf and takes the money out of Cash & Bank.
 */
export function PrasadSales() {
  const { t } = useTranslation()
  const toast = useToast()
  const canDelete = useCanDeleteEntries()
  const deleteEntry = useDeleteEntry()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('prasad-sales', 'today'))
  const [printing, setPrinting] = useState<string | null>(null)

  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (search) p.set('q', search)
    if (range.from) p.set('from', range.from)
    if (range.to) p.set('to', range.to)
    return `/prasad/sales?${p}`
  }, [page, search, range])
  const { data, loading, refresh } = useApiGet<{ data?: PrasadSale[]; meta?: { total?: number; total_amount_paise?: number } }>(url)
  const rows = data?.data ?? []
  const total = data?.meta?.total ?? 0
  const amount = Number(data?.meta?.total_amount_paise ?? 0)

  async function reprint(id: string) {
    setPrinting(id)
    try {
      await printDonationReceipt(id, '/prasad/sales')
    } catch {
      toast.error(t('prasad.receiptFailed', { defaultValue: 'Could not load the receipt' }))
    } finally {
      setPrinting(null)
    }
  }

  const columns: ColumnDef<PrasadSale>[] = useMemo(() => [
    {
      key: 'time', label: t('prasad.salesWhen'),
      render: s => (
        <div className="text-xs">
          <p className="text-slate-700">{new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <p className="text-slate-400">{new Date(s.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>
        </div>
      ),
    },
    { key: 'invoice_no', label: t('prasad.receiptNo'), render: s => <span className="font-mono text-xs text-slate-600">{s.invoice_no || '—'}</span> },
    {
      key: 'buyer', label: t('prasad.buyer'),
      render: s => (
        <div>
          <p className="font-medium text-slate-800">{s.is_anonymous ? t('recycleBin.anonymous') : (s.buyer_name || t('prasad.walkIn'))}</p>
          {s.buyer_mobile && <p className="text-xs text-slate-400">{s.buyer_mobile}</p>}
        </div>
      ),
    },
    {
      key: 'items', label: t('prasad.items'),
      render: s => (
        <span className="text-xs text-slate-600">
          {linesOf(s).map(l => `${l.name ?? '—'} × ${l.qty ?? 0}`).join(', ') || '—'}
        </span>
      ),
    },
    { key: 'payment_mode', label: t('seva.mode'), render: s => <span className="badge-gray">{s.payment_mode}</span> },
    { key: 'total', label: t('common.amount'), align: 'right', render: s => <span className="font-semibold tabular-nums">₹{fmtPaise(Number(s.total_paise))}</span> },
  ], [t])

  function rowActions(s: PrasadSale): RowAction[] {
    const actions: RowAction[] = [{
      label: t('prasad.printReceipt'), icon: <Receipt size={14} />, primary: true,
      onClick: () => void reprint(s.id), disabled: printing === s.id,
    }]
    if (canDelete) {
      actions.push({
        label: t('entries.delete'), icon: <Trash2 size={13} />, danger: true,
        onClick: async () => {
          if (await deleteEntry({
            kind: 'prasad_sale', id: s.id,
            title: s.is_anonymous ? t('recycleBin.anonymous') : (s.buyer_name || t('prasad.walkIn')),
            detail: linesOf(s).map(l => `${l.name ?? '—'} × ${l.qty ?? 0}`).join(', '),
            reference: s.invoice_no, amountPaise: Number(s.total_paise), date: s.created_at,
          })) refresh()
        },
      })
    }
    return actions
  }

  const stats: SummaryStat[] = [
    { label: t('prasad.salesCount'), value: total.toLocaleString('en-IN') },
    { label: t('prasad.salesAmount'), value: `₹${fmtPaise(amount)}` },
  ]

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('prasad.salesTitle')} subtitle={rangeCaption(range, t('dateRange.all'))} />
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-navy-900">{t('prasad.salesTitle')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('prasad.salesSubtitle')}</p>
        </div>
        <Link to="/prasad" className="btn-primary btn-sm"><ShoppingCart size={14} /> {t('prasad.counterTitle')}</Link>
      </div>
      <div className="no-print">
        <DateRangePicker value={range} onChange={v => { setRange(v); setPage(1) }} storageKey="prasad-sales" />
      </div>
      <SummaryStrip stats={stats} />
      <DataTable
        viewKey="prasad-sales"
        columns={columns}
        rows={rows}
        rowKey={s => s.id}
        rowActions={rowActions}
        loading={loading}
        searchValue={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder={t('prasad.salesSearch')}
        onPrint={() => printCurrentView()}
        filterState={{}}
        onFilterChange={() => {}}
        page={page}
        limit={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        emptyMessage={t('prasad.noSales')}
      />
    </div>
  )
}
