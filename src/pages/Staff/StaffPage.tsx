import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, FileText, IndianRupee, LogOut, UserCheck, Users } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { AttendanceGrid } from './AttendanceGrid'
import { PayrollPage } from '../Payroll/PayrollPage'
import { printPayslip } from '../../lib/printVoucher'
import { ExitDialog, fmtDay, RejoinDialog, StaffStatusBadge, type StaffStatus } from './StaffLifecycle'

/**
 * Staff: everyone the trust manages, in one place.
 *
 * Before this, a mandir admin looking for "the people who work here" had to
 * know that priests were under Masters, employees and volunteers were under a
 * different Masters entry, and payroll was a third — three nav items for one
 * mental model, sitting beside Vendors and Inventory as though a cook were
 * master data.
 *
 * They are three tables underneath (`employees`, `priests`, `volunteers`) and
 * that has not changed. What changed is that the product stops making the
 * reader carry that split around: one section, three tabs, and a profile per
 * person reached by clicking their name — the same shape as a donor.
 */

type Tab = 'directory' | 'attendance' | 'payroll'

interface RosterRow {
  id: string
  name: string
  role: string | null
  staff_type: 'employee' | 'priest' | 'volunteer'
  is_paid: boolean
  salary_type: string | null
  monthly_salary_paise: number
  // Tenant migration 066: dates and where the person stands.
  is_active: boolean
  status: StaffStatus
  joining_date: string | null
  leaving_date: string | null
  exit_reason: string | null
}

const TYPE_TONE: Record<string, string> = {
  employee: 'badge-blue', priest: 'badge-yellow', volunteer: 'badge-gray',
}

export function StaffPage({ initialTab = 'directory' }: { initialTab?: Tab }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(initialTab)

  const tabs: { key: Tab; label: string; icon: JSX.Element }[] = [
    { key: 'directory', label: t('staff.directory'), icon: <Users size={14} /> },
    { key: 'attendance', label: t('staff.attendance'), icon: <CalendarCheck size={14} /> },
    { key: 'payroll', label: t('staff.payroll'), icon: <IndianRupee size={14} /> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <h1 className="text-xl font-semibold text-navy-900">{t('nav.staff')}</h1>
        <div className="flex gap-2">
          {tabs.map(x => (
            <button
              key={x.key}
              className={tab === x.key ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
              onClick={() => setTab(x.key)}
            >
              {x.icon} {x.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'directory' && <StaffDirectory onOpen={id => navigate(`/staff/${id}`)} />}
      {tab === 'attendance' && <AttendanceGrid />}
      {tab === 'payroll' && <PayrollPage />}
    </div>
  )
}

function StaffDirectory({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'employee' | 'priest' | 'volunteer'>('all')
  // Who is listed: the people still working (the default), those who left,
  // or everyone (tenant migration 066).
  const [standing, setStanding] = useState<'working' | 'left' | 'everyone'>('working')

  useEffect(() => {
    api.get('/payroll/roster', { params: { include: 'all' } })
      .then(r => setRoster(r.data.data ?? r.data ?? []))
      .catch(() => setRoster([]))
      .finally(() => setLoading(false))
  }, [])

  // Serving notice counts as working: they still come in.
  const working = useMemo(() => roster.filter(r => r.status !== 'left'), [roster])

  const shown = useMemo(() => roster.filter(r =>
    (only === 'all' || r.staff_type === only)
    && (standing === 'everyone' || (standing === 'left') === (r.status === 'left'))
    && (!q || r.name.toLowerCase().includes(q.toLowerCase())
        || (r.role ?? '').toLowerCase().includes(q.toLowerCase()))
  ), [roster, q, only, standing])

  const paidMonthly = working
    .filter(r => r.is_paid && r.salary_type === 'monthly')
    .reduce((n, r) => n + Number(r.monthly_salary_paise || 0), 0)

  const stats: SummaryStat[] = [
    { label: t('staff.total'), value: String(working.length), sub: t('staff.leftSub', { count: roster.length - working.length }) },
    { label: t('staff.employees'), value: String(working.filter(r => r.staff_type === 'employee').length) },
    { label: t('staff.priests'), value: String(working.filter(r => r.staff_type === 'priest').length) },
    // Volunteers attend but are never paid, so the monthly wage bill excludes
    // them — showing a headcount total next to a salary total would imply they
    // cost something.
    { label: t('staff.monthlyWageBill'), value: `₹${fmtPaise(paidMonthly)}`, tone: 'expense' },
  ]

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('staff.directory')} />
      <SummaryStrip stats={stats} />

      <div className="card no-print">
        <div className="card-body flex flex-wrap gap-3">
          <input
            className="form-input flex-1 min-w-[200px]" value={q} onChange={e => setQ(e.target.value)}
            placeholder={t('staff.searchPlaceholder')} aria-label={t('staff.searchPlaceholder')}
          />
          <select className="form-select w-auto" value={only} onChange={e => setOnly(e.target.value as typeof only)}>
            <option value="all">{t('staff.allTypes')}</option>
            <option value="employee">{t('staff.employees')}</option>
            <option value="priest">{t('staff.priests')}</option>
            <option value="volunteer">{t('staff.volunteers')}</option>
          </select>
          <select className="form-select w-auto" value={standing} aria-label={t('staff.standing')}
            onChange={e => setStanding(e.target.value as typeof standing)} data-testid="staff-standing">
            <option value="working">{t('staff.standingWorking')}</option>
            <option value="left">{t('staff.standingLeft')}</option>
            <option value="everyone">{t('staff.standingEveryone')}</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div className="card-body overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('staff.person')}</th>
                <th>{t('staff.type')}</th>
                <th>{t('staff.role')}</th>
                <th>{t('common.status')}</th>
                <th className="text-right">{t('staff.salary')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="text-center text-slate-400 py-6">{t('common.loading')}</td></tr>}
              {!loading && !shown.length && (
                <tr><td colSpan={5} className="text-center text-slate-400 py-6">{t('staff.noneMatch')}</td></tr>
              )}
              {!loading && shown.map(r => (
                <tr key={`${r.staff_type}-${r.id}`}>
                  <td>
                    <button className="font-medium text-navy-800 hover:underline" onClick={() => onOpen(r.id)}>
                      {r.name}
                    </button>
                  </td>
                  <td><span className={TYPE_TONE[r.staff_type]}>{t('staff.' + r.staff_type)}</span></td>
                  <td className="text-slate-600">{r.role ?? '—'}</td>
                  <td><StaffStatusBadge isActive={r.is_active} leavingDate={r.leaving_date} reason={r.exit_reason} /></td>
                  <td className="text-right tabular-nums">
                    {r.is_paid && Number(r.monthly_salary_paise) > 0
                      ? <>₹{fmtPaise(r.monthly_salary_paise)}
                          <span className="text-xs text-slate-500">{r.salary_type === 'daily' ? t('staff.perDay') : t('staff.perMonth')}</span>
                        </>
                      : <span className="text-slate-400">{r.is_paid ? '—' : t('staff.unpaidRole')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/**
 * One person: what they are paid, what they have attended, what they owe.
 *
 * The same idea as a donor profile — everything about one party on one page,
 * instead of the reader joining three screens in their head.
 */
interface ServiceEvent {
  id: string
  event: 'left' | 'rejoined' | 'exit_updated' | 'exit_cancelled'
  event_date: string
  reason: string | null
  notes: string | null
  recorded_by_name: string | null
}

export function StaffProfile() {
  const { t } = useTranslation()
  const toast = useToast()
  const { id = '' } = useParams()
  const [person, setPerson] = useState<RosterRow | null>(null)
  const [advances, setAdvances] = useState<any[]>([])
  const [salaries, setSalaries] = useState<any[]>([])
  const [events, setEvents] = useState<ServiceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<'exit' | 'rejoin' | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    async function load() {
      try {
        // Everyone, including those who have left: a profile is history too.
        const roster = await api.get('/payroll/roster', { params: { include: 'all' } }).then(r => r.data.data ?? r.data ?? [])
        if (!live) return
        const found: RosterRow | null = roster.find((r: RosterRow) => r.id === id) ?? null
        setPerson(found)
        if (found) {
          api.get(`/staff/${found.staff_type}/${id}/service`)
            .then(r => { if (live) setEvents((r.data.data ?? r.data)?.events ?? []) })
            .catch(() => { if (live) setEvents([]) })
        }
        const [adv, sal] = await Promise.all([
          api.get('/payroll/advances', { params: { employee_id: id } })
            .then(r => r.data.data ?? r.data ?? []).catch(() => []),
          // This person's own records. It used to read the latest 24 records
          // of EVERYONE and filter them here, so with a few staff an
          // employee's history stopped after a month or two.
          api.get('/payroll/salaries', { params: { employee_id: id, limit: '36' } })
            .then(r => r.data.data ?? r.data ?? []).catch(() => []),
        ])
        if (!live) return
        setAdvances(adv)
        setSalaries(sal)
      } finally {
        if (live) setLoading(false)
      }
    }
    load()
    return () => { live = false }
  }, [id, reload])

  const outstanding = advances
    .filter(a => a.status === 'active')
    .reduce((n, a) => n + Number(a.outstanding_paise ?? 0), 0)

  if (loading) return <div className="card"><div className="card-body text-slate-400">{t('common.loading')}</div></div>
  if (!person) {
    return (
      <div className="card">
        <div className="card-body">
          <p className="text-slate-500">{t('staff.notFound')}</p>
          <Link to="/staff" className="btn-secondary btn-sm mt-3">{t('staff.backToStaff')}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={person.name} subtitle={person.role ?? undefined} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">{person.name}</h1>
          <p className="text-sm text-slate-500 flex flex-wrap items-center gap-2">
            <span className={TYPE_TONE[person.staff_type]}>{t('staff.' + person.staff_type)}</span>
            {person.role && <span>{person.role}</span>}
            <StaffStatusBadge isActive={person.is_active} leavingDate={person.leaving_date} reason={person.exit_reason} />
          </p>
        </div>
        <div className="flex gap-2 no-print">
          {person.status === 'left'
            ? (
              <button className="btn-secondary btn-sm" onClick={() => setDialog('rejoin')}>
                <UserCheck size={14} /> {t('staffExit.rejoin')}
              </button>
            ) : (
              <button className="btn-secondary btn-sm" onClick={() => setDialog('exit')} data-testid="profile-mark-left">
                <LogOut size={14} /> {person.status === 'leaving' ? t('staffExit.editExit') : t('staffExit.markLeft')}
              </button>
            )}
          <Link to="/staff" className="btn-secondary btn-sm">{t('staff.backToStaff')}</Link>
        </div>
      </div>

      {dialog === 'exit' && (
        <ExitDialog type={person.staff_type} id={person.id} name={person.name} onClose={() => setDialog(null)}
          onDone={() => { toast.success(t('staffExit.recorded', { name: person.name })); setDialog(null); setReload(n => n + 1) }} />
      )}
      {dialog === 'rejoin' && (
        <RejoinDialog type={person.staff_type} id={person.id} name={person.name} leavingDate={person.leaving_date}
          onClose={() => setDialog(null)}
          onDone={() => { toast.success(t('staffExit.rejoined', { name: person.name })); setDialog(null); setReload(n => n + 1) }} />
      )}

      <SummaryStrip stats={[
        {
          label: t('staff.salary'),
          value: person.is_paid && Number(person.monthly_salary_paise) > 0
            ? `₹${fmtPaise(person.monthly_salary_paise)}` : '—',
          sub: person.is_paid ? (person.salary_type === 'daily' ? t('staff.perDay') : t('staff.perMonth')) : t('staff.unpaidRole'),
        },
        { label: t('staff.advanceOutstanding'), value: `₹${fmtPaise(outstanding)}`, tone: outstanding ? 'expense' : 'default' },
        { label: t('staff.monthsPaid'), value: String(salaries.filter(s => s.paid_at).length) },
      ]} />

      <div className="card">
        <div className="card-header">{t('staff.advances')}</div>
        <div className="card-body overflow-x-auto">
          {!advances.length
            ? <p className="text-sm text-slate-400">{t('staff.noAdvances')}</p>
            : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('staff.date')}</th>
                    <th className="text-right">{t('staff.amount')}</th>
                    <th className="text-right">{t('staff.recovered')}</th>
                    <th className="text-right">{t('staff.outstanding')}</th>
                    <th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map(a => (
                    <tr key={a.id}>
                      <td className="text-xs text-slate-500">{new Date(a.advance_date).toLocaleDateString('en-IN')}</td>
                      <td className="text-right tabular-nums">₹{fmtPaise(a.amount_paise)}</td>
                      <td className="text-right tabular-nums text-green-700">₹{fmtPaise(a.recovered_paise)}</td>
                      <td className="text-right tabular-nums font-semibold">₹{fmtPaise(a.outstanding_paise)}</td>
                      <td>
                        <span className={a.status === 'active' ? 'badge-blue' : 'badge-gray'}>
                          {a.status === 'active' ? t('staff.statusActive') : t('staff.statusClosed')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">{t('staff.salaryHistory')}</div>
        <div className="card-body overflow-x-auto">
          {!salaries.length
            ? <p className="text-sm text-slate-400">{t('staff.noSalaryYet')}</p>
            : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('staff.month')}</th>
                    <th className="text-right">{t('staff.present')}</th>
                    <th className="text-right">{t('staff.gross')}</th>
                    <th className="text-right">{t('staff.advanceRecovered')}</th>
                    <th className="text-right">{t('staff.net')}</th>
                    <th>{t('common.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {salaries.map(s => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.month}</td>
                      <td className="text-right tabular-nums">{s.days_present}</td>
                      <td className="text-right tabular-nums">₹{fmtPaise(s.gross_paise)}</td>
                      <td className="text-right tabular-nums text-red-600">
                        {Number(s.advance_recovered_paise) ? `−₹${fmtPaise(s.advance_recovered_paise)}` : '—'}
                      </td>
                      <td className="text-right tabular-nums font-semibold">₹{fmtPaise(s.net_paise)}</td>
                      <td>
                        {/* paid_at is what gates the cash statements, so it is
                            the only honest thing to show as "paid". */}
                        {s.paid_at
                          ? <span className="badge-green">{t('staff.paid')}</span>
                          : <span className="badge-yellow">{t('staff.computedNotPaid')}</span>}
                        {s.voucher_no && <span className="block text-[11px] font-mono text-slate-500">{s.voucher_no}</span>}
                      </td>
                      <td className="text-right">
                        <button
                          className="p-1.5 text-slate-500 hover:text-navy-900" title={t('payroll.payslip')}
                          aria-label={t('payroll.payslip')} onClick={() => printPayslip(s.id).catch(() => {})}
                        >
                          <FileText size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>

      {/* Time on the rolls: joined, left, came back (tenant migration 066). */}
      <div className="card" data-testid="staff-service-history">
        <div className="card-header">{t('staffExit.serviceHistory')}</div>
        <div className="card-body">
          <ul className="space-y-2 text-sm">
            {person.joining_date && !events.some(e => e.event === 'rejoined') && (
              <li><span className="font-medium">{fmtDay(person.joining_date)}</span> — {t('staffExit.event_joined')}</li>
            )}
            {events.map(e => (
              <li key={e.id}>
                <span className="font-medium">{fmtDay(e.event_date)}</span> — {t(`staffExit.event_${e.event}`)}
                {e.reason && <> · {t(`staffExit.reason_${e.reason}`)}</>}
                {e.notes && <span className="block text-xs text-slate-500">{e.notes}</span>}
                {e.recorded_by_name && <span className="block text-[11px] text-slate-400">{t('staffExit.recordedBy', { name: e.recorded_by_name })}</span>}
              </li>
            ))}
            {!person.joining_date && !events.length && <li className="text-slate-400">{t('staffExit.noHistory')}</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}
