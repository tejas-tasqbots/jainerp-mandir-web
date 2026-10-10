import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Copy, CreditCard, Globe, KeyRound, Loader2, Save, ShieldAlert, Wifi } from 'lucide-react'
import { api, apiErrorMessage } from '../../../lib/api'
import { useToast } from '../../../components/kit/Toast'

interface SiteSettings {
  slug: string
  enabled: boolean
  site_url: string | null
  room_mode: 'off' | 'request' | 'instant'
  donation_mode: 'off' | 'gateway' | 'manual' | 'both'
  request_advance_percent: number
  min_donation_paise: number
  razorpay_key_id: string | null
  has_key_secret: boolean
  has_webhook_secret: boolean
  settlement_account_id: string | null
  gateway_checked_at: string | null
  gateway_check_ok: boolean | null
  gateway_check_message: string | null
  webhook_url: string | null
  webhook_path: string
  site_api_path: string
  has_dharamshala: boolean
  accept_donor_requests: boolean
  donation_account_verified: boolean
}

interface Account { id: string; name: string; type: string; bank_name?: string | null; account_no?: string | null; is_active: boolean }

/**
 * Settings → Website & online payments (tenant migration 062).
 *
 * The trust's OWN website — not a JainERP page — may take gifts and rooms, and
 * whatever it takes lands here: gifts in Donations, rooms in Rooms → Website
 * requests. Money goes to the trust's own Razorpay account, entered below.
 * The key secret and the webhook secret are never shown again once saved; the
 * screen only says whether one is on file.
 */
export function WebsiteTab() {
  const { t } = useTranslation()
  const toast = useToast()
  const [s, setS] = useState<SiteSettings | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [keySecret, setKeySecret] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [minRupees, setMinRupees] = useState('100')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')

  function take(d: SiteSettings) {
    setS(d)
    setMinRupees(String(Math.round(d.min_donation_paise / 100)))
  }

  useEffect(() => {
    api.get('/tenants/me/public-site').then(r => take(r.data.data)).catch(e => setError(apiErrorMessage(e, t('website.settings.loadFailed'))))
    api.get('/accounts', { params: { limit: 100 } }).then(r => setAccounts((r.data.data || []) as Account[])).catch(() => {})
  }, [t])

  if (!s) {
    return error
      ? <div className="bg-red-50 border border-red-200 rounded-md px-4 py-2 text-sm text-red-700">{error}</div>
      : <div className="py-10 text-center text-slate-400 text-sm">{t('common.loading')}</div>
  }

  const banks = accounts.filter(a => a.type === 'bank' && a.is_active)
  const takesGateway = s.donation_mode === 'gateway' || s.donation_mode === 'both' || s.room_mode !== 'off'
  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => setS(prev => (prev ? { ...prev, [k]: v } : prev))

  async function save() {
    if (!s) return
    setSaving(true); setError('')
    try {
      const body: Record<string, unknown> = {
        enabled: s.enabled,
        site_url: s.site_url ?? '',
        room_mode: s.room_mode,
        donation_mode: s.donation_mode,
        request_advance_percent: s.request_advance_percent,
        min_donation_paise: Math.round(Number(minRupees || 0) * 100),
        razorpay_key_id: s.razorpay_key_id ?? '',
        settlement_account_id: s.settlement_account_id ?? '',
      }
      // Blank = keep the secret on file; only a newly typed one is sent.
      if (keySecret.trim()) body.razorpay_key_secret = keySecret.trim()
      if (webhookSecret.trim()) body.razorpay_webhook_secret = webhookSecret.trim()
      const { data } = await api.put('/tenants/me/public-site', body)
      take(data.data)
      setKeySecret(''); setWebhookSecret('')
      toast.success(t('website.settings.saved'))
    } catch (e) {
      setError(apiErrorMessage(e, t('website.settings.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function testGateway() {
    setTesting(true)
    try {
      await api.post('/tenants/me/public-site/test-gateway')
      const { data } = await api.get('/tenants/me/public-site')
      take(data.data)
    } catch (e) {
      toast.error(apiErrorMessage(e, t('website.settings.testFailed')))
    } finally {
      setTesting(false)
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => toast.success(t('website.settings.copied'))).catch(() => {})
  }

  const webhook = s.webhook_url ?? s.webhook_path

  return (
    <div className="space-y-4 max-w-3xl">
      {error && <div className="bg-red-50 border border-red-200 rounded-md px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Globe size={15} /> {t('website.settings.siteHeading')}</h3>
        </div>
        <div className="card-body space-y-4">
          <p className="text-xs text-slate-500">{t('website.settings.siteIntro')}</p>
          <label className="flex items-start gap-3 border rounded-md p-3 cursor-pointer border-slate-200">
            <input type="checkbox" className="mt-1" checked={s.enabled} onChange={e => set('enabled', e.target.checked)} />
            <div>
              <p className="font-medium text-sm">{t('website.settings.enabled')}</p>
              <p className="text-xs text-slate-400">{t('website.settings.enabledHelp')}</p>
            </div>
          </label>
          <div>
            <label className="form-label" htmlFor="website-site-url">{t('website.settings.siteUrl')}</label>
            <input id="website-site-url" className="form-input" placeholder="https://nakodadham.org" value={s.site_url ?? ''}
              onChange={e => set('site_url', e.target.value)} />
            <p className="text-xs text-slate-400 mt-1">{t('website.settings.siteUrlHelp')}</p>
          </div>
          <p className="text-xs text-slate-500">
            {t('website.settings.apiFor')} <code className="bg-slate-100 px-1 rounded">{s.site_api_path}</code>
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm flex items-center gap-2"><CreditCard size={15} /> {t('website.settings.whatHeading')}</h3>
        </div>
        <div className="card-body grid sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label" htmlFor="website-donation-mode">{t('website.settings.donationMode')}</label>
            <select id="website-donation-mode" className="form-select" value={s.donation_mode}
              onChange={e => set('donation_mode', e.target.value as SiteSettings['donation_mode'])}>
              {(['off', 'gateway', 'manual', 'both'] as const).map(m => <option key={m} value={m}>{t(`website.settings.donation.${m}`)}</option>)}
            </select>
            {(s.donation_mode === 'manual' || s.donation_mode === 'both') && (!s.accept_donor_requests || !s.donation_account_verified) && (
              <p className="text-xs text-amber-600 mt-1 flex items-start gap-1">
                <ShieldAlert size={13} className="mt-0.5 flex-shrink-0" /> {t('website.settings.manualNeedsAccount')}
              </p>
            )}
          </div>
          <div>
            <label className="form-label" htmlFor="website-min-gift">{t('website.settings.minDonation')}</label>
            <input id="website-min-gift" type="number" min="1" className="form-input" value={minRupees} onChange={e => setMinRupees(e.target.value)} />
          </div>
          <div>
            <label className="form-label" htmlFor="website-room-mode">{t('website.settings.roomMode')}</label>
            <select id="website-room-mode" className="form-select" value={s.room_mode} disabled={!s.has_dharamshala}
              onChange={e => set('room_mode', e.target.value as SiteSettings['room_mode'])}>
              {(['off', 'request', 'instant'] as const).map(m => <option key={m} value={m}>{t(`website.settings.rooms.${m}`)}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              {s.has_dharamshala ? t(`website.settings.rooms.${s.room_mode}Help`) : t('website.settings.noDharamshala')}
            </p>
          </div>
          {s.room_mode === 'request' && (
            <div>
              <label className="form-label" htmlFor="website-advance">{t('website.settings.advancePercent')}</label>
              <input id="website-advance" type="number" min="0" max="100" className="form-input" value={s.request_advance_percent}
                onChange={e => set('request_advance_percent', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
              <p className="text-xs text-slate-400 mt-1">{t('website.settings.advanceHelp')}</p>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm flex items-center gap-2"><KeyRound size={15} /> {t('website.settings.gatewayHeading')}</h3>
        </div>
        <div className="card-body space-y-4">
          <p className="text-xs text-slate-500">{t('website.settings.gatewayIntro')}</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label" htmlFor="website-key-id">{t('website.settings.keyId')}{takesGateway && ' *'}</label>
              <input id="website-key-id" className="form-input font-mono" placeholder="rzp_live_…" value={s.razorpay_key_id ?? ''}
                onChange={e => set('razorpay_key_id', e.target.value.trim())} autoComplete="off" />
            </div>
            <div>
              <label className="form-label" htmlFor="website-key-secret">{t('website.settings.keySecret')}{takesGateway && !s.has_key_secret && ' *'}</label>
              <input id="website-key-secret" type="password" className="form-input font-mono" autoComplete="new-password"
                placeholder={s.has_key_secret ? t('website.settings.secretOnFile') as string : ''}
                value={keySecret} onChange={e => setKeySecret(e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="website-webhook-secret">{t('website.settings.webhookSecret')}</label>
              <input id="website-webhook-secret" type="password" className="form-input font-mono" autoComplete="new-password"
                placeholder={s.has_webhook_secret ? t('website.settings.secretOnFile') as string : ''}
                value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="website-settlement">{t('website.settings.settlement')}{takesGateway && ' *'}</label>
              <select id="website-settlement" className="form-select" value={s.settlement_account_id ?? ''}
                onChange={e => set('settlement_account_id', e.target.value || null)}>
                <option value="">{t('website.settings.chooseBank')}</option>
                {banks.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.account_no ? ` · ••${a.account_no.slice(-4)}` : ''}</option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">{t('website.settings.settlementHelp')}</p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-md p-3 text-xs space-y-1">
            <p className="font-semibold text-slate-600">{t('website.settings.webhookUrl')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-slate-700">{webhook}</code>
              <button type="button" className="btn-secondary btn-sm" onClick={() => copy(webhook)} title={t('website.settings.copy') as string}>
                <Copy size={13} />
              </button>
            </div>
            <p className="text-slate-400">{t('website.settings.webhookHelp')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary btn-sm" onClick={testGateway} disabled={testing || !s.razorpay_key_id || !s.has_key_secret}>
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />} {t('website.settings.test')}
            </button>
            {s.gateway_checked_at && (
              <span className={`text-xs flex items-center gap-1 ${s.gateway_check_ok ? 'text-green-700' : 'text-red-600'}`}>
                {s.gateway_check_ok ? <CheckCircle2 size={13} /> : <ShieldAlert size={13} />} {s.gateway_check_message}
              </span>
            )}
          </div>
          {s.razorpay_key_id?.startsWith('rzp_test_') && (
            <p className="text-xs text-amber-600">{t('website.settings.testKeys')}</p>
          )}
        </div>
      </div>

      <button type="button" onClick={save} disabled={saving} className="btn-primary">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {saving ? t('settings.saving') : t('website.settings.save')}
      </button>
    </div>
  )
}
