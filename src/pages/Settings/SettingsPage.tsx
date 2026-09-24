import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, RefreshCw, TrendingUp, CreditCard, ClipboardList } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise } from '../../lib/api'
import { useSensitiveFields, LockedField } from '../../components/SensitiveFields'
import { ComplianceSection } from './ComplianceSection'
import {
  COMPLIANCE_FIELDS, complianceIssues, IDENTITY_FIELDS,
  type ComplianceField, type ComplianceValues, type IdentityField, type IdentityValues,
} from './complianceFields'
import { useToast } from '../../components/kit/Toast'
import { openRazorpayCheckout } from '../../lib/razorpay'
import { useProfileStore } from '../../store/profileStore'
import { LocationPicker } from '../../components/LocationPicker'
import { StateSelect, CitySelect } from '../../components/GeoSelect'
import { MasterEditor } from './MasterEditor'
import { BhojanshalaRates } from './BhojanshalaRates'
import { BankAccountsTab } from './tabs/BankAccountsTab'
import { DonorPaymentsTab } from './tabs/DonorPaymentsTab'
import { ReceiptSettingsTab } from './tabs/ReceiptSettingsTab'
import { NumberingTab } from './tabs/NumberingTab'
import { MessagesTab } from './tabs/MessagesTab'
import { UsersTab } from './tabs/UsersTab'
import { BackupTab } from './tabs/BackupTab'
import { PublicProfileTab } from './tabs/PublicProfileTab'
import { GalleryTab } from './tabs/GalleryTab'
import { TrusteesTab } from './tabs/TrusteesTab'
import { MyAccountTab } from './tabs/MyAccountTab'
import { SetupMeter } from '../../components/SetupChecklist'

/**
 * Plan limit columns store -1 to mean "no cap" (that is how the Enterprise plan
 * is seeded). Never show the sentinel raw — it reads as a negative allowance.
 */
function planLimit(n: number | null | undefined): string {
  return n == null || n < 0 ? '∞' : String(n)
}

interface Requirement {
  id: string
  text: string
  status: 'open' | 'in_progress' | 'done' | 'rejected'
  note: string | null
  raised_by: string | null
  created_at: string
  updated_at: string
}

/**
 * The tabs, in the order they are shown.
 *
 * Three tabs were folded into their owners because the same field was editable
 * from several places at once — `upi_id` was on Temple Profile, Receipt
 * Settings AND Donor Payments, and the bank fields on two of them. A setting
 * with three owners has no owner: whichever screen was saved last won, and
 * nobody could say which one was authoritative.
 *
 *   donor-payments → accounts        (donor-facing payment details belong with
 *                                     the accounts the money lands in)
 *   gallery        → public-profile  (photos are part of the public page)
 *   accounting     → removed         (the accounting basis is a platform
 *                                     decision, set by the super admin; a trust
 *                                     switching it mid-year restates every
 *                                     statement it has already filed)
 */
const TAB_IDS = [
  'my-account', 'profile', 'public-profile', 'trustees', 'accounts',
  'receipts', 'numbering', 'messages', 'masters', 'users', 'backup',
  'privacy', 'subscription',
] as const
type TabId = (typeof TAB_IDS)[number]

/** Old ?tab= values kept working, so existing links and bookmarks still land. */
const TAB_ALIASES: Record<string, TabId> = {
  // Was its own tab until the two receipt tabs were merged. Kept because a
  // trust may have bookmarked it and a super admin reviewing a submitted design
  // may have sent the link.
  'receipt-designs': 'receipts',
  'donor-payments': 'accounts',
  gallery: 'public-profile',
  accounting: 'profile',
}

export function SettingsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { profile, fetchProfile } = useProfileStore()
  /**
   * Tabs, and the ?tab= that addresses them.
   *
   * This page used to hold the tab in plain state seeded with 'profile' and
   * ignore the query string entirely, so every deep link — every item on the
   * setup checklist, every "fix this" the wizard hands out — landed on Temple
   * Profile whatever it asked for. The links were right; nothing was reading
   * them.
   *
   * `gallery`, `donor-payments` and `accounting` are still accepted as aliases
   * so old links, bookmarks and anything already in the wild keep working after
   * those tabs were folded into their owners.
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab') ?? ''
  const initialTab = (TAB_ALIASES[requested] ?? (TAB_IDS.includes(requested as TabId) ? requested : 'profile')) as TabId
  const [tab, setTabState] = useState<TabId>(initialTab)

  // Keep the URL in step, so a tab is shareable and Back works between tabs.
  const setTab = (next: TabId) => {
    setTabState(next)
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('tab', next)
      return p
    }, { replace: true })
  }

  // A later navigation to /settings?tab=… (the checklist, while already on
  // Settings) changes the query but not the component, so react to it.
  useEffect(() => {
    const want = TAB_ALIASES[requested] ?? (TAB_IDS.includes(requested as TabId) ? (requested as TabId) : null)
    if (want && want !== tab) setTabState(want)
  }, [requested])
  const [saving, setSaving] = useState(false)
  const sens = useSensitiveFields()
  const [success, setSuccess] = useState(false)
  const [form, setForm] = useState({
    name: '', address_line1: '', city: '', state: '', pincode: '', area: '', mobile: '', email: '', website: '',
    upi_id: '', custom_receipt_footer: '',
    show_80g_on_receipt: false, global_sync_enabled: false,
    lat: null as number | null, lng: null as number | null,
  })
  // Registration numbers, and what they were when loaded — only a value that
  // CHANGES is checked, the same rule the API applies.
  const blankCompliance = Object.fromEntries(COMPLIANCE_FIELDS.map(f => [f, ''])) as ComplianceValues
  const [compliance, setCompliance] = useState<ComplianceValues>(blankCompliance)
  const [loadedCompliance, setLoadedCompliance] = useState<ComplianceValues>(blankCompliance)
  // The free-text identity registrations. No `loaded` twin and no issues map:
  // they have no format rule to break, so every value is saveable and an empty
  // one simply clears the field.
  const blankIdentity = Object.fromEntries(IDENTITY_FIELDS.map(f => [f, ''])) as IdentityValues
  const [identity, setIdentity] = useState<IdentityValues>(blankIdentity)
  const issues = complianceIssues(compliance, loadedCompliance, sens.pendingFor('pan')?.requested_value)
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [history, setHistory] = useState<BillingHistoryData | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payMsg, setPayMsg] = useState('')
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [planCycle, setPlanCycle] = useState<'monthly' | 'yearly'>('yearly')
  const [upgradingPlan, setUpgradingPlan] = useState('')
  const [reqText, setReqText] = useState('')
  const [reqSent, setReqSent] = useState(false)
  const [requirements, setRequirements] = useState<Requirement[]>([])

  interface SubscriptionData {
    subscription?: { plan_display?: string; billing_cycle?: string; status?: string; current_period_end?: string }
    invoices?: { id: string; invoice_number?: string; period_start?: string; period_end?: string; total_paise?: number; status?: string; paid_at?: string }[]
  }
  interface UsageData {
    limits?: {
      max_users?: number; max_receipts_per_month?: number; max_sms_per_month?: number
      is_custom?: boolean; plan_display?: string
    }
    current?: { users?: number; receipts_this_month?: number }
  }
  /** GET /tenants/me/billing-history — the mandir's full record with JainERP. */
  interface BillingHistoryData {
    plan_changes?: {
      change_type: string; from_value: string; to_value: string
      effective: string; effective_at?: string | null
      proration_credit_paise?: number; invoice_number?: string | null
      note?: string | null; created_at: string
    }[]
    invoices?: {
      id: string; invoice_number?: string; period_start?: string; period_end?: string
      total_paise?: number; status?: string; paid_at?: string
      payment_method?: string | null; payment_ref?: string | null
      plan_name?: string | null; billing_cycle?: string | null
      download_count?: number; last_downloaded_at?: string | null
    }[]
    receipt_downloads?: {
      id: string; invoice_number?: string; total_paise?: number
      actor_type: string; actor_name?: string | null; channel: string; created_at: string
    }[]
    totals?: {
      paid_paise: number; outstanding_paise: number
      paid_count: number; unpaid_count: number
      first_invoice_at?: string | null; last_paid_at?: string | null
    }
  }
  interface PlanRow {
    id: string; name: string; display_name: string
    price_monthly_paise: number; price_yearly_paise: number
    max_users: number; max_receipts_per_month: number; max_sms_per_month: number
  }

  // The profile is otherwise loaded once, at boot. A change request approved
  // while this tab was open (the name, a PAN) stayed invisible here and in the
  // header until a reload; opening Settings is when someone looks for it.
  // fetchProfile is a store action, stable across renders: this runs once.
  useEffect(() => { fetchProfile() }, [fetchProfile])

  useEffect(() => {
    if (profile) {
      const p = profile as unknown as Record<string, string | boolean | undefined>
      setForm({
        name: profile.name || '',
        address_line1: (p.address_line1 as string) || (profile.address as string) || '',
        city: profile.city || '',
        state: profile.state || '',
        pincode: (p.pincode as string) || '',
        area: (p.area as string) || '',
        mobile: profile.phone || (p.mobile as string) || '',
        email: profile.email || '',
        website: profile.website || '',
        upi_id: (p.upi_id as string) || '',
        custom_receipt_footer: (p.custom_receipt_footer as string) || '',
        show_80g_on_receipt: Boolean(p.show_80g_on_receipt),
        global_sync_enabled: profile.global_sync_enabled || false,
        lat: p.lat != null ? Number(p.lat) : null,
        lng: p.lng != null ? Number(p.lng) : null,
      })
      const loaded = Object.fromEntries(COMPLIANCE_FIELDS.map(f => [
        f,
        // The API sends the validity as YYYY-MM-DD; an older build sent a
        // timestamp, and a date input shows nothing for one.
        f === 'reg_80g_valid_upto' ? String(p[f] ?? '').slice(0, 10) : String(p[f] ?? ''),
      ])) as ComplianceValues
      setCompliance(loaded)
      setLoadedCompliance(loaded)
      setIdentity(Object.fromEntries(
        IDENTITY_FIELDS.map(f => [f, String(p[f] ?? '')]),
      ) as IdentityValues)
    }
  }, [profile])

  useEffect(() => {
    if (tab === 'subscription') loadSubscription()
    if (tab === 'privacy') loadRequirements()
  }, [tab])

  async function loadRequirements() {
    try {
      const { data } = await api.get('/tenants/me/requirements')
      setRequirements(data.data || [])
    } catch { /* ignore */ }
  }

  async function loadSubscription() {
    try {
      const [subResp, usageResp, plansResp, histResp] = await Promise.allSettled([
        api.get('/tenants/me/subscription'),
        api.get('/tenants/me/usage'),
        api.get('/tenants/me/plans'),
        api.get('/tenants/me/billing-history'),
      ])
      if (subResp.status === 'fulfilled') setSubscription(subResp.value.data.data || subResp.value.data)
      if (usageResp.status === 'fulfilled') setUsage(usageResp.value.data.data || usageResp.value.data)
      if (plansResp.status === 'fulfilled') setPlans(plansResp.value.data.data || plansResp.value.data || [])
      if (histResp.status === 'fulfilled') setHistory(histResp.value.data.data || histResp.value.data)
    } catch { /* ignore */ }
  }

  async function changePlan(planName: string) {
    setUpgradingPlan(planName); setPayMsg('')
    try {
      // Raise an invoice for the chosen plan + cycle, then pay it.
      const { data } = await api.post('/tenants/me/subscription/upgrade', { plan: planName, billing_cycle: planCycle })
      const invoiceId = (data.data || data).invoice?.id
      setShowPlanModal(false)
      await loadSubscription()
      if (invoiceId) await payInvoice(invoiceId)
    } catch (e: any) {
      setPayMsg(e?.response?.data?.error?.message || t('settings.subscription.couldNotChangePlan'))
    } finally {
      setUpgradingPlan('')
    }
  }

  /** Payment-method + download counters live on the richer history payload. */
  function invoiceDetail(invoiceId: string) {
    return history?.invoices?.find(i => i.id === invoiceId)
  }

  function openReceipt(invoiceId: string) {
    // Receipt is server-rendered HTML; open in a new tab so the user can
    // print / save as PDF. Pass the bearer token via a short-lived fetch→blob.
    api.get(`/tenants/me/invoices/${invoiceId}/receipt?channel=download`, { responseType: 'text' })
      .then(({ data }) => {
        const w = window.open('', '_blank')
        if (w) { w.document.write(data); w.document.close() }
        // The API logs the pull — refresh so the download counters are current.
        loadSubscription()
      })
      .catch(() => setPayMsg(t('settings.subscription.couldNotLoadReceipt')))
  }

  async function payInvoice(invoiceId: string) {
    setPayingId(invoiceId); setPayMsg('')
    try {
      // 1. Create a Razorpay order for the invoice.
      const { data } = await api.post(`/tenants/me/invoices/${invoiceId}/pay`)
      const order = data.data || data
      if (order.mock) {
        // Backend has no live Razorpay keys configured — opening the real
        // checkout widget with a placeholder key would fail immediately.
        setPayMsg(t('settings.subscription.gatewayNotConfigured'))
        setPayingId(null)
        return
      }
      // 2. Open Razorpay Standard Checkout.
      await openRazorpayCheckout({
        order,
        name: profile?.name || 'JainERP Subscription',
        description: 'Platform subscription payment',
        prefill: { name: profile?.name, email: profile?.email, contact: profile?.phone },
        onSuccess: async (cb) => {
          try {
            // 3. Verify the signature; the invoice is marked paid server-side.
            await api.post(`/tenants/me/invoices/${invoiceId}/pay/verify`, cb)
            setPayMsg(t('settings.subscription.paymentSuccess'))
            await loadSubscription()
          } catch {
            setPayMsg(t('settings.subscription.paymentVerifyFailed'))
          } finally {
            setPayingId(null)
          }
        },
        onFailure: (msg) => { setPayMsg(msg); setPayingId(null) },
        onDismiss: () => { setPayMsg(t('settings.subscription.paymentCancelled')); setPayingId(null) },
      })
    } catch (e: any) {
      setPayMsg(e?.response?.data?.error?.message || t('settings.subscription.couldNotStartPayment'))
      setPayingId(null)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    // The API refuses the same things; catching them here keeps the address
    // and contact edits beside them from being lost to a round trip.
    if (Object.keys(issues).length) {
      toast.error(t('settings.profile.fixHighlighted'))
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name, address_line1: form.address_line1, city: form.city, state: form.state,
        pincode: form.pincode, area: form.area, mobile: form.mobile, email: form.email, website: form.website,
        upi_id: form.upi_id,
        custom_receipt_footer: form.custom_receipt_footer,
        show_80g_on_receipt: form.show_80g_on_receipt,
        lat: form.lat, lng: form.lng,
        // Blank goes as null: "no GSTIN" is an absence, and the API stores it so.
        ...Object.fromEntries(COMPLIANCE_FIELDS.map(f => [f, compliance[f].trim() || null])),
        ...Object.fromEntries(IDENTITY_FIELDS.map(f => [f, identity[f].trim() || null])),
      }
      // Verified fields are rejected by the API, and it rejects the whole
      // payload — leaving an unchanged locked value in here would block the
      // address/contact edits sitting alongside it.
      for (const key of Object.keys(payload)) {
        if (sens.isLocked(key)) delete payload[key]
      }
      await api.patch('/tenants/me', payload)
      await fetchProfile()
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function toggleSync() {
    const newVal = !form.global_sync_enabled
    await api.patch('/tenants/me/privacy', { global_sync_enabled: newVal })
    setForm(f => ({ ...f, global_sync_enabled: newVal }))
    await fetchProfile()
  }

  async function sendRequirement(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.post('/tenants/me/requirements', { text: reqText })
      setReqText('')
      setReqSent(true)
      setTimeout(() => setReqSent(false), 4000)
      loadRequirements()
    } catch { /* ignore */ }
  }

  return (
    <div className={`space-y-6 ${['masters', 'accounts', 'users', 'receipts', 'messages'].includes(tab) ? 'max-w-5xl' : 'max-w-3xl'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-navy-900">{t('settings.title')}</h1>
        {/* Stays here even after the dashboard card is dismissed, so setup is
            never something a trust can lose track of. */}
        <SetupMeter />
      </div>

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'my-account', labelKey: 'settings.tabs.myAccount' },
          { id: 'profile', labelKey: 'settings.tabs.profile' },
          { id: 'public-profile', labelKey: 'settings.tabs.publicProfile' },
          { id: 'trustees', labelKey: 'settings.tabs.trustees' },
          { id: 'accounts', labelKey: 'settings.tabs.accounts' },
          { id: 'receipts', labelKey: 'settings.tabs.receipts' },
          { id: 'numbering', labelKey: 'settings.tabs.numbering' },
          { id: 'messages', labelKey: 'settings.tabs.messages' },
          { id: 'masters', labelKey: 'settings.tabs.masters' },
          { id: 'users', labelKey: 'settings.tabs.users' },
          { id: 'backup', labelKey: 'settings.tabs.backup' },
          { id: 'privacy', labelKey: 'settings.tabs.privacy' },
          { id: 'subscription', labelKey: 'settings.tabs.subscription' },
        ].map(tabItem => (
          <button key={tabItem.id} onClick={() => setTab(tabItem.id as TabId)}
            className={`px-4 py-1.5 text-sm rounded-md font-medium ${tab === tabItem.id ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {t(tabItem.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'my-account' && <MyAccountTab />}

      {tab === 'profile' && (
        <form onSubmit={save} className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.profile.heading')}</h3></div>
          <div className="card-body space-y-5">
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">{t('settings.profile.saved')}</div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                {/* LockedField renders its own label, so the plain one is only
                    for the editable case — otherwise the name shows twice. */}
                {sens.isLocked('name') ? (
                  <LockedField label={t('settings.profile.templeName') as string} value={form.name}
                    field="name" pending={sens.pendingFor('name')} onRequest={sens.openRequest} />
                ) : (
                  <>
                    <label className="form-label">{t('settings.profile.templeName')}</label>
                    <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </>
                )}
              </div>
              <div>
                <label className="form-label">{t('settings.profile.mobile')}</label>
                <input type="tel" className="form-input" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label">{t('settings.profile.address')}</label>
              <input className="form-input" value={form.address_line1} onChange={e => setForm(f => ({ ...f, address_line1: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="form-label">{t('settings.profile.state')}</label>
                <StateSelect value={form.state} onChange={s => setForm(f => ({ ...f, state: s, city: '' }))} />
              </div>
              <div><label className="form-label">{t('settings.profile.city')}</label>
                <CitySelect state={form.state} value={form.city} onChange={c => setForm(f => ({ ...f, city: c }))} />
              </div>
              <div><label className="form-label">{t('settings.profile.pincode')}</label><input className="form-input" value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))} /></div>
            </div>
            {/* Locality in the words people use. Devotees searching for
                accommodation type "Ghatkopar West" or "near Palitana taluka" —
                which no pincode captures — so this is what makes the trust
                findable in the devotee app's stay search. Mirrored to
                public.tenants.area on save (migration 033). */}
            <div>
              <label className="form-label">{t('settings.profile.area', 'Area / locality')}</label>
              <input
                className="form-input"
                placeholder="e.g. Ghatkopar West, near Palitana taluka"
                value={form.area}
                onChange={e => setForm(f => ({ ...f, area: e.target.value }))}
              />
              <p className="mt-1 text-xs text-slate-400">{t('ui.dharamshalaDesc')}</p>
            </div>
            <LocationPicker lat={form.lat} lng={form.lng} onChange={(lat, lng) => setForm(f => ({ ...f, lat, lng }))} />
            <div className="grid grid-cols-2 gap-4">
              <div><label className="form-label">{t('settings.profile.email')}</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><label className="form-label">{t('settings.profile.website')}</label><input type="url" className="form-input" placeholder="https://" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} /></div>
            </div>
            <ComplianceSection
              values={compliance}
              loaded={loadedCompliance}
              onChange={(f: ComplianceField, v: string) => setCompliance(c => ({ ...c, [f]: v }))}
              identity={identity}
              onIdentityChange={(f: IdentityField, v: string) => setIdentity(i => ({ ...i, [f]: v }))}
              sens={sens}
              issues={issues}
            />
            {/* The receipt block that used to sit here is gone.
                It edited upi_id, show_80g_on_receipt and custom_receipt_footer
                — all three of which Receipt Settings already owns, and upi_id
                is also on Donor Payments. Three screens writing one field means
                whichever was saved last won, and no screen could be called
                authoritative. Each of those fields now has exactly one home. */}
            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-500">
                {t('settings.profile.movedNote', {
                  defaultValue:
                    'Receipt layout, the 80G line and your footer are in Receipt Settings. UPI and bank details for donors are under Bank & Cash Accounts.',
                })}
              </p>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => setTab('receipts')} className="btn-secondary btn-sm">
                  {t('settings.tabs.receipts')}
                </button>
                <button type="button" onClick={() => setTab('accounts')} className="btn-secondary btn-sm">
                  {t('settings.tabs.accounts')}
                </button>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? t('settings.saving') : t('settings.profile.saveChanges')}
            </button>
          </div>
        </form>
      )}

      {tab === 'trustees' && <TrusteesTab />}
      {/* Donor-facing payment details sit WITH the accounts the money lands
          in, rather than on a tab of their own. They were previously editable
          from here, from Receipt Settings and from Temple Profile at once. */}
      {tab === 'accounts' && (
        <div className="space-y-6">
          <BankAccountsTab />
          <DonorPaymentsTab />
        </div>
      )}
      {/* One tab, not two. The designer is the last card of this tab's Design
          step: both answered "what does my receipt look like", both ran their
          own live preview of the same document, and a trust that finished a
          design had to change tabs to select it. */}
      {tab === 'receipts' && <ReceiptSettingsTab onGoToTab={setTab} />}

      {tab === 'numbering' && <NumberingTab />}

      {tab === 'messages' && <MessagesTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'backup' && <BackupTab />}

      {/* Photos are part of the public page, not a separate concern. */}
      {tab === 'public-profile' && (
        <div className="space-y-6">
          <PublicProfileTab />
          <GalleryTab />
        </div>
      )}

      {tab === 'masters' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{t('settings.masters.helpText')}</p>

          <MasterEditor
            resource="donation-categories"
            title={t('settings.masters.donationCategories')}
            description={t('settings.masters.donationCategoriesDesc')}
            fields={[
              { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderGeneral') as string },
              // Which fund this head's gifts belong to (tenant-migration 038).
              // Set once here, so the donation counter never asks; the fund
              // carries the statutory bucket (corpus / specific / general).
              {
                key: 'fund_id', label: t('settings.masters.fields.fund'), type: 'select',
                optionsFrom: { resource: 'funds' }, emptyLabel: t('settings.masters.fields.fundNone') as string,
              },
              { key: 'is_80g_eligible', label: t('settings.masters.fields.is80gEligible'), type: 'checkbox', default: true },
              { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
            ]}
          />

          {/* Named funds (tenant-migration 036). Separate from the donation
              CATEGORY, which says what a gift was for; a fund says whose money
              it is and what it may be spent on. Dev Dravya, Jivdaya and
              Sadharan are added here — they are not seeded, because they would
              be wrong for a trust outside the Jain tradition. */}
          <MasterEditor
            resource="funds"
            title={t('settings.masters.funds')}
            description={t('settings.masters.fundsDesc')}
            fields={[
              { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: 'Dev Dravya' },
              {
                key: 'fund_type', label: t('settings.masters.fields.fundType'), type: 'select', default: 'general',
                options: [
                  { value: 'general', label: t('donations.fundGeneral') },
                  { value: 'specific', label: t('donations.fundSpecific') },
                  { value: 'corpus', label: t('donations.fundCorpus') },
                ],
              },
              { key: 'is_restricted', label: t('settings.masters.fields.isRestricted'), type: 'checkbox', default: true },
              { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="expense-categories"
            title={t('settings.masters.expenseCategories')}
            description={t('settings.masters.expenseCategoriesDesc')}
            fields={[
              { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderElectricity') as string },
              { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="payment-modes"
            title={t('settings.masters.paymentModes')}
            description={t('settings.masters.paymentModesDesc')}
            fields={[
              { key: 'name', label: t('settings.masters.fields.displayName'), required: true, placeholder: t('settings.masters.fields.namePlaceholderUpi') as string },
              { key: 'code', label: t('settings.masters.fields.code'), required: true, placeholder: t('settings.masters.fields.codePlaceholder') as string },
              { key: 'requires_reference', label: t('settings.masters.fields.requiresRef'), type: 'checkbox' },
              { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="services"
            title={t('settings.masters.sevas')}
            description={t('settings.masters.sevasDesc')}
            fields={[
              { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderAbhishek') as string },
              { key: 'name_hindi', label: t('settings.masters.fields.nameHindi'), placeholder: 'अभिषेक' },
              { key: 'price_paise', label: t('settings.masters.fields.amountRupees'), type: 'money', placeholder: '0.00', required: true },
              { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="gst-rates"
            title={t('settings.masters.gstRates')}
            description={t('settings.masters.gstRatesDesc')}
            fields={[
              { key: 'service', label: t('settings.masters.fields.service'), required: true, placeholder: t('settings.masters.fields.servicePlaceholder') as string },
              { key: 'cgst', label: t('settings.masters.fields.cgst'), type: 'number', placeholder: '9' },
              { key: 'sgst', label: t('settings.masters.fields.sgst'), type: 'number', placeholder: '9' },
              { key: 'igst', label: t('settings.masters.fields.igst'), type: 'number', placeholder: '18' },
            ]}
          />

          {/* The stay extras' price list (tenant migration 057), with the other
              masters rather than inside the receipt settings: it is a list of
              things the counter picks from, like the categories above. */}
          <MasterEditor
            resource="room-charge-items"
            title={t('roomCharges.priceList')}
            description={t('roomCharges.priceListHint')}
            listParams={{ all: 'true' }}
            fields={[
              { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('roomCharges.newItemPlaceholder') as string },
              { key: 'default_rate_paise', label: t('roomCharges.rate'), type: 'money', placeholder: '0.00' },
              { key: 'per_night', label: t('roomCharges.perNight'), type: 'checkbox' },
              { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="halls"
            title={t('settings.masters.halls')}
            description={t('settings.masters.hallsDesc')}
            statusField="is_available"
            fields={[
              { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderMainHall') as string },
              { key: 'capacity_persons', label: t('settings.masters.fields.capacity'), type: 'number', placeholder: '0' },
              { key: 'fullday_tariff_paise', label: t('settings.masters.fields.fullDayTariff'), type: 'money', placeholder: '0' },
              { key: 'session_tariff_paise', label: t('settings.masters.fields.sessionTariff'), type: 'money', placeholder: '0' },
              { key: 'hourly_tariff_paise', label: t('settings.masters.fields.hourlyTariff'), type: 'money', placeholder: '0' },
              { key: 'gst_rate', label: t('settings.masters.fields.gstPercent'), type: 'number', placeholder: '0' },
              // Shown to devotees deciding where to hold a function
              // (tenant-migration 040). The first is the one a listing uses.
              { key: 'images', label: t('settings.masters.fields.hallPhotos'), type: 'images' },
            ]}
          />

          <MasterEditor
            resource="rooms"
            title={t('settings.masters.rooms')}
            description={t('settings.masters.roomsDesc')}
            statusField="is_available"
            fields={[
              { key: 'room_number', label: t('settings.masters.fields.roomNo'), required: true, placeholder: t('settings.masters.fields.roomNoPlaceholder') as string },
              { key: 'name', label: t('settings.masters.fields.nameType'), placeholder: t('settings.masters.fields.nameTypePlaceholder') as string },
              // Where the room is, so the room board can show it building by
              // building and floor by floor (tenant migration 053). Both are
              // optional: a one-building trust leaves Building empty, and the
              // board falls back to the room numbers' own series.
              { key: 'building', label: t('settings.masters.fields.building'), placeholder: t('settings.masters.fields.buildingPlaceholder') as string, clearable: true },
              { key: 'floor', label: t('settings.masters.fields.floor'), type: 'number', placeholder: t('settings.masters.fields.floorPlaceholder') as string },
              { key: 'capacity_persons', label: t('settings.masters.fields.capacity'), type: 'number', placeholder: '0' },
              { key: 'tariff_paise', label: t('settings.masters.fields.tariffPerNight'), type: 'money', placeholder: '0' },
              { key: 'gst_rate', label: t('settings.masters.fields.gstPercent'), type: 'number', placeholder: '0' },
              // Shown to a devotee choosing a room in the Bhakt app and portal
              // (tenant-migration 040), who previously saw only a number, a
              // type and a price. The first photo is the one a search card uses.
              { key: 'images', label: t('settings.masters.fields.roomPhotos'), type: 'images' },
            ]}
          />

          {/* What a plate costs at each sitting (tenant migration 042).
              Here rather than at the counter because it is a property of the
              trust, not of a sale — and because the counter has a queue in
              front of it and must not stop to ask. The API prices from these,
              so the counter showing them as fixed is true. */}
          <BhojanshalaRates />

          {/* Vendors are managed on the dedicated master page (Masters → Vendors / Suppliers),
              not here, to avoid two places editing the same records. */}

          <MasterEditor
            resource="prasad/items"
            title={t('settings.masters.prasadItems')}
            description={t('settings.masters.prasadItemsDesc')}
            statusField="is_available"
            fields={[
              { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderLadoo') as string },
              { key: 'name_hindi', label: t('settings.masters.fields.nameHindi'), placeholder: 'लड्डू' },
              { key: 'unit', label: t('settings.masters.fields.unit'), placeholder: t('settings.masters.fields.unitPlaceholder') as string, default: 'piece' },
              { key: 'price_paise', label: t('settings.masters.fields.priceRupees'), type: 'money', required: true, placeholder: '0.00' },
              { key: 'gst_rate', label: t('settings.masters.fields.gstPercentField'), type: 'number', placeholder: '0', default: 0 },
              { key: 'low_stock_threshold', label: t('settings.masters.fields.lowStockAlert'), type: 'number', placeholder: '10', default: 10 },
              { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0', default: 0 },
            ]}
          />
        </div>
      )}

      {tab === 'privacy' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.privacy.syncHeading')}</h3></div>
            <div className="card-body">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm">{t('settings.privacy.syncLabel')}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{t('settings.privacy.syncHelp')}</p>
                </div>
                <button
                  onClick={toggleSync}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer focus:outline-none ${form.global_sync_enabled ? 'bg-green-600' : 'bg-slate-200'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.global_sync_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.privacy.requirementHeading')}</h3></div>
            <div className="card-body">
              <p className="text-xs text-slate-500 mb-3">{t('settings.privacy.requirementHelp')}</p>
              {reqSent && <div className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{t('settings.privacy.requirementSent')}</div>}
              <form onSubmit={sendRequirement} className="flex gap-3">
                <textarea className="form-input flex-1" rows={2} value={reqText}
                  onChange={e => setReqText(e.target.value)} placeholder={t('settings.privacy.requirementPlaceholder') as string} required />
                <button type="submit" disabled={!reqText.trim()} className="btn-primary self-end">{t('settings.privacy.send')}</button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <ClipboardList size={14} /> {t('settings.privacy.myRequirementsHeading')}
              </h3>
              <span className="text-xs text-slate-400">{t('settings.privacy.submittedCount', { count: requirements.length })}</span>
            </div>
            {requirements.length === 0 ? (
              <div className="card-body text-sm text-slate-400">{t('settings.privacy.noRequirements')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>{t('settings.privacy.requirementCol')}</th><th>{t('settings.privacy.statusCol')}</th><th>{t('settings.privacy.noteCol')}</th><th>{t('settings.privacy.raisedOnCol')}</th></tr></thead>
                  <tbody>
                    {requirements.map(r => (
                      <tr key={r.id}>
                        <td className="text-sm max-w-xs">{r.text}</td>
                        <td>
                          {r.status === 'done' ? <span className="badge-green">{t('settings.privacy.statusDone')}</span>
                            : r.status === 'in_progress' ? <span className="badge-blue">{t('settings.privacy.statusInProgress')}</span>
                            : r.status === 'rejected' ? <span className="badge-red">{t('settings.privacy.statusRejected')}</span>
                            : <span className="badge-yellow">{t('settings.privacy.statusOpen')}</span>}
                        </td>
                        <td className="text-xs text-slate-500">{r.note || '—'}</td>
                        <td className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'subscription' && (
        <div className="space-y-4">
          {subscription?.subscription ? (
            <div className="card">
              <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><TrendingUp size={14} /> {t('settings.subscription.currentPlanHeading')}</h3></div>
              <div className="card-body">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs">{t('settings.subscription.plan')}</p>
                    <p className="font-bold text-navy-900">{subscription.subscription.plan_display || '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">{t('settings.subscription.status')}</p>
                    <span className={subscription.subscription.status === 'active' ? 'badge-green' : 'badge-red'}>{subscription.subscription.status}</span>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">{t('settings.subscription.renewsOn')}</p>
                    <p className="font-medium">{subscription.subscription.current_period_end ? new Date(subscription.subscription.current_period_end).toLocaleDateString('en-IN') : '—'}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <button onClick={() => setShowPlanModal(true)} className="btn-secondary btn-sm">
                    <TrendingUp size={13} /> {t('settings.subscription.changePlan')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card"><div className="card-body flex items-center justify-between text-sm">
              <span className="text-slate-400">{t('settings.subscription.noSubscription')}</span>
              <button onClick={() => setShowPlanModal(true)} className="btn-secondary btn-sm"><TrendingUp size={13} /> {t('settings.subscription.choosePlan')}</button>
            </div></div>
          )}

          {usage && (
            <div className="card">
              <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><CreditCard size={14} /> {t('settings.subscription.usageHeading')}</h3></div>
              <div className="card-body">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  {[
                    { label: t('settings.subscription.users'), current: usage.current?.users, max: usage.limits?.max_users },
                    { label: t('settings.subscription.receipts'), current: usage.current?.receipts_this_month, max: usage.limits?.max_receipts_per_month },
                    { label: t('settings.subscription.smsPerMonth'), current: 0, max: usage.limits?.max_sms_per_month },
                  ].map(({ label, current, max }) => {
                    // Limit columns store -1 for "no cap" (the Enterprise plan).
                    // Treating only null as unlimited printed "3 / -1" and gave
                    // the bar a negative width.
                    const unlimited = max == null || max < 0
                    const pct = unlimited ? 0 : Math.min(100, ((current || 0) / (max || 1)) * 100)
                    return (
                      <div key={label}>
                        <p className="text-xs text-slate-400 mb-1">{label}</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-2">
                            <div className="bg-brand-red h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-medium">{current ?? 0} / {planLimit(max)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {payMsg && <div className="card"><div className="card-body text-sm text-slate-700">{payMsg}</div></div>}

          {subscription?.invoices && subscription.invoices.length > 0 && (
            <div className="card overflow-hidden">
              <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.subscription.billingHistoryHeading')}</h3></div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>{t('settings.subscription.invoiceCol')}</th><th>{t('settings.subscription.periodCol')}</th><th>{t('settings.subscription.amountCol')}</th><th>{t('settings.subscription.statusCol')}</th><th>{t('settings.subscription.paidViaCol')}</th><th>{t('settings.subscription.downloadsCol')}</th><th></th></tr></thead>
                  <tbody>
                    {subscription.invoices.map(inv => (
                      <tr key={inv.id}>
                        <td className="font-mono text-xs">{inv.invoice_number || inv.id.slice(0, 8)}</td>
                        <td className="text-xs text-slate-500">{inv.period_start ? new Date(inv.period_start).toLocaleDateString('en-IN') : '—'} – {inv.period_end ? new Date(inv.period_end).toLocaleDateString('en-IN') : '—'}</td>
                        <td className="font-semibold">{inv.total_paise ? `₹${fmtPaise(inv.total_paise)}` : '—'}</td>
                        <td><span className={inv.status === 'paid' ? 'badge-green' : 'badge-yellow'}>{inv.status}</span></td>
                        <td className="text-xs text-slate-500">{invoiceDetail(inv.id)?.payment_method?.replace(/_/g, ' ') || '—'}</td>
                        <td className="text-xs text-slate-500">
                          {(invoiceDetail(inv.id)?.download_count ?? 0) > 0
                            ? `${invoiceDetail(inv.id)!.download_count}×`
                            : t('settings.subscription.neverDownloaded')}
                        </td>
                        <td className="text-right">
                          {inv.status === 'paid' ? (
                            <button onClick={() => openReceipt(inv.id)} className="btn-secondary btn-sm">
                              <ClipboardList size={13} /> {t('settings.subscription.receiptButton')}
                            </button>
                          ) : (
                            <button
                              onClick={() => payInvoice(inv.id)}
                              disabled={payingId === inv.id}
                              className="btn-primary btn-sm"
                            >
                              <CreditCard size={13} />
                              {payingId === inv.id ? t('settings.subscription.processing') : t('settings.subscription.payNow')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---- Plan upgrade / downgrade history ---- */}
          <div className="card overflow-hidden" data-testid="upgrade-history">
            <div className="card-header">
              <h3 className="font-semibold text-sm">{t('settings.subscription.upgradeHistoryHeading')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>
                  <th>{t('settings.subscription.whenCol')}</th>
                  <th>{t('settings.subscription.changeCol')}</th>
                  <th>{t('settings.subscription.fromToCol')}</th>
                  <th>{t('settings.subscription.invoiceCol')}</th>
                </tr></thead>
                <tbody>
                  {(history?.plan_changes ?? []).map((c, i) => (
                    <tr key={i}>
                      <td className="text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString('en-IN')}</td>
                      <td className="text-xs">{c.change_type.replace(/_/g, ' ')}</td>
                      <td className="font-mono text-xs">{c.from_value} → {c.to_value}</td>
                      <td className="font-mono text-xs">{c.invoice_number || '—'}</td>
                    </tr>
                  ))}
                  {(history?.plan_changes ?? []).length === 0 && (
                    <tr><td colSpan={4} className="text-xs text-slate-400">{t('settings.subscription.noUpgrades')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- Downloaded receipts history ---- */}
          <div className="card overflow-hidden" data-testid="download-history">
            <div className="card-header">
              <h3 className="font-semibold text-sm">{t('settings.subscription.downloadHistoryHeading')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>
                  <th>{t('settings.subscription.whenCol')}</th>
                  <th>{t('settings.subscription.invoiceCol')}</th>
                  <th>{t('settings.subscription.amountCol')}</th>
                  <th>{t('settings.subscription.byCol')}</th>
                  <th>{t('settings.subscription.howCol')}</th>
                </tr></thead>
                <tbody>
                  {(history?.receipt_downloads ?? []).map(d => (
                    <tr key={d.id}>
                      <td className="text-xs text-slate-500">{new Date(d.created_at).toLocaleString('en-IN')}</td>
                      <td className="font-mono text-xs">{d.invoice_number || '—'}</td>
                      <td className="text-xs">{d.total_paise ? `₹${fmtPaise(d.total_paise)}` : '—'}</td>
                      <td className="text-xs">{d.actor_type === 'super_admin' ? 'JainERP' : (d.actor_name || '—')}</td>
                      <td className="text-xs">{d.channel}</td>
                    </tr>
                  ))}
                  {(history?.receipt_downloads ?? []).length === 0 && (
                    <tr><td colSpan={5} className="text-xs text-slate-400">{t('settings.subscription.noDownloads')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Change Plan modal */}
          {showPlanModal && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowPlanModal(false)}>
              <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-navy-900">{t('settings.subscription.modalHeading')}</h3>
                  <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs">
                    <button onClick={() => setPlanCycle('monthly')} className={`px-3 py-1 rounded-md font-medium ${planCycle === 'monthly' ? 'bg-white shadow-sm text-navy-900' : 'text-slate-500'}`}>{t('settings.subscription.monthly')}</button>
                    <button onClick={() => setPlanCycle('yearly')} className={`px-3 py-1 rounded-md font-medium ${planCycle === 'yearly' ? 'bg-white shadow-sm text-navy-900' : 'text-slate-500'}`}>{t('settings.subscription.yearly')}</button>
                  </div>
                </div>
                <div className="space-y-3">
                  {plans.map(p => {
                    const price = planCycle === 'yearly' ? p.price_yearly_paise : p.price_monthly_paise
                    const isCurrent = subscription?.subscription?.plan_display === p.display_name
                    return (
                      <div key={p.id} className={`card p-4 ${isCurrent ? 'border-brand-red' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-bold text-navy-900">{p.display_name} {isCurrent && <span className="badge-green ml-1">{t('settings.subscription.current')}</span>}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{t('settings.subscription.usersReceiptsSms', { users: planLimit(p.max_users), receipts: planLimit(p.max_receipts_per_month), sms: planLimit(p.max_sms_per_month) })}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-navy-900">{price > 0 ? `₹${fmtPaise(price)}` : t('settings.subscription.free')}</p>
                            <p className="text-[10px] text-slate-400">{planCycle === 'yearly' ? t('settings.subscription.perYear') : t('settings.subscription.perMonth')}</p>
                          </div>
                        </div>
                        {price > 0 && (
                          <button
                            onClick={() => changePlan(p.name)}
                            disabled={!!upgradingPlan}
                            className="btn-primary btn-sm w-full justify-center mt-3"
                          >
                            {upgradingPlan === p.name ? t('settings.subscription.processing') : isCurrent ? t('settings.subscription.renew') : t('settings.subscription.selectAndPay')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {plans.length === 0 && <p className="text-sm text-slate-400 text-center py-4">{t('settings.subscription.noPlans')}</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {sens.modal}
    </div>
  )
}
