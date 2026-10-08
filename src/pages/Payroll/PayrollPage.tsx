import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Calculator, ChevronDown, ChevronRight, FileText, HandCoins, IndianRupee, Plus, Printer, RefreshCw, Save, X,
} from 'lucide-react'
import { api, fmtPaise, parsePaise, todayIst } from '../../lib/api'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { PaymentFields, emptyPayment, needsReference, type PaymentFieldsValue } from '../../components/PaymentFields'
import { usePaymentModes } from '../../lib/useDropdownOptions'
import { paymentModeLabel } from '../../lib/paymentModeLabel'
import { printAdvanceVoucher, printPayslip } from '../../lib/printVoucher'

/**
 * Payroll: the salary run, paying it, and the advances it recovers.
 *
 * The month is always PREVIEWED before it is written. The preview is computed
 * server-side by the same code that writes it (`GET /payroll/preview` and
 * `POST /payroll/compute` share one function), so what is shown is what will
 * be saved — not an estimate the write path might disagree with.
 *
 * 2026-10-08, from a live trust: "the advance is given to one employee but it
 * is not deducting and not showing the calculations". Three things were
 * wrong, and this screen shows the answer to each:
 *   - a monthly salary was paid only for days MARKED present, so with no
 *     register kept the gross was ₹0 and no advance could come off it. The
 *     API now pays the month less loss-of-pay days; each row opens to show
 *     the arithmetic and every advance taken, before and after;
 *   - nothing paid a salary — computing was the last step, so trusts paid
 *     salary as an Expense, which knows nothing about advances. "Pay" records
 *     mode, account and UTR, issues a voucher and posts to the cash book;
 *   - there was no payslip. There is now, from the same record.
 */

type Tab = 'run' | 'advances'

interface Recovery {
  advance_id: string
  advance_date: string | null
  voucher_no: string | null
  advance_paise: number
  amount_paise: number
  outstanding_before_paise: number
  outstanding_after_paise: number
}

interface PreviewRow {
  employee_id: string
  employee_name: string
  designation: string | null
  salary_type: string
  rate_paise: number
  days_in_month: number
  days_not_joined: number
  days_present: number
  days_half: number
  days_paid_leave: number
  days_unpaid_leave: number
  days_absent: number
  payable_days: number
  loss_of_pay_days: number
  gross_paise: number
  deduction_cap_paise: number
  advance_recovered_paise: number
  other_deductions_paise: number
  deductions_paise: number
  net_paise: number
  recoveries: Recovery[]
  advances_outstanding_before_paise: number
  advances_outstanding_after_paise: number
  salary_record_id: string | null
  status: 'draft' | 'computed' | 'paid'
  voucher_no: string | null
}

interface Preview {
  month: string
  days_in_month: number
  employees: number
  gross_paise: number
  net_paise: number
  advance_recovered_paise: number
  rows: PreviewRow[]
}

interface Advance {
  id: string
  employee_id: string
  employee_name: string
  designation: string | null
  amount_paise: number
  recovered_paise: number
  outstanding_paise: number
  advance_date: string
  reason: string | null
  recovery_mode: 'instalment' | 'full_next_salary' | 'manual'
  instalment_paise: number
  recovery_starts_on: string | null
  status: string
  payment_mode: string | null
  voucher_no: string | null
  reference_no: string | null
}

interface Employee { id: string; name: string; designation?: string | null; is_active?: boolean }

/** This month in IST — toISOString() is UTC and reads the previous month until 05:30 on the 1st. */
const thisMonth = () => todayIst().slice(0, 7)
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN') : '—'

export function PayrollPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const modes = usePaymentModes()
  const [tab, setTab] = useState<Tab>('run')

  // ── salary run ─────────────────────────────────────────────────────────
  const [month, setMonth] = useState(thisMonth())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [computing, setComputing] = useState(false)
  const [runError, setRunError] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // Only the LATEST request may land. Switching month while the previous
  // month was still loading let the older answer arrive last and show one
  // month's figures under another month's heading.
  const previewSeq = useRef(0)

  const loadPreview = useCallback(async (m: string) => {
    const seq = ++previewSeq.current
    setLoadingPreview(true)
    setRunError('')
    try {
      const { data } = await api.get('/payroll/preview', { params: { month: m } })
      if (seq === previewSeq.current) setPreview(data.data ?? data)
    } catch (e: any) {
      if (seq !== previewSeq.current) return
      setPreview(null)
      setRunError(e?.response?.data?.error?.message ?? t('payroll.previewFailed'))
    } finally {
      if (seq === previewSeq.current) setLoadingPreview(false)
    }
  }, [t])

  useEffect(() => { if (tab === 'run') loadPreview(month) }, [tab, month, loadPreview])

  async function compute() {
    setComputing(true)
    try {
      const { data } = await api.post('/payroll/compute', { month })
      const written = (data.data ?? data)?.written ?? 0
      toast.success(t('payroll.computed', { count: written, month }))
      await loadPreview(month)
      await loadAdvances()
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message ?? t('payroll.computeFailed'))
    } finally {
      setComputing(false)
    }
  }

  // ── paying one salary ──────────────────────────────────────────────────
  const [payFor, setPayFor] = useState<PreviewRow | null>(null)
  const [payment, setPayment] = useState<PaymentFieldsValue>(emptyPayment())
  const [paidOn, setPaidOn] = useState(todayIst())
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')

  function openPay(r: PreviewRow) {
    setPayFor(r)
    setPayment(emptyPayment())
    setPaidOn(todayIst())
    setPayError('')
  }

  async function paySalary() {
    if (!payFor?.salary_record_id) return
    if (needsReference(modes, payment.payment_mode) && !payment.reference_no.trim()) {
      setPayError(t('payroll.utrRequired'))
      return
    }
    setPaying(true)
    setPayError('')
    try {
      const { data } = await api.post(`/payroll/salaries/${payFor.salary_record_id}/pay`, {
        payment_mode: payment.payment_mode,
        payment_account_id: payment.payment_account_id || null,
        reference_no: payment.reference_no.trim() || null,
        paid_on: paidOn,
      })
      const res = data.data ?? data
      toast.success(t('payroll.salaryPaid', { name: payFor.employee_name, voucher: res?.voucher_no ?? '' }))
      const id = payFor.salary_record_id
      setPayFor(null)
      await loadPreview(month)
      printPayslip(id).catch(() => {})
    } catch (e: any) {
      setPayError(e?.response?.data?.error?.message ?? t('payroll.payFailed'))
    } finally {
      setPaying(false)
    }
  }

  async function slip(id: string | null) {
    if (!id) return
    try { await printPayslip(id) } catch { toast.error(t('payroll.payslipFailed')) }
  }

  // ── advances ───────────────────────────────────────────────────────────
  const [advances, setAdvances] = useState<Advance[]>([])
  const [loadingAdv, setLoadingAdv] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    employee_id: '', amount: '', advance_date: todayIst(),
    reason: '', recovery_mode: 'instalment' as Advance['recovery_mode'],
    instalment: '', recovery_starts_on: '',
  })
  const [advPayment, setAdvPayment] = useState<PaymentFieldsValue>(emptyPayment())

  const [repay, setRepay] = useState<Advance | null>(null)
  const [repayAmt, setRepayAmt] = useState('')
  const [repaying, setRepaying] = useState(false)

  const loadAdvances = useCallback(async () => {
    setLoadingAdv(true)
    try {
      const { data } = await api.get('/payroll/advances')
      setAdvances(data.data ?? data ?? [])
    } catch {
      setAdvances([])
    } finally {
      setLoadingAdv(false)
    }
  }, [])

  useEffect(() => { loadAdvances() }, [loadAdvances])

  useEffect(() => {
    api.get('/employees', { params: { limit: '200' } })
      .then(r => setEmployees((r.data.data ?? []).filter((e: Employee) => e.is_active !== false)))
      .catch(() => setEmployees([]))
  }, [])

  async function saveAdvance() {
    if (needsReference(modes, advPayment.payment_mode) && !advPayment.reference_no.trim()) {
      setFormError(t('payroll.utrRequired'))
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const { data } = await api.post('/payroll/advances', {
        employee_id: form.employee_id,
        amount_paise: parsePaise(form.amount),
        advance_date: form.advance_date,
        reason: form.reason || null,
        recovery_mode: form.recovery_mode,
        instalment_paise: form.recovery_mode === 'instalment' ? parsePaise(form.instalment) : 0,
        recovery_starts_on: form.recovery_starts_on || null,
        payment_mode: advPayment.payment_mode,
        payment_account_id: advPayment.payment_account_id || null,
        reference_no: advPayment.reference_no.trim() || null,
      })
      const created = data.data ?? data
      toast.success(t('payroll.advanceGiven'))
      setShowForm(false)
      setForm({ ...form, employee_id: '', amount: '', reason: '', instalment: '', recovery_starts_on: '' })
      setAdvPayment(emptyPayment())
      await loadAdvances()
      // The employee signs the voucher as the money is handed over.
      if (created?.id) printAdvanceVoucher(created.id).catch(() => {})
    } catch (e: any) {
      setFormError(e?.response?.data?.error?.message ?? t('payroll.advanceFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function saveRepayment() {
    if (!repay) return
    setRepaying(true)
    try {
      await api.post(`/payroll/advances/${repay.id}/recover`, { amount_paise: parsePaise(repayAmt) })
      toast.success(t('payroll.repaymentRecorded'))
      setRepay(null)
      setRepayAmt('')
      await loadAdvances()
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message ?? t('payroll.repaymentFailed'))
    } finally {
      setRepaying(false)
    }
  }

  const outstandingTotal = useMemo(
    () => advances.filter(a => a.status === 'active').reduce((n, a) => n + Number(a.outstanding_paise), 0),
    [advances],
  )

  const unpaid = preview?.rows.filter(r => r.status !== 'paid') ?? []
  const runStats: SummaryStat[] = preview ? [
    { label: t('payroll.staff'), value: String(preview.employees) },
    { label: t('payroll.gross'), value: `₹${fmtPaise(preview.gross_paise)}` },
    { label: t('payroll.advanceRecovered'), value: `₹${fmtPaise(preview.advance_recovered_paise)}`, tone: 'expense' },
    { label: t('payroll.netPayable'), value: `₹${fmtPaise(preview.net_paise)}`, tone: 'income' },
  ] : []

  const modeLabel = (m: Advance['recovery_mode']) =>
    m === 'instalment' ? t('payroll.modeInstalment')
      : m === 'full_next_salary' ? t('payroll.modeFullNext')
        : t('payroll.modeManual')

  const statusBadge = (s: PreviewRow['status']) =>
    s === 'paid' ? <span className="badge-green">{t('payroll.statusPaid')}</span>
      : s === 'computed' ? <span className="badge-blue">{t('payroll.statusComputed')}</span>
        : <span className="badge-gray">{t('payroll.statusDraft')}</span>

  /** "₹20,000 ÷ 31 days × 28.5 days paid = ₹18,387.10" — the line the client asked to see. */
  const working = (r: PreviewRow) => r.salary_type === 'daily'
    ? t('payroll.workingDaily', { rate: fmtPaise(r.rate_paise), days: days(r.payable_days), gross: fmtPaise(r.gross_paise) })
    : t('payroll.workingMonthly', {
      rate: fmtPaise(r.rate_paise), dim: r.days_in_month, days: days(r.payable_days), gross: fmtPaise(r.gross_paise),
    })

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('nav.payroll')} />

      <div className="flex items-center justify-between gap-3 no-print">
        <h1 className="text-xl font-semibold text-navy-900">{t('nav.payroll')}</h1>
        <div className="flex gap-2">
          <button className={tab === 'run' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setTab('run')}>
            <Calculator size={14} /> {t('payroll.salaryRun')}
          </button>
          <button className={tab === 'advances' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setTab('advances')}>
            <HandCoins size={14} /> {t('payroll.advances')}
          </button>
        </div>
      </div>

      {/* ── salary run ─────────────────────────────────────────────── */}
      {tab === 'run' && (
        <>
          <div className="card no-print">
            <div className="card-body flex flex-wrap items-end gap-3">
              <div>
                <label className="form-label" htmlFor="payroll-month">{t('payroll.month')}</label>
                <input
                  id="payroll-month" type="month" className="form-input"
                  value={month} onChange={e => setMonth(e.target.value)}
                />
              </div>
              <button className="btn-secondary" onClick={() => loadPreview(month)} disabled={loadingPreview}>
                <RefreshCw size={15} /> {t('payroll.refresh')}
              </button>
              <button
                className="btn-primary"
                onClick={compute}
                disabled={computing || loadingPreview || !unpaid.length}
                data-testid="payroll-compute"
              >
                <Save size={15} /> {computing ? t('payroll.computing') : t('payroll.compute')}
              </button>
              <p className="text-xs text-slate-500 max-w-xl">{t('payroll.computeHintV2')}</p>
            </div>
          </div>

          {runStats.length > 0 && <SummaryStrip stats={runStats} />}
          {runError && <div className="card"><div className="card-body text-sm text-red-600">{runError}</div></div>}

          <div className="card">
            <div className="card-body overflow-x-auto">
              <table className="data-table" data-testid="payroll-run">
                <thead>
                  <tr>
                    <th />
                    <th>{t('payroll.employee')}</th>
                    <th className="text-right">{t('payroll.salary')}</th>
                    <th className="text-right">{t('payroll.lossOfPay')}</th>
                    <th className="text-right">{t('payroll.daysPaid')}</th>
                    <th className="text-right">{t('payroll.gross')}</th>
                    <th className="text-right">{t('payroll.advanceRecovered')}</th>
                    <th className="text-right">{t('payroll.net')}</th>
                    <th>{t('common.status')}</th>
                    <th className="no-print" />
                  </tr>
                </thead>
                <tbody>
                  {loadingPreview && (
                    <tr><td colSpan={10} className="text-center text-slate-400 py-6">{t('common.loading')}</td></tr>
                  )}
                  {!loadingPreview && !preview?.rows.length && (
                    <tr><td colSpan={10} className="text-center text-slate-400 py-6">{t('payroll.noStaff')}</td></tr>
                  )}
                  {!loadingPreview && preview?.rows.map(r => {
                    const isOpen = !!open[r.employee_id]
                    return (
                      <Fragment key={r.employee_id}>
                        <tr data-testid={`payroll-row-${r.employee_id}`}>
                          <td className="w-6">
                            <button
                              type="button" className="p-1 text-slate-400 hover:text-navy-900"
                              aria-expanded={isOpen} aria-label={t('payroll.showWorking')}
                              onClick={() => setOpen(o => ({ ...o, [r.employee_id]: !isOpen }))}
                            >
                              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td>
                            <span className="font-medium">{r.employee_name}</span>
                            {r.designation && <span className="text-xs text-slate-500 block">{r.designation}</span>}
                          </td>
                          <td className="text-right tabular-nums text-xs">
                            ₹{fmtPaise(r.rate_paise)}
                            <span className="text-slate-500 block">{r.salary_type === 'daily' ? t('staff.perDay') : t('staff.perMonth')}</span>
                          </td>
                          <td className="text-right tabular-nums">{r.loss_of_pay_days ? days(r.loss_of_pay_days) : '—'}</td>
                          <td className="text-right tabular-nums">{days(r.payable_days)}<span className="text-xs text-slate-400"> / {r.days_in_month}</span></td>
                          <td className="text-right tabular-nums">₹{fmtPaise(r.gross_paise)}</td>
                          <td className="text-right tabular-nums">
                            {r.advance_recovered_paise
                              ? <span className="text-red-600" data-testid="advance-deducted">−₹{fmtPaise(r.advance_recovered_paise)}</span>
                              : '—'}
                          </td>
                          <td className="text-right tabular-nums font-semibold">₹{fmtPaise(r.net_paise)}</td>
                          <td>{statusBadge(r.status)}{r.voucher_no && <span className="block text-[11px] font-mono text-slate-500">{r.voucher_no}</span>}</td>
                          <td className="no-print text-right whitespace-nowrap">
                            {r.status === 'computed' && (
                              <button className="btn-success btn-sm" onClick={() => openPay(r)} data-testid="payroll-pay">
                                <IndianRupee size={13} /> {t('payroll.pay')}
                              </button>
                            )}
                            {r.salary_record_id && (
                              <button
                                className="p-1.5 text-slate-500 hover:text-navy-900" title={t('payroll.payslip')}
                                aria-label={t('payroll.payslip')} onClick={() => slip(r.salary_record_id)}
                              >
                                <FileText size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-slate-50" data-testid="payroll-working">
                            <td />
                            <td colSpan={9} className="text-xs text-slate-600 space-y-1 py-3">
                              <p>
                                <b>{t('payroll.working')}:</b> {working(r)}
                              </p>
                              <p>
                                {t('payroll.attendanceLine', {
                                  present: r.days_present, half: r.days_half, paidLeave: r.days_paid_leave,
                                  unpaidLeave: r.days_unpaid_leave, absent: r.days_absent,
                                })}
                                {r.days_not_joined > 0 && ` · ${t('payroll.notJoined', { count: r.days_not_joined })}`}
                              </p>
                              {r.salary_type !== 'daily' && <p className="text-slate-500">{t('payroll.unmarkedNote')}</p>}
                              {r.recoveries.length > 0 ? (
                                <table className="mt-1 text-xs">
                                  <thead>
                                    <tr className="text-slate-500">
                                      <th className="pr-4 text-left font-medium">{t('payroll.advanceGivenOn')}</th>
                                      <th className="pr-4 text-right font-medium">{t('payroll.amount')}</th>
                                      <th className="pr-4 text-right font-medium">{t('payroll.owedBefore')}</th>
                                      <th className="pr-4 text-right font-medium">{t('payroll.deductedNow')}</th>
                                      <th className="text-right font-medium">{t('payroll.owedAfter')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.recoveries.map(x => (
                                      <tr key={x.advance_id}>
                                        <td className="pr-4">{fmtDay(x.advance_date)}{x.voucher_no && <span className="font-mono text-slate-400"> · {x.voucher_no}</span>}</td>
                                        <td className="pr-4 text-right tabular-nums">₹{fmtPaise(x.advance_paise)}</td>
                                        <td className="pr-4 text-right tabular-nums">₹{fmtPaise(x.outstanding_before_paise)}</td>
                                        <td className="pr-4 text-right tabular-nums text-red-600">−₹{fmtPaise(x.amount_paise)}</td>
                                        <td className="text-right tabular-nums font-semibold">₹{fmtPaise(x.outstanding_after_paise)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : r.advances_outstanding_before_paise > 0 ? (
                                <p className="text-amber-700">{t('payroll.advanceNotTaken', { amount: fmtPaise(r.advances_outstanding_before_paise) })}</p>
                              ) : (
                                <p className="text-slate-500">{t('payroll.noAdvanceOpen')}</p>
                              )}
                              {r.advances_outstanding_after_paise > 0 && r.recoveries.length > 0 && (
                                <p>{t('payroll.stillOwed', { amount: fmtPaise(r.advances_outstanding_after_paise) })}</p>
                              )}
                              {r.advance_recovered_paise > 0 && r.advance_recovered_paise >= r.deduction_cap_paise && (
                                <p className="text-amber-700">{t('payroll.capNote', { amount: fmtPaise(r.deduction_cap_paise) })}</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── advances ───────────────────────────────────────────────── */}
      {tab === 'advances' && (
        <>
          <SummaryStrip stats={[
            { label: t('payroll.openAdvances'), value: String(advances.filter(a => a.status === 'active').length) },
            { label: t('payroll.outstanding'), value: `₹${fmtPaise(outstandingTotal)}`, tone: 'expense' },
          ]} />

          <div className="flex justify-end no-print">
            <button className="btn-primary" onClick={() => setShowForm(v => !v)}>
              {showForm ? <X size={15} /> : <Plus size={15} />} {showForm ? t('common.cancel') : t('payroll.giveAdvance')}
            </button>
          </div>

          {showForm && (
            <div className="card no-print">
              <div className="card-header">{t('payroll.giveAdvance')}</div>
              <div className="card-body space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="form-label" htmlFor="adv-emp">{t('payroll.employee')}</label>
                    <select
                      id="adv-emp" className="form-select" value={form.employee_id}
                      onChange={e => setForm({ ...form, employee_id: e.target.value })}
                    >
                      <option value="">{t('payroll.selectEmployee')}</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="adv-amt">{t('payroll.amount')}</label>
                    <input
                      id="adv-amt" className="form-input" inputMode="decimal" value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="10000"
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="adv-date">{t('payroll.date')}</label>
                    <input
                      id="adv-date" type="date" className="form-input" value={form.advance_date}
                      onChange={e => setForm({ ...form, advance_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="adv-mode">{t('payroll.recoveryMode')}</label>
                    <select
                      id="adv-mode" className="form-select" value={form.recovery_mode}
                      onChange={e => setForm({ ...form, recovery_mode: e.target.value as Advance['recovery_mode'] })}
                    >
                      <option value="instalment">{t('payroll.modeInstalment')}</option>
                      <option value="full_next_salary">{t('payroll.modeFullNext')}</option>
                      <option value="manual">{t('payroll.modeManual')}</option>
                    </select>
                  </div>
                  {form.recovery_mode === 'instalment' && (
                    <div>
                      <label className="form-label" htmlFor="adv-inst">{t('payroll.instalment')}</label>
                      <input
                        id="adv-inst" className="form-input" inputMode="decimal" value={form.instalment}
                        onChange={e => setForm({ ...form, instalment: e.target.value })} placeholder="2000"
                      />
                    </div>
                  )}
                  {form.recovery_mode !== 'manual' && (
                    <div>
                      <label className="form-label" htmlFor="adv-start">{t('payroll.recoveryStarts')}</label>
                      <input
                        id="adv-start" type="month" className="form-input"
                        value={form.recovery_starts_on.slice(0, 7)}
                        onChange={e => setForm({ ...form, recovery_starts_on: e.target.value ? `${e.target.value}-01` : '' })}
                      />
                      <p className="text-xs text-slate-500 mt-1">{t('payroll.recoveryStartsHint')}</p>
                    </div>
                  )}
                </div>
                <PaymentFields idPrefix="adv-pay" value={advPayment} onChange={setAdvPayment} direction="out" />
                <div>
                  <label className="form-label" htmlFor="adv-reason">{t('payroll.reason')}</label>
                  <input
                    id="adv-reason" className="form-input" value={form.reason}
                    onChange={e => setForm({ ...form, reason: e.target.value })}
                  />
                </div>
                {form.recovery_mode === 'manual' && <p className="text-xs text-amber-700">{t('payroll.manualHint')}</p>}
                {formError && <p className="text-sm text-red-600">{formError}</p>}
                <div className="flex justify-end">
                  <button
                    className="btn-primary" onClick={saveAdvance}
                    disabled={saving || !form.employee_id || !form.amount}
                  >
                    <Save size={15} /> {saving ? t('common.saving') : t('payroll.saveAndPrintVoucher')}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-body overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('payroll.employee')}</th>
                    <th>{t('payroll.date')}</th>
                    <th className="text-right">{t('payroll.amount')}</th>
                    <th className="text-right">{t('payroll.recovered')}</th>
                    <th className="text-right">{t('payroll.outstanding')}</th>
                    <th>{t('payroll.recoveryMode')}</th>
                    <th>{t('common.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {loadingAdv && (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-6">{t('common.loading')}</td></tr>
                  )}
                  {!loadingAdv && !advances.length && (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-6">{t('payroll.noAdvances')}</td></tr>
                  )}
                  {!loadingAdv && advances.map(a => (
                    <tr key={a.id}>
                      <td>
                        <span className="font-medium">{a.employee_name}</span>
                        {a.designation && <span className="text-xs text-slate-500 block">{a.designation}</span>}
                      </td>
                      <td className="text-xs text-slate-500">
                        {fmtDay(a.advance_date)}
                        {a.voucher_no && <span className="block font-mono">{a.voucher_no}</span>}
                        <span className="block">{paymentModeLabel(t, a.payment_mode)}{a.reference_no ? ` · ${a.reference_no}` : ''}</span>
                      </td>
                      <td className="text-right tabular-nums">₹{fmtPaise(a.amount_paise)}</td>
                      <td className="text-right tabular-nums text-green-700">₹{fmtPaise(a.recovered_paise)}</td>
                      <td className="text-right tabular-nums font-semibold">₹{fmtPaise(a.outstanding_paise)}</td>
                      <td className="text-xs">
                        {modeLabel(a.recovery_mode)}
                        {a.recovery_mode === 'instalment' && a.instalment_paise > 0 && (
                          <span className="text-slate-500"> · ₹{fmtPaise(a.instalment_paise)}</span>
                        )}
                        {a.recovery_starts_on && <span className="text-slate-500 block">{t('payroll.fromMonth', { month: a.recovery_starts_on.slice(0, 7) })}</span>}
                      </td>
                      <td>
                        {a.status === 'active'
                          ? <span className="badge-blue">{t('payroll.statusActive')}</span>
                          : <span className="badge-gray">{t('payroll.statusClosed')}</span>}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <button
                          className="p-1.5 text-slate-500 hover:text-navy-900" title={t('payroll.printVoucher')}
                          aria-label={t('payroll.printVoucher')}
                          onClick={() => printAdvanceVoucher(a.id).catch(() => toast.error(t('payroll.voucherFailed')))}
                        >
                          <Printer size={15} />
                        </button>
                        {Number(a.outstanding_paise) > 0 && (
                          <button className="btn-secondary btn-sm" onClick={() => { setRepay(a); setRepayAmt('') }}>
                            {t('payroll.recordRepayment')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Pay one computed salary. */}
      {payFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 no-print" role="dialog" aria-modal="true">
          <div className="card w-full max-w-xl mx-4">
            <div className="card-header flex items-center justify-between">
              <span>{t('payroll.paySalaryOf', { name: payFor.employee_name, month })}</span>
              <button onClick={() => setPayFor(null)} aria-label={t('common.close')} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="card-body space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded border border-slate-200 p-2"><p className="text-xs text-slate-500">{t('payroll.gross')}</p><p className="font-semibold">₹{fmtPaise(payFor.gross_paise)}</p></div>
                <div className="rounded border border-slate-200 p-2"><p className="text-xs text-slate-500">{t('payroll.advanceRecovered')}</p><p className="font-semibold text-red-600">−₹{fmtPaise(payFor.advance_recovered_paise)}</p></div>
                <div className="rounded border border-emerald-300 bg-emerald-50 p-2"><p className="text-xs text-slate-500">{t('payroll.netPayable')}</p><p className="font-bold text-emerald-800" data-testid="pay-net">₹{fmtPaise(payFor.net_paise)}</p></div>
              </div>
              <PaymentFields idPrefix="sal-pay" value={payment} onChange={setPayment} direction="out" />
              <div className="max-w-[12rem]">
                <label className="form-label" htmlFor="sal-paid-on">{t('payroll.paidOn')}</label>
                <input id="sal-paid-on" type="date" className="form-input" value={paidOn} onChange={e => setPaidOn(e.target.value)} />
              </div>
              {payError && <p className="text-sm text-red-600">{payError}</p>}
              <div className="flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => setPayFor(null)}>{t('common.cancel')}</button>
                <button className="btn-success" onClick={paySalary} disabled={paying} data-testid="pay-confirm">
                  {paying ? t('common.saving') : t('payroll.payAndPrint')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cash repaid by hand, rather than deducted from a salary run. */}
      {repay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 no-print" role="dialog" aria-modal="true">
          <div className="card w-full max-w-sm">
            <div className="card-header">{t('payroll.recordRepayment')} — {repay.employee_name}</div>
            <div className="card-body space-y-3">
              <p className="text-sm text-slate-600">
                {t('payroll.outstanding')}: <b>₹{fmtPaise(repay.outstanding_paise)}</b>
              </p>
              <div>
                <label className="form-label" htmlFor="repay-amt">{t('payroll.amount')}</label>
                <input
                  id="repay-amt" className="form-input" inputMode="decimal" autoFocus
                  value={repayAmt} onChange={e => setRepayAmt(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => setRepay(null)}>{t('common.cancel')}</button>
                <button className="btn-primary" onClick={saveRepayment} disabled={repaying || !repayAmt}>
                  {repaying ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
