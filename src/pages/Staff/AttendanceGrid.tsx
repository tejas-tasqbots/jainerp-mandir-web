import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, RefreshCw, Save } from 'lucide-react'
import { api, todayIst } from '../../lib/api'
import { useToast } from '../../components/kit/Toast'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'

/**
 * The month's attendance register.
 *
 * This is what payroll was missing. The salary run reads `staff_attendance`,
 * but nothing wrote it: there was no screen anywhere in the product to mark
 * somebody present, absent, on half a day, or on leave. The engine was
 * computing from an empty table.
 *
 * Shaped like the paper register it replaces — people down, days across —
 * because that is what the person holding it already knows how to read. A cell
 * CYCLES on click (present → absent → half day → leave → clear) so a month can
 * be marked without a dialog per day, and a whole row or column can be filled
 * in one action.
 *
 * Nothing is written until Save. A register is corrected as the day goes on,
 * and a screen that saved every click would turn each correction into an audit
 * entry nobody asked for.
 *
 * Tester report 2026-10-20:
 *  - "All Present" marked the days after today present, and payroll paid
 *    them. A day that has not come cannot be marked - not by a cell, a row's
 *    "All present" or a column - and the API skips one if sent.
 *  - "Changing Leave Type has no effect." The type picker only ever applied
 *    to the NEXT leave marked, and an L cell did not say which leave it was,
 *    so a leave could not be seen or corrected. Each L now shows its type
 *    (C, S, F...), and clicking an L while another type is picked changes that
 *    day to the picked type instead of clearing it.
 */

type Status = 'present' | 'absent' | 'half_day' | 'leave'

interface RosterRow {
  id: string
  name: string
  role: string | null
  staff_type: 'employee' | 'priest' | 'volunteer'
  is_paid: boolean
  joining_date?: string | null
  /** Last working day, when an exit is recorded (tenant migration 066). */
  leaving_date?: string | null
}
interface LeaveType { id: string; name: string; is_paid: boolean }
interface Mark {
  staff_type: string
  staff_id: string
  attendance_date: string
  status: Status
  leave_type_id: string | null
}

/** The cycle a cell walks through on repeated clicks. */
const CYCLE: (Status | null)[] = ['present', 'absent', 'half_day', 'leave', null]

const LETTER: Record<Status, string> = {
  present: 'P', absent: 'A', half_day: 'H', leave: 'L',
}
const TONE: Record<Status, string> = {
  present: 'bg-green-100 text-green-800',
  absent: 'bg-red-100 text-red-700',
  half_day: 'bg-amber-100 text-amber-800',
  leave: 'bg-blue-100 text-blue-800',
}

const thisMonth = () => todayIst().slice(0, 7)
const key = (t: string, id: string, d: string) => `${t}|${id}|${d}`

/**
 * A short code per leave type for the L cells: the first letter of its name,
 * or the first two where two types share a letter (Sick / Special).
 */
function leaveCodes(types: LeaveType[]): Record<string, string> {
  const first = (n: string) => Array.from(n.trim())[0]?.toUpperCase() ?? ''
  const counts = new Map<string, number>()
  for (const lt of types) counts.set(first(lt.name), (counts.get(first(lt.name)) ?? 0) + 1)
  const out: Record<string, string> = {}
  for (const lt of types) {
    const f = first(lt.name)
    out[lt.id] = (counts.get(f) ?? 0) > 1 ? Array.from(lt.name.trim()).slice(0, 2).join('') : f
  }
  return out
}

export function AttendanceGrid() {
  const { t } = useTranslation()
  const toast = useToast()
  const [month, setMonth] = useState(thisMonth())
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [days, setDays] = useState(30)
  const [marks, setMarks] = useState<Record<string, { status: Status; leave_type_id: string | null }>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Which leave type a newly-set 'leave' cell gets. One control at the top
  // rather than a dropdown in every cell — a trust marking leave is almost
  // always marking the same kind on the same day.
  const [leaveTypeId, setLeaveTypeId] = useState('')
  // The SERVER's IST day (the attendance response carries it): no day after
  // it can be marked. todayIst() until the first load answers.
  const [today, setToday] = useState(todayIst())

  const load = useCallback(async (m: string) => {
    setLoading(true)
    try {
      const { data } = await api.get('/payroll/attendance', { params: { month: m } })
      const d = data.data ?? data
      setRoster(d.roster ?? [])
      setLeaveTypes(d.leave_types ?? [])
      setDays(d.days_in_month ?? 30)
      if (d.today) setToday(d.today)
      const next: Record<string, { status: Status; leave_type_id: string | null }> = {}
      for (const mk of (d.marks ?? []) as Mark[]) {
        next[key(mk.staff_type, mk.staff_id, mk.attendance_date)] =
          { status: mk.status, leave_type_id: mk.leave_type_id }
      }
      setMarks(next)
      setDirty(new Set())
      if (!leaveTypeId && d.leave_types?.length) setLeaveTypeId(d.leave_types[0].id)
    } catch {
      setRoster([])
      toast.error(t('staff.attendanceLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t, toast, leaveTypeId])

  useEffect(() => { load(month) }, [month])

  const dateOf = (day: number) => `${month}-${String(day).padStart(2, '0')}`

  /**
   * A day this person was not on the rolls: before joining, or after the last
   * working day. Payroll neither pays nor docks it, so the register does not
   * offer it — a person who left on the 15th has fifteen cells, not thirty.
   */
  function offRolls(row: RosterRow, day: number): boolean {
    const d = dateOf(day)
    return (!!row.joining_date && d < row.joining_date) || (!!row.leaving_date && d > row.leaving_date)
  }

  /** A day that has not come yet: nothing to mark. */
  const isFuture = (day: number) => dateOf(day) > today

  function setCell(row: RosterRow, day: number, status: Status | null) {
    if (offRolls(row, day) || isFuture(day)) return
    const k = key(row.staff_type, row.id, dateOf(day))
    setMarks(prev => {
      const next = { ...prev }
      if (status === null) delete next[k]
      else next[k] = { status, leave_type_id: status === 'leave' ? (leaveTypeId || null) : null }
      return next
    })
    setDirty(prev => new Set(prev).add(k))
  }

  function cycle(row: RosterRow, day: number) {
    const current = marks[key(row.staff_type, row.id, dateOf(day))]
    // A leave of another type than the one picked: the click changes its type
    // (and the salary, when one is paid and the other is not). Clicking it
    // again carries on round the cycle.
    if (current?.status === 'leave' && leaveTypeId && current.leave_type_id !== leaveTypeId) {
      setCell(row, day, 'leave')
      return
    }
    const i = CYCLE.indexOf(current?.status ?? null)
    setCell(row, day, CYCLE[(i + 1) % CYCLE.length])
  }

  /** Fill a whole person's month, or a whole day's column. */
  function fillRow(row: RosterRow, status: Status) {
    for (let d = 1; d <= days; d++) setCell(row, d, status)
  }
  function fillColumn(day: number, status: Status) {
    for (const row of roster) setCell(row, day, status)
  }

  async function save() {
    if (!dirty.size) { toast.info(t('staff.nothingToSave')); return }
    setSaving(true)
    try {
      // Only what changed. A cleared cell has no status to send, so it is
      // dropped rather than posted — the API upserts, it does not delete.
      const entries = [...dirty]
        .map(k => {
          const [staff_type, staff_id, attendance_date] = k.split('|')
          const m = marks[k]
          return m ? { staff_type, staff_id, attendance_date, status: m.status, leave_type_id: m.leave_type_id } : null
        })
        .filter(Boolean)
      if (!entries.length) { setDirty(new Set()); setSaving(false); return }
      const { data } = await api.post('/payroll/attendance', { entries })
      const res = data.data ?? data
      toast.success(t('staff.attendanceSaved', { count: res?.marked ?? entries.length }))
      if (res?.skipped_future) toast.info(t('staff.futureSkipped', { count: res.skipped_future }))
      await load(month)
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message ?? t('staff.attendanceSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const totals = useMemo(() => {
    const per: Record<string, Record<Status, number>> = {}
    for (const row of roster) {
      per[row.id] = { present: 0, absent: 0, half_day: 0, leave: 0 }
      for (let d = 1; d <= days; d++) {
        const m = marks[key(row.staff_type, row.id, dateOf(d))]
        if (m) per[row.id][m.status]++
      }
    }
    return per
  }, [roster, marks, days, month])

  const grouped = useMemo(() => ({
    employee: roster.filter(r => r.staff_type === 'employee'),
    priest: roster.filter(r => r.staff_type === 'priest'),
    volunteer: roster.filter(r => r.staff_type === 'volunteer'),
  }), [roster])

  const codes = useMemo(() => leaveCodes(leaveTypes), [leaveTypes])
  const leaveName = (id: string | null) => {
    const lt = leaveTypes.find(x => x.id === id)
    return lt ? `${lt.name}${lt.is_paid ? '' : ` (${t('staff.unpaid')})`}` : t('staff.leaveTypeUnknown')
  }

  const typeLabel: Record<string, string> = {
    employee: t('staff.employees'), priest: t('staff.priests'), volunteer: t('staff.volunteers'),
  }

  function renderRows(rows: RosterRow[], groupKey: string) {
    if (!rows.length) return null
    return [
      <tr key={`h-${groupKey}`} className="bg-slate-50">
        <td colSpan={days + 6} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {typeLabel[groupKey]}
          {groupKey === 'volunteer' && (
            <span className="ml-2 font-normal normal-case">{t('staff.volunteerNotPaid')}</span>
          )}
        </td>
      </tr>,
      ...rows.map(row => (
        <tr key={row.id}>
          <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-medium whitespace-nowrap border-r border-slate-200">
            {row.name}
            {row.role && <span className="block text-xs font-normal text-slate-500">{row.role}</span>}
            {row.leaving_date && (
              <span className="block text-[11px] font-normal text-amber-700">
                {t('staff.lastDay', { date: new Date(`${row.leaving_date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) })}
              </span>
            )}
          </th>
          {Array.from({ length: days }, (_, i) => i + 1).map(day => {
            const m = marks[key(row.staff_type, row.id, dateOf(day))]
            if (offRolls(row, day)) {
              return (
                <td key={day} className="p-0 border border-slate-100 text-center bg-slate-100">
                  <span className="inline-flex w-7 h-7 items-center justify-center text-[10px] text-slate-400"
                    title={`${row.name} · ${dateOf(day)} · ${t('staff.notOnRolls')}`}>–</span>
                </td>
              )
            }
            if (isFuture(day)) {
              return (
                <td key={day} className="p-0 border border-slate-100 text-center bg-slate-50" data-testid="att-future">
                  <span className="inline-flex w-7 h-7 items-center justify-center text-[10px] text-slate-300"
                    title={`${row.name} · ${dateOf(day)} · ${t('staff.notYet')}`}>·</span>
                </td>
              )
            }
            const isLeave = m?.status === 'leave'
            const what = m ? t('staff.status_' + m.status) + (isLeave ? ` · ${leaveName(m.leave_type_id)}` : '') : t('staff.notMarked')
            return (
              <td key={day} className="p-0 border border-slate-100 text-center">
                <button
                  type="button"
                  onClick={() => cycle(row, day)}
                  className={`w-7 h-7 text-xs font-semibold ${m ? TONE[m.status] : 'text-slate-300 hover:bg-slate-100'}`}
                  title={`${row.name} · ${dateOf(day)} · ${what}`}
                  aria-label={`${row.name} ${dateOf(day)} ${what}`}
                  data-testid={`att-${row.id}-${day}`}
                >
                  {m ? LETTER[m.status] : '·'}
                  {isLeave && m.leave_type_id && codes[m.leave_type_id] && (
                    <sub className="text-[8px] font-bold">{codes[m.leave_type_id]}</sub>
                  )}
                </button>
              </td>
            )
          })}
          <td className="px-2 text-center text-xs tabular-nums text-green-700">{totals[row.id]?.present || '—'}</td>
          <td className="px-2 text-center text-xs tabular-nums text-red-600">{totals[row.id]?.absent || '—'}</td>
          <td className="px-2 text-center text-xs tabular-nums text-amber-700">{totals[row.id]?.half_day || '—'}</td>
          <td className="px-2 text-center text-xs tabular-nums text-blue-700">{totals[row.id]?.leave || '—'}</td>
          <td className="px-2 whitespace-nowrap no-print">
            {/* Up to today only: setCell skips the days still ahead. */}
            <button className="btn-secondary btn-sm" onClick={() => fillRow(row, 'present')}
              disabled={isFuture(1)} title={t('staff.allPresentHint')}>
              <Check size={12} /> {t('staff.allPresent')}
            </button>
          </td>
        </tr>
      )),
    ]
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('staff.attendanceRegister')} subtitle={month} />

      <div className="card no-print">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div>
            <label className="form-label" htmlFor="att-month">{t('staff.month')}</label>
            <input id="att-month" type="month" className="form-input" value={month} max={today.slice(0, 7)}
              onChange={e => { if (e.target.value && e.target.value <= today.slice(0, 7)) setMonth(e.target.value) }} />
          </div>
          <div>
            <label className="form-label" htmlFor="att-leave">{t('staff.leaveTypeForNew')}</label>
            <select id="att-leave" className="form-select" value={leaveTypeId}
              onChange={e => setLeaveTypeId(e.target.value)} aria-describedby="att-leave-hint">
              {leaveTypes.map(lt => (
                <option key={lt.id} value={lt.id}>
                  {codes[lt.id]} · {lt.name}{lt.is_paid ? '' : ` — ${t('staff.unpaid')}`}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-secondary" onClick={() => load(month)} disabled={loading}>
            <RefreshCw size={15} /> {t('staff.refresh')}
          </button>
          <button className="btn-primary" onClick={save} disabled={saving || !dirty.size}>
            <Save size={15} /> {saving ? t('common.saving') : t('staff.saveCount', { count: dirty.size })}
          </button>
          <div className="text-xs text-slate-500 max-w-sm space-y-0.5">
            <p>{t('staff.cycleHint')}</p>
            <p id="att-leave-hint">{t('staff.leaveTypeHint')}</p>
            <p>{t('staff.futureHint')}</p>
          </div>
        </div>
      </div>

      {/* Legend — the letters mean nothing without it, and this register is printed. */}
      <div className="flex flex-wrap gap-3 text-xs">
        {(Object.keys(LETTER) as Status[]).map(s => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-flex w-5 h-5 items-center justify-center font-semibold rounded ${TONE[s]}`}>{LETTER[s]}</span>
            {t('staff.status_' + s)}
          </span>
        ))}
        {/* Which leave each L is - printed with the register. */}
        {leaveTypes.length > 0 && (
          <span className="text-slate-500" data-testid="att-leave-legend">
            ({leaveTypes.map(lt => `${codes[lt.id]} ${lt.name}${lt.is_paid ? '' : ` · ${t('staff.unpaid')}`}`).join(', ')})
          </span>
        )}
      </div>

      <div className="card">
        <div className="card-body overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white px-3 py-2 text-left border-r border-slate-200">{t('staff.person')}</th>
                {Array.from({ length: days }, (_, i) => i + 1).map(day => {
                  const dow = new Date(`${dateOf(day)}T00:00:00Z`).getUTCDay()
                  return (
                    <th key={day}
                      className={`w-7 text-xs font-medium ${dow === 0 ? 'text-red-500' : 'text-slate-500'}`}>
                      {day}
                    </th>
                  )
                })}
                <th className="px-2 text-xs text-green-700">P</th>
                <th className="px-2 text-xs text-red-600">A</th>
                <th className="px-2 text-xs text-amber-700">H</th>
                <th className="px-2 text-xs text-blue-700">L</th>
                <th className="no-print" />
              </tr>
              <tr className="no-print">
                <th className="sticky left-0 bg-white px-3 py-1 text-left text-xs font-normal text-slate-400 border-r border-slate-200">
                  {t('staff.markWholeDay')}
                </th>
                {Array.from({ length: days }, (_, i) => i + 1).map(day => (
                  <th key={day} className="p-0">
                    {!isFuture(day) && (
                      <button type="button" onClick={() => fillColumn(day, 'present')}
                        className="w-7 h-5 text-[10px] text-slate-300 hover:bg-green-50 hover:text-green-700"
                        title={t('staff.markDayPresent', { day })}>P</button>
                    )}
                  </th>
                ))}
                <th colSpan={5} />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={days + 6} className="text-center text-slate-400 py-6">{t('common.loading')}</td></tr>}
              {!loading && !roster.length && (
                <tr><td colSpan={days + 6} className="text-center text-slate-400 py-6">{t('staff.noStaffYet')}</td></tr>
              )}
              {!loading && renderRows(grouped.employee, 'employee')}
              {!loading && renderRows(grouped.priest, 'priest')}
              {!loading && renderRows(grouped.volunteer, 'volunteer')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
