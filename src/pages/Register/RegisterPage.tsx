import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft, ChevronRight, Check, CreditCard, Loader2,
  ShieldCheck, Sparkles, AlertTriangle, Database, FileText, LogIn, RotateCw,
} from 'lucide-react'
import { isValidPhone, PhoneInput } from '../../components/PhoneInput'
import { issueKey, normaliseStatutory, STATUTORY_EXAMPLE, statutoryIssue } from '../../lib/statutoryIds'
import { Catalogue, CataloguePlan, PlanLimits, Registration, apiError, clearDraft, inr, invoiceUrl, loadDraft, loadRazorpay, onboarding, saveDraft } from '../../lib/onboardingApi'
import { CustomPlanForm } from './CustomPlanForm'
import { LocationPicker } from '../../components/LocationPicker'

/**
 * Self-serve registration for a new Trust/Temple.
 *
 * THE ONE registration UI in the platform. The website's "Register Your
 * Trust/Temple" CTA and the mandir login page's "New Mandir?" link both land
 * here, so there is a single form, a single plan picker, a single checkout and
 * a single onboarding flow — not two implementations that drift.
 *
 * Naming: the spec's one exception to "do not rename Mandir yet" is this form's
 * organisation field, which is labelled **Trust/Temple Name**. Everything else
 * in the app — routes, login, dashboard — keeps saying Mandir.
 */

type Step = 'details' | 'verify' | 'plan' | 'review' | 'status'

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'details', label: 'Trust/Temple details' },
  { key: 'verify', label: 'Verify mobile' },
  { key: 'plan', label: 'Choose a plan' },
  { key: 'review', label: 'Review & pay' },
  { key: 'status', label: 'Account setup' },
]

const TEMPLE_TYPES = [
  { value: 'jain', label: 'Jain' },
  { value: 'hindu', label: 'Hindu' },
  { value: 'sikh', label: 'Sikh' },
  { value: 'buddhist', label: 'Buddhist' },
  { value: 'gurudwara', label: 'Gurudwara' },
  { value: 'church', label: 'Church' },
]

interface DetailsForm {
  trust_name: string
  temple_type: string
  sect: string
  sub_sect: string
  line1: string
  line2: string
  city: string
  state: string
  pincode: string
  lat: number | null
  lng: number | null
  admin_name: string
  admin_mobile: string
  admin_email: string
  mandir_mobile: string
  mandir_email: string
  website: string
  gstin: string
  pan: string
  reg_80g_number: string
  registration_number: string
  darpan_number: string
  reg_12a_number: string
}

const EMPTY: DetailsForm = {
  trust_name: '', temple_type: 'jain', sect: '', sub_sect: '',
  line1: '', line2: '', city: '', state: '', pincode: '', lat: null, lng: null,
  admin_name: '', admin_mobile: '', admin_email: '',
  mandir_mobile: '', mandir_email: '', website: '',
  gstin: '', pan: '', reg_80g_number: '', reg_12a_number: '',
  registration_number: '', darpan_number: '',
}

/** Statuses where the only sensible screen is "what is happening to my account". */
const TERMINAL_PHASES = new Set(['setup', 'done'])


/**
 * A plan's limits as sentences, for cards whose highlights have not been
 * written yet. -1 means unlimited throughout the plan model.
 *
 * This is a fallback, not a feature list: it keeps a thin plan from rendering
 * as a blank column, and disappears the moment real copy exists.
 */
function planLimitLines(l: PlanLimits | undefined): string[] {
  if (!l) return []
  const n = (v: number | undefined, one: string, many: string) =>
    v == null ? null : v < 0 ? `Unlimited ${many}` : `${v} ${v === 1 ? one : many}`
  return [
    n(l.max_users, 'user', 'users'),
    n(l.max_devices, 'device', 'devices'),
    l.max_receipts_per_month == null
      ? null
      : l.max_receipts_per_month < 0
        ? 'Unlimited receipts a month'
        : `${l.max_receipts_per_month} receipts a month`,
  ].filter((x): x is string => !!x)
}

export function RegisterPage() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const [step, setStep] = useState<Step>('details')
  const [form, setForm] = useState<DetailsForm>(EMPTY)
  const [reg, setReg] = useState<Registration | null>(null)
  const [token, setToken] = useState('')
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  // Seeded from the website's plan card (`/register?plan=enterprise&cycle=yearly`)
  // so somebody who already chose on jainerp.org is not asked to choose twice.
  // Read once, at mount: re-reading on every render would fight the toggle.
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>(() =>
    new URLSearchParams(window.location.search).get('cycle') === 'monthly' ? 'monthly' : 'yearly',
  )
  const [preselectedPlan] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('plan'),
  )
  const [showCustom, setShowCustom] = useState(false)
  const [customPlanName, setCustomPlanName] = useState<string | null>(null)

  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // ---------------------------------------------------------------------
  // Resume an in-flight registration
  // ---------------------------------------------------------------------
  // A customer who paid and then closed the tab must land back on their status
  // screen, not on a blank form that invites them to pay again.
  useEffect(() => {
    const draft = loadDraft()
    if (!draft) return
    let cancelled = false
    onboarding
      .status(draft.id, draft.token)
      .then((r) => {
        if (cancelled) return
        setReg(r)
        setToken(draft.token)
        hydrateForm(r)
        setStep(resumeStep(r))
      })
      .catch(() => {
        // Gone or not ours any more — start clean rather than showing an error
        // for something the applicant did not do.
        clearDraft()
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    onboarding
      .catalogue()
      .then(setCatalogue)
      .catch(() => setError('Could not load our plans just now. Please refresh the page.'))
  }, [])

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  function hydrateForm(r: Registration) {
    const a = r.address ?? {}
    const p = r.profile ?? {}
    setForm({
      trust_name: r.trust_name ?? '',
      temple_type: r.temple_type ?? 'jain',
      sect: r.sect ?? '',
      sub_sect: r.sub_sect ?? '',
      line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '',
      state: a.state ?? '', pincode: a.pincode ?? '',
      lat: a.lat != null ? Number(a.lat) : null, lng: a.lng != null ? Number(a.lng) : null,
      admin_name: r.admin_name ?? '',
      admin_mobile: r.admin_mobile ?? '',
      admin_email: r.admin_email ?? '',
      mandir_mobile: p.mandir_mobile ?? '',
      mandir_email: p.mandir_email ?? '',
      website: p.website ?? '',
      gstin: p.gstin ?? '',
      pan: p.pan ?? '',
      reg_80g_number: p.reg_80g_number ?? '',
      registration_number: p.registration_number ?? '',
      darpan_number: p.darpan_number ?? '',
      reg_12a_number: p.reg_12a_number ?? '',
    })
    if (r.billing_cycle) setCycle(r.billing_cycle)
  }

  function resumeStep(r: Registration): Step {
    if (TERMINAL_PHASES.has(r.phase) || r.status === 'custom_request') return 'status'
    if (r.phase === 'payment') return 'review'
    if (r.phase === 'plan') return r.plan_name ? 'review' : 'plan'
    return r.mobile_verified ? 'plan' : 'details'
  }

  const set = (k: keyof DetailsForm) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setError('')
  }

  /** The map pin — two numbers at once, so it cannot go through `set`. */
  const setPin = (lat: number | null, lng: number | null) => {
    setForm((f) => ({ ...f, lat, lng }))
    setError('')
  }

  function detailsPayload() {
    // Only send what the applicant filled in: the DTO validates GSTIN/PAN/email
    // formats, and an empty string is not a valid GSTIN — sending '' would 400
    // on a field they deliberately left blank.
    const blank = (v: string) => (v.trim() === '' ? undefined : v.trim())
    return {
      trust_name: form.trust_name.trim(),
      temple_type: form.temple_type,
      // A non-Jain trust has no Jain sampradaya and the API refuses one.
      sect: form.temple_type === 'jain' ? blank(form.sect) : undefined,
      sub_sect: form.temple_type === 'jain' ? blank(form.sub_sect) : undefined,
      address: {
        line1: blank(form.line1), line2: blank(form.line2), city: blank(form.city),
        state: blank(form.state), pincode: blank(form.pincode),
        // The map pin. Optional by design (FR-MAP-005/007) — omitting it is
        // valid and simply means the trust has no pin on the devotee map yet.
        lat: form.lat ?? undefined, lng: form.lng ?? undefined,
      },
      admin_name: form.admin_name.trim(),
      admin_mobile: form.admin_mobile,
      admin_email: blank(form.admin_email),
      mandir_mobile: blank(form.mandir_mobile),
      mandir_email: blank(form.mandir_email),
      website: blank(form.website),
      gstin: normaliseStatutory('gstin', form.gstin) ?? undefined,
      pan: normaliseStatutory('pan', form.pan) ?? undefined,
      reg_80g_number: normaliseStatutory('reg_80g_number', form.reg_80g_number) ?? undefined,
      reg_12a_number: normaliseStatutory('reg_12a_number', form.reg_12a_number) ?? undefined,
      // Free text: no national format to normalise against (migration 041).
      registration_number: form.registration_number.trim() || undefined,
      darpan_number: form.darpan_number.trim() || undefined,
      source: 'website' as const,
    }
  }

  // ---------------------------------------------------------------------
  // Step 1 — details
  // ---------------------------------------------------------------------
  async function submitDetails() {
    if (!form.trust_name.trim()) return setError('Enter your Trust/Temple name')
    if (!form.admin_name.trim()) return setError('Enter the administrator’s name')
    if (!isValidPhone(form.admin_mobile)) return setError('Enter a valid mobile number for the administrator')
    // The same rules the API applies (and the trust's own Settings later), so
    // "0" in GSTIN or a mistyped PAN is caught here rather than as a 400.
    // English, like the rest of this page.
    const tEn = i18n.getFixedT('en')
    for (const [field, label] of [['pan', 'PAN'], ['gstin', 'GSTIN'], ['reg_80g_number', '80G registration number'], ['reg_12a_number', '12A registration number']] as const) {
      const value = normaliseStatutory(field, form[field])
      const issue = value ? statutoryIssue(field, value, field === 'pan' ? [] : [form.pan]) : null
      if (issue) return setError(`${label}: ${tEn(issueKey(issue), issue.params)}`)
    }

    setLoading(true)
    setError('')
    try {
      if (reg) {
        const updated = await onboarding.update(reg.id, token, detailsPayload())
        setReg(updated)
        setStep(updated.mobile_verified ? 'plan' : 'verify')
      } else {
        const created = await onboarding.create(detailsPayload())
        // Persist before anything else can fail: without the claim token the
        // applicant can never return to this registration.
        saveDraft({ id: created.id, token: created.claim_token! })
        setToken(created.claim_token!)
        setReg(created)
        setStep('verify')
      }
    } catch (e) {
      setError(apiError(e, 'Could not save those details. Please check them and try again.'))
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------
  // Step 2 — verify mobile
  // ---------------------------------------------------------------------
  const sendOtp = useCallback(async () => {
    if (!reg) return
    setLoading(true)
    setError('')
    try {
      const res = await onboarding.sendOtp(reg.id, token)
      setDevOtp(res.dev_otp ?? null)
      setResendIn(30)
      setNotice(`Code sent to ${reg.admin_mobile}`)
    } catch (e) {
      setError(apiError(e, 'Could not send the code. Please try again shortly.'))
    } finally {
      setLoading(false)
    }
  }, [reg, token])

  async function verifyOtp() {
    if (!reg || otp.length !== 6) return setError('Enter the 6-digit code')
    setLoading(true)
    setError('')
    try {
      const updated = await onboarding.verifyOtp(reg.id, token, otp)
      setReg(updated)
      setOtp('')
      setNotice('')
      setStep('plan')
    } catch (e) {
      setError(apiError(e, 'That code was not accepted.'))
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------
  // Step 3 — plan
  // ---------------------------------------------------------------------
  async function choosePlan(plan: CataloguePlan) {
    if (plan.is_custom) {
      setCustomPlanName(plan.display_name)
      setShowCustom(true)
      return
    }
    if (!reg) return
    setLoading(true)
    setError('')
    try {
      const updated = await onboarding.selectPlan(reg.id, token, { plan: plan.name, billing_cycle: cycle })
      setReg(updated)
      setStep('review')
    } catch (e) {
      setError(apiError(e, 'Could not select that plan.'))
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------
  // Step 4 — checkout
  // ---------------------------------------------------------------------
  // Guards against a second checkout while Razorpay's modal is open: two orders
  // for one registration means the customer can be charged twice.
  const paying = useRef(false)

  async function pay() {
    if (!reg || paying.current) return
    paying.current = true
    setLoading(true)
    setError('')
    try {
      const { checkout } = await onboarding.checkout(reg.id, token)

      // Mock mode (no Razorpay keys — dev only): the server accepts a mock
      // order without a real signature, so the wizard can be exercised end to
      // end. In production `mock` is never true; the API refuses it.
      if (checkout.mock) {
        const updated = await onboarding.verifyPayment(reg.id, token, {
          razorpay_order_id: checkout.razorpay_order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: 'mock',
        })
        setReg(updated)
        setStep('status')
        return
      }

      const ready = await loadRazorpay()
      if (!ready) {
        setError('Could not reach the payment gateway. Please check your connection and try again.')
        return
      }

      const rzp = new window.Razorpay!({
        key: checkout.key_id,
        order_id: checkout.razorpay_order_id,
        amount: checkout.amount_paise,
        currency: checkout.currency,
        name: checkout.name,
        description: checkout.description,
        prefill: checkout.prefill,
        theme: { color: '#dc2626' },
        handler: async (response: Record<string, string>) => {
          // The gateway calling back is not proof of payment — the server
          // re-verifies the signature before anything is provisioned.
          setStep('status')
          setLoading(true)
          try {
            const updated = await onboarding.verifyPayment(reg.id, token, {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            })
            setReg(updated)
          } catch (e) {
            setError(apiError(e, 'We could not confirm that payment. Our team has been notified.'))
            // Fall through to the status screen's poller, which picks the
            // payment up from the webhook if the browser verify failed.
          } finally {
            setLoading(false)
            paying.current = false
          }
        },
        modal: {
          ondismiss: async () => {
            paying.current = false
            setLoading(false)
            try {
              const updated = await onboarding.paymentFailed(reg.id, token, { outcome: 'cancelled' })
              setReg(updated)
            } catch {
              /* the status screen will re-read it */
            }
          },
        },
      })
      rzp.open()
    } catch (e) {
      setError(apiError(e, 'Could not start the payment.'))
      paying.current = false
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------
  // Step 5 — provisioning status
  // ---------------------------------------------------------------------
  // Provisioning a dedicated database takes real seconds. Polling is what stops
  // the applicant reading a slow setup as a failed payment.
  useEffect(() => {
    if (step !== 'status' || !reg || !token) return
    if (reg.status === 'active' || reg.status === 'custom_request') return
    const t = setInterval(async () => {
      try {
        const r = await onboarding.status(reg.id, token)
        setReg(r)
        if (r.status === 'active') clearInterval(t)
      } catch {
        /* transient — keep polling */
      }
    }, 4000)
    return () => clearInterval(t)
  }, [step, reg, token])

  const stepIndex = STEPS.findIndex((s) => s.key === step)
  const selectedPlan = catalogue?.plans.find((p) => p.name === reg?.plan_name) ?? null

  return (
    // `h-full overflow-y-auto`, not `min-h-screen`: index.css sets
    // `html, body, #root { height: 100%; overflow: hidden }` because the
    // signed-in app is a fixed-height shell that scrolls in its own `.app-main`
    // container. A page outside that shell therefore has nowhere to scroll and
    // is simply CLIPPED at the viewport — which is what happened here: the
    // registration form is taller than a screen, so everything below the fold
    // was unreachable. The login page never showed it because it fits.
    <div className="h-full overflow-y-auto bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          {/* Wordmark only — see the note in LoginPage: the mark carries no badge. */}
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none">
                <span className="text-navy-900">Jain</span><span className="text-brand-red">ERP</span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">Register your Trust/Temple</p>
            </div>
          </div>
          <button onClick={() => navigate('/login')} className="text-sm font-semibold text-slate-500 hover:text-brand-red">
            Already registered? Sign in
          </button>
        </div>
      </header>

      {/* Stepper — the applicant always knows which stage they are on. */}
      <div className="max-w-4xl mx-auto px-4 pt-6">
        <ol className="flex flex-wrap items-center gap-y-2">
          {STEPS.map((s, i) => {
            const done = i < stepIndex
            const current = i === stepIndex
            return (
              <li key={s.key} className="flex items-center">
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${
                    current ? 'bg-brand-red text-white'
                      : done ? 'bg-green-100 text-green-800' : 'bg-white text-slate-400 border border-slate-200'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    current ? 'bg-white/25' : done ? 'bg-green-600 text-white' : 'bg-slate-100'
                  }`}>
                    {done ? <Check size={11} /> : i + 1}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <ChevronRight size={14} className="text-slate-300 mx-0.5" />}
              </li>
            )
          })}
        </ol>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {step === 'details' && (
          <DetailsStep form={form} set={set} setPin={setPin} loading={loading} onNext={submitDetails} />
        )}

        {step === 'verify' && reg && (
          <VerifyStep
            mobile={reg.admin_mobile}
            otp={otp}
            setOtp={(v) => { setOtp(v); setError('') }}
            devOtp={devOtp}
            notice={notice}
            resendIn={resendIn}
            loading={loading}
            onSend={sendOtp}
            onVerify={verifyOtp}
            onBack={() => setStep('details')}
          />
        )}

        {step === 'plan' && (
          <PlanStep
            catalogue={catalogue}
            cycle={cycle}
            setCycle={setCycle}
            loading={loading}
            selected={reg?.plan_name ?? null}
            preselected={preselectedPlan}
            onChoose={choosePlan}
            onBack={() => setStep('details')}
          />
        )}

        {step === 'review' && reg && (
          <ReviewStep
            reg={reg}
            plan={selectedPlan}
            loading={loading}
            onPay={pay}
            onBack={() => setStep('plan')}
          />
        )}

        {step === 'status' && reg && (
          <StatusStep
            reg={reg}
            token={token}
            onSignIn={() => { clearDraft(); navigate('/login') }}
            onRetryPayment={() => setStep('review')}
          />
        )}
      </main>

      {showCustom && (
        <CustomPlanForm
          catalogue={catalogue}
          planLabel={customPlanName ?? 'Custom'}
          prefill={{
            trust_name: form.trust_name,
            contact_name: form.admin_name,
            mobile: form.admin_mobile,
            email: form.admin_email,
            city: form.city,
            state: form.state,
          }}
          registrationId={reg?.id ?? null}
          onClose={() => setShowCustom(false)}
          onSubmitted={(reference) => {
            setShowCustom(false)
            setReg((r) => (r ? { ...r, status: 'custom_request', phase: 'done', reference } : r))
            setStep('status')
          }}
        />
      )}
    </div>
  )
}

// =========================================================================
// Steps
// =========================================================================

function Field({
  label, value, onChange, placeholder, type = 'text', required, hint, maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  required?: boolean
  hint?: string
  maxLength?: number
}) {
  return (
    <div>
      <label className="form-label">
        {label} {required && <span className="text-brand-red">*</span>}
      </label>
      <input
        type={type}
        className="form-input"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-4">
      <h2 className="text-base font-bold text-navy-900">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500 mt-1 mb-4">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-4'}>{children}</div>
    </section>
  )
}

function DetailsStep({
  form, set, setPin, loading, onNext,
}: {
  form: DetailsForm
  set: (k: keyof DetailsForm) => (v: string) => void
  /** The map pin is the one field that is not a string, so `set` cannot carry it. */
  setPin: (lat: number | null, lng: number | null) => void
  loading: boolean
  onNext: () => void
}) {
  return (
    <>
      <Card
        title="Trust/Temple details"
        subtitle="This is the organisation the account will belong to. It appears on every receipt you issue."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Trust/Temple Name"
              value={form.trust_name}
              onChange={set('trust_name')}
              placeholder="Shri Digambar Jain Mandir Trust"
              required
            />
          </div>
          <div>
            <label className="form-label">Type</label>
            <select className="form-input" value={form.temple_type} onChange={(e) => set('temple_type')(e.target.value)}>
              {TEMPLE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {/* Sampradaya is Jain-specific — the API refuses it for any other type. */}
          {form.temple_type === 'jain' && (
            <div>
              <label className="form-label">Sampradaya</label>
              <select className="form-input" value={form.sect} onChange={(e) => set('sect')(e.target.value)}>
                <option value="">Prefer not to say</option>
                <option value="digambar">Digambar</option>
                <option value="shwetambar">Shwetambar</option>
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <Field label="Address line 1" value={form.line1} onChange={set('line1')} placeholder="Street / area" />
          </div>
          <Field label="City" value={form.city} onChange={set('city')} />
          <Field label="State" value={form.state} onChange={set('state')} hint="Used for the GST place of supply on your invoice" />
          <Field label="PIN code" value={form.pincode} onChange={set('pincode')} maxLength={6} />
        </div>

        {/* The map pin (FR-MAP-007). Nothing in onboarding used to ask for one,
            so a trust appeared in the devotee directory and was invisible on the
            discovery map until somebody happened to open Settings → Temple
            Profile — the only other place it can be set. Optional on purpose:
            skipping it is valid and simply means no pin yet. */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="text-sm font-medium text-slate-700">
              Location on the map <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            {(form.lat != null && form.lng != null) && (
              <button
                type="button"
                onClick={() => setPin(null, null)}
                className="text-xs text-slate-500 hover:text-brand-red underline"
              >
                Remove pin
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-2">
            Devotees use this to find you and get directions. You can add or change it later in
            Settings → Temple Profile.
          </p>
          <LocationPicker
            lat={form.lat}
            lng={form.lng}
            onChange={(lat, lng) => setPin(lat, lng)}
          />
        </div>
      </Card>

      <Card
        title="Administrator"
        subtitle="This person signs in to manage the Mandir. They sign in with this mobile number, so it must be reachable — we send a verification code to it next."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" value={form.admin_name} onChange={set('admin_name')} required />
          <div>
            <label className="form-label">Mobile number <span className="text-brand-red">*</span></label>
            <PhoneInput value={form.admin_mobile} onChange={set('admin_mobile')} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Email" value={form.admin_email} onChange={set('admin_email')} type="email" hint="Where we send your invoice" />
          </div>
        </div>
      </Card>

      <Card
        title="Tax & registration details"
        subtitle="All optional — you can add these later from Settings. Filling them in now means your 80G receipts work from day one."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="PAN" value={form.pan} onChange={set('pan')} placeholder={STATUTORY_EXAMPLE.pan} maxLength={10}
            hint="The trust's own PAN — the one printed on 80G receipts" />
          <Field label="GSTIN" value={form.gstin} onChange={set('gstin')} placeholder={STATUTORY_EXAMPLE.gstin} maxLength={15}
            hint="Only if the trust is registered for GST — leave empty otherwise" />
          <Field label="80G registration number" value={form.reg_80g_number} onChange={set('reg_80g_number')}
            placeholder={STATUTORY_EXAMPLE.reg_80g_number} maxLength={16}
            hint="The 16-character URN on the Income Tax approval" />
          <Field label="12A registration number" value={form.reg_12a_number} onChange={set('reg_12a_number')} />
          <Field label="Registration No." value={form.registration_number} onChange={set('registration_number')}
            placeholder="COOP/2021/UDAIPUR/201746" maxLength={60}
            hint="From the trust, society or co-operative registration certificate" />
          <Field label="Darpan Registration No." value={form.darpan_number} onChange={set('darpan_number')}
            placeholder="RJ/2024/2187120" maxLength={40}
            hint="NITI Aayog NGO-Darpan ID — leave empty if the trust has none" />
          <Field label="Mandir contact number" value={form.mandir_mobile} onChange={set('mandir_mobile')} hint="Shown on receipts. Defaults to the administrator's number." />
          <Field label="Mandir email" value={form.mandir_email} onChange={set('mandir_email')} type="email" />
        </div>
      </Card>

      <button onClick={onNext} disabled={loading} className="btn-primary w-full justify-center py-3">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
        {loading ? 'Saving…' : 'Continue'}
      </button>
    </>
  )
}

function VerifyStep({
  mobile, otp, setOtp, devOtp, notice, resendIn, loading, onSend, onVerify, onBack,
}: {
  mobile: string
  otp: string
  setOtp: (v: string) => void
  devOtp: string | null
  notice: string
  resendIn: number
  loading: boolean
  onSend: () => void
  onVerify: () => void
  onBack: () => void
}) {
  const sent = useRef(false)
  useEffect(() => {
    // Send once on arrival, not on every re-render.
    if (!sent.current) {
      sent.current = true
      onSend()
    }
  }, [onSend])

  return (
    <Card title="Verify your mobile number" subtitle={`We sent a 6-digit code to ${mobile}. This is the number you will sign in with.`}>
      {devOtp && (
        <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-700 mb-4">
          Dev mode — OTP: <span className="font-mono font-bold">{devOtp}</span>
        </div>
      )}
      {notice && !devOtp && (
        <div className="bg-green-50 border border-green-200 rounded-md px-3 py-2 text-xs text-green-700 mb-4">{notice}</div>
      )}
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        placeholder="000000"
        className="form-input text-center text-2xl font-mono tracking-[0.5em]"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && onVerify()}
        autoFocus
      />
      <button onClick={onVerify} disabled={loading || otp.length !== 6} className="btn-primary w-full justify-center py-3 mt-4">
        <ShieldCheck size={16} />
        {loading ? 'Verifying…' : 'Verify & continue'}
      </button>
      <div className="flex items-center justify-between mt-4 text-sm">
        <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-slate-600">
          <ChevronLeft size={15} /> Edit details
        </button>
        {resendIn > 0 ? (
          <span className="text-slate-400">Resend in {resendIn}s</span>
        ) : (
          <button onClick={onSend} disabled={loading} className="inline-flex items-center gap-1 font-semibold text-brand-blue hover:underline">
            <RotateCw size={13} /> Resend code
          </button>
        )}
      </div>
    </Card>
  )
}

function PlanStep({
  catalogue, cycle, setCycle, loading, selected, preselected, onChoose, onBack,
}: {
  catalogue: Catalogue | null
  cycle: 'monthly' | 'yearly'
  setCycle: (c: 'monthly' | 'yearly') => void
  loading: boolean
  /** Committed via POST /plan. */
  selected: string | null
  /** Carried in from the website's plan card — a hint, not a commitment. */
  preselected: string | null
  onChoose: (p: CataloguePlan) => void
  onBack: () => void
}) {
  if (!catalogue) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading plans…
      </div>
    )
  }

  return (
    <>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-extrabold text-navy-900">Choose your plan</h2>
        <p className="text-slate-500 mt-1 text-sm">Prices include the modules listed. GST is added at checkout.</p>
        <div className="inline-flex mt-4 bg-white rounded-full p-1 border border-slate-200">
          {(['monthly', 'yearly'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold capitalize transition-colors ${
                cycle === c ? 'bg-brand-red text-white' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {c === 'yearly' ? 'Annual' : 'Monthly'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {catalogue.plans.map((p) => {
          const price = cycle === 'yearly' ? p.pricing.yearly : p.pricing.monthly
          const saving = cycle === 'yearly' ? p.pricing.yearly.saving_vs_monthly_paise : 0
          return (
            <div
              key={p.id}
              className={`relative flex flex-col rounded-2xl border bg-white p-5 ${
                p.highlight || p.name === preselected
                  ? 'border-brand-red shadow-lg ring-1 ring-brand-red'
                  : 'border-slate-200 shadow-sm'
              }`}
            >
              {p.badge && (
                <span className="absolute -top-3 left-5 rounded-full bg-brand-red px-3 py-1 text-[11px] font-semibold text-white">
                  {p.badge}
                </span>
              )}
              <h3 className="text-lg font-bold text-navy-900">{p.display_name}</h3>
              {/* A hint, not a commitment — they still press the button. Marking
                  it "Selected" would claim a choice the server has not recorded. */}
              {p.name === preselected && p.name !== selected && (
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-brand-red">
                  Your choice from jainerp.org
                </p>
              )}

              <div className="mt-3">
                {p.is_custom ? (
                  <div className="text-2xl font-extrabold text-navy-900">Let’s talk</div>
                ) : (
                  <>
                    <div className="text-2xl font-extrabold text-navy-900">
                      {inr(price.subtotal_paise)}
                      <span className="text-sm font-medium text-slate-400"> / {cycle === 'yearly' ? 'year' : 'month'}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      + {p.pricing.gst_rate}% GST · {inr(price.total_paise)} total
                    </div>
                    {saving > 0 && (
                      <div className="text-xs font-semibold text-green-700 mt-1">Save {inr(saving)} vs monthly</div>
                    )}
                  </>
                )}
              </div>

              {p.description && <p className="mt-3 text-sm text-slate-600">{p.description}</p>}

              <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                {/* No "pooled/dedicated database" wording. A trust choosing a
                    plan is deciding what the software does for them, not which
                    hosting topology it runs on — and "shared database" reads to
                    a customer as "my donor records are mixed with someone
                    else's", which is both alarming and untrue. The tier still
                    drives provisioning; it just is not a selling point. */}
                <Database size={13} className={p.tenancy_tier === 'dedicated' ? 'text-brand-red' : ''} />
                {p.tenancy_tier === 'dedicated' ? 'Your own private instance' : 'Fully managed hosting'}
              </div>

              <ul className="mt-4 flex-1 space-y-2">
                {p.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check size={14} className="mt-0.5 flex-none text-brand-red" />
                    {h}
                  </li>
                ))}
                {/* A plan with no highlights written for it rendered as an
                    empty box under a price — which reads as "this plan does
                    nothing". Its limits are real data the buyer needs anyway,
                    so they stand in until someone writes the copy. */}
                {p.highlights.length === 0 && planLimitLines(p.limits).map((line) => (
                  <li key={line} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check size={14} className="mt-0.5 flex-none text-brand-red" />
                    {line}
                  </li>
                ))}
                {p.modules.length > 0 && (
                  <li className="flex items-start gap-2 text-sm text-slate-700">
                    <Sparkles size={14} className="mt-0.5 flex-none text-brand-red" />
                    <span>
                      <b>Modules:</b> {p.modules.map((m) => m.display_name).join(', ')}
                    </span>
                  </li>
                )}
              </ul>

              <button
                onClick={() => onChoose(p)}
                disabled={loading}
                className={`mt-5 w-full justify-center py-2.5 ${
                  p.highlight || p.name === preselected ? 'btn-primary' : 'btn-secondary'
                }`}
              >
                {selected === p.name ? 'Selected' : p.is_custom ? 'Tell us your needs' : 'Choose plan'}
              </button>
            </div>
          )
        })}
      </div>

      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 mt-6">
        <ChevronLeft size={15} /> Back
      </button>
    </>
  )
}

function ReviewStep({
  reg, plan, loading, onPay, onBack,
}: {
  reg: Registration
  plan: CataloguePlan | null
  loading: boolean
  onPay: () => void
  onBack: () => void
}) {
  const q = reg.quote
  return (
    <>
      {reg.status === 'payment_failed' && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {reg.message}
        </div>
      )}

      <Card title="Review your order">
        <dl className="divide-y divide-slate-100 text-sm">
          <Row label="Trust/Temple" value={reg.trust_name} />
          <Row label="Administrator" value={`${reg.admin_name} · ${reg.admin_mobile}`} />
          {reg.admin_email && <Row label="Email" value={reg.admin_email} />}
          <Row label="Plan" value={plan?.display_name ?? reg.plan_name ?? '—'} />
          <Row label="Billing" value={reg.billing_cycle === 'yearly' ? 'Annual' : 'Monthly'} />
          <Row
            label="Database"
            value={reg.tenancy_tier === 'dedicated' ? 'Your own private instance' : 'Fully managed hosting'}
          />
          {reg.modules.length > 0 && (
            <Row
              label="Modules"
              value={
                plan
                  ? plan.modules.filter((m) => reg.modules.includes(m.key)).map((m) => m.display_name).join(', ')
                  : reg.modules.join(', ')
              }
            />
          )}
        </dl>
      </Card>

      <Card title="Amount payable">
        <dl className="text-sm space-y-2">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="font-semibold">{inr(q.subtotal_paise)}</dd></div>
          {q.discount_paise > 0 && (
            <div className="flex justify-between text-green-700">
              <dt>Discount{q.note ? ` (${q.note})` : ''}</dt>
              <dd className="font-semibold">− {inr(q.discount_paise)}</dd>
            </div>
          )}
          {q.additional_charges_paise > 0 && (
            <div className="flex justify-between"><dt className="text-slate-500">Additional charges</dt><dd className="font-semibold">{inr(q.additional_charges_paise)}</dd></div>
          )}
          <div className="flex justify-between"><dt className="text-slate-500">GST @ {q.gst_rate}%</dt><dd className="font-semibold">{inr(q.gst_amount_paise)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-2 mt-2 text-base">
            <dt className="font-bold text-navy-900">Total ({q.currency})</dt>
            <dd className="font-extrabold text-navy-900">{inr(q.total_paise)}</dd>
          </div>
        </dl>
      </Card>

      <button onClick={onPay} disabled={loading} className="btn-primary w-full justify-center py-3">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
        {loading ? 'Opening payment…' : `Pay ${inr(q.total_paise)} securely`}
      </button>
      <p className="text-xs text-slate-400 text-center mt-3">
        Payments are processed by Razorpay. Your account is created automatically once the payment is confirmed.
      </p>

      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 mt-6">
        <ChevronLeft size={15} /> Change plan
      </button>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-800 text-right">{value}</dd>
    </div>
  )
}

function StatusStep({
  reg, token, onSignIn, onRetryPayment,
}: {
  reg: Registration
  token: string
  onSignIn: () => void
  onRetryPayment: () => void
}) {
  const done = reg.status === 'active'
  const custom = reg.status === 'custom_request' || reg.status === 'custom_review'
  const working = reg.status === 'paid' || reg.status === 'provisioning' || reg.status === 'payment_processing'
  const failedPayment = reg.status === 'payment_failed'

  return (
    <Card title={done ? 'Your Mandir account is ready' : custom ? 'Requirements received' : 'Setting up your account'}>
      <div className="flex items-start gap-3">
        {done ? (
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <Check size={20} className="text-green-700" />
          </div>
        ) : working ? (
          <Loader2 size={22} className="animate-spin text-brand-red mt-1 shrink-0" />
        ) : (
          <AlertTriangle size={22} className="text-amber-500 mt-1 shrink-0" />
        )}
        <div>
          <p className="text-sm text-slate-700">{reg.message}</p>
          <p className="text-xs text-slate-400 mt-1">Reference: {reg.reference}</p>
        </div>
      </div>

      {reg.timeline && reg.timeline.length > 0 && (
        <ol className="mt-5 border-l-2 border-slate-100 pl-4 space-y-3">
          {reg.timeline.map((e, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-slate-300" />
              <p className="text-sm text-slate-700">{e.message}</p>
              <p className="text-xs text-slate-400">{new Date(e.created_at).toLocaleString('en-IN')}</p>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {reg.invoice_id && (
          <a
            href={invoiceUrl(reg.id, token, 'download')}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
          >
            <FileText size={15} /> View invoice / receipt
          </a>
        )}
        {done && (
          <button onClick={onSignIn} className="btn-primary">
            <LogIn size={15} /> Sign in to your Mandir
          </button>
        )}
        {failedPayment && (
          <button onClick={onRetryPayment} className="btn-primary">
            <CreditCard size={15} /> Retry payment
          </button>
        )}
      </div>

      {done && (
        <p className="text-xs text-slate-400 mt-4">
          Sign in with <b>{reg.admin_mobile}</b> — we will send you a one-time code.
        </p>
      )}
    </Card>
  )
}
