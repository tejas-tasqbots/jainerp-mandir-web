import { useEffect, useState } from 'react'
import { Save, RefreshCw, TrendingUp, CreditCard, ClipboardList } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { openRazorpayCheckout } from '../../lib/razorpay'
import { useProfileStore } from '../../store/profileStore'
import { LocationPicker } from '../../components/LocationPicker'
import { StateSelect, CitySelect } from '../../components/GeoSelect'
import { MasterEditor } from './MasterEditor'
import { BankAccountsTab } from './tabs/BankAccountsTab'
import { ReceiptSettingsTab } from './tabs/ReceiptSettingsTab'
import { AccountingRulesTab } from './tabs/AccountingRulesTab'
import { UsersTab } from './tabs/UsersTab'
import { BackupTab } from './tabs/BackupTab'
import { GalleryTab } from './tabs/GalleryTab'
import { TrusteesTab } from './tabs/TrusteesTab'

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
  const { profile, fetchProfile } = useProfileStore()
  const [tab, setTab] = useState<'profile' | 'trustees' | 'masters' | 'gallery' | 'accounts' | 'receipts' | 'accounting' | 'users' | 'backup' | 'subscription' | 'privacy'>('profile')
  const [saving, setSaving] = useState(false)
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
      setPayMsg(e?.response?.data?.error?.message || 'Could not change plan.')
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
      .catch(() => setPayMsg('Could not load receipt.'))
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
        setPayMsg('Payment gateway is not configured on the server yet. Please contact support.')
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
            setPayMsg('Payment successful — subscription active.')
            await loadSubscription()
          } catch {
            setPayMsg('Payment could not be verified. Please contact support.')
          } finally {
            setPayingId(null)
          }
        },
        onFailure: (msg) => { setPayMsg(msg); setPayingId(null) },
        onDismiss: () => { setPayMsg('Payment cancelled.'); setPayingId(null) },
      })
    } catch (e: any) {
      setPayMsg(e?.response?.data?.error?.message || 'Could not start payment.')
      setPayingId(null)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.patch('/tenants/me', {
        name: form.name, address_line1: form.address_line1, city: form.city, state: form.state,
        pincode: form.pincode, mobile: form.mobile, email: form.email, website: form.website,
        gstin: form.gstin, pan: form.pan, reg_80g_number: form.reg_80g_number,
        reg_12ab_number: form.reg_12ab_number, upi_id: form.upi_id,
        custom_receipt_footer: form.custom_receipt_footer,
        show_80g_on_receipt: form.show_80g_on_receipt,
        lat: form.lat, lng: form.lng,
      })
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
    <div className={`space-y-6 ${['masters', 'accounts', 'users', 'receipts'].includes(tab) ? 'max-w-5xl' : 'max-w-3xl'}`}>
      <h1 className="text-xl font-bold text-navy-900">Settings</h1>

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'profile', label: 'Temple Profile' },
          { id: 'trustees', label: 'Trustees' },
          { id: 'accounts', label: 'Bank & Cash Accounts' },
          { id: 'receipts', label: 'Receipt Settings' },
          { id: 'accounting', label: 'Accounting Rules' },
          { id: 'masters', label: 'Categories & Dropdowns' },
          { id: 'gallery', label: 'Gallery' },
          { id: 'users', label: 'Users' },
          { id: 'backup', label: 'Backup' },
          { id: 'privacy', label: 'Privacy & Sync' },
          { id: 'subscription', label: 'Subscription & Usage' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
            className={`px-4 py-1.5 text-sm rounded-md font-medium ${tab === t.id ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <form onSubmit={save} className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Temple / Mandir Profile</h3></div>
          <div className="card-body space-y-5">
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">Settings saved successfully!</div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Temple / Mandir Name *</label>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Mobile</label>
                <input type="tel" className="form-input" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label">Address</label>
              <input className="form-input" value={form.address_line1} onChange={e => setForm(f => ({ ...f, address_line1: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="form-label">State</label>
                <StateSelect value={form.state} onChange={s => setForm(f => ({ ...f, state: s, city: '' }))} />
              </div>
              <div><label className="form-label">City</label>
                <CitySelect state={form.state} value={form.city} onChange={c => setForm(f => ({ ...f, city: c }))} />
              </div>
              <div><label className="form-label">Pincode</label><input className="form-input" value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))} /></div>
            </div>
            <LocationPicker lat={form.lat} lng={form.lng} onChange={(lat, lng) => setForm(f => ({ ...f, lat, lng }))} />
            <div className="grid grid-cols-2 gap-4">
              <div><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><label className="form-label">Website</label><input type="url" className="form-input" placeholder="https://" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} /></div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Registration & Compliance</p>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="form-label">PAN</label><input className="form-input uppercase" value={form.pan} onChange={e => setForm(f => ({ ...f, pan: e.target.value.toUpperCase() }))} /></div>
                <div><label className="form-label">GSTIN</label><input className="form-input uppercase" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} /></div>
                <div><label className="form-label">80G Registration No.</label><input className="form-input" value={form.reg_80g_number} onChange={e => setForm(f => ({ ...f, reg_80g_number: e.target.value }))} /></div>
                <div><label className="form-label">12AB Registration No.</label><input className="form-input" value={form.reg_12ab_number} onChange={e => setForm(f => ({ ...f, reg_12ab_number: e.target.value }))} /></div>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Receipt Settings</p>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="form-label">UPI ID</label><input className="form-input" placeholder="temple@upi" value={form.upi_id} onChange={e => setForm(f => ({ ...f, upi_id: e.target.value }))} /></div>
                <div className="flex items-center gap-3 mt-5">
                  <input type="checkbox" id="show80g" checked={form.show_80g_on_receipt} onChange={e => setForm(f => ({ ...f, show_80g_on_receipt: e.target.checked }))} className="w-4 h-4" />
                  <label htmlFor="show80g" className="text-sm">Show 80G details on receipts</label>
                </div>
              </div>
              <div className="mt-3">
                <label className="form-label">Custom Receipt Footer</label>
                <textarea className="form-input" rows={2} value={form.custom_receipt_footer} onChange={e => setForm(f => ({ ...f, custom_receipt_footer: e.target.value }))} placeholder="Jai Jinendra! Thank you for your donation." />
              </div>
            </div>
          </div>
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {tab === 'trustees' && <TrusteesTab />}
      {tab === 'accounts' && <BankAccountsTab />}
      {tab === 'receipts' && <ReceiptSettingsTab />}
      {tab === 'accounting' && <AccountingRulesTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'backup' && <BackupTab />}

      {tab === 'gallery' && <GalleryTab />}

      {tab === 'masters' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Configure the dropdown options used across the app. Items are mandir-specific. Deactivating an
            item hides it from new entries while keeping it on past records.
          </p>

          <MasterEditor
            resource="donation-categories"
            title="Donation Categories"
            description="Shown when recording a donation."
            fields={[
              { key: 'name', label: 'Name', required: true, placeholder: 'e.g. General Donation' },
              { key: 'is_80g_eligible', label: '80G Eligible', type: 'checkbox', default: true },
              { key: 'sort_order', label: 'Sort Order', type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="expense-categories"
            title="Expense Categories"
            description="Shown when recording an expense."
            fields={[
              { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Electricity' },
              { key: 'sort_order', label: 'Sort Order', type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="payment-modes"
            title="Payment Modes"
            description="Shown wherever a payment method is selected."
            fields={[
              { key: 'name', label: 'Display Name', required: true, placeholder: 'e.g. UPI' },
              { key: 'code', label: 'Code', required: true, placeholder: 'e.g. upi' },
              { key: 'requires_reference', label: 'Requires UTR / Ref', type: 'checkbox' },
              { key: 'sort_order', label: 'Sort Order', type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="services"
            title="Sevas / Services"
            description="Seva options and their default amounts."
            fields={[
              { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Abhishek' },
              { key: 'name_hindi', label: 'Name (Hindi)', placeholder: 'अभिषेक' },
              { key: 'price_paise', label: 'Amount (₹)', type: 'money', placeholder: '0.00', required: true },
              { key: 'sort_order', label: 'Sort Order', type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="gst-rates"
            title="GST Rates"
            description="GST percentages applied to taxable services (CGST + SGST for intra-state)."
            fields={[
              { key: 'service', label: 'Service / Label', required: true, placeholder: 'e.g. Hall Rent' },
              { key: 'cgst', label: 'CGST (%)', type: 'number', placeholder: '9' },
              { key: 'sgst', label: 'SGST (%)', type: 'number', placeholder: '9' },
              { key: 'igst', label: 'IGST (%)', type: 'number', placeholder: '18' },
            ]}
          />

          <MasterEditor
            resource="halls"
            title="Halls"
            description="Dharamshala halls available for booking. Tariffs are the default prices — editable per booking."
            statusField="is_available"
            fields={[
              { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Main Hall' },
              { key: 'capacity_persons', label: 'Capacity', type: 'number', placeholder: '0' },
              { key: 'fullday_tariff_paise', label: 'Full-day ₹', type: 'money', placeholder: '0' },
              { key: 'session_tariff_paise', label: 'Session ₹', type: 'money', placeholder: '0' },
              { key: 'hourly_tariff_paise', label: 'Hourly ₹', type: 'money', placeholder: '0' },
              { key: 'gst_rate', label: 'GST %', type: 'number', placeholder: '0' },
            ]}
          />

          <MasterEditor
            resource="rooms"
            title="Rooms"
            description="Dharamshala rooms available for check-in. Tariff is the default per-night price — editable at checkout."
            statusField="is_available"
            fields={[
              { key: 'room_number', label: 'Room No.', required: true, placeholder: 'e.g. 101' },
              { key: 'name', label: 'Name / Type', placeholder: 'e.g. AC Deluxe' },
              { key: 'capacity_persons', label: 'Capacity', type: 'number', placeholder: '0' },
              { key: 'tariff_paise', label: 'Tariff / night ₹', type: 'money', placeholder: '0' },
              { key: 'gst_rate', label: 'GST %', type: 'number', placeholder: '0' },
            ]}
          />

          {/* Vendors are managed on the dedicated master page (Masters → Vendors / Suppliers),
              not here, to avoid two places editing the same records. */}

          <MasterEditor
            resource="prasad/items"
            title="Prasad Items"
            description="Items sold at the Prasad counter (POS). Go to Prasad → Manage Items to adjust stock levels."
            statusField="is_available"
            fields={[
              { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Ladoo' },
              { key: 'name_hindi', label: 'Name (Hindi)', placeholder: 'लड्डू' },
              { key: 'unit', label: 'Unit', placeholder: 'piece, kg, box…', default: 'piece' },
              { key: 'price_paise', label: 'Price (₹)', type: 'money', required: true, placeholder: '0.00' },
              { key: 'gst_rate', label: 'GST (%)', type: 'number', placeholder: '0', default: 0 },
              { key: 'low_stock_threshold', label: 'Low Stock Alert', type: 'number', placeholder: '10', default: 10 },
              { key: 'sort_order', label: 'Sort Order', type: 'number', placeholder: '0', default: 0 },
            ]}
          />
        </div>
      )}

      {tab === 'privacy' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm">Global Platform Sync</h3></div>
            <div className="card-body">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm">Mirror transactions to Global Platform</p>
                  <p className="text-xs text-slate-400 mt-0.5">When enabled, donations, seva bookings, and room bookings are visible to donors on the JainERP devotee portal.</p>
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
            <div className="card-header"><h3 className="font-semibold text-sm">Raise a Requirement</h3></div>
            <div className="card-body">
              <p className="text-xs text-slate-500 mb-3">
                Describe any feature, improvement, or customization you need. The Tasqbots team will review and respond.
              </p>
              {reqSent && <div className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">Requirement sent to Tasqbots team!</div>}
              <form onSubmit={sendRequirement} className="flex gap-3">
                <textarea className="form-input flex-1" rows={2} value={reqText}
                  onChange={e => setReqText(e.target.value)} placeholder="Describe the feature or improvement you need..." required />
                <button type="submit" disabled={!reqText.trim()} className="btn-primary self-end">Send</button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <ClipboardList size={14} /> My Requirements
              </h3>
              <span className="text-xs text-slate-400">{requirements.length} submitted</span>
            </div>
            {requirements.length === 0 ? (
              <div className="card-body text-sm text-slate-400">No requirements raised yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Requirement</th><th>Status</th><th>Note from Team</th><th>Raised On</th></tr></thead>
                  <tbody>
                    {requirements.map(r => (
                      <tr key={r.id}>
                        <td className="text-sm max-w-xs">{r.text}</td>
                        <td>
                          {r.status === 'done' ? <span className="badge-green">Done ✓</span>
                            : r.status === 'in_progress' ? <span className="badge-blue">In Progress</span>
                            : r.status === 'rejected' ? <span className="badge-red">Rejected</span>
                            : <span className="badge-yellow">Open</span>}
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
              <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><TrendingUp size={14} /> Current Plan</h3></div>
              <div className="card-body">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs">Plan</p>
                    <p className="font-bold text-navy-900">{subscription.subscription.plan_display || '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Status</p>
                    <span className={subscription.subscription.status === 'active' ? 'badge-green' : 'badge-red'}>{subscription.subscription.status}</span>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Renews On</p>
                    <p className="font-medium">{subscription.subscription.current_period_end ? new Date(subscription.subscription.current_period_end).toLocaleDateString('en-IN') : '—'}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <button onClick={() => setShowPlanModal(true)} className="btn-secondary btn-sm">
                    <TrendingUp size={13} /> Change Plan
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card"><div className="card-body flex items-center justify-between text-sm">
              <span className="text-slate-400">No subscription data available.</span>
              <button onClick={() => setShowPlanModal(true)} className="btn-secondary btn-sm"><TrendingUp size={13} /> Choose a Plan</button>
            </div></div>
          )}

          {usage && (
            <div className="card">
              <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><CreditCard size={14} /> Usage This Month</h3></div>
              <div className="card-body">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  {[
                    { label: 'Users', current: usage.current?.users, max: usage.limits?.max_users },
                    { label: 'Receipts', current: usage.current?.receipts_this_month, max: usage.limits?.max_receipts_per_month },
                    { label: 'SMS / Month', current: 0, max: usage.limits?.max_sms_per_month },
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
              <div className="card-header"><h3 className="font-semibold text-sm">Billing History</h3></div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Invoice</th><th>Period</th><th>Amount</th><th>Status</th><th></th></tr></thead>
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
                              <ClipboardList size={13} /> Receipt
                            </button>
                          ) : (
                            <button
                              onClick={() => payInvoice(inv.id)}
                              disabled={payingId === inv.id}
                              className="btn-primary btn-sm"
                            >
                              <CreditCard size={13} />
                              {payingId === inv.id ? 'Processing…' : 'Pay Now'}
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
                  <h3 className="font-bold text-navy-900">Choose a Plan</h3>
                  <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs">
                    <button onClick={() => setPlanCycle('monthly')} className={`px-3 py-1 rounded-md font-medium ${planCycle === 'monthly' ? 'bg-white shadow-sm text-navy-900' : 'text-slate-500'}`}>Monthly</button>
                    <button onClick={() => setPlanCycle('yearly')} className={`px-3 py-1 rounded-md font-medium ${planCycle === 'yearly' ? 'bg-white shadow-sm text-navy-900' : 'text-slate-500'}`}>Yearly</button>
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
                            <p className="font-bold text-navy-900">{p.display_name} {isCurrent && <span className="badge-green ml-1">Current</span>}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{p.max_users} users · {p.max_receipts_per_month} receipts/mo · {p.max_sms_per_month} SMS/mo</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-navy-900">{price > 0 ? `₹${fmtPaise(price)}` : 'Free'}</p>
                            <p className="text-[10px] text-slate-400">/{planCycle === 'yearly' ? 'yr' : 'mo'}</p>
                          </div>
                        </div>
                        {price > 0 && (
                          <button
                            onClick={() => changePlan(p.name)}
                            disabled={!!upgradingPlan}
                            className="btn-primary btn-sm w-full justify-center mt-3"
                          >
                            {upgradingPlan === p.name ? 'Processing…' : isCurrent ? 'Renew' : 'Select & Pay'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {plans.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No plans available.</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
