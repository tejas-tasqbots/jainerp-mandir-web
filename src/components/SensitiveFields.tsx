import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Clock } from 'lucide-react'
import { api } from '../lib/api'
import {
  formatCalendarDate,
  isStatutoryField,
  issueKey,
  normaliseStatutory,
  sameStatutoryValue,
  STATUTORY_EXAMPLE,
  STATUTORY_MAX_LENGTH,
  statutoryIssue,
} from '../lib/statutoryIds'
import { useToast } from './kit/Toast'

/* Sensitive mandir details, once the platform has verified them.

   The UPI ID and the registrations an 80G receipt rests on — PAN, 12A/12AB,
   the 80G number and its validity — are what devotees pay into and what a
   donor's deduction depends on. After verification the API rejects a direct
   PATCH (SENSITIVE_LOCKED), so the form must not pretend the input is
   editable — it shows the value locked with the reason, and offers to raise a
   change request the super admin reviews.

   GSTIN, TAN and FSSAI are NOT here: they are optional registrations the trust
   edits (and clears) itself, checked by the rules in lib/statutoryIds.

   The locked field list comes from GET /tenants/me rather than being duplicated
   here, so the UI cannot drift out of step with what the API actually enforces. */

export interface SensitiveState {
  locked: boolean
  verified_at: string | null
  fields: string[]
  pending_requests: { field: string; requested_value: string; requested_at: string }[]
}

interface PendingReq { field: string; requested_value: string; requested_at: string }

export function useSensitiveFields() {
  const { t } = useTranslation()
  const toast = useToast()
  const [state, setState] = useState<SensitiveState | null>(null)
  // The PAN on file: a requested 80G/12AB number must have been issued to it
  // (or to a PAN change already awaiting review).
  const [pan, setPan] = useState<string | null>(null)
  const [target, setTarget] = useState<{ field: string; label: string; current: string } | null>(null)
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/tenants/me')
      setState(data.data?.sensitive ?? null)
      setPan(data.data?.pan ?? null)
    } catch { /* settings still render; fields just stay editable */ }
  }, [])

  useEffect(() => { void load() }, [load])

  const locked = !!state?.locked
  /** A field is frozen only when the mandir is verified AND the field is listed. */
  const isLocked = (field: string) => locked && (state?.fields ?? []).includes(field)
  const pendingFor = (field: string): PendingReq | undefined =>
    state?.pending_requests?.find(r => r.field === field)

  function openRequest(field: string, label: string, current: string) {
    setTarget({ field, label, current })
    setValue('')
    setReason('')
  }

  // What the request would carry, and what is wrong with it — checked as it is
  // typed, so a malformed number never reaches the review queue.
  const statutory = !!target && isStatutoryField(target.field)
  const cleaned = target && isStatutoryField(target.field)
    ? normaliseStatutory(target.field, value) ?? ''
    : value.trim()
  const unchanged = !!target && !!cleaned && (isStatutoryField(target.field)
    ? sameStatutoryValue(target.field, cleaned, target.current)
    : cleaned === target.current.trim())
  // "Already the current value" is the answer to re-typing what is on file,
  // even when that value has its own problem — which the field itself shows.
  const issue = target && isStatutoryField(target.field) && cleaned && !unchanged
    ? statutoryIssue(target.field, cleaned, [pan, pendingFor('pan')?.requested_value])
    : null

  async function submit() {
    if (!target || !cleaned || issue || unchanged) return
    setSaving(true)
    try {
      await api.post('/tenants/me/change-requests', {
        field: target.field,
        requested_value: cleaned,
        reason: reason.trim() || undefined,
      })
      toast.success(t('sensitive.requestSent'))
      setTarget(null)
      await load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('sensitive.requestFailed'))
    } finally { setSaving(false) }
  }

  const isDate = target?.field === 'reg_80g_valid_upto'
  const modal = target ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="font-bold text-navy-900 mb-1">{t('sensitive.requestTitle')}</h3>
        <p className="text-sm text-slate-500 mb-4">{t('sensitive.requestSubtitle')}</p>
        <div className="space-y-3">
          <div>
            <label className="form-label" htmlFor="sensitive-fields-field-1">{target.label}</label>
            <input id="sensitive-fields-field-1" className="form-input bg-slate-50" disabled
              value={(isDate ? formatCalendarDate(target.current) : target.current) || '—'} />
          </div>
          <div>
            <label className="form-label" htmlFor="sensitive-new-value">{t('sensitive.newValue')}</label>
            <input
              id="sensitive-new-value"
              className={`form-input ${statutory && !isDate ? 'uppercase font-mono' : ''} ${issue ? 'border-red-400' : ''}`}
              autoFocus
              type={isDate ? 'date' : 'text'}
              value={value}
              placeholder={statutory ? STATUTORY_EXAMPLE[target.field as keyof typeof STATUTORY_EXAMPLE] : undefined}
              maxLength={statutory && !isDate ? STATUTORY_MAX_LENGTH[target.field as keyof typeof STATUTORY_MAX_LENGTH] + 4 : undefined}
              aria-invalid={!!issue}
              onChange={e => setValue(e.target.value)}
            />
            {issue && (
              <p className="mt-1 text-xs text-red-600" role="alert">{t(issueKey(issue), issue.params)}</p>
            )}
            {!issue && unchanged && (
              <p className="mt-1 text-xs text-slate-500">{t('sensitive.sameAsCurrent')}</p>
            )}
          </div>
          <div>
            <label className="form-label" htmlFor="sensitive-fields-reason">{t('sensitive.reason')}</label>
            <textarea id="sensitive-fields-reason" className="form-input" rows={3} value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('sensitive.reasonPlaceholder')} />
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button type="button" onClick={() => setTarget(null)} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={submit} disabled={!cleaned || !!issue || unchanged || saving} className="btn-primary">
            {saving ? t('common.saving') : t('sensitive.sendRequest')}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { state, locked, isLocked, pendingFor, openRequest, modal, reload: load }
}

/**
 * Renders a sensitive value as locked: the value stays visible (staff still need
 * to read it), but it cannot be typed into, and the only way forward is a
 * reviewed request.
 */
export function LockedField({
  label, value, field, pending, onRequest, display, hint,
}: {
  label: string
  value: string
  field: string
  pending?: PendingReq
  onRequest: (field: string, label: string, current: string) => void
  /** How to show the value when it is not plain text (a date). */
  display?: string
  /** A note under the field, e.g. an expiry or holder-type warning. */
  hint?: ReactNode
}) {
  const { t } = useTranslation()
  const pendingValue = pending && field === 'reg_80g_valid_upto'
    ? formatCalendarDate(pending.requested_value)
    : pending?.requested_value
  return (
    <div>
      <label className="form-label flex items-center gap-1.5">
        {label}
        <Lock size={11} className="text-slate-400" aria-hidden />
      </label>
      <div className="flex gap-2">
        <input className="form-input bg-slate-50 text-slate-600" value={(display ?? value) || '—'} disabled />
        <button
          type="button"
          onClick={() => onRequest(field, label, value)}
          disabled={!!pending}
          className="btn-secondary btn-sm whitespace-nowrap disabled:opacity-50"
        >
          {pending ? t('sensitive.pending') : t('sensitive.requestChange')}
        </button>
      </div>
      {pending && (
        <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
          <Clock size={11} />
          {t('sensitive.pendingDetail', { value: pendingValue })}
        </p>
      )}
      {hint}
    </div>
  )
}

/**
 * Explains once, at the top of a section, why the inputs below are frozen.
 * `message` lets a section that mixes locked and editable fields say which is
 * which, instead of implying everything below is frozen.
 */
export function VerifiedBanner({ verifiedAt, message }: { verifiedAt: string | null; message?: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
      <Lock size={14} className="mt-0.5 shrink-0" />
      <p>
        {message ?? t('sensitive.bannerVerified')}
        {verifiedAt && (
          <span className="text-amber-700">
            {' '}({new Date(verifiedAt).toLocaleDateString('en-IN')})
          </span>
        )}
      </p>
    </div>
  )
}
