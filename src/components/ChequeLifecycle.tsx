import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Banknote, CheckCircle2, XOctagon } from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from './kit/Toast'
import type { RowAction } from './kit/DataTable'

/* Cheque lifecycle, shared.

   The deposit → clear → bounce transitions only ever existed on the
   Accounts ▸ Cheques page, so a cashier looking at a bounced cheque in the
   Donations list had no way to act on it — they had to know that a different
   screen existed. The API has supported all three transitions on both
   /donations and /expenses from the start; this hook exposes them as row
   actions so every list that shows a cheque row can offer them.

   Bouncing a *donation* cheque voids its receipt (the money never settled) —
   that is why the reason is mandatory there and optional for expenses. */

export type ChequeKind = 'donations' | 'expenses'

/** The subset of a donation/expense row this hook needs. */
export interface ChequeRow {
  id: string
  payment_mode?: string | null
  cheque_status?: string | null
  /** Donations: invoice_no. Expenses: description. Used in the warning copy. */
  invoice_no?: string | null
  description?: string | null
}

export function useChequeLifecycle(kind: ChequeKind, reload: () => void) {
  const { t } = useTranslation()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bounce, setBounce] = useState<ChequeRow | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  function apiError(err: unknown, fallback: string) {
    const ex = err as { response?: { data?: { error?: { message?: string } } } }
    toast.error(ex.response?.data?.error?.message || fallback)
  }

  async function markDeposited(row: ChequeRow) {
    setBusyId(row.id)
    try {
      // Account + date are optional server-side; the Cheques page offers the
      // full form when the cashier needs to pick a specific bank account.
      await api.patch(`/${kind}/${row.id}/cheque/deposit`, {
        deposited_at: new Date().toISOString().slice(0, 10),
      })
      toast.success(t('cheques.depositSuccess'))
      reload()
    } catch (err) { apiError(err, t('cheques.depositFailed')) } finally { setBusyId(null) }
  }

  async function markCleared(row: ChequeRow) {
    setBusyId(row.id)
    try {
      await api.patch(`/${kind}/${row.id}/cheque/clear`, {})
      toast.success(t('cheques.clearSuccess'))
      reload()
    } catch (err) { apiError(err, t('cheques.clearFailed')) } finally { setBusyId(null) }
  }

  async function submitBounce() {
    if (!bounce) return
    if (kind === 'donations' && !reason.trim()) return
    setSaving(true)
    try {
      await api.patch(`/${kind}/${bounce.id}/cheque/bounce`, { reason: reason.trim() || undefined })
      toast.success(kind === 'donations'
        ? t('cheques.bounceSuccess', { invoiceNo: bounce.invoice_no ?? '' })
        : t('cheques.issuedBounceSuccess'))
      setBounce(null)
      reload()
    } catch (err) { apiError(err, t('cheques.bounceFailed')) } finally { setSaving(false) }
  }

  /** Row actions for a cheque row — empty for cash/UPI rows and settled cheques. */
  function chequeActions(row: ChequeRow): RowAction[] {
    if (row.payment_mode !== 'cheque') return []
    const status = row.cheque_status
    // Terminal states: nothing left to do.
    if (!status || status === 'cleared' || status === 'bounced') return []

    const out: RowAction[] = []
    // Donations arrive 'received' and must be deposited first; expenses are
    // 'issued' by us and go straight to cleared.
    if (status === 'received') {
      out.push({
        label: t('cheques.deposit'), icon: <Banknote size={13} />,
        onClick: () => markDeposited(row), disabled: busyId === row.id,
      })
    }
    if (status === 'deposited' || status === 'issued') {
      out.push({
        label: t('cheques.markCleared'), icon: <CheckCircle2 size={13} />,
        onClick: () => markCleared(row), disabled: busyId === row.id,
      })
    }
    out.push({
      label: t('cheques.markBounced'), icon: <XOctagon size={13} />, danger: true,
      onClick: () => { setReason(''); setBounce(row) }, disabled: busyId === row.id,
    })
    return out
  }

  const bounceModal = bounce ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="font-bold text-navy-900 mb-1">{t('cheques.bounceTitle')}</h3>
        <p className="text-sm text-slate-500 mb-4">
          {kind === 'donations'
            ? t('cheques.bounceWarning', { invoiceNo: bounce.invoice_no ?? '' })
            : t('cheques.issuedBounceWarning', { description: bounce.description ?? '' })}
        </p>
        <div className="mb-4">
          <label className="form-label">
            {kind === 'donations' ? t('donations.reasonForVoiding') : t('cheques.bounceReasonOptional')}
          </label>
          <textarea
            className="form-input" rows={3} autoFocus
            value={reason} onChange={e => setReason(e.target.value)}
            placeholder={t('cheques.bounceReasonPlaceholder')}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={() => setBounce(null)} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button
            type="button" onClick={submitBounce} className="btn-danger"
            disabled={saving || (kind === 'donations' && !reason.trim())}
          >
            {saving ? t('common.saving') : t('cheques.markBounced')}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { chequeActions, bounceModal }
}
