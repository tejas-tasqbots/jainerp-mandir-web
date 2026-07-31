import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Clock } from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from './kit/Toast'

/* Sensitive mandir details, once the platform has verified them.

   Bank account, UPI ID and the 80G/PAN registration numbers are what devotees
   pay into and what appears on tax receipts. After verification the API rejects
   a direct PATCH (SENSITIVE_LOCKED), so the form must not pretend the input is
   editable — it shows the value locked with the reason, and offers to raise a
   change request the super admin reviews.

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
  const [target, setTarget] = useState<{ field: string; label: string; current: string } | null>(null)
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/tenants/me')
      setState(data.data?.sensitive ?? null)
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

  async function submit() {
    if (!target || !value.trim()) return
    setSaving(true)
    try {
      await api.post('/tenants/me/change-requests', {
        field: target.field,
        requested_value: value.trim(),
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

  const modal = target ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="font-bold text-navy-900 mb-1">{t('sensitive.requestTitle')}</h3>
        <p className="text-sm text-slate-500 mb-4">{t('sensitive.requestSubtitle')}</p>
        <div className="space-y-3">
          <div>
            <label className="form-label">{target.label}</label>
            <input className="form-input bg-slate-50" value={target.current || '—'} disabled />
          </div>
          <div>
            <label className="form-label">{t('sensitive.newValue')}</label>
            <input className="form-input" autoFocus value={value}
              onChange={e => setValue(e.target.value)} />
          </div>
          <div>
            <label className="form-label">{t('sensitive.reason')}</label>
            <textarea className="form-input" rows={3} value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('sensitive.reasonPlaceholder')} />
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button type="button" onClick={() => setTarget(null)} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={submit} disabled={!value.trim() || saving} className="btn-primary">
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
  label, value, field, pending, onRequest,
}: {
  label: string
  value: string
  field: string
  pending?: PendingReq
  onRequest: (field: string, label: string, current: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="form-label flex items-center gap-1.5">
        {label}
        <Lock size={11} className="text-slate-400" aria-hidden />
      </label>
      <div className="flex gap-2">
        <input className="form-input bg-slate-50 text-slate-600" value={value || '—'} disabled />
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
          {t('sensitive.pendingDetail', { value: pending.requested_value })}
        </p>
      )}
    </div>
  )
}

/** Explains once, at the top of a section, why the inputs below are frozen. */
export function VerifiedBanner({ verifiedAt }: { verifiedAt: string | null }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
      <Lock size={14} className="mt-0.5 shrink-0" />
      <p>
        {t('sensitive.bannerVerified')}
        {verifiedAt && (
          <span className="text-amber-700">
            {' '}({new Date(verifiedAt).toLocaleDateString('en-IN')})
          </span>
        )}
      </p>
    </div>
  )
}
