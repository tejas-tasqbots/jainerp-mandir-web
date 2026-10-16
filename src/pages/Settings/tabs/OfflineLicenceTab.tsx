import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, RefreshCw, ShieldAlert } from 'lucide-react'
import { offlineBridge, errText, type OfflineLicence } from '../../../lib/offlineDesktop'
import { useAuthStore } from '../../../store/authStore'

/**
 * JainERP Offline: the licence this computer runs under, in place of the
 * cloud's Subscription & Usage (plans, invoices and payments need the
 * internet). Renewal is a new licence block pasted here — nothing is sent.
 */
export function OfflineLicenceTab() {
  const { t } = useTranslation()
  const bridge = offlineBridge()
  const isAdmin = useAuthStore(s => s.user?.roles?.includes('temple_admin') ?? false)
  const [info, setInfo] = useState<OfflineLicence | null>(null)
  const [graceDays, setGraceDays] = useState(7)
  const [version, setVersion] = useState('')
  const [block, setBlock] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => bridge?.licence().then(r => { setInfo(r.info); setGraceDays(r.graceDays); setVersion(r.version) })
  useEffect(() => { void load() }, [])

  async function renew() {
    if (!bridge) return
    setBusy(true); setMsg(null)
    const r = await bridge.renewLicence(block)
    setBusy(false)
    if (!r.success) { setMsg({ ok: false, text: errText(r, t('offline.licence.renewFailed', 'That licence could not be used.')) }); return }
    setBlock('')
    setMsg({ ok: true, text: t('offline.licence.renewed', 'Licence renewed.') })
    void load()
  }

  if (!info) return null
  const expiry = info.expiry ? new Date(info.expiry).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
  const days = info.daysRemaining ?? null
  const status = !info.valid
    ? { cls: 'badge-red', text: t('offline.licence.expired', 'Expired') }
    : info.grace
      ? { cls: 'badge-red', text: t('offline.licence.grace', 'Expired — {{days}}-day grace period', { days: graceDays }) }
      : days !== null && days <= 30
        ? { cls: 'badge-yellow', text: t('offline.licence.endingSoon', 'Ends in {{days}} days', { days }) }
        : { cls: 'badge-green', text: t('offline.licence.active', 'Active') }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2"><BadgeCheck size={15} /> {t('offline.licence.title', 'JainERP Offline licence')}</h3>
          <span className={status.cls}>{status.text}</span>
        </div>
        <div className="card-body">
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-slate-400">{t('offline.licence.mandir', 'Licensed to')}</dt><dd className="font-medium">{info.temple}</dd>
            <dt className="text-slate-400">{t('offline.licence.validUntil', 'Valid until')}</dt><dd className="font-medium">{expiry}{days !== null && days >= 0 ? ` (${t('offline.licence.daysLeft', '{{days}} days left', { days })})` : ''}</dd>
            <dt className="text-slate-400">{t('offline.licence.id', 'Licence id')}</dt><dd className="font-mono text-xs">{info.licenseId || '—'}</dd>
            <dt className="text-slate-400">{t('offline.licence.version', 'App version')}</dt><dd>{version}</dd>
          </dl>
          <p className="text-xs text-slate-400 mt-4">{t('offline.licence.note', 'Everything is stored on this computer and nothing is sent anywhere, so there is no subscription or online billing. When the licence ends, the app keeps working for {{days}} more days, then asks for a new licence.', { days: graceDays })}</p>
        </div>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><RefreshCw size={14} /> {t('offline.licence.renewTitle', 'Renew')}</h3></div>
          <div className="card-body space-y-3">
            <p className="text-sm text-slate-500">{t('offline.licence.renewHelp', 'Paste the new licence the JainERP team sent you (the whole block, including the BEGIN and END lines).')}</p>
            <textarea className="form-input font-mono text-xs" rows={5} spellCheck={false} value={block} onChange={e => setBlock(e.target.value)}
              placeholder="-----BEGIN LICENCE-----" />
            {msg && <p className={`text-sm ${msg.ok ? 'text-green-600' : 'text-brand-red'} flex items-center gap-1`}>{!msg.ok && <ShieldAlert size={14} />}{msg.text}</p>}
            <button onClick={renew} disabled={busy || !block.trim()} className="btn-primary btn-sm">{t('offline.licence.renewButton', 'Use this licence')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
