import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogOut, UserCheck, X } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise, todayIst } from '../../lib/api'

/**
 * A staff member's time on the rolls (tenant migration 066): the status badge,
 * and the two dialogs that change it — "Mark as left" and "Re-join".
 *
 * Leaving is recorded the way payroll software records it: a last working day
 * and a reason. The person comes off the active list at once but stays on the
 * attendance register and in the salary run up to that day, so the month they
 * leave in is paid for the days they worked. Nothing is deleted: their
 * attendance, salary slips and advances stay, and they can re-join.
 */

export type StaffType = 'employee' | 'volunteer' | 'priest'
export type StaffStatus = 'active' | 'leaving' | 'left'

export const EXIT_REASONS = ['resigned', 'terminated', 'retired', 'contract_ended', 'absconding', 'deceased', 'other'] as const

/** active | leaving (exit recorded, last day ahead) | left — the API's rule. */
export function statusOf(isActive: boolean, leavingDate: string | null | undefined, today = todayIst()): StaffStatus {
  if (isActive) return 'active'
  if (leavingDate && leavingDate >= today) return 'leaving'
  return 'left'
}

export function fmtDay(day?: string | null): string {
  if (!day) return ''
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function StaffStatusBadge({ isActive, leavingDate, reason }: {
  isActive: boolean; leavingDate?: string | null; reason?: string | null
}) {
  const { t } = useTranslation()
  const status = statusOf(isActive, leavingDate)
  if (status === 'active') return <span className="badge-green">{t('employees.active')}</span>
  const why = reason ? t(`staffExit.reason_${reason}`) : ''
  if (status === 'leaving') {
    return (
      <span className="badge-yellow" title={why || undefined}>
        {t('staffExit.leavingOn', { date: fmtDay(leavingDate) })}
      </span>
    )
  }
  return (
    <span className="badge-gray" title={why || undefined}>
      {leavingDate ? t('staffExit.leftOn', { date: fmtDay(leavingDate) }) : t('employees.inactive')}
    </span>
  )
}

interface Settlement {
  outstanding_advance_paise: number
  open_advances: number
  unpaid_salaries: { id: string; month: string; net_paise: number }[]
  last_paid_month: string | null
  final_month: string | null
  final_month_status: 'paid' | 'computed' | 'not_run' | null
}

interface Service {
  status: StaffStatus
  joining_date: string | null
  leaving_date: string | null
  exit_reason: string | null
  exit_notes: string | null
  settlement: Settlement | null
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-navy-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} className="text-slate-400" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * "Mark as left" — or, for someone already left, correct the date or reason.
 * For an employee it shows what is still to be settled before they go: an
 * advance still owed, salary computed but not paid, and whether their last
 * month has been run.
 */
export function ExitDialog({ type, id, name, onClose, onDone }: {
  type: StaffType; id: string; name: string; onClose: () => void; onDone: () => void
}) {
  const { t } = useTranslation()
  const [service, setService] = useState<Service | null>(null)
  const [form, setForm] = useState({ leaving_date: todayIst(), reason: 'resigned', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get(`/staff/${type}/${id}/service`).then(r => {
      const s: Service = r.data.data ?? r.data
      setService(s)
      if (s.leaving_date) {
        setForm({ leaving_date: s.leaving_date, reason: s.exit_reason ?? 'resigned', notes: s.exit_notes ?? '' })
      }
    }).catch(() => setService(null))
  }, [type, id])

  const amending = !!service && service.status !== 'active' && !!service.leaving_date
  const s = service?.settlement
  // "October 2026", not "2026-10".
  const finalMonth = /^\d{4}-\d{2}/.test(form.leaving_date)
    ? new Date(`${form.leaving_date.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : ''

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.post(`/staff/${type}/${id}/exit`, {
        leaving_date: form.leaving_date, reason: form.reason, notes: form.notes.trim() || undefined,
      })
      onDone()
    } catch (err) {
      setError(apiErrorMessage(err, t('staffExit.failed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={amending ? t('staffExit.editTitle', { name }) : t('staffExit.title', { name })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" data-testid="staff-exit-dialog">
        <p className="text-sm text-slate-600">{t('staffExit.explain')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label" htmlFor="exit-date">{t('staffExit.lastWorkingDay')}</label>
            <input id="exit-date" type="date" className="form-input" required value={form.leaving_date}
              min={service?.joining_date ?? undefined}
              onChange={e => setForm(f => ({ ...f, leaving_date: e.target.value }))} />
          </div>
          <div>
            <label className="form-label" htmlFor="exit-reason">{t('staffExit.reason')}</label>
            <select id="exit-reason" className="form-select" value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
              {EXIT_REASONS.map(r => <option key={r} value={r}>{t(`staffExit.reason_${r}`)}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="form-label" htmlFor="exit-notes">{t('staffExit.notes')}</label>
          <textarea id="exit-notes" className="form-textarea" rows={2} maxLength={1000} value={form.notes}
            placeholder={t('staffExit.notesPlaceholder')}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        {/* The full-and-final checklist, employees only (volunteers are unpaid,
            priests are paid outside this payroll). */}
        {type === 'employee' && s && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm space-y-1.5" data-testid="staff-exit-settlement">
            <p className="font-semibold text-amber-900">{t('staffExit.settleTitle')}</p>
            <p className={s.outstanding_advance_paise > 0 ? 'text-amber-900' : 'text-slate-600'}>
              {s.outstanding_advance_paise > 0
                ? t('staffExit.advanceOwed', { amount: fmtPaise(s.outstanding_advance_paise), count: s.open_advances })
                : t('staffExit.noAdvance')}
            </p>
            {s.unpaid_salaries.length > 0 && (
              <p className="text-amber-900">
                {t('staffExit.unpaidSalaries', {
                  months: s.unpaid_salaries.map(u => `${u.month} (₹${fmtPaise(u.net_paise)})`).join(', '),
                })}
              </p>
            )}
            <p className="text-slate-700">{t('staffExit.finalMonth', { month: finalMonth })}</p>
          </div>
        )}

        {error && <p className="text-sm text-brand-red">{error}</p>}
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="btn-danger">
            <LogOut size={15} /> {saving ? t('common.saving') : amending ? t('staffExit.saveChanges') : t('staffExit.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Someone who left comes back, from a new joining date. */
export function RejoinDialog({ type, id, name, leavingDate, onClose, onDone }: {
  type: StaffType; id: string; name: string; leavingDate?: string | null; onClose: () => void; onDone: () => void
}) {
  const { t } = useTranslation()
  const [joining, setJoining] = useState(todayIst())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.post(`/staff/${type}/${id}/rejoin`, { joining_date: joining, notes: notes.trim() || undefined })
      onDone()
    } catch (err) {
      setError(apiErrorMessage(err, t('staffExit.failed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t('staffExit.rejoinTitle', { name })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" data-testid="staff-rejoin-dialog">
        <p className="text-sm text-slate-600">
          {leavingDate ? t('staffExit.rejoinExplainLeft', { date: fmtDay(leavingDate) }) : t('staffExit.rejoinExplain')}
        </p>
        <div>
          <label className="form-label" htmlFor="rejoin-date">{t('staffExit.newJoiningDate')}</label>
          <input id="rejoin-date" type="date" className="form-input" required value={joining}
            onChange={e => setJoining(e.target.value)} />
        </div>
        <div>
          <label className="form-label" htmlFor="rejoin-notes">{t('staffExit.notes')}</label>
          <input id="rejoin-notes" className="form-input" maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-sm text-brand-red">{error}</p>}
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <UserCheck size={15} /> {saving ? t('common.saving') : t('staffExit.rejoin')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** The person stayed after all: withdraw an exit whose last day is still ahead. */
export async function cancelExit(type: StaffType, id: string): Promise<void> {
  await api.post(`/staff/${type}/${id}/cancel-exit`, {})
}
