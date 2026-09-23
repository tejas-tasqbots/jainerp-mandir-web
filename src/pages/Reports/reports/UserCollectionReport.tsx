import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { fmtPaise, todayIst } from '../../../lib/api'
import { useApiGet } from '../../../lib/useApiGet'
import { printCurrentView } from '../../../lib/downloadReport'
import { exportXlsx } from '../../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'
import { roleLabel } from '../../../lib/auditLabels'

interface Tally { amount_paise: number; count: number }

interface UserRow {
  key: string
  kind: 'staff' | 'online' | 'unrecorded'
  name: string | null
  role: string | null
  cash_in: Tally
  online_in: Tally
  expenses: Tally
  other_out: Tally
  received_paise: number
  paid_paise: number
}

interface Report {
  from: string
  to: string
  users: UserRow[]
  totals: {
    cash_in_paise: number
    online_in_paise: number
    expenses_paise: number
    other_out_paise: number
    received_paise: number
    paid_paise: number
  }
}

/**
 * User-wise collection — who took how much.
 *
 * Asked for: "which User have taken how much cash bills and online bills
 * generated and expense userwise". Money is credited to whoever TOOK it (each
 * payment's operator), so a room booked by one cashier and settled by another
 * credits each with their own part — how a counter's shift is reconciled
 * against the drawer. Read from the same feed as the Day Book: the totals row
 * always equals the Day Book for the same dates.
 */
export function UserCollectionReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('user-collections', 'today'))

  const url = useMemo(() => {
    // "All time" is an empty range; the report needs real dates.
    const p = new URLSearchParams({ from: range.from || '2000-01-01', to: range.to || todayIst() })
    return `/accounting/user-collections?${p}`
  }, [range])
  const { data, loading } = useApiGet<{ data?: Report }>(url)
  const report = data?.data ?? null
  const rows = report?.users ?? []

  const who = (u: UserRow) =>
    u.kind === 'online' ? t('enteredBy.online') : u.kind === 'unrecorded' || !u.name ? t('enteredBy.notRecorded') : u.name

  const money = (x: Tally, withBills = true) =>
    x.amount_paise ? (
      <span className="tabular-nums">
        ₹{fmtPaise(x.amount_paise)}
        {withBills && <span className="text-xs text-slate-400 ml-1">({t('userCollections.bills', { count: x.count })})</span>}
      </span>
    ) : <span className="text-slate-300">—</span>

  const columns: ColumnDef<UserRow>[] = [
    {
      key: 'user', label: t('userCollections.user'),
      render: u => (
        <span className="flex items-center gap-2">
          {u.kind === 'online' && <Globe size={13} className="text-blue-600" aria-hidden />}
          <span className={u.kind === 'staff' ? 'font-medium' : 'text-slate-500'}>{who(u)}</span>
          {u.role && <span className="badge-gray">{roleLabel(t, u.role)}</span>}
        </span>
      ),
    },
    { key: 'cash', label: t('userCollections.cashIn'), align: 'right', render: u => money(u.cash_in) },
    { key: 'online', label: t('userCollections.onlineIn'), align: 'right', render: u => money(u.online_in) },
    {
      key: 'received', label: t('userCollections.received'), align: 'right',
      render: u => <span className="font-semibold tabular-nums text-green-700">₹{fmtPaise(u.received_paise)}</span>,
    },
    { key: 'expenses', label: t('userCollections.expenses'), align: 'right', render: u => money(u.expenses, false) },
    { key: 'other', label: t('userCollections.otherOut'), align: 'right', render: u => money(u.other_out, false) },
  ]

  const tot = report?.totals
  const stats: SummaryStat[] = tot ? [
    { label: t('userCollections.cashIn'), value: `₹${fmtPaise(tot.cash_in_paise)}`, tone: 'income' },
    { label: t('userCollections.onlineIn'), value: `₹${fmtPaise(tot.online_in_paise)}`, tone: 'income' },
    { label: t('userCollections.expenses'), value: `₹${fmtPaise(tot.expenses_paise)}`, tone: 'expense' },
    { label: t('userCollections.otherOut'), value: `₹${fmtPaise(tot.other_out_paise)}`, tone: 'expense' },
  ] : []

  async function exportExcel() {
    if (!rows.length || !tot) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.userCollections'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'user-wise-collection',
        columns: [
          { header: t('userCollections.user'), width: 24 },
          { header: t('userCollections.cashIn'), type: 'money' },
          { header: t('userCollections.cashBills'), type: 'number', width: 10 },
          { header: t('userCollections.onlineIn'), type: 'money' },
          { header: t('userCollections.onlineBills'), type: 'number', width: 10 },
          { header: t('userCollections.received'), type: 'money' },
          { header: t('userCollections.expenses'), type: 'money' },
          { header: t('userCollections.otherOut'), type: 'money' },
        ],
        rows: rows.map(u => [
          who(u), u.cash_in.amount_paise, u.cash_in.count, u.online_in.amount_paise, u.online_in.count,
          u.received_paise, u.expenses.amount_paise, u.other_out.amount_paise,
        ]),
        totals: [
          t('kit.total'), tot.cash_in_paise, rows.reduce((s, u) => s + u.cash_in.count, 0),
          tot.online_in_paise, rows.reduce((s, u) => s + u.online_in.count, 0),
          tot.received_paise, tot.expenses_paise, tot.other_out_paise,
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.userCollections')} subtitle={rangeCaption(range, t('dateRange.all'))} />
      <div className="no-print">
        <DateRangePicker value={range} onChange={setRange} storageKey="user-collections" />
      </div>
      <p className="text-xs text-slate-500 no-print">{t('userCollections.hint')}</p>
      <SummaryStrip stats={stats} />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={u => u.key}
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
