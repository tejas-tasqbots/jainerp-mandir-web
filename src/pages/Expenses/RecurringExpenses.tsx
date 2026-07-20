import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, CheckCircle2 } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { DataTable, type ColumnDef } from '../../components/kit/DataTable'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface RecurringSeries {
  id: string
  description: string
  vendor_id: string | null
  vendor_name: string | null
  category_id: string | null
  category: string | null
  amount_paise: number
  bill_date: string | null
  created_at: string
  logged_this_month: boolean
}

/**
 * Recurring expenses — salary, electricity, AMC and the like, marked once
 * ("Repeat monthly" on Add Expense) and confirmed here each month with the
 * amount pre-filled from last time, editable before the click.
 */
export function RecurringExpenses() {
  const { t } = useTranslation()
  const toast = useToast()
  const [rows, setRows] = useState<RecurringSeries[]>([])
  const [loading, setLoading] = useState(true)
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/expenses/recurring')
      const list: RecurringSeries[] = data.data || []
      setRows(list)
      setAmountDrafts(prev => {
        const next = { ...prev }
        for (const r of list) if (next[r.id] === undefined) next[r.id] = String(r.amount_paise / 100)
        return next
      })
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  async function confirm(r: RecurringSeries) {
    const draft = amountDrafts[r.id]
    const amountPaise = parsePaise(draft ?? '')
    if (!amountPaise || amountPaise <= 0) { toast.error(t('expenses.enterValidAmount')); return }
    setConfirmingId(r.id)
    try {
      await api.post(`/expenses/recurring/${r.id}/confirm`, { amount_paise: amountPaise })
      toast.success(t('expenses.recurringConfirmed', { description: r.description }))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('expenses.recurringConfirmFailed'))
    } finally {
      setConfirmingId(null)
    }
  }

  const columns: ColumnDef<RecurringSeries>[] = useMemo(() => [
    { key: 'description', label: t('expenses.description'), render: r => <span className="font-medium">{r.description}</span> },
    { key: 'vendor', label: t('expenses.vendor'), render: r => <span className="text-slate-600">{r.vendor_name || '—'}</span> },
    { key: 'category', label: t('expenses.category'), render: r => <span className="text-slate-500">{r.category || '—'}</span> },
    {
      key: 'lastAmount', label: t('expenses.lastAmount'), align: 'right',
      render: r => <span className="text-slate-500">₹{fmtPaise(r.amount_paise)}</span>,
    },
    {
      key: 'lastDate', label: t('expenses.lastDate'),
      render: r => <span className="text-xs text-slate-400">{new Date(r.bill_date || r.created_at).toLocaleDateString('en-IN')}</span>,
    },
    {
      key: 'status', label: t('common.status'),
      render: r => r.logged_this_month
        ? <span className="badge-green inline-flex items-center gap-1"><CheckCircle2 size={11} /> {t('expenses.loggedThisMonth')}</span>
        : <span className="badge-yellow">{t('expenses.pendingThisMonth')}</span>,
    },
    {
      key: 'actions', label: t('common.actions'),
      render: r => r.logged_this_month ? null : (
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs">₹</span>
          <input
            type="number" min="0.01" step="0.01"
            className="form-input !py-1 !text-xs w-24"
            value={amountDrafts[r.id] ?? ''}
            onChange={e => setAmountDrafts(prev => ({ ...prev, [r.id]: e.target.value }))}
          />
          <button
            type="button" onClick={() => confirm(r)} disabled={confirmingId === r.id}
            className="btn-primary btn-sm !text-xs"
          >
            {confirmingId === r.id ? <RefreshCw size={12} className="animate-spin" /> : null}
            {t('expenses.confirmThisMonth')}
          </button>
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, amountDrafts, confirmingId])

  const pendingCount = rows.filter(r => !r.logged_this_month).length

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('expenses.recurringTitle')} />

      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="text-xl font-bold text-navy-900">{t('expenses.recurringTitle')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('expenses.recurringSubtitle')}</p>
        </div>
        {pendingCount > 0 && <span className="badge-yellow">{t('expenses.pendingCount', { count: pendingCount })}</span>}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        loading={loading}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={rows.length || 1}
        total={rows.length}
        onPageChange={() => {}}
        emptyMessage={t('expenses.noRecurringExpenses')}
      />
    </div>
  )
}
