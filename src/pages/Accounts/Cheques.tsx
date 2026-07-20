import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Landmark, CheckCircle2, XCircle as BounceIcon } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState,
} from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { Donation, Expense } from '../../types'

const PAGE_SIZE = 20
type ReceivedStatus = 'received' | 'deposited' | 'cleared' | 'bounced'
type IssuedStatus = 'issued' | 'cleared' | 'bounced'
const RECEIVED_STATUSES: ReceivedStatus[] = ['received', 'deposited', 'cleared', 'bounced']
const ISSUED_STATUSES: IssuedStatus[] = ['issued', 'cleared', 'bounced']

interface Account { id: string; name: string; type: string }

export function Cheques() {
  const { t } = useTranslation()
  const toast = useToast()
  const [direction, setDirection] = useState<'received' | 'issued'>('received')

  const receivedLabel: Record<ReceivedStatus, string> = {
    received: t('cheques.statusReceived'), deposited: t('cheques.statusDeposited'),
    cleared: t('cheques.statusCleared'), bounced: t('cheques.statusBounced'),
  }
  const issuedLabel: Record<IssuedStatus, string> = {
    issued: t('cheques.statusIssued'), cleared: t('cheques.statusCleared'), bounced: t('cheques.statusBounced'),
  }
  const statusBadge: Record<string, string> = {
    received: 'badge-yellow', issued: 'badge-yellow', deposited: 'badge-blue', cleared: 'badge-green', bounced: 'badge-red',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('cheques.title')}</h1>
      </div>

      <div className="flex gap-1 border-b border-slate-200 no-print">
        {(['received', 'issued'] as const).map(d => (
          <button
            key={d} type="button" onClick={() => setDirection(d)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              direction === d ? 'border-brand-red text-brand-red' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {d === 'received' ? t('cheques.tabReceived') : t('cheques.tabIssued')}
          </button>
        ))}
      </div>

      {direction === 'received' ? (
        <ReceivedCheques statusLabel={receivedLabel} statusBadge={statusBadge} t={t} toast={toast} />
      ) : (
        <IssuedCheques statusLabel={issuedLabel} statusBadge={statusBadge} t={t} toast={toast} />
      )}
    </div>
  )
}

// ── Received (donor) cheques — received -> deposited -> cleared, or bounced ─

function ReceivedCheques({ statusLabel, statusBadge, t, toast }: {
  statusLabel: Record<ReceivedStatus, string>
  statusBadge: Record<string, string>
  t: (k: string, o?: Record<string, unknown>) => string
  toast: ReturnType<typeof useToast>
}) {
  const [rows, setRows] = useState<Donation[]>([])
  const [meta, setMeta] = useState<{ total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('cheques-received', 'thisMonth'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [accounts, setAccounts] = useState<Account[]>([])

  const [depositModal, setDepositModal] = useState<{ id: string; invoiceNo: string } | null>(null)
  const [depositAccountId, setDepositAccountId] = useState('')
  const [depositDate, setDepositDate] = useState(new Date().toISOString().slice(0, 10))
  const [depositing, setDepositing] = useState(false)

  const [bounceModal, setBounceModal] = useState<{ id: string; invoiceNo: string } | null>(null)
  const [bounceReason, setBounceReason] = useState('')
  const [bouncing, setBouncing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const bankAccounts = accounts.filter(a => a.type !== 'cash')

  useEffect(() => {
    api.get('/accounts?is_active=true').then(r => setAccounts(r.data.data || [])).catch(() => {})
  }, [])

  const columns: ColumnDef<Donation>[] = useMemo(() => [
    { key: 'date', label: t('common.date'), sortable: true, render: d => <span className="text-xs text-slate-500">{new Date(d.created_at).toLocaleDateString('en-IN')}</span> },
    { key: 'invoice', label: t('donations.invoiceNo'), render: d => <span className="font-mono text-xs text-brand-blue">{d.invoice_no}</span> },
    { key: 'donor', label: t('donations.donor'), render: d => <span className="font-medium">{d.donor_name || '—'}</span> },
    { key: 'cheque_no', label: t('cheques.chequeNo'), render: d => <span className="font-mono text-xs">{d.cheque_number || '—'}</span> },
    { key: 'bank', label: t('cheques.bank'), render: d => <span className="text-slate-600">{d.cheque_bank || '—'}</span> },
    { key: 'cheque_date', label: t('cheques.chequeDate'), render: d => <span className="text-xs text-slate-400">{d.cheque_date ? new Date(d.cheque_date).toLocaleDateString('en-IN') : '—'}</span> },
    { key: 'amount', label: t('common.amount'), align: 'right', sortable: true, render: d => <span className="font-semibold">₹{fmtPaise(d.amount_paise)}</span> },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'cheque_status', options: RECEIVED_STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: d => {
        const s = (d.cheque_status ?? 'received') as ReceivedStatus
        return d.is_voided ? <span className="badge-red">{t('donations.voided')}</span> : <span className={statusBadge[s]}>{statusLabel[s]}</span>
      },
    },
    {
      key: 'actions', label: t('common.actions'),
      render: d => {
        if (d.is_voided) return null
        const s = (d.cheque_status ?? 'received') as ReceivedStatus
        if (s === 'received') {
          return <button type="button" onClick={() => openDeposit(d)} className="btn-secondary btn-sm !text-xs"><Landmark size={12} /> {t('cheques.deposit')}</button>
        }
        if (s === 'deposited') {
          return (
            <div className="flex gap-1">
              <button type="button" onClick={() => markCleared(d)} disabled={busyId === d.id} className="p-1 text-slate-400 hover:text-green-600 rounded" title={t('cheques.markCleared')} aria-label={t('cheques.markCleared')}><CheckCircle2 size={16} /></button>
              <button type="button" onClick={() => openBounce(d)} className="p-1 text-slate-400 hover:text-red-600 rounded" title={t('cheques.markBounced')} aria-label={t('cheques.markBounced')}><BounceIcon size={16} /></button>
            </div>
          )
        }
        return null
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, busyId])

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit), payment_mode: 'cheque' })
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, range, filterState])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/donations?${buildParams(PAGE_SIZE, page)}`)
      setRows(data.data || [])
      setMeta(data.meta || null)
    } catch { setRows([]); setMeta(null) } finally { setLoading(false) }
  }

  function resetPageAnd<T>(setter: (v: T) => void) { return (v: T) => { setter(v); setPage(1) } }

  const pendingClearance = rows.filter(d => !d.is_voided && (d.cheque_status === 'received' || d.cheque_status === 'deposited'))
  const stats: SummaryStat[] = [
    { label: t('cheques.pendingClearance'), value: `₹${fmtPaise(pendingClearance.reduce((s, d) => s + d.amount_paise, 0))}`, sub: t('cheques.pendingCount', { count: pendingClearance.length }) },
    { label: t('cheques.statusReceived'), value: String(rows.filter(d => d.cheque_status === 'received' && !d.is_voided).length) },
    { label: t('cheques.statusDeposited'), value: String(rows.filter(d => d.cheque_status === 'deposited' && !d.is_voided).length) },
    { label: t('cheques.statusBounced'), value: String(rows.filter(d => d.cheque_status === 'bounced').length), tone: 'expense' },
  ]

  async function exportExcel() {
    try {
      const { data } = await api.get(`/donations?${buildParams(1000)}`)
      const all: Donation[] = data.data || []
      if (!all.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: `${t('cheques.title')} — ${t('cheques.tabReceived')}`,
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'cheques-received',
        columns: [
          { header: t('common.date'), type: 'date' }, { header: t('donations.invoiceNo') },
          { header: t('donations.donor'), width: 24 }, { header: t('cheques.chequeNo'), width: 14 },
          { header: t('cheques.bank'), width: 18 }, { header: t('cheques.chequeDate'), type: 'date' },
          { header: t('common.amount'), type: 'money' }, { header: t('common.status'), width: 12 },
        ],
        rows: all.map(d => [
          new Date(d.created_at).toLocaleDateString('en-IN'), d.invoice_no, d.donor_name ?? '',
          d.cheque_number ?? '', d.cheque_bank ?? '', d.cheque_date ? new Date(d.cheque_date).toLocaleDateString('en-IN') : '',
          d.amount_paise, d.is_voided ? t('donations.voided') : statusLabel[(d.cheque_status ?? 'received') as ReceivedStatus],
        ]),
        totals: [t('kit.total'), '', '', '', '', '', all.reduce((s, d) => s + d.amount_paise, 0), ''],
      })
      toast.success(t('kit.exportReady'))
    } catch { toast.error(t('kit.exportFailed')) }
  }

  function openDeposit(d: Donation) {
    setDepositModal({ id: d.id, invoiceNo: d.invoice_no })
    setDepositAccountId(bankAccounts[0]?.id ?? '')
    setDepositDate(new Date().toISOString().slice(0, 10))
  }
  async function submitDeposit(e: React.FormEvent) {
    e.preventDefault()
    if (!depositModal) return
    setDepositing(true)
    try {
      await api.patch(`/donations/${depositModal.id}/cheque/deposit`, { account_id: depositAccountId || undefined, deposited_at: depositDate })
      setDepositModal(null)
      toast.success(t('cheques.depositSuccess'))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('cheques.depositFailed'))
    } finally { setDepositing(false) }
  }
  async function markCleared(d: Donation) {
    setBusyId(d.id)
    try {
      await api.patch(`/donations/${d.id}/cheque/clear`, {})
      toast.success(t('cheques.clearSuccess'))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('cheques.clearFailed'))
    } finally { setBusyId(null) }
  }
  function openBounce(d: Donation) { setBounceModal({ id: d.id, invoiceNo: d.invoice_no }); setBounceReason('') }
  async function submitBounce() {
    if (!bounceModal || !bounceReason.trim()) return
    setBouncing(true)
    try {
      await api.patch(`/donations/${bounceModal.id}/cheque/bounce`, { reason: bounceReason })
      setBounceModal(null)
      toast.success(t('cheques.bounceSuccess', { invoiceNo: bounceModal.invoiceNo }))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('cheques.bounceFailed'))
    } finally { setBouncing(false) }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={`${t('cheques.title')} — ${t('cheques.tabReceived')}`} subtitle={rangeCaption(range, t('dateRange.all'))} />
      <div className="no-print"><DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="cheques-received" /></div>
      <SummaryStrip stats={stats} />
      <DataTable
        viewKey="cheques-received-list"
        columns={columns}
        rows={rows}
        rowKey={d => d.id}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => { const next = { ...prev }; if (s) next[key] = s; else delete next[key]; return next })
          setPage(1)
        }}
        page={page} limit={PAGE_SIZE} total={meta?.total ?? 0} onPageChange={setPage}
        emptyMessage={t('cheques.noCheques')}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />

      {depositModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('cheques.depositTitle')}</h3>
            <p className="text-sm text-slate-500 mb-4">{t('cheques.depositSubtitle', { invoiceNo: depositModal.invoiceNo })}</p>
            <form onSubmit={submitDeposit} className="space-y-4">
              <div>
                <label className="form-label">{t('cheques.depositTo')}</label>
                <select className="form-select" value={depositAccountId} onChange={e => setDepositAccountId(e.target.value)} required>
                  <option value="">{t('creditors.selectAccount')}</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">{t('cheques.depositDate')}</label>
                <input type="date" className="form-input" value={depositDate} onChange={e => setDepositDate(e.target.value)} required />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setDepositModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={depositing || !depositAccountId} className="btn-primary">{depositing ? t('common.saving') : t('cheques.deposit')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bounceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('cheques.bounceTitle')}</h3>
            <p className="text-sm text-slate-500 mb-4">{t('cheques.bounceWarning', { invoiceNo: bounceModal.invoiceNo })}</p>
            <div className="mb-4">
              <label className="form-label">{t('donations.reasonForVoiding')}</label>
              <textarea className="form-input" rows={3} value={bounceReason} onChange={e => setBounceReason(e.target.value)} placeholder={t('cheques.bounceReasonPlaceholder')} />
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setBounceModal(null)} className="btn-secondary">{t('common.cancel')}</button>
              <button type="button" onClick={submitBounce} disabled={!bounceReason.trim() || bouncing} className="btn-danger">{bouncing ? t('common.saving') : t('cheques.markBounced')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Issued (vendor) cheques — issued -> cleared, or bounced (no deposit step: the vendor deposits it, not us) ─

function IssuedCheques({ statusLabel, statusBadge, t, toast }: {
  statusLabel: Record<IssuedStatus, string>
  statusBadge: Record<string, string>
  t: (k: string, o?: Record<string, unknown>) => string
  toast: ReturnType<typeof useToast>
}) {
  const [rows, setRows] = useState<Expense[]>([])
  const [meta, setMeta] = useState<{ total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('cheques-issued', 'thisMonth'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const [bounceModal, setBounceModal] = useState<{ id: string; description: string } | null>(null)
  const [bounceReason, setBounceReason] = useState('')
  const [bouncing, setBouncing] = useState(false)

  const columns: ColumnDef<Expense>[] = useMemo(() => [
    { key: 'date', label: t('common.date'), sortable: true, render: e => <span className="text-xs text-slate-500">{new Date(e.bill_date || e.created_at).toLocaleDateString('en-IN')}</span> },
    { key: 'description', label: t('expenses.description'), render: e => <span className="font-medium">{e.description}</span> },
    { key: 'vendor', label: t('expenses.vendor'), render: e => <span className="text-slate-600">{e.vendor_name || '—'}</span> },
    { key: 'cheque_no', label: t('cheques.chequeNo'), render: e => <span className="font-mono text-xs">{e.cheque_number || '—'}</span> },
    { key: 'bank', label: t('cheques.bank'), render: e => <span className="text-slate-600">{e.cheque_bank || '—'}</span> },
    { key: 'cheque_date', label: t('cheques.chequeDate'), render: e => <span className="text-xs text-slate-400">{e.cheque_date ? new Date(e.cheque_date).toLocaleDateString('en-IN') : '—'}</span> },
    { key: 'amount', label: t('common.amount'), align: 'right', sortable: true, render: e => <span className="font-semibold">₹{fmtPaise(e.amount_paise)}</span> },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'cheque_status', options: ISSUED_STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: e => {
        const s = (e.cheque_status ?? 'issued') as IssuedStatus
        return <span className={statusBadge[s]}>{statusLabel[s]}</span>
      },
    },
    {
      key: 'actions', label: t('common.actions'),
      render: e => {
        const s = (e.cheque_status ?? 'issued') as IssuedStatus
        if (s !== 'issued') return null
        return (
          <div className="flex gap-1">
            <button type="button" onClick={() => markCleared(e)} disabled={busyId === e.id} className="p-1 text-slate-400 hover:text-green-600 rounded" title={t('cheques.markCleared')} aria-label={t('cheques.markCleared')}><CheckCircle2 size={16} /></button>
            <button type="button" onClick={() => openBounce(e)} className="p-1 text-slate-400 hover:text-red-600 rounded" title={t('cheques.markBounced')} aria-label={t('cheques.markBounced')}><BounceIcon size={16} /></button>
          </div>
        )
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, busyId])

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit), payment_mode: 'cheque' })
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, range, filterState])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/expenses?${buildParams(PAGE_SIZE, page)}`)
      setRows(data.data || [])
      setMeta(data.meta || null)
    } catch { setRows([]); setMeta(null) } finally { setLoading(false) }
  }

  function resetPageAnd<T>(setter: (v: T) => void) { return (v: T) => { setter(v); setPage(1) } }

  const pendingClearance = rows.filter(e => e.cheque_status === 'issued')
  const stats: SummaryStat[] = [
    { label: t('cheques.pendingClearance'), value: `₹${fmtPaise(pendingClearance.reduce((s, e) => s + e.amount_paise, 0))}`, sub: t('cheques.pendingCount', { count: pendingClearance.length }) },
    { label: t('cheques.statusIssued'), value: String(rows.filter(e => e.cheque_status === 'issued').length) },
    { label: t('cheques.statusCleared'), value: String(rows.filter(e => e.cheque_status === 'cleared').length) },
    { label: t('cheques.statusBounced'), value: String(rows.filter(e => e.cheque_status === 'bounced').length), tone: 'expense' },
  ]

  async function exportExcel() {
    try {
      const { data } = await api.get(`/expenses?${buildParams(1000)}`)
      const all: Expense[] = data.data || []
      if (!all.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: `${t('cheques.title')} — ${t('cheques.tabIssued')}`,
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'cheques-issued',
        columns: [
          { header: t('common.date'), type: 'date' }, { header: t('expenses.description'), width: 26 },
          { header: t('expenses.vendor'), width: 22 }, { header: t('cheques.chequeNo'), width: 14 },
          { header: t('cheques.bank'), width: 18 }, { header: t('cheques.chequeDate'), type: 'date' },
          { header: t('common.amount'), type: 'money' }, { header: t('common.status'), width: 12 },
        ],
        rows: all.map(e => [
          new Date(e.bill_date || e.created_at).toLocaleDateString('en-IN'), e.description, e.vendor_name ?? '',
          e.cheque_number ?? '', e.cheque_bank ?? '', e.cheque_date ? new Date(e.cheque_date).toLocaleDateString('en-IN') : '',
          e.amount_paise, statusLabel[(e.cheque_status ?? 'issued') as IssuedStatus],
        ]),
        totals: [t('kit.total'), '', '', '', '', '', all.reduce((s, e) => s + e.amount_paise, 0), ''],
      })
      toast.success(t('kit.exportReady'))
    } catch { toast.error(t('kit.exportFailed')) }
  }

  async function markCleared(e: Expense) {
    setBusyId(e.id)
    try {
      await api.patch(`/expenses/${e.id}/cheque/clear`, {})
      toast.success(t('cheques.clearSuccess'))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('cheques.clearFailed'))
    } finally { setBusyId(null) }
  }
  function openBounce(e: Expense) { setBounceModal({ id: e.id, description: e.description }); setBounceReason('') }
  async function submitBounce() {
    if (!bounceModal) return
    setBouncing(true)
    try {
      await api.patch(`/expenses/${bounceModal.id}/cheque/bounce`, { reason: bounceReason || undefined })
      setBounceModal(null)
      toast.success(t('cheques.issuedBounceSuccess'))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('cheques.bounceFailed'))
    } finally { setBouncing(false) }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={`${t('cheques.title')} — ${t('cheques.tabIssued')}`} subtitle={rangeCaption(range, t('dateRange.all'))} />
      <div className="no-print"><DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="cheques-issued" /></div>
      <SummaryStrip stats={stats} />
      <DataTable
        viewKey="cheques-issued-list"
        columns={columns}
        rows={rows}
        rowKey={e => e.id}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => { const next = { ...prev }; if (s) next[key] = s; else delete next[key]; return next })
          setPage(1)
        }}
        page={page} limit={PAGE_SIZE} total={meta?.total ?? 0} onPageChange={setPage}
        emptyMessage={t('cheques.noCheques')}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />

      {bounceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('cheques.bounceTitle')}</h3>
            <p className="text-sm text-slate-500 mb-4">{t('cheques.issuedBounceWarning', { description: bounceModal.description })}</p>
            <div className="mb-4">
              <label className="form-label">{t('cheques.bounceReasonOptional')}</label>
              <textarea className="form-input" rows={3} value={bounceReason} onChange={e => setBounceReason(e.target.value)} placeholder={t('cheques.bounceReasonPlaceholder')} />
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setBounceModal(null)} className="btn-secondary">{t('common.cancel')}</button>
              <button type="button" onClick={submitBounce} disabled={bouncing} className="btn-danger">{bouncing ? t('common.saving') : t('cheques.markBounced')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
