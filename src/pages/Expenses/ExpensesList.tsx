import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, Landmark, Paperclip } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { rsFmt, printCurrentView } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { useResourceNames } from '../../lib/useDropdownOptions'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState, type SortState, type RowAction,
} from '../../components/kit/DataTable'
import { useChequeLifecycle } from '../../components/ChequeLifecycle'
import { SummaryStrip, deltaPct, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { Expense } from '../../types'
import { useConfirm } from '../../components/ConfirmDialog'
import { ExpenseDetail } from './ExpenseDetail'

const PAYMENT_MODES = ['cash', 'upi', 'cheque', 'netbanking', 'online', 'credit']
const PAGE_SIZE = 20

interface ListMeta {
  total: number
  total_amount_paise: number
  prev_period_amount_paise: number | null
  day_totals?: { date: string; amount_paise: number }[]
}

interface Account { id: string; name: string; type: string }
type PayMode = 'cash' | 'upi' | 'cheque' | 'netbanking'

export function ExpensesList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [meta, setMeta] = useState<ListMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('expenses'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [sort, setSort] = useState<SortState | undefined>()

  const [editModal, setEditModal] = useState<Expense | null>(null)
  const [editForm, setEditForm] = useState({ description: '', amount_paise: '', bill_number: '' })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const { chequeActions, bounceModal } = useChequeLifecycle('expenses', () => { void load() })

  const [accounts, setAccounts] = useState<Account[]>([])
  const [payModal, setPayModal] = useState<{ creditorId: string; vendorName: string; outstanding: number } | null>(null)
  const [payAmt, setPayAmt] = useState('')
  const [payMode, setPayMode] = useState<PayMode>('cash')
  const [payAccountId, setPayAccountId] = useState('')
  const [payError, setPayError] = useState('')
  const [paying, setPaying] = useState(false)

  const categoryNames = useResourceNames('expense-categories')
  const bankAccounts = accounts.filter(a => a.type !== 'cash')

  useEffect(() => {
    api.get('/accounts?is_active=true').then(r => setAccounts(r.data.data || [])).catch(() => {})
  }, [])

  function creditOutstanding(e: Expense): number {
    return e.amount_paise - (e.credit_paid_paise ?? 0)
  }

  function openPay(e: Expense) {
    if (!e.creditor_id) return
    setPayModal({ creditorId: e.creditor_id, vendorName: e.vendor_name || e.description, outstanding: creditOutstanding(e) })
    setPayAmt(''); setPayMode('cash'); setPayAccountId(''); setPayError('')
  }

  async function submitPay(ev: React.FormEvent) {
    ev.preventDefault()
    if (!payModal) return
    const payPaise = parsePaise(payAmt)
    if (!payPaise || payPaise <= 0) { setPayError(t('creditors.enterValidAmount')); return }
    if (payPaise > payModal.outstanding) { setPayError(t('creditors.cannotExceedOutstanding', { amount: fmtPaise(payModal.outstanding) })); return }
    if (payMode !== 'cash' && !payAccountId) { setPayError(t('creditors.selectBankAccountError')); return }
    setPaying(true); setPayError('')
    try {
      await api.post(`/creditors/${payModal.creditorId}/pay`, {
        amount_paise: payPaise,
        payment_mode: payMode,
        payment_account_id: payMode === 'cash' ? undefined : payAccountId,
        payment_date: new Date().toISOString().slice(0, 10),
      })
      setPayModal(null)
      toast.success(t('creditors.paymentRecorded'))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      setPayError(ex.response?.data?.error?.message || t('pledges.paymentFailed'))
    } finally {
      setPaying(false)
    }
  }

  const columns: ColumnDef<Expense>[] = useMemo(() => [
    {
      key: 'description', label: t('expenses.description'),
      render: e => (
        <span className="font-medium inline-flex items-center gap-1.5">
          {e.description}
          {e.has_bill_photo && <Paperclip size={12} className="text-slate-400" aria-label={t('expenses.billAttached')} />}
        </span>
      ),
    },
    {
      key: 'vendor', label: t('expenses.vendor'), sortable: true,
      filter: { kind: 'text', param: 'vendor' },
      render: e => <span className="text-slate-600">{e.vendor_name || '—'}</span>,
    },
    {
      key: 'category', label: t('expenses.category'), sortable: true,
      filter: { kind: 'enum', param: 'category', options: categoryNames.map(n => ({ value: n, label: n })) },
      render: e => <span className="text-slate-500">{e.category || '—'}</span>,
    },
    {
      key: 'amount', label: t('common.amount'), align: 'right', sortable: true,
      filter: { kind: 'amount', gteParam: 'amount_gte', lteParam: 'amount_lte' },
      render: e => (
        <span className="font-semibold">
          ₹{fmtPaise(e.amount_paise)}
          {!!e.gst_paid_paise && <span className="block text-xs text-slate-400 font-normal">+GST ₹{fmtPaise(e.gst_paid_paise)}</span>}
        </span>
      ),
    },
    {
      key: 'mode', label: t('expenses.mode'),
      filter: { kind: 'enum', param: 'payment_mode', options: PAYMENT_MODES.map(m => ({ value: m, label: t(`common.${m}`, m) })) },
      render: e => <span className="badge-gray">{e.payment_mode}</span>,
    },
    {
      key: 'bill_number', label: t('expenses.billNo'), sortable: true,
      render: e => <span className="text-xs text-slate-400 font-mono">{e.bill_number || '—'}</span>,
    },
    {
      key: 'tds', label: t('expenses.tds'),
      render: e => e.tds_deducted
        ? <span className="badge-blue">₹{fmtPaise(e.tds_amount_paise ?? 0)}</span>
        : <span className="text-slate-300">—</span>,
    },
    {
      key: 'date', label: t('common.date'), sortable: true,
      render: e => <span className="text-slate-500 text-xs">{new Date(e.bill_date || e.created_at).toLocaleDateString('en-IN')}</span>,
    },
    {
      key: 'type', label: t('expenses.type'),
      filter: {
        kind: 'enum', param: 'credit',
        options: [
          { value: 'false', label: t('expenses.paid') },
          { value: 'true', label: t('expenses.onCredit') },
        ],
      },
      render: e => {
        if (!e.is_on_credit) return <span className="badge-green">{t('expenses.paid')}</span>
        const outstanding = creditOutstanding(e)
        return (
          <div>
            <span className="badge-red">{t('expenses.credit')}</span>
            {outstanding > 0 ? (
              <span className="block text-xs text-red-600 font-semibold mt-0.5">₹{fmtPaise(outstanding)} {t('creditors.due')}</span>
            ) : (
              <span className="block text-xs text-green-600 mt-0.5">{t('creditors.statusPaid')}</span>
            )}
          </div>
        )
      },
    },
    // Actions come from `rowActions` below so this list behaves like every
    // other one: edit stays visible, the rest (including the cheque lifecycle)
    // collapses behind ⋮.
     
  ], [t, categoryNames])

  function rowActions(e: Expense): RowAction[] {
    const actions: RowAction[] = []
    if (e.is_on_credit && e.creditor_id && creditOutstanding(e) > 0) {
      actions.push({ label: t('creditors.recordPayment'), icon: <Landmark size={14} />, primary: true, onClick: () => openPay(e) })
    }
    actions.push({ label: t('expenses.edit'), icon: <Pencil size={14} />, primary: true, onClick: () => openEdit(e) })
    actions.push(...chequeActions(e))
    actions.push({
      label: t('expenses.delete'), icon: <Trash2 size={13} />, danger: true,
      onClick: () => deleteExpense(e.id), disabled: deleteId === e.id,
    })
    return actions
  }

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit) })
    if (search) params.set('q', search)
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    if (sort) params.set('sort', `${sort.key}:${sort.dir}`)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, search, range, filterState, sort])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/expenses?${buildParams(PAGE_SIZE, page)}`)
      setExpenses(data.data || [])
      setMeta(data.meta || null)
    } catch {
      setExpenses([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }

  function resetPageAnd<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1) }
  }

  const stats: SummaryStat[] = meta ? [
    {
      label: t('expenses.totalAmount'),
      value: `₹${fmtPaise(meta.total_amount_paise)}`,
      deltaPct: deltaPct(meta.total_amount_paise, meta.prev_period_amount_paise),
      sub: t('kit.vsPrevPeriodSub'),
      tone: 'expense',
      invert: true,
    },
    { label: t('expenses.totalExpenses'), value: String(meta.total) },
  ] : []

  async function fetchAllFiltered(): Promise<Expense[]> {
    const { data } = await api.get(`/expenses?${buildParams(1000)}`)
    return data.data || []
  }

  async function exportExcel() {
    try {
      const rows = await fetchAllFiltered()
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('reports.expenseRegister'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'expense-register',
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('expenses.description'), width: 30 },
          { header: t('expenses.vendor'), width: 22 },
          { header: t('expenses.category') },
          { header: t('common.amount'), type: 'money' },
          { header: 'GST', type: 'money' },
          { header: t('expenses.mode'), width: 10 },
          { header: t('expenses.billNo'), width: 14 },
          { header: t('expenses.tds'), type: 'money' },
          { header: t('expenses.type'), width: 10 },
        ],
        rows: rows.map(e => [
          (e.bill_date || e.created_at || '').slice(0, 10), e.description ?? '', e.vendor_name ?? '',
          e.category ?? '', e.amount_paise, e.gst_paid_paise ?? 0, e.payment_mode,
          e.bill_number ?? '', e.tds_deducted ? (e.tds_amount_paise ?? 0) : 0,
          e.is_on_credit ? t('expenses.credit') : t('expenses.paid'),
        ]),
        totals: [
          t('kit.total'), '', '', '',
          rows.reduce((s, e) => s + e.amount_paise, 0),
          rows.reduce((s, e) => s + (e.gst_paid_paise ?? 0), 0),
          '', '', '', '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  async function exportPdf() {
    try {
      const rows = await fetchAllFiltered()
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      const total = rows.reduce((s, e) => s + e.amount_paise, 0)
      downloadRowsPdf('expenses.pdf', 'Expense Register',
        ['Date', 'Description', 'Vendor', 'Category', 'Amount', 'GST', 'Mode', 'Bill No', 'TDS', 'Credit'],
        rows.map(e => [
          (e.bill_date || e.created_at || '').slice(0, 10), e.description ?? '', e.vendor_name ?? '',
          e.category ?? '', rsFmt(e.amount_paise), rsFmt(e.gst_paid_paise ?? 0), e.payment_mode,
          e.bill_number ?? '', e.tds_deducted ? rsFmt(e.tds_amount_paise ?? 0) : '', e.is_on_credit ? 'Yes' : 'No',
        ]),
        {
          subtitle: rangeCaption(range, t('dateRange.all')),
          landscape: true,
          totals: ['Total', '', '', '', rsFmt(total), '', '', '', '', ''],
        })
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function openEdit(e: Expense) {
    setEditModal(e)
    setEditForm({
      description: e.description || '',
      amount_paise: String(e.amount_paise / 100),
      bill_number: e.bill_number || '',
    })
  }

  async function saveEdit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!editModal) return
    setSaving(true)
    try {
      await api.patch(`/expenses/${editModal.id}`, {
        description: editForm.description,
        amount_paise: parsePaise(editForm.amount_paise),
        bill_number: editForm.bill_number || undefined,
      })
      setEditModal(null)
      toast.success(t('expenses.updateSuccess'))
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message || t('expenses.updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteExpense(id: string) {
    if (!(await confirm({ title: t('expenses.delete'), message: t('expenses.deleteConfirm'), confirmLabel: t('expenses.delete'), danger: true }))) return
    setDeleteId(id)
    try {
      await api.delete(`/expenses/${id}`)
      toast.success(t('expenses.deleteSuccess'))
      load()
    } catch {
      toast.error(t('expenses.deleteFailed'))
    } finally {
      setDeleteId(null)
    }
  }

  const graphData = (meta?.day_totals ?? []).map(d => ({
    label: new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    value: d.amount_paise / 100,
  }))

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.expenseRegister')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('expenses.title')}</h1>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigate('/expenses/recurring')} className="text-sm text-brand-blue hover:underline">
            {t('expenses.recurringLink')}
          </button>
          <button type="button" onClick={() => navigate('/expenses/add')} className="btn-primary btn-sm">
            <Plus size={14} /> {t('expenses.newExpense')}
          </button>
        </div>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="expenses" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="expenses-list"
        columns={columns}
        rows={expenses}
        rowKey={e => e.id}
        loading={loading}
        searchValue={search}
        onSearchChange={resetPageAnd(setSearch)}
        searchPlaceholder={t('expenses.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onExportPdf={exportPdf}
        onPrint={() => printCurrentView()}
        graphData={graphData}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
          setPage(1)
        }}
        sort={sort}
        onSortChange={resetPageAnd(setSort)}
        page={page}
        limit={PAGE_SIZE}
        total={meta?.total ?? 0}
        onPageChange={setPage}
        emptyMessage={t('expenses.noExpensesFound')}
        emptyAction={{ label: t('expenses.newExpense'), onClick: () => navigate('/expenses/add') }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
        detailTitle={e => e.description}
        renderDetail={e => <ExpenseDetail expense={e} />}
        rowActions={rowActions}
      />

      {/* Edit modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-4">{t('expenses.editExpense')}</h3>
            <form onSubmit={saveEdit} className="space-y-4">
              <div>
                <label className="form-label">{t('expenses.descriptionRequired')}</label>
                <input className="form-input" value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('expenses.amountLabel')}</label>
                <input type="number" step="0.01" min="0" className="form-input" value={editForm.amount_paise}
                  onChange={e => setEditForm(f => ({ ...f, amount_paise: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('expenses.billReceiptNo')}</label>
                <input className="form-input" value={editForm.bill_number}
                  onChange={e => setEditForm(f => ({ ...f, bill_number: e.target.value }))} />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay-off modal for credit expenses — records a real cash/bank outflow via the same flow as Creditors. */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('creditors.recordPayment')}</h3>
            <p className="text-sm text-slate-500 mb-4">{t('creditors.outstandingLabel', { amount: fmtPaise(payModal.outstanding) })}</p>
            <form onSubmit={submitPay} className="space-y-4">
              <div>
                <label className="form-label">{t('creditors.paymentAmount')}</label>
                <input
                  type="number" step="0.01" min="0.01" max={(payModal.outstanding / 100).toFixed(2)}
                  className="form-input" placeholder="0.00" autoFocus required
                  value={payAmt} onChange={e => { setPayAmt(e.target.value); setPayError('') }}
                />
                <button type="button" className="mt-1 text-xs text-brand-red hover:underline"
                  onClick={() => setPayAmt((payModal.outstanding / 100).toFixed(2))}>
                  {t('creditors.payFullOutstanding', { amount: fmtPaise(payModal.outstanding) })}
                </button>
              </div>
              <div>
                <label className="form-label">{t('creditors.paymentMode')}</label>
                <select className="form-input" value={payMode} onChange={e => { setPayMode(e.target.value as PayMode); setPayError('') }}>
                  <option value="cash">{t('common.cash')}</option>
                  <option value="upi">{t('common.upi')}</option>
                  <option value="cheque">{t('common.cheque')}</option>
                  <option value="netbanking">{t('common.netbanking')}</option>
                </select>
              </div>
              {payMode !== 'cash' && (
                <div>
                  <label className="form-label">{t('creditors.bankAccount')}</label>
                  <select className="form-input" value={payAccountId} onChange={e => { setPayAccountId(e.target.value); setPayError('') }}>
                    <option value="">{t('creditors.selectAccount')}</option>
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              {payError && <p className="text-sm text-red-600">{payError}</p>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setPayModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={paying} className="btn-success">{paying ? t('creditors.recording') : t('creditors.recordPayment')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {bounceModal}
    </div>
  )
}
