import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTrustHas80g } from '../../store/profileStore'
import { Receipt, FileDown, MessageCircle, History, RefreshCw } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { printDonationReceipt, downloadReceiptPdf } from '../../lib/printReceipt'
import { useToast } from '../../components/kit/Toast'
import type { Donation } from '../../types'
import { paymentModeLabel } from '../../lib/paymentModeLabel'

interface AuditRow {
  id: number
  action: string
  occurred_at: string
  actor_name: string | null
}

/**
 * Row detail drawer for a donation (plan §04): receipt actions, donor context,
 * and the per-row audit trail ("View History" in the benchmark's row menu).
 */
export function DonationDetail({ donation, onChanged }: { donation: Donation; onChanged?: () => void }) {
  const { t } = useTranslation()
  const has80g = useTrustHas80g()
  const toast = useToast()
  const [history, setHistory] = useState<AuditRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setHistoryLoading(true)
    // The audit-log `q` matches entity_id, so this returns just this receipt's trail.
    api.get(`/audit-log?q=${donation.id}&limit=20`)
      .then(r => { if (alive) setHistory(r.data.data || []) })
      .catch(() => { if (alive) setHistory([]) })
      .finally(() => { if (alive) setHistoryLoading(false) })
    return () => { alive = false }
  }, [donation.id])

  async function run(key: string, fn: () => Promise<unknown>, okMsg?: string) {
    setBusy(key)
    try {
      await fn()
      if (okMsg) toast.success(okMsg)
      onChanged?.()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('donations.actionFailed'))
    } finally {
      setBusy(null)
    }
  }

  const rows: [string, React.ReactNode][] = [
    [t('donations.invoiceNo'), <span className="font-mono text-brand-blue">{donation.invoice_no}</span>],
    [t('donations.donor'), donation.donor_name || t('donations.anonymousGuptDan')],
    [t('donors.mobile'), donation.donor_mobile || '—'],
    [t('donations.category'), donation.category_name || '—'],
    [t('common.amount'), <span className="font-semibold">₹{fmtPaise(donation.amount_paise)}</span>],
    [t('donations.mode'), <span className="badge-gray">{paymentModeLabel(t, donation.payment_mode)}</span>],
    ...(has80g ? [[t('donations.eightyG'), donation.is_80g_eligible ? t('common.yes') : t('common.no')] as [string, React.ReactNode]] : []),
    [t('common.date'), new Date(donation.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })],
    [t('common.status'), donation.is_voided
      ? <span className="badge-red">{t('donations.voided')}</span>
      : <span className="badge-green">{t('common.active')}</span>],
  ]

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 text-sm">
            <span className="text-slate-500 flex-shrink-0">{label}</span>
            <span className="text-right">{value}</span>
          </div>
        ))}
        {donation.is_voided && donation.void_reason && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {donation.void_reason}
          </div>
        )}
      </div>

      {!donation.is_voided && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy === 'print'} className="btn-secondary btn-sm justify-center"
            onClick={() => run('print', () => printDonationReceipt(donation.id))}>
            <Receipt size={14} /> {t('donations.printReceipt')}
          </button>
          <button type="button" disabled={busy === 'pdf'} className="btn-secondary btn-sm justify-center"
            onClick={() => run('pdf', () => downloadReceiptPdf(donation.id))}>
            <FileDown size={14} /> {t('donations.downloadPdf')}
          </button>
          <button type="button" disabled={busy === 'wa' || !donation.donor_mobile} className="btn-secondary btn-sm justify-center col-span-2"
            onClick={() => run('wa', () => api.post(`/donations/${donation.id}/resend-receipt`, {}), t('donations.receiptResent'))}>
            {busy === 'wa' ? <RefreshCw size={14} className="animate-spin" /> : <MessageCircle size={14} />}
            {t('donations.resendWhatsApp')}
          </button>
        </div>
      )}

      <div>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
          <History size={13} /> {t('donations.history')}
        </h4>
        {historyLoading ? (
          <div className="space-y-1.5">
            {[0, 1, 2].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-400">{t('donations.noHistory')}</p>
        ) : (
          <ol className="space-y-2">
            {history.map(h => (
              <li key={h.id} className="flex items-start gap-2 text-xs">
                <span className="badge-gray flex-shrink-0">{h.action}</span>
                <span className="text-slate-500">
                  {h.actor_name || t('activityLog.system')} · {new Date(h.occurred_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
