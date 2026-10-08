import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, ArchiveRestore, BedDouble, History, IndianRupee, Loader2, Lock, Package, Trash2, X,
} from 'lucide-react'
import { api, apiErrorMessage, fmtPaise } from '../lib/api'
import { useToast } from './kit/Toast'
import { DeleteEntryContext, type DeleteFn, type DeleteTarget } from './deleteEntry'

/**
 * Deleting a money entry — a donation, a seva booking, a prasad or bhojanshala
 * sale, a room or hall booking, an expense.
 *
 * One dialog for all seven, because the API treats them the same way
 * (mandiradmin-api EntriesService): temple_admin only, a reason is required,
 * the money taken against the entry comes out of Cash & Bank and every report,
 * and the entry goes to the Recycle Bin, from which it can be restored with its
 * receipt number. The dialog says all of that BEFORE the click, which is what
 * separates a delete a trustee can defend from one they discover later.
 *
 *   const deleteEntry = useDeleteEntry()          // components/deleteEntry.ts
 *   if (await deleteEntry({ kind: 'donation', id, title: donor, reference: invoiceNo, amountPaise })) load()
 */

const QUICK_REASONS = ['duplicate', 'wrongAmount', 'wrongPerson', 'test', 'cancelled'] as const

export function DeleteEntryProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [target, setTarget] = useState<DeleteTarget | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement | null>(null)

  const open = useCallback<DeleteFn>((tg) => {
    setTarget(tg)
    setReason('')
    setError('')
    setBusy(false)
    return new Promise<boolean>(resolve => { resolver.current = resolve })
  }, [])

  const close = useCallback((result: boolean) => {
    resolver.current?.(result)
    resolver.current = null
    setTarget(null)
  }, [])

  useEffect(() => { if (target) setTimeout(() => reasonRef.current?.focus(), 0) }, [target])

  const trimmed = reason.replace(/\s+/g, ' ').trim()
  const valid = trimmed.length >= 3 && trimmed.length <= 500

  async function submit() {
    if (!target || !valid || busy) return
    setBusy(true)
    setError('')
    try {
      await api.delete(`/entries/${target.kind}/${target.id}`, { data: { reason: trimmed } })
      toast.success(t('entries.deleted', { kind: t(`entries.kind.${target.kind}`) }))
      close(true)
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t('entries.failed')))
      setBusy(false)
    }
  }

  const kindLabel = target ? t(`entries.kind.${target.kind}`) : ''
  const hasMoney = target && target.kind !== 'expense'
  const dateText = target?.date
    ? new Date(target.date.length === 10 ? `${target.date}T12:00:00` : target.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <DeleteEntryContext.Provider value={open}>
      {children}
      {target && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-entry-title"
          onKeyDown={e => { if (e.key === 'Escape' && !busy) close(false) }}
          data-testid="delete-entry-dialog"
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 p-5 pb-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <Trash2 size={18} className="text-red-600" />
                </span>
                <div>
                  <h3 id="delete-entry-title" className="font-bold text-navy-900 text-base">
                    {t('entries.deleteHeading', { kind: kindLabel.toLocaleLowerCase() })}
                  </h3>
                  <p className="text-xs text-slate-500">{t('entries.adminAction')}</p>
                </div>
              </div>
              <button type="button" onClick={() => close(false)} disabled={busy} title={t('ui.close')} aria-label={t('ui.close')}>
                <X size={18} className="text-slate-400" />
              </button>
            </div>

            {/* What is being deleted — so nobody deletes the wrong row. */}
            <div className="mx-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{target.title || kindLabel}</p>
                  {target.detail && <p className="text-xs text-slate-500 truncate">{target.detail}</p>}
                  <p className="text-xs text-slate-400 mt-0.5">
                    {[target.reference, dateText].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {target.amountPaise != null && (
                  <p className="text-base font-bold text-slate-900 whitespace-nowrap">₹{fmtPaise(target.amountPaise)}</p>
                )}
              </div>
            </div>

            <div className="px-5 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{t('entries.willHappen')}</p>
              <ul className="space-y-1.5 text-sm text-slate-600">
                <Effect icon={<IndianRupee size={14} />}>
                  {/* A boli is a promise: its money is on its payment receipts,
                      which must be deleted first (tenant migration 061). */}
                  {target.kind === 'boli' ? t('entries.effectBoli')
                    : hasMoney ? t('entries.effectMoney') : t('entries.effectExpense')}
                </Effect>
                {target.kind === 'prasad_sale' && <Effect icon={<Package size={14} />}>{t('entries.effectStock')}</Effect>}
                {(target.kind === 'room_booking' || target.kind === 'hall_booking') && (
                  <Effect icon={<BedDouble size={14} />}>{t(target.kind === 'room_booking' ? 'entries.effectRoom' : 'entries.effectHall')}</Effect>
                )}
                <Effect icon={<ArchiveRestore size={14} />}>{t('entries.effectBin')}</Effect>
                <Effect icon={<History size={14} />}>{t('entries.effectLog')}</Effect>
                <Effect icon={<Lock size={14} />}>{t('entries.effectFy')}</Effect>
              </ul>
            </div>

            <div className="px-5 pt-4">
              <label className="form-label" htmlFor="delete-entry-reason">
                {t('entries.reason')} <span className="text-red-600">*</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_REASONS.map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setReason(t(`entries.quickReasons.${k}`))}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  >
                    {t(`entries.quickReasons.${k}`)}
                  </button>
                ))}
              </div>
              <textarea
                id="delete-entry-reason"
                ref={reasonRef}
                className="form-textarea"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t('entries.reasonPlaceholder')}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit() }}
              />
              <p className="text-xs text-slate-400 mt-1">{t('entries.reasonHelp')}</p>
            </div>

            {error && (
              <div className="mx-5 mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 p-5">
              <button type="button" className="btn-secondary" onClick={() => close(false)} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn-danger" onClick={() => void submit()} disabled={!valid || busy} data-testid="delete-entry-confirm">
                {busy ? <><Loader2 size={14} className="animate-spin" /> {t('entries.deleting')}</> : <><Trash2 size={14} /> {t('entries.confirm')}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </DeleteEntryContext.Provider>
  )
}

function Effect({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <span>{children}</span>
    </li>
  )
}
