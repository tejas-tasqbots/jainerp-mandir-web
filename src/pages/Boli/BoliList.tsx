import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, AlertTriangle, Bell, Trash2, X } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { printBoliIntimation } from '../../lib/printBoliIntimation'
import { downloadReport, printCurrentView } from '../../lib/downloadReport'
import { exportXlsx } from '../../lib/exportXlsx'
import { trendByDay } from '../../lib/chartData'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState,
} from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { PaymentSplitInput, emptyPaymentRow, sumPaise, toPayload, type PaymentRow } from '../../components/PaymentSplitInput'
import { useCanDeleteEntries, useDeleteEntry } from '../../components/deleteEntry'
import { usePaymentModes } from '../../lib/useDropdownOptions'
import { printDonationReceipt } from '../../lib/printReceipt'
import type { Boli } from '../../types'

const PAGE_SIZE = 20
const STATUSES = ['pledged', 'partially_paid', 'paid', 'waived'] as const

interface ListMeta {
  total: number
  committed_paise: number
  paid_paise: number
  outstanding_paise: number
}

export function BoliList() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()

  const [bolis, setBolis] = useState<Boli[]>([])
  const [meta, setMeta] = useState<ListMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('boli', 'thisFY'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const [payModal, setPayModal] = useState<{ id: string; name: string; outstanding: number; pledged: number; paid: number; description: string } | null>(null)
  // Tenders, like every other bill: one boli payment may be part cash, part
  // UPI, and every non-cash part carries its UTR / cheque number and the
  // account it reached. The old dialog had a mode dropdown and nothing else,
  // so a UPI collection could not say which transaction it was (2026-10-08).
  const [payRows, setPayRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [payError, setPayError] = useState('')
  const [paying, setPaying] = useState(false)
  const paymentModes = usePaymentModes()
  const canDelete = useCanDeleteEntries()
  const deleteEntry = useDeleteEntry()
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    api.get('/boli-categories', { params: { limit: '200' } })
      .then(r => setCategories(r.data.data ?? [])).catch(() => setCategories([]))
  }, [])
  const [waiveModal, setWaiveModal] = useState<{ id: string; name: string } | null>(null)
  const [waiveReason, setWaiveReason] = useState('')
  const [waiving, setWaiving] = useState(false)
  const [intimating, setIntimating] = useState<string | null>(null)

  function statusBadge(s: string) {
    if (s === 'pledged') return <span className="badge-yellow">{t('pledges.statusPledged')}</span>
    if (s === 'partially_paid') return <span className="badge-blue">{t('pledges.statusPartial')}</span>
    if (s === 'paid') return <span className="badge-green">{t('pledges.statusPaid')}</span>
    if (s === 'waived') return <span className="badge-gray">{t('pledges.statusWaived')}</span>
    return null
  }

  const statusLabel: Record<string, string> = {
    pledged: t('pledges.filterPledged'),
    partially_paid: t('pledges.filterPartiallyPaid'),
    paid: t('pledges.filterPaid'),
    waived: t('pledges.filterWaived'),
  }

  const columns: ColumnDef<Boli>[] = useMemo(() => [
    {
      key: 'donor', label: t('donations.donor'),
      render: b => (
        <div>
          <p className="font-medium">{b.is_anonymous ? t('pledges.anonymous') : b.donor_name}</p>
          {b.donor_mobile && <p className="text-xs text-slate-400">{b.donor_mobile}</p>}
        </div>
      ),
    },
    {
      key: 'category', label: t('pledges.boliType'),
      filter: categories.length
        ? { kind: 'enum', param: 'category_id', options: categories.map(c => ({ value: c.id, label: c.name })) }
        : undefined,
      render: b => <span className="text-xs font-medium text-slate-700">{((i18n.language === 'hi' || i18n.language === 'mr') && b.category_name_hindi) || b.category_name || '—'}</span>,
    },
    {
      key: 'description', label: t('pledges.description'),
      render: b => <span className="text-slate-600 block max-w-[220px] truncate">{b.seva_description || '—'}</span>,
    },
    {
      key: 'event', label: t('pledges.event'),
      render: b => <span className="text-slate-500 text-xs">{b.event_name || '—'}</span>,
    },
    {
      key: 'pledged', label: t('pledges.pledged'), align: 'right',
      filter: { kind: 'amount', gteParam: 'amount_gte', lteParam: 'amount_lte' },
      render: b => <span className="font-semibold">₹{fmtPaise(b.committed_amount_paise)}</span>,
    },
    {
      key: 'paid', label: t('pledges.paid'), align: 'right',
      render: b => <span className="text-green-700">₹{fmtPaise(b.paid_amount_paise)}</span>,
    },
    {
      key: 'outstanding', label: t('pledges.outstanding'), align: 'right',
      render: b => (
        <span className={b.outstanding_paise > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
          ₹{fmtPaise(b.outstanding_paise)}
        </span>
      ),
    },
    {
      key: 'date', label: t('common.date'),
      render: b => (
        <span className="text-xs text-slate-400">
          {b.boli_date ? new Date(b.boli_date).toLocaleDateString('en-IN') : '—'}
        </span>
      ),
    },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: b => statusBadge(b.status),
    },
    {
      key: 'actions', label: t('common.actions'),
      render: b => (
        <div className="flex gap-1 items-center">
          {(b.status === 'pledged' || b.status === 'pending' || b.status === 'partially_paid') && (
            <>
              <button
                type="button"
                onClick={() => openPay(b)}
                className="btn-success btn-sm"
                data-testid="boli-pay"
              >
                {t('pledges.pay')}
              </button>
              <button
                type="button"
                onClick={() => setWaiveModal({ id: b.id, name: b.donor_name })}
                title={t('pledges.waiveOutstanding')} aria-label={t('pledges.waiveOutstanding')}
                className="p-1 text-slate-400 hover:text-yellow-600 rounded"
              >
                <AlertTriangle size={14} />
              </button>
            </>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => removeBoli(b)}
              title={t('pledges.deleteBoli')} aria-label={t('pledges.deleteBoli')}
              className="p-1 text-slate-400 hover:text-red-600 rounded"
              data-testid="boli-delete"
            >
              <Trash2 size={14} />
            </button>
          )}
          {/* Intimation/reminder slip only makes sense while a balance is outstanding. */}
          {b.outstanding_paise > 0 && (
            <button
              type="button"
              onClick={() => openIntimation(b.id)}
              title={t('pledges.printIntimation')} aria-label={t('pledges.printIntimation')}
              disabled={intimating === b.id}
              className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
            >
              <Bell size={14} className={intimating === b.id ? 'animate-pulse' : ''} />
            </button>
          )}
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, i18n.language, intimating, categories, canDelete])

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit) })
    if (search) params.set('q', search)
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, search, range, filterState])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/bolis?${buildParams(PAGE_SIZE, page)}`)
      setBolis(data.data || [])
      setMeta(data.meta || null)
    } catch {
      setBolis([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }

  function resetPageAnd<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1) }
  }

  const stats: SummaryStat[] = meta ? [
    { label: t('pledges.pledged'), value: `₹${fmtPaise(meta.committed_paise)}` },
    { label: t('pledges.collected'), value: `₹${fmtPaise(meta.paid_paise)}`, tone: 'income' },
    { label: t('pledges.outstanding'), value: `₹${fmtPaise(meta.outstanding_paise)}`, tone: 'expense' },
    { label: t('kit.receipts'), value: String(meta.total) },
  ] : []

  async function exportExcel() {
    try {
      const { data } = await api.get(`/bolis?${buildParams(1000)}`)
      const rows: Boli[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('reports.pledgeRegister'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'boli-register',
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
        rows: rows.map(b => [
          b.boli_date ? new Date(b.boli_date).toLocaleDateString('en-IN') : '',
          b.is_anonymous ? t('pledges.anonymous') : (b.donor_name ?? ''),
          b.donor_mobile ?? '', b.seva_description ?? '', b.event_name ?? '',
          b.committed_amount_paise, b.paid_amount_paise, b.outstanding_paise,
          statusLabel[b.status] ?? b.status,
        ]),
        totals: [
          t('kit.total'), '', '', '', '',
          rows.reduce((s, b) => s + b.committed_amount_paise, 0),
          rows.reduce((s, b) => s + b.paid_amount_paise, 0),
          rows.reduce((s, b) => s + b.outstanding_paise, 0),
          '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function openPay(b: Boli) {
    setPayModal({
      id: b.id, name: b.is_anonymous ? t('pledges.anonymous') : b.donor_name, outstanding: b.outstanding_paise,
      pledged: b.committed_amount_paise, paid: b.paid_amount_paise, description: b.seva_description,
    })
    // The whole balance by default: most bolis are settled in one go.
    setPayRows([{ ...emptyPaymentRow(), amount: String(b.outstanding_paise / 100) }])
    setPayError('')
  }

  const refNeeded = (code: string) =>
    paymentModes.find(m => m.code === code)?.requires_reference ?? code !== 'cash'

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!payModal) return
    const total = sumPaise(payRows)
    if (total <= 0) { setPayError(t('pledges.enterAmount')); return }
    if (total > payModal.outstanding) {
      setPayError(t('pledges.moreThanOutstanding', { amount: fmtPaise(payModal.outstanding) }))
      return
    }
    if (payRows.some(r => Number(r.amount) > 0 && refNeeded(r.payment_mode) && !r.reference_no?.trim())) {
      setPayError(t('pledges.utrRequired'))
      return
    }
    setPaying(true)
    setPayError('')
    try {
      const { data } = await api.post(`/bolis/${payModal.id}/payments`, { payments: toPayload(payRows) })
      const res = data.data ?? data
      setPayModal(null)
      toast.success(t('pledges.paymentSuccessNo', { receipt: res?.donation?.receipt_number ?? '' }))
      load()
      // The receipt the donor takes away: this payment and what is still pending.
      if (res?.donation?.id) printDonationReceipt(res.donation.id).catch(() => {})
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      setPayError(ex.response?.data?.error?.message || t('pledges.paymentFailed'))
    } finally {
      setPaying(false)
    }
  }

  async function removeBoli(b: Boli) {
    const done = await deleteEntry({
      kind: 'boli', id: b.id,
      title: b.is_anonymous ? t('pledges.anonymous') : b.donor_name,
      detail: b.seva_description, amountPaise: b.committed_amount_paise, date: b.boli_date,
    })
    if (done) load()
  }

  async function waive(e: React.FormEvent) {
    e.preventDefault()
    if (!waiveModal || !waiveReason.trim()) return
    setWaiving(true)
    try {
      await api.post(`/bolis/${waiveModal.id}/waive`, { reason: waiveReason })
      setWaiveModal(null)
      setWaiveReason('')
      toast.success(t('pledges.waiveSuccess'))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('pledges.waiveFailed'))
    } finally {
      setWaiving(false)
    }
  }

  async function openIntimation(id: string) {
    setIntimating(id)
    try {
      await printBoliIntimation(id)
    } catch {
      toast.error(t('pledges.intimationFailed'))
    } finally {
      setIntimating(null)
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.pledgeRegister')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('pledges.title')}</h1>
        <button type="button" onClick={() => navigate('/boli/add')} className="btn-primary btn-sm">
          <Plus size={14} /> {t('pledges.newPledge')}
        </button>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="boli" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="boli-list"
        columns={columns}
        rows={bolis}
        rowKey={b => b.id}
        loading={loading}
        graphData={trendByDay(bolis, 'boli_date', 'committed_amount_paise')}
        searchValue={search}
        onSearchChange={resetPageAnd(setSearch)}
        searchPlaceholder={t('pledges.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onExportPdf={() => downloadReport('boli-register', {}, 'pdf')}
        onPrint={() => printCurrentView()}
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
        page={page}
        limit={PAGE_SIZE}
        total={meta?.total ?? 0}
        onPageChange={setPage}
        emptyMessage={t('pledges.noPledgesFound')}
        emptyAction={{ label: t('pledges.newPledge'), onClick: () => navigate('/boli/add') }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />

      {/* Payment modal */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-xl mx-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-navy-900">{t('pledges.recordPayment')}</h3>
                <p className="text-sm text-slate-500">{payModal.name} · {payModal.description}</p>
              </div>
              <button type="button" onClick={() => setPayModal(null)} aria-label={t('common.close')} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4 text-sm">
              <div className="rounded border border-slate-200 p-2"><p className="text-xs text-slate-500">{t('pledges.pledged')}</p><p className="font-semibold">₹{fmtPaise(payModal.pledged)}</p></div>
              <div className="rounded border border-slate-200 p-2"><p className="text-xs text-slate-500">{t('pledges.paid')}</p><p className="font-semibold text-green-700">₹{fmtPaise(payModal.paid)}</p></div>
              <div className="rounded border border-amber-300 bg-amber-50 p-2"><p className="text-xs text-slate-500">{t('pledges.outstanding')}</p><p className="font-bold text-amber-800" data-testid="boli-outstanding">₹{fmtPaise(payModal.outstanding)}</p></div>
            </div>
            <form onSubmit={recordPayment} className="space-y-4">
              <PaymentSplitInput rows={payRows} onChange={r => { setPayRows(r); setPayError('') }} totalPaise={payModal.outstanding} />
              <p className="text-xs text-slate-500">{t('pledges.balanceAfter', { amount: fmtPaise(Math.max(0, payModal.outstanding - sumPaise(payRows))) })}</p>
              {payError && <p className="text-sm text-red-600" data-testid="boli-pay-error">{payError}</p>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setPayModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={paying} className="btn-success" data-testid="boli-pay-confirm">{paying ? t('pledges.recording') : t('pledges.recordAndPrint')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Waive modal */}
      {waiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('pledges.waivePledge')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('pledges.waiveWarning', { name: waiveModal.name })}
            </p>
            <form onSubmit={waive} className="space-y-4">
              <div>
                <label className="form-label" htmlFor="boli-list-waiveReason">{t('common.reason')} *</label>
                <textarea id="boli-list-waiveReason" className="form-input" rows={3} value={waiveReason}
                  onChange={e => setWaiveReason(e.target.value)} placeholder={t('pledges.waiveReasonPlaceholder')} required />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setWaiveModal(null); setWaiveReason('') }} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={waiving || !waiveReason.trim()} className="btn-danger">
                  {waiving ? t('pledges.waiving') : t('pledges.waive')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
