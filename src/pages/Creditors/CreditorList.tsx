import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, fmtPaise, parsePaise, todayIst } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState, type SortState, type RowAction,
} from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { Creditor } from '../../types'

type PayMode = 'cash' | 'upi' | 'cheque' | 'netbanking'

interface PayModal {
  id: string
  vendorName: string
  outstanding: number
  currentPaid: number
}

interface AddModal {
  open: boolean
  vendor_name: string
  description: string
  amount: string
  due_date: string
}

interface Account { id: string; name: string; type: string }

// Payables are a short register — load them in one go (API cap) so the
// outstanding total reflects every entry, and let the table paginate visually.
const FETCH_LIMIT = 200

export function CreditorList() {
  const { t } = useTranslation()
  const toast = useToast()
  const [creditors, setCreditors] = useState<Creditor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [sort, setSort] = useState<SortState | undefined>()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [payModal, setPayModal] = useState<PayModal | null>(null)
  const [payAmt, setPayAmt] = useState('')
  const [payMode, setPayMode] = useState<PayMode>('cash')
  const [payAccountId, setPayAccountId] = useState('')
  const [paying, setPaying] = useState(false)
  const [addModal, setAddModal] = useState<AddModal>({
    open: false, vendor_name: '', description: '', amount: '', due_date: '',
  })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const statusLabel: Record<string, string> = {
    pending: t('creditors.statusPending'),
    partially_paid: t('creditors.statusPartial'),
    paid: t('creditors.statusPaid'),
  }

  // Generic resource API: single sort column + order.
  const sortColumn: Record<string, string> = {
    original: 'original_amount_paise',
    due_date: 'due_date',
  }

  const columns: ColumnDef<Creditor>[] = useMemo(() => [
    {
      key: 'vendor', label: t('creditors.vendorPayee'),
      render: c => <span className="font-medium">{c.vendor_name || '—'}</span>,
    },
    {
      key: 'description', label: t('creditors.description'),
      render: c => <span className="text-slate-600">{c.description}</span>,
    },
    {
      key: 'original', label: t('creditors.original'), align: 'right', sortable: true,
      render: c => <>₹{fmtPaise(c.original_amount_paise)}</>,
    },
    {
      key: 'paid', label: t('creditors.paid'), align: 'right',
      render: c => <span className="text-green-700">₹{fmtPaise(c.paid_amount_paise)}</span>,
    },
    {
      key: 'outstanding', label: t('creditors.outstanding'), align: 'right',
      render: c => {
        const outstanding = c.original_amount_paise - c.paid_amount_paise
        return (
          <span className={outstanding > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
            ₹{fmtPaise(outstanding)}
          </span>
        )
      },
    },
    {
      key: 'due_date', label: t('creditors.dueDate'), sortable: true,
      render: c => {
        const age = ageDaysOf(c)
        return (
          <div>
            <span className="text-xs text-slate-400">
              {c.due_date ? new Date(c.due_date).toLocaleDateString('en-IN') : '—'}
            </span>
            {c.status !== 'paid' && age > 30 && (
              <span className={`block text-xs font-semibold ${age > 60 ? 'text-red-600' : 'text-amber-600'}`}>
                {t('creditors.daysCount', { count: age })}
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'status', label: t('creditors.status'),
      filter: {
        kind: 'enum', param: 'status',
        options: (['pending', 'partially_paid', 'paid'] as const).map(s => ({ value: s, label: statusLabel[s] })),
      },
      render: c => c.status === 'paid'
        ? <span className="badge-green">{t('creditors.statusPaid')}</span>
        : c.status === 'partially_paid'
        ? <span className="badge-yellow">{t('creditors.statusPartial')}</span>
        : <span className="badge-red">{t('creditors.statusPending')}</span>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

  useEffect(() => { load() }, [search, filterState, sort])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(FETCH_LIMIT) })
      if (search) params.set('q', search)
      if (sort && sortColumn[sort.key]) {
        params.set('sort', sortColumn[sort.key])
        params.set('order', sort.dir)
      }
      for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
      const [cr, ac] = await Promise.all([
        api.get(`/creditors?${params}`),
        api.get('/accounts?is_active=true'),
      ])
      setCreditors(cr.data.data || [])
      setAccounts(ac.data.data || [])
    } catch {
      setCreditors([])
    } finally {
      setLoading(false)
    }
  }

  const bankAccounts = accounts.filter(a => a.type !== 'cash')
  const totalOutstanding = creditors.reduce((s, c) => s + (c.original_amount_paise - c.paid_amount_paise), 0)
  const openEntries = creditors.filter(c => c.status !== 'paid').length
  const ageDaysOf = (c: Creditor) => Math.max(0, Math.floor((Date.now() - new Date(c.due_date || c.created_at).getTime()) / 86_400_000))
  const oldestAge = creditors.filter(c => c.status !== 'paid').reduce((max, c) => Math.max(max, ageDaysOf(c)), 0)
  const overdue60 = creditors
    .filter(c => c.status !== 'paid' && ageDaysOf(c) > 60)
    .reduce((s, c) => s + (c.original_amount_paise - c.paid_amount_paise), 0)

  const stats: SummaryStat[] = [
    { label: t('creditors.totalOutstanding'), value: `₹${fmtPaise(totalOutstanding)}`, tone: 'expense' },
    { label: t('creditors.openEntries'), value: String(openEntries) },
    { label: t('reports.aging60plus'), value: `₹${fmtPaise(overdue60)}`, tone: overdue60 > 0 ? 'expense' : 'default' },
    { label: t('creditors.oldestBill'), value: openEntries ? t('creditors.daysCount', { count: oldestAge }) : '—' },
  ]

  async function exportExcel() {
    if (!creditors.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('creditors.title'),
        filename: 'creditors',
        columns: [
          { header: t('creditors.vendorPayee'), width: 24 },
          { header: t('creditors.description'), width: 30 },
          { header: t('creditors.original'), type: 'money' },
          { header: t('creditors.paid'), type: 'money' },
          { header: t('creditors.outstanding'), type: 'money' },
          { header: t('creditors.dueDate'), type: 'date' },
          { header: t('creditors.status'), width: 14 },
        ],
        rows: creditors.map(c => [
          c.vendor_name ?? '', c.description ?? '',
          c.original_amount_paise, c.paid_amount_paise,
          c.original_amount_paise - c.paid_amount_paise,
          c.due_date ? new Date(c.due_date).toLocaleDateString('en-IN') : '',
          statusLabel[c.status] ?? c.status,
        ]),
        totals: [
          t('kit.total'), '',
          creditors.reduce((s, c) => s + c.original_amount_paise, 0),
          creditors.reduce((s, c) => s + c.paid_amount_paise, 0),
          totalOutstanding, '', '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function openPayModal(c: Creditor) {
    const outstanding = c.original_amount_paise - c.paid_amount_paise
    setPayModal({ id: c.id, vendorName: c.vendor_name || 'Unknown', outstanding, currentPaid: c.paid_amount_paise })
    setPayAmt('')
    setPayMode('cash')
    setPayAccountId('')
    setError('')
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!payModal) return
    const payPaise = parsePaise(payAmt)
    if (!payPaise || payPaise <= 0) { setError(t('creditors.enterValidAmount')); return }
    if (payPaise > payModal.outstanding) { setError(t('creditors.cannotExceedOutstanding', { amount: fmtPaise(payModal.outstanding) })); return }
    if (payMode !== 'cash' && !payAccountId) { setError(t('creditors.selectBankAccountError')); return }
    setPaying(true)
    setError('')
    try {
      // Dedicated pay endpoint records a real cash/bank outflow (updates the
      // Cash/Bank Book & Balance Sheet), unlike the old generic PATCH.
      await api.post(`/creditors/${payModal.id}/pay`, {
        amount_paise: payPaise,
        payment_mode: payMode,
        payment_account_id: payMode === 'cash' ? undefined : payAccountId,
        payment_date: todayIst(),
      })
      setPayModal(null)
      toast.success(t('creditors.paymentRecorded'))
      load()
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e2.response?.data?.error?.message || 'Payment failed. Please try again.')
    } finally {
      setPaying(false)
    }
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    setError('')
    try {
      await api.post('/creditors', {
        vendor_name: addModal.vendor_name,
        description: addModal.description,
        original_amount_paise: parsePaise(addModal.amount),
        due_date: addModal.due_date || null,
        status: 'pending',
      })
      setAddModal({ open: false, vendor_name: '', description: '', amount: '', due_date: '' })
      toast.success(t('creditors.entryAdded'))
      load()
    } catch {
      setError(t('creditors.failedToAddEntry'))
    } finally {
      setAdding(false)
    }
  }

  function rowActions(c: Creditor): RowAction[] {
    // A settled creditor has nothing left to act on.
    if (c.status === 'paid') return []
    return [{ label: t('creditors.pay'), primary: true, onClick: () => openPayModal(c) }]
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('creditors.title')} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('creditors.title')}</h1>
        <button onClick={() => setAddModal(a => ({ ...a, open: true }))} className="btn-primary btn-sm">
          <Plus size={14} /> {t('creditors.addEntry')}
        </button>
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="creditors-list"
        columns={columns}
        rows={creditors}
        rowKey={c => c.id}
        rowActions={rowActions}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('creditors.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
        }}
        sort={sort}
        onSortChange={setSort}
        page={1}
        limit={FETCH_LIMIT}
        total={creditors.length}
        onPageChange={() => {}}
        emptyMessage={t('creditors.noEntriesFound')}
        emptyAction={{ label: t('creditors.addEntry'), onClick: () => setAddModal(a => ({ ...a, open: true })) }}
        onClearFilters={() => setFilterState({})}
      />

      {/* Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-navy-900">{t('creditors.recordPayment')}</h2>
              <button onClick={() => setPayModal(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitPayment} className="p-6 space-y-4">
              <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
                <p className="text-slate-500">{t('creditors.vendorLabel', { name: payModal.vendorName })}</p>
                <p className="text-slate-500">{t('creditors.outstandingLabel', { amount: fmtPaise(payModal.outstanding) })}</p>
              </div>
              <div>
                <label className="form-label">{t('creditors.paymentAmount')}</label>
                <input
                  type="number" step="0.01" min="0.01"
                  max={(payModal.outstanding / 100).toFixed(2)}
                  className="form-input" placeholder="0.00"
                  value={payAmt}
                  onChange={e => { setPayAmt(e.target.value); setError('') }}
                  autoFocus required
                />
                <button type="button" className="mt-1 text-xs text-brand-red hover:underline"
                  onClick={() => setPayAmt((payModal.outstanding / 100).toFixed(2))}>
                  {t('creditors.payFullOutstanding', { amount: fmtPaise(payModal.outstanding) })}
                </button>
              </div>
              <div>
                <label className="form-label">{t('creditors.paymentMode')}</label>
                <select className="form-input" value={payMode}
                  onChange={e => { setPayMode(e.target.value as PayMode); setError('') }}>
                  <option value="cash">{t('common.cash')}</option>
                  <option value="upi">{t('common.upi')}</option>
                  <option value="cheque">{t('common.cheque')}</option>
                  <option value="netbanking">{t('common.netbanking')}</option>
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  {payMode === 'cash' ? t('creditors.paidFromCash') : t('creditors.paidFromBank')}
                </p>
              </div>
              {payMode !== 'cash' && (
                <div>
                  <label className="form-label">{t('creditors.bankAccount')}</label>
                  <select className="form-input" value={payAccountId}
                    onChange={e => { setPayAccountId(e.target.value); setError('') }}>
                    <option value="">{t('creditors.selectAccount')}</option>
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setPayModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={paying} className="btn-success">
                  {paying ? t('creditors.recording') : t('creditors.recordPayment')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Creditor Entry Modal */}
      {addModal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-navy-900">{t('creditors.addCreditorEntry')}</h2>
              <button onClick={() => setAddModal(a => ({ ...a, open: false }))} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitAdd} className="p-6 space-y-4">
              <div>
                <label className="form-label">{t('creditors.vendorPayeeName')}</label>
                <input className="form-input" value={addModal.vendor_name}
                  onChange={e => setAddModal(a => ({ ...a, vendor_name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('creditors.description')} *</label>
                <input className="form-input" value={addModal.description} placeholder={t('creditors.descriptionPlaceholder')}
                  onChange={e => setAddModal(a => ({ ...a, description: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('creditors.amountLabel')}</label>
                <input type="number" step="0.01" min="1" className="form-input" value={addModal.amount}
                  onChange={e => setAddModal(a => ({ ...a, amount: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('creditors.dueDate')}</label>
                <input type="date" className="form-input" value={addModal.due_date}
                  onChange={e => setAddModal(a => ({ ...a, due_date: e.target.value }))} />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setAddModal(a => ({ ...a, open: false }))} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={adding} className="btn-primary">
                  {adding ? t('donors.adding') : t('creditors.addEntry')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
