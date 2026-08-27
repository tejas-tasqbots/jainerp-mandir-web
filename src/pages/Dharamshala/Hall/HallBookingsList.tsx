import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Ban, FileText, IndianRupee, Plus, Receipt, X } from 'lucide-react'
import { printCurrentView } from '../../../lib/downloadReport'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { printDonationReceipt } from '../../../lib/printReceipt'
import { printBillDoc } from '../../../lib/printBill'
import { useProfileStore } from '../../../store/profileStore'
import {
  PaymentSplitInput, emptyPaymentRow, toPayload, sumPaise, type PaymentRow,
} from '../../../components/PaymentSplitInput'
import { trendByDay } from '../../../lib/chartData'
import { rangeCaption, type DateRange } from '../../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState,
} from '../../../components/kit/DataTable'
import { DateRangePicker, loadStoredRange } from '../../../components/kit/DateRangePicker'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'
import type { HallBooking } from '../../../types'

const PAGE_SIZE = 20
const STATUSES = ['confirmed', 'completed', 'cancelled'] as const

export function HallBookingsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()

  const [bookings, setBookings] = useState<HallBooking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('hall'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const { profile } = useProfileStore()

  // Settlement state. The API has always exposed payments / bill / cancel for
  // halls; the screen simply never called them, so a confirmed booking could
  // take an advance and then had no route to collect the balance, issue the
  // HALL invoice, or cancel — and hall_bill / hall_booking_cancelled (which
  // fire only on status 'completed' / 'cancelled') could never be sent.
  const [payModal, setPayModal] = useState<{ booking: HallBooking; bill: Record<string, any> } | null>(null)
  const [payRows, setPayRows] = useState<PaymentRow[]>([emptyPaymentRow()])
  const [issueBill, setIssueBill] = useState(true)
  const [paying, setPaying] = useState(false)
  const [billModal, setBillModal] = useState<Record<string, any> | null>(null)
  const [cancelModal, setCancelModal] = useState<HallBooking | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  function statusBadge(s: string) {
    if (s === 'confirmed') return <span className="badge-blue">{t('dharamshala.statusConfirmed')}</span>
    if (s === 'completed') return <span className="badge-green">{t('dharamshala.statusCompleted')}</span>
    return <span className="badge-red">{t('dharamshala.statusCancelled')}</span>
  }

  const statusLabel: Record<string, string> = {
    confirmed: t('dharamshala.statusConfirmed'),
    completed: t('dharamshala.statusCompleted'),
    cancelled: t('dharamshala.statusCancelled'),
  }

  const columns: ColumnDef<HallBooking>[] = useMemo(() => [
    {
      key: 'event', label: t('dharamshala.event'),
      render: b => <span className="font-medium">{b.event_name}</span>,
    },
    {
      key: 'hall', label: t('dharamshala.hall'),
      render: b => <span className="text-slate-600">{b.hall_name || '—'}</span>,
    },
    {
      key: 'date', label: t('common.date'),
      render: b => <span className="text-xs">{new Date(b.booking_date).toLocaleDateString('en-IN')}</span>,
    },
    {
      key: 'session', label: t('dharamshala.session'),
      render: b => <span className="badge-blue capitalize">{b.session_type.replace('_', ' ')}</span>,
    },
    {
      key: 'total', label: t('dharamshala.total'), align: 'right',
      render: b => <span className="font-semibold">₹{fmtPaise(b.total_paise)}</span>,
    },
    {
      key: 'advance', label: t('dharamshala.advance'), align: 'right',
      render: b => <>₹{fmtPaise(b.advance_paise)}</>,
    },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: b => statusBadge(b.status),
    },
    {
      key: 'actions', label: t('common.actions', { defaultValue: 'Actions' }), align: 'right',
      render: b => {
        const open = b.status !== 'cancelled' && b.status !== 'completed'
        const due = Math.max(0, (b.total_paise ?? 0) - (b.advance_paise ?? 0))
        return (
          <div className="flex items-center justify-end gap-1">
            {/* Collect balance — the whole point of a confirmed booking, and
                previously unreachable from this screen. */}
            {open && due > 0 && (
              <button
                onClick={e => { e.stopPropagation(); openPayment(b) }}
                className="p-1 text-slate-400 hover:text-brand-green rounded"
                title={t('dharamshala.collectPayment', { defaultValue: 'Collect payment' })}
                aria-label={t('dharamshala.collectPayment', { defaultValue: 'Collect payment' })}
              >
                <IndianRupee size={14} />
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); viewBill(b.id) }}
              className="p-1 text-slate-400 hover:text-navy-700 rounded"
              title={t('dharamshala.viewBill')}
              aria-label={t('dharamshala.viewBill')}
            >
              <FileText size={14} />
            </button>
            {/* Only once a number has been issued — before that there is nothing
                to print, and offering the button would produce a blank document. */}
            {b.invoice_no && (
              <button
                onClick={e => { e.stopPropagation(); printDonationReceipt(b.id, '/hall-bookings').catch(() => {}) }}
                className="p-1 text-slate-400 hover:text-navy-700 rounded"
                title={t('common.printReceipt', { defaultValue: 'Print receipt' })}
                aria-label={t('common.printReceipt', { defaultValue: 'Print receipt' })}
              >
                <Receipt size={14} />
              </button>
            )}
            {open && (
              <button
                onClick={e => { e.stopPropagation(); setCancelModal(b); setCancelReason('') }}
                className="p-1 text-slate-400 hover:text-red-600 rounded"
                title={t('dharamshala.cancelBooking', { defaultValue: 'Cancel booking' })}
                aria-label={t('dharamshala.cancelBooking', { defaultValue: 'Cancel booking' })}
              >
                <Ban size={14} />
              </button>
            )}
          </div>
        )
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

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
      const { data } = await api.get(`/hall-bookings?${buildParams(PAGE_SIZE, page)}`)
      setBookings(data.data || [])
      setTotal(data.meta?.total || 0)
    } catch {
      setBookings([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  function resetPageAnd<T>(setter: (v: T) => void) {
  

  return (v: T) => { setter(v); setPage(1) }
  }

  /** Open the settlement modal, seeded with the live bill (paid + due). */
  async function openPayment(b: HallBooking) {
    try {
      const { data } = await api.get(`/hall-bookings/${b.id}/bill`)
      const bill = data?.data ?? data
      setPayModal({ booking: b, bill })
      setPayRows([emptyPaymentRow()])
      // Default to issuing the bill only when this settles the booking in full;
      // an interim advance should not burn a HALL invoice number.
      setIssueBill(Number(bill.due_paise ?? 0) > 0)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string }; message?: string } } }
      toast.error(err.response?.data?.error?.message || err.response?.data?.message || t('dharamshala.billLoadFailed', { defaultValue: 'Could not load the bill' }))
    }
  }

  /**
   * Record the tender(s). Two distinct outcomes:
   *  - partial  -> POST /payments only; booking stays 'confirmed', balance carries.
   *  - final    -> PATCH status 'completed' with the tenders attached, which
   *                issues the gapless HALL invoice and sends hall_bill, both in
   *                one transaction so a number is never burnt without a bill.
   */
  async function submitPayment() {
    if (!payModal) return
    const entered = sumPaise(payRows)
    const due = Number(payModal.bill.due_paise ?? 0)
    if (entered <= 0) {
      toast.error(t('dharamshala.enterAmount', { defaultValue: 'Enter an amount' })); return
    }
    if (entered > due) {
      toast.error(t('dharamshala.overpayment', { defaultValue: 'Amount exceeds the balance due' })); return
    }
    const settlesInFull = entered >= due
    setPaying(true)
    try {
      if (settlesInFull && issueBill) {
        await api.patch(`/hall-bookings/${payModal.booking.id}`, {
          status: 'completed', payments: toPayload(payRows),
        })
        toast.success(t('dharamshala.billIssued', { defaultValue: 'Payment recorded and bill issued' }))
      } else {
        await api.post(`/hall-bookings/${payModal.booking.id}/payments`, { payments: toPayload(payRows) })
        toast.success(t('dharamshala.paymentRecorded', { defaultValue: 'Payment recorded' }))
      }
      setPayModal(null)
      setPayRows([emptyPaymentRow()])
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string }; message?: string } } }
      toast.error(err.response?.data?.error?.message || err.response?.data?.message || t('dharamshala.paymentFailed', { defaultValue: 'Could not record the payment' }))
    } finally {
      setPaying(false)
    }
  }

  async function viewBill(id: string) {
    try {
      const { data } = await api.get(`/hall-bookings/${id}/bill`)
      setBillModal(data?.data ?? data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string }; message?: string } } }
      toast.error(err.response?.data?.error?.message || err.response?.data?.message || t('dharamshala.billLoadFailed', { defaultValue: 'Could not load the bill' }))
    }
  }

  /** Print the bill as its own document (see lib/printBill.ts). */
  function printBill(bill: Record<string, any>) {
    const rs = (p: unknown) => `₹${fmtPaise(Number(p ?? 0))}`
    const due = Number(bill.due_paise ?? 0)
    printBillDoc({
      templeName: profile?.name || 'Temple',
      templeAddress: [profile?.address, profile?.city, profile?.state].filter(Boolean).join(', '),
      title: t('dharamshala.hallBillTitle', { defaultValue: 'Hall Bill' }),
      invoiceNo: bill.invoice_no,
      meta: [
        { label: t('dharamshala.event'), value: String(bill.event_name ?? '') },
        { label: t('dharamshala.hall'), value: String(bill.hall_name ?? '') },
        { label: t('common.date'), value: new Date(bill.booking_date).toLocaleDateString('en-IN') },
      ],
      charges: [
        { label: t('dharamshala.total'), value: rs(bill.total_paise), bold: true },
      ],
      paymentsLabel: t('dharamshala.paymentsReceived'),
      payments: ((bill.payments ?? []) as Record<string, any>[]).map(p => ({
        label: `${p.payment_mode}${p.reference_no ? ` · ${p.reference_no}` : ''} (${String(p.paid_on).slice(0, 10)})`,
        value: rs(p.amount_paise),
      })),
      noPaymentsLabel: t('dharamshala.noPaymentsRecorded'),
      balanceLabel: t('dharamshala.balance'),
      balanceValue: rs(due),
      balanceOutstanding: due > 0,
    })
  }

  /** Cancel via PATCH status — this is what sends hall_booking_cancelled. */
  async function confirmCancel() {
    if (!cancelModal) return
    setCancelling(true)
    try {
      await api.patch(`/hall-bookings/${cancelModal.id}`, {
        status: 'cancelled', notes: cancelReason || undefined,
      })
      setCancelModal(null)
      setCancelReason('')
      toast.success(t('dharamshala.cancelSuccess'))
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string }; message?: string } } }
      toast.error(err.response?.data?.error?.message || err.response?.data?.message || t('dharamshala.cancelFailed'))
    } finally {
      setCancelling(false)
    }
  }

  async function exportExcel() {
    try {
      const { data } = await api.get(`/hall-bookings?${buildParams(1000)}`)
      const rows: HallBooking[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('dharamshala.hallTitle'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'hall-bookings',
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('dharamshala.event'), width: 26 },
          { header: t('dharamshala.hall'), width: 18 },
          { header: t('dharamshala.session'), width: 12 },
          { header: t('dharamshala.total'), type: 'money' },
          { header: t('dharamshala.advance'), type: 'money' },
          { header: t('common.status'), width: 12 },
        ],
        rows: rows.map(b => [
          new Date(b.booking_date).toLocaleDateString('en-IN'), b.event_name ?? '',
          b.hall_name ?? '', b.session_type.replace('_', ' '),
          b.total_paise, b.advance_paise, statusLabel[b.status] ?? b.status,
        ]),
        totals: [
          t('kit.total'), '', '', '',
          rows.reduce((s, b) => s + b.total_paise, 0),
          rows.reduce((s, b) => s + b.advance_paise, 0),
          '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  // Hall money view per plan §15 (balance-due column + status chips).
  const live = bookings.filter(b => b.status !== 'cancelled')
  const hallTotal = live.reduce((s2, b) => s2 + (b.total_paise ?? 0), 0)
  const hallAdvance = live.reduce((s2, b) => s2 + (b.advance_paise ?? 0), 0)
  const stats: SummaryStat[] = [
    { label: t('dharamshala.summaryBookings'), value: String(live.length) },
    { label: t('dharamshala.summaryBooked'), value: `₹${fmtPaise(hallTotal)}`, tone: 'income' },
    { label: t('dharamshala.summaryAdvances'), value: `₹${fmtPaise(hallAdvance)}` },
    { label: t('dharamshala.summaryBalanceDue'), value: `₹${fmtPaise(Math.max(hallTotal - hallAdvance, 0))}`, tone: 'expense' },
  ]

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('dharamshala.hallTitle')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('dharamshala.hallTitle')}</h1>
        <button onClick={() => navigate('/hall/add')} className="btn-primary btn-sm">
          <Plus size={14} /> {t('dharamshala.newBooking')}
        </button>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="hall" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="hall-list"
        columns={columns}
        rows={bookings}
        rowKey={b => b.id}
        loading={loading}
        graphData={trendByDay(bookings, 'booking_date', 'total_paise')}
        searchValue={search}
        onSearchChange={resetPageAnd(setSearch)}
        searchPlaceholder={t('dharamshala.hallSearchPlaceholder')}
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
          setPage(1)
        }}
        page={page}
        limit={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        emptyMessage={t('dharamshala.noHallBookings')}
        emptyAction={{ label: t('dharamshala.newBooking'), onClick: () => navigate('/hall/add') }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />

      {/* Settlement — collect a partial or full tender against the booking. */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-navy-900">{t('dharamshala.collectPayment', { defaultValue: 'Collect payment' })}</h3>
                <p className="text-sm text-slate-500">
                  {payModal.booking.event_name} · {payModal.booking.hall_name}
                </p>
              </div>
              <button onClick={() => setPayModal(null)} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1 text-sm border-y border-slate-100 py-3 mb-4">
              <div className="flex justify-between">
                <span className="text-slate-600">{t('dharamshala.total')}</span>
                <span>₹{fmtPaise(payModal.bill.total_paise ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">{t('dharamshala.paymentsReceived')}</span>
                <span>₹{fmtPaise(payModal.bill.paid_paise ?? 0)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>{t('dharamshala.balance')}</span>
                <span className="text-red-600">₹{fmtPaise(payModal.bill.due_paise ?? 0)}</span>
              </div>
            </div>

            {/* Shows entered vs remaining, so a partial payment is explicit. */}
            <PaymentSplitInput
              rows={payRows}
              onChange={setPayRows}
              totalPaise={Number(payModal.bill.total_paise ?? 0)}
              paidPaise={Number(payModal.bill.paid_paise ?? 0)}
              disabled={paying}
            />

            {sumPaise(payRows) >= Number(payModal.bill.due_paise ?? 0) && (
              <label className="flex items-start gap-2 text-sm text-slate-700 mt-4 cursor-pointer">
                <input
                  type="checkbox" className="mt-0.5 rounded border-slate-300"
                  checked={issueBill} onChange={e => setIssueBill(e.target.checked)}
                />
                <span>
                  {t('dharamshala.issueBillLabel', { defaultValue: 'Mark completed and issue the bill' })}
                  <span className="block text-xs text-slate-400">
                    {t('dharamshala.issueBillHint', { defaultValue: 'Issues the HALL invoice number and sends the bill on WhatsApp. Cannot be undone.' })}
                  </span>
                </span>
              </label>
            )}

            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => setPayModal(null)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
              <button onClick={submitPayment} disabled={paying} className="btn-primary btn-sm">
                {paying ? t('common.saving', { defaultValue: 'Saving…' }) : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill — the invoice plus every tender recorded against it. */}
      {billModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-navy-900">{billModal.invoice_no || t('dharamshala.viewBill')}</h3>
                <p className="text-sm text-slate-500">{billModal.event_name} · {billModal.hall_name}</p>
              </div>
              <button onClick={() => setBillModal(null)} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1 text-sm border-t border-slate-100 pt-3">
              <div className="flex justify-between font-semibold">
                <span>{t('dharamshala.total')}</span>
                <span>₹{fmtPaise(billModal.total_paise ?? 0)}</span>
              </div>
            </div>

            {(billModal.in_clearing_paise ?? 0) > 0 && (
              /* A cheque is a promise until it clears, so "paid" and "realised"
                 are not the same number. Showing only the total made a bill
                 settled by an uncleared cheque look fully collected. */
              <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">{t('dharamshala.realised', { defaultValue: 'Realised' })}</span>
                  <span>₹{fmtPaise(billModal.realized_paise ?? 0)}</span>
                </div>
                <div className="flex justify-between text-amber-700">
                  <span>{t('dharamshala.inClearing', { defaultValue: 'Cheque in clearing' })}</span>
                  <span>₹{fmtPaise(billModal.in_clearing_paise ?? 0)}</span>
                </div>
              </div>
            )}

            <p className="form-label mt-4">{t('dharamshala.paymentsReceived')}</p>
            {billModal.payments?.length ? (
              <div className="space-y-1 text-sm">
                {billModal.payments.map((p: Record<string, any>) => (
                  <div key={p.id} className="flex justify-between">
                    <span className="text-slate-600">
                      {p.payment_mode}
                      {p.reference_no ? ` · ${p.reference_no}` : ''}
                      <span className="text-slate-400 text-xs ml-1">{String(p.paid_on).slice(0, 10)}</span>
                    </span>
                    <span>₹{fmtPaise(p.amount_paise)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">{t('dharamshala.noPaymentsRecorded')}</p>
            )}

            <div className="flex justify-between font-semibold border-t border-slate-100 pt-2 mt-2 text-sm">
              <span>{t('dharamshala.balance')}</span>
              <span className={(billModal.due_paise ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}>
                ₹{fmtPaise(billModal.due_paise ?? 0)}
              </span>
            </div>

            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => printBill(billModal)} className="btn-secondary">{t('common.print')}</button>
              <button onClick={() => setBillModal(null)} className="btn-primary">{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel — PATCH status 'cancelled', which sends hall_booking_cancelled. */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('dharamshala.cancelBooking', { defaultValue: 'Cancel booking' })}</h3>
            <p className="text-sm text-slate-500 mb-4">{cancelModal.event_name} · {cancelModal.hall_name}</p>

            <label className="form-label" htmlFor="hall-cancel-reason">
              {t('dharamshala.cancelReason', { defaultValue: 'Reason' })}
            </label>
            <textarea
              id="hall-cancel-reason" className="form-textarea" rows={3}
              value={cancelReason} onChange={e => setCancelReason(e.target.value)}
              placeholder={t('dharamshala.cancelReasonHint', { defaultValue: 'Recorded on the booking and in the audit trail' })}
            />

            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => setCancelModal(null)} className="btn-secondary btn-sm">{t('common.close')}</button>
              <button onClick={confirmCancel} disabled={cancelling} className="btn-danger btn-sm">
                {cancelling ? t('common.saving', { defaultValue: 'Saving…' }) : t('dharamshala.cancelBooking', { defaultValue: 'Cancel booking' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
