import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, RefreshCw, TrendingUp, CreditCard, ClipboardList } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { useSensitiveFields, LockedField, VerifiedBanner } from '../../components/SensitiveFields'
import { openRazorpayCheckout } from '../../lib/razorpay'
import { useProfileStore } from '../../store/profileStore'
import { LocationPicker } from '../../components/LocationPicker'
import { StateSelect, CitySelect } from '../../components/GeoSelect'
import { MasterEditor } from './MasterEditor'
import { BankAccountsTab } from './tabs/BankAccountsTab'
import { DonorPaymentsTab } from './tabs/DonorPaymentsTab'
import { ReceiptSettingsTab } from './tabs/ReceiptSettingsTab'
import { NumberingTab } from './tabs/NumberingTab'
import { MessagesTab } from './tabs/MessagesTab'
import { AccountingRulesTab } from './tabs/AccountingRulesTab'
import { UsersTab } from './tabs/UsersTab'
import { BackupTab } from './tabs/BackupTab'
import { GalleryTab } from './tabs/GalleryTab'
import { TrusteesTab } from './tabs/TrusteesTab'
import { MyAccountTab } from './tabs/MyAccountTab'

interface Requirement {
  id: string
  text: string
  status: 'open' | 'in_progress' | 'done' | 'rejected'
  note: string | null
  raised_by: string | null
  created_at: string
  updated_at: string
}

export function SettingsPage() {
  const { t } = useTranslation()
  const { profile, fetchProfile } = useProfileStore()
  const [tab, setTab] = useState<'my-account' | 'profile' | 'trustees' | 'masters' | 'gallery' | 'accounts' | 'donor-payments' | 'receipts' | 'numbering' | 'messages' | 'accounting' | 'users' | 'backup' | 'subscription' | 'privacy'>('profile')
  const [saving, setSaving] = useState(false)
  const sens = useSensitiveFields()
  const [success, setSuccess] = useState(false)
  const [form, setForm] = useState({
    name: '', address_line1: '', city: '', state: '', pincode: '', mobile: '', email: '', website: '',
    gstin: '', pan: '', reg_80g_number: '', reg_12ab_number: '', upi_id: '', custom_receipt_footer: '',
    show_80g_on_receipt: false, global_sync_enabled: false,
    lat: null as number | null, lng: null as number | null,
  })
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
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
    limits?: { max_users?: number; max_receipts_per_month?: number; max_sms_per_month?: number }
    current?: { users?: number; receipts_this_month?: number }
  }
  interface PlanRow {
    id: string; name: string; display_name: string
    price_monthly_paise: number; price_yearly_paise: number
    max_users: number; max_receipts_per_month: number; max_sms_per_month: number
  }

  useEffect(() => {
    if (profile) {
      const p = profile as unknown as Record<string, string | boolean | undefined>
      setForm({
        name: profile.name || '',
        address_line1: (p.address_line1 as string) || (profile.address as string) || '',
        city: profile.city || '',
        state: profile.state || '',
        pincode: (p.pincode as string) || '',
        mobile: profile.phone || (p.mobile as string) || '',
        email: profile.email || '',
        website: profile.website || '',
        gstin: (p.gstin as string) || '',
        pan: (p.pan as string) || '',
        reg_80g_number: (p.reg_80g_number as string) || '',
        reg_12ab_number: (p.reg_12ab_number as string) || '',
        upi_id: (p.upi_id as string) || '',
        custom_receipt_footer: (p.custom_receipt_footer as string) || '',
        show_80g_on_receipt: Boolean(p.show_80g_on_receipt),
        global_sync_enabled: profile.global_sync_enabled || false,
        lat: p.lat != null ? Number(p.lat) : null,
        lng: p.lng != null ? Number(p.lng) : null,
      })
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
      const [subResp, usageResp, plansResp] = await Promise.allSettled([
        api.get('/tenants/me/subscription'),
        api.get('/tenants/me/usage'),
        api.get('/tenants/me/plans'),
      ])
      if (subResp.status === 'fulfilled') setSubscription(subResp.value.data.data || subResp.value.data)
      if (usageResp.status === 'fulfilled') setUsage(usageResp.value.data.data || usageResp.value.data)
      if (plansResp.status === 'fulfilled') setPlans(plansResp.value.data.data || plansResp.value.data || [])
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

  function openReceipt(invoiceId: string) {
    // Receipt is server-rendered HTML; open in a new tab so the user can
    // print / save as PDF. Pass the bearer token via a short-lived fetch→blob.
    api.get(`/tenants/me/invoices/${invoiceId}/receipt`, { responseType: 'text' })
      .then(({ data }) => {
        const w = window.open('', '_blank')
        if (w) { w.document.write(data); w.document.close() }
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
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name, address_line1: form.address_line1, city: form.city, state: form.state,
        pincode: form.pincode, mobile: form.mobile, email: form.email, website: form.website,
        gstin: form.gstin, pan: form.pan, reg_80g_number: form.reg_80g_number,
        reg_12ab_number: form.reg_12ab_number, upi_id: form.upi_id,
        custom_receipt_footer: form.custom_receipt_footer,
        show_80g_on_receipt: form.show_80g_on_receipt,
        lat: form.lat, lng: form.lng,
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
      <h1 className="text-xl font-bold text-navy-900">{t('settings.title')}</h1>

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'my-account', labelKey: 'settings.tabs.myAccount' },
          { id: 'profile', labelKey: 'settings.tabs.profile' },
          { id: 'trustees', labelKey: 'settings.tabs.trustees' },
          { id: 'accounts', labelKey: 'settings.tabs.accounts' },
          { id: 'donor-payments', labelKey: 'settings.tabs.donorPayments' },
          { id: 'receipts', labelKey: 'settings.tabs.receipts' },
          { id: 'numbering', labelKey: 'settings.tabs.numbering' },
          { id: 'messages', labelKey: 'settings.tabs.messages' },
          { id: 'accounting', labelKey: 'settings.tabs.accounting' },
          { id: 'masters', labelKey: 'settings.tabs.masters' },
          { id: 'gallery', labelKey: 'settings.tabs.gallery' },
          { id: 'users', labelKey: 'settings.tabs.users' },
          { id: 'backup', labelKey: 'settings.tabs.backup' },
          { id: 'privacy', labelKey: 'settings.tabs.privacy' },
          { id: 'subscription', labelKey: 'settings.tabs.subscription' },
        ].map(tabItem => (
          <button key={tabItem.id} onClick={() => setTab(tabItem.id as typeof tab)}
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
            <LocationPicker lat={form.lat} lng={form.lng} onChange={(lat, lng) => setForm(f => ({ ...f, lat, lng }))} />
            <div className="grid grid-cols-2 gap-4">
              <div><label className="form-label">{t('settings.profile.email')}</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><label className="form-label">{t('settings.profile.website')}</label><input type="url" className="form-input" placeholder="https://" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} /></div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('settings.profile.registrationCompliance')}</p>
              {sens.locked && (
                <div className="mb-3">
                  <VerifiedBanner verifiedAt={sens.state?.verified_at ?? null} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>{sens.isLocked('pan') ? (
                  <LockedField label={t('settings.profile.pan') as string} value={form.pan}
                    field="pan" pending={sens.pendingFor('pan')} onRequest={sens.openRequest} />
                ) : (<><label className="form-label">{t('settings.profile.pan')}</label><input className="form-input uppercase" value={form.pan} onChange={e => setForm(f => ({ ...f, pan: e.target.value.toUpperCase() }))} /></>)}</div>
                <div>{sens.isLocked('gstin') ? (
                  <LockedField label={t('settings.profile.gstin') as string} value={form.gstin}
                    field="gstin" pending={sens.pendingFor('gstin')} onRequest={sens.openRequest} />
                ) : (<><label className="form-label">{t('settings.profile.gstin')}</label><input className="form-input uppercase" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} /></>)}</div>
                <div>{sens.isLocked('reg_80g_number') ? (
                  <LockedField label={t('settings.profile.reg80g') as string} value={form.reg_80g_number}
                    field="reg_80g_number" pending={sens.pendingFor('reg_80g_number')} onRequest={sens.openRequest} />
                ) : (<><label className="form-label">{t('settings.profile.reg80g')}</label><input className="form-input" value={form.reg_80g_number} onChange={e => setForm(f => ({ ...f, reg_80g_number: e.target.value }))} /></>)}</div>
                <div>{sens.isLocked('reg_12ab_number') ? (
                  <LockedField label={t('settings.profile.reg12ab') as string} value={form.reg_12ab_number}
                    field="reg_12ab_number" pending={sens.pendingFor('reg_12ab_number')} onRequest={sens.openRequest} />
                ) : (<><label className="form-label">{t('settings.profile.reg12ab')}</label><input className="form-input" value={form.reg_12ab_number} onChange={e => setForm(f => ({ ...f, reg_12ab_number: e.target.value }))} /></>)}</div>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('settings.profile.receiptSettings')}</p>
              <div className="grid grid-cols-2 gap-4">
                <div>{sens.isLocked('upi_id') ? (
                  <LockedField label={t('settings.profile.upiId') as string} value={form.upi_id}
                    field="upi_id" pending={sens.pendingFor('upi_id')} onRequest={sens.openRequest} />
                ) : (<><label className="form-label">{t('settings.profile.upiId')}</label><input className="form-input" placeholder="temple@upi" value={form.upi_id} onChange={e => setForm(f => ({ ...f, upi_id: e.target.value }))} /></>)}</div>
                <div className="flex items-center gap-3 mt-5">
                  <input type="checkbox" id="show80g" checked={form.show_80g_on_receipt} onChange={e => setForm(f => ({ ...f, show_80g_on_receipt: e.target.checked }))} className="w-4 h-4" />
                  <label htmlFor="show80g" className="text-sm">{t('settings.profile.show80gOnReceipt')}</label>
                </div>
              </div>
              <div className="mt-3">
                <label className="form-label">{t('settings.profile.customFooter')}</label>
                <textarea className="form-input" rows={2} value={form.custom_receipt_footer} onChange={e => setForm(f => ({ ...f, custom_receipt_footer: e.target.value }))} placeholder={t('settings.profile.footerPlaceholder') as string} />
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
      {tab === 'accounts' && <BankAccountsTab />}
      {tab === 'donor-payments' && <DonorPaymentsTab />}
      {tab === 'receipts' && <ReceiptSettingsTab />}

      {tab === 'numbering' && <NumberingTab />}

      {tab === 'messages' && <MessagesTab />}
      {tab === 'accounting' && <AccountingRulesTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'backup' && <BackupTab />}

      {tab === 'gallery' && <GalleryTab />}

      {tab === 'masters' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{t('settings.masters.helpText')}</p>

          <MasterEditor
            resource="donation-categories"
            title={t('settings.masters.donationCategories')}
            description={t('settings.masters.donationCategoriesDesc')}
            fields={[
              { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderGeneral') as string },
              { key: 'is_80g_eligible', label: t('settings.masters.fields.is80gEligible'), type: 'checkbox', default: true },
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
              { key: 'capacity_persons', label: t('settings.masters.fields.capacity'), type: 'number', placeholder: '0' },
              { key: 'tariff_paise', label: t('settings.masters.fields.tariffPerNight'), type: 'money', placeholder: '0' },
              { key: 'gst_rate', label: t('settings.masters.fields.gstPercent'), type: 'number', placeholder: '0' },
            ]}
          />

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
                  ].map(({ label, current, max }) => (
                    <div key={label}>
                      <p className="text-xs text-slate-400 mb-1">{label}</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-2">
                          <div className="bg-brand-red h-2 rounded-full transition-all" style={{ width: `${Math.min(100, ((current || 0) / (max || 1)) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-medium">{current ?? 0} / {max ?? '∞'}</span>
                      </div>
                    </div>
                  ))}
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
                  <thead><tr><th>{t('settings.subscription.invoiceCol')}</th><th>{t('settings.subscription.periodCol')}</th><th>{t('settings.subscription.amountCol')}</th><th>{t('settings.subscription.statusCol')}</th><th></th></tr></thead>
                  <tbody>
                    {subscription.invoices.map(inv => (
                      <tr key={inv.id}>
                        <td className="font-mono text-xs">{inv.invoice_number || inv.id.slice(0, 8)}</td>
                        <td className="text-xs text-slate-500">{inv.period_start ? new Date(inv.period_start).toLocaleDateString('en-IN') : '—'} – {inv.period_end ? new Date(inv.period_end).toLocaleDateString('en-IN') : '—'}</td>
                        <td className="font-semibold">{inv.total_paise ? `₹${fmtPaise(inv.total_paise)}` : '—'}</td>
                        <td><span className={inv.status === 'paid' ? 'badge-green' : 'badge-yellow'}>{inv.status}</span></td>
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
                            <p className="text-xs text-slate-400 mt-0.5">{t('settings.subscription.usersReceiptsSms', { users: p.max_users, receipts: p.max_receipts_per_month, sms: p.max_sms_per_month })}</p>
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
