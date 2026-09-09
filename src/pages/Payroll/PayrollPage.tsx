import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calculator, HandCoins, Plus, RefreshCw, Save, X } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

/**
 * Payroll: the salary run, and the advances it recovers.
 *
 * Before this screen existed there was no way to compute a salary at all —
 * `employee_salary_records` was reachable only through the generic resource
 * CRUD, so an accountant typed gross and deductions in by hand and the salary
 * register could silently disagree with the attendance beside it.
 *
 * The month is always PREVIEWED before it is written. The preview is computed
 * server-side by the same code that writes it (`GET /payroll/preview` and
 * `POST /payroll/compute` share one function), so what is shown is what will
 * be saved — not an estimate the write path might disagree with.
 */

type Tab = 'run' | 'advances'

interface PreviewRow {
  employee_id: string
  employee_name: string
  designation: string | null
  salary_type: string
  days_in_month: number
  days_present: number
  days_half: number
  days_leave: number
  days_absent: number
  gross_paise: number
  advance_recovered_paise: number
  other_deductions_paise: number
  deductions_paise: number
  net_paise: number
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
  status: string
}

interface Employee { id: string; name: string; designation?: string | null }
interface Account { id: string; name: string }

const thisMonth = () => new Date().toISOString().slice(0, 7)

export function PayrollPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('run')

  // ── salary run ─────────────────────────────────────────────────────────
  const [month, setMonth] = useState(thisMonth())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [computing, setComputing] = useState(false)
  const [runError, setRunError] = useState('')

  const loadPreview = useCallback(async (m: string) => {
    setLoadingPreview(true)
    setRunError('')
    try {
      const { data } = await api.get('/payroll/preview', { params: { month: m } })
      setPreview(data.data ?? data)
    } catch (e: any) {
      setPreview(null)
      setRunError(e?.response?.data?.error?.message ?? t('payroll.previewFailed'))
    } finally {
      setLoadingPreview(false)
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
      const err = e?.response?.data?.error
      // A disbursed month is refused by design — the money has gone and the
      // cash statements have posted it.
      toast.error(err?.message ?? t('payroll.computeFailed'))
    } finally {
      setComputing(false)
    }
  }

  // ── advances ───────────────────────────────────────────────────────────
  const [advances, setAdvances] = useState<Advance[]>([])
  const [loadingAdv, setLoadingAdv] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    employee_id: '', amount: '', advance_date: new Date().toISOString().slice(0, 10),
    reason: '', recovery_mode: 'instalment' as Advance['recovery_mode'],
    instalment: '', recovery_starts_on: '', payment_mode: 'cash', payment_account_id: '',
  })

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
      .then(r => setEmployees(r.data.data ?? [])).catch(() => setEmployees([]))
    api.get('/accounts', { params: { limit: '100' } })
      .then(r => setAccounts(r.data.data ?? [])).catch(() => setAccounts([]))
  }, [])

  async function saveAdvance() {
    setSaving(true)
    setFormError('')
    try {
      await api.post('/payroll/advances', {
        employee_id: form.employee_id,
        amount_paise: parsePaise(form.amount),
        advance_date: form.advance_date,
        reason: form.reason || null,
        recovery_mode: form.recovery_mode,
        instalment_paise: form.recovery_mode === 'instalment' ? parsePaise(form.instalment) : 0,
        recovery_starts_on: form.recovery_starts_on || null,
        payment_mode: form.payment_mode,
        payment_account_id: form.payment_account_id || null,
      })
      toast.success(t('payroll.advanceGiven'))
      setShowForm(false)
      setForm({ ...form, employee_id: '', amount: '', reason: '', instalment: '' })
      await loadAdvances()
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
                disabled={computing || loadingPreview || !preview?.rows.length}
              >
                <Save size={15} /> {computing ? t('payroll.computing') : t('payroll.compute')}
              </button>
              <p className="text-xs text-slate-500 max-w-md">{t('payroll.computeHint')}</p>
            </div>
          </div>

          {runStats.length > 0 && <SummaryStrip stats={runStats} />}
          {runError && <div className="card"><div className="card-body text-sm text-red-600">{runError}</div></div>}

          <div className="card">
            <div className="card-body overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('payroll.employee')}</th>
                    <th className="text-right">{t('payroll.present')}</th>
                    <th className="text-right">{t('payroll.half')}</th>
                    <th className="text-right">{t('payroll.leave')}</th>
                    <th className="text-right">{t('payroll.absent')}</th>
                    <th className="text-right">{t('payroll.gross')}</th>
                    <th className="text-right">{t('payroll.advanceRecovered')}</th>
                    <th className="text-right">{t('payroll.net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingPreview && (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-6">{t('common.loading')}</td></tr>
                  )}
                  {!loadingPreview && !preview?.rows.length && (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-6">{t('payroll.noStaff')}</td></tr>
                  )}
                  {!loadingPreview && preview?.rows.map(r => (
                    <tr key={r.employee_id}>
                      <td>
                        <span className="font-medium">{r.employee_name}</span>
                        {r.designation && <span className="text-xs text-slate-500 block">{r.designation}</span>}
                      </td>
                      <td className="text-right tabular-nums">{r.days_present}</td>
                      <td className="text-right tabular-nums">{r.days_half || '—'}</td>
                      <td className="text-right tabular-nums">{r.days_leave || '—'}</td>
                      <td className="text-right tabular-nums">{r.days_absent || '—'}</td>
                      <td className="text-right tabular-nums">₹{fmtPaise(r.gross_paise)}</td>
                      <td className="text-right tabular-nums">
                        {r.advance_recovered_paise
                          ? <span className="text-red-600">−₹{fmtPaise(r.advance_recovered_paise)}</span>
                          : '—'}
                      </td>
                      <td className="text-right tabular-nums font-semibold">₹{fmtPaise(r.net_paise)}</td>
                    </tr>
                  ))}
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
              <div className="card-body grid gap-3 md:grid-cols-3">
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
                <div>
                  <label className="form-label" htmlFor="adv-acct">{t('payroll.paidFrom')}</label>
                  <select
                    id="adv-acct" className="form-select" value={form.payment_account_id}
                    onChange={e => setForm({ ...form, payment_account_id: e.target.value })}
                  >
                    <option value="">{t('payroll.defaultCash')}</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="form-label" htmlFor="adv-reason">{t('payroll.reason')}</label>
                  <input
                    id="adv-reason" className="form-input" value={form.reason}
                    onChange={e => setForm({ ...form, reason: e.target.value })}
                  />
                </div>
                {formError && <p className="md:col-span-3 text-sm text-red-600">{formError}</p>}
                <div className="md:col-span-3 flex justify-end">
                  <button
                    className="btn-primary" onClick={saveAdvance}
                    disabled={saving || !form.employee_id || !form.amount}
                  >
                    <Save size={15} /> {saving ? t('common.saving') : t('common.save')}
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
                      <td className="text-xs text-slate-500">{new Date(a.advance_date).toLocaleDateString('en-IN')}</td>
                      <td className="text-right tabular-nums">₹{fmtPaise(a.amount_paise)}</td>
                      <td className="text-right tabular-nums text-green-700">₹{fmtPaise(a.recovered_paise)}</td>
                      <td className="text-right tabular-nums font-semibold">₹{fmtPaise(a.outstanding_paise)}</td>
                      <td className="text-xs">
                        {modeLabel(a.recovery_mode)}
                        {a.recovery_mode === 'instalment' && a.instalment_paise > 0 && (
                          <span className="text-slate-500"> · ₹{fmtPaise(a.instalment_paise)}</span>
                        )}
                      </td>
                      <td>
                        {a.status === 'active'
                          ? <span className="badge-blue">{t('payroll.statusActive')}</span>
                          : <span className="badge-gray">{t('payroll.statusClosed')}</span>}
                      </td>
                      <td className="text-right">
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
