import axios from 'axios'

/**
 * Client for the PUBLIC self-serve onboarding API.
 *
 * Separate axios instance from `lib/api.ts` on purpose:
 *  - it talks to superadmin-api (which owns provisioning), not mandir-api;
 *  - it must NOT carry the tenant bearer token or the 401-refresh/403-blocked
 *    interceptors — an applicant has no session, and firing `logout()` at
 *    somebody who was never logged in would wipe a real staff session open in
 *    another tab.
 *
 * Base URL resolution:
 *  1. `VITE_ONBOARDING_API_URL` when the build sets it;
 *  2. under `vite dev` only, the relative `/api/onboarding` path that
 *     vite.config.ts proxies to :3105;
 *  3. otherwise **the superadmin-api that matches the host this page is served
 *     from** — dev portal to dev API, prod portal to prod API.
 *
 * Step 3 has now been wrong in both directions, which is why it is derived
 * rather than hardcoded:
 *
 *  - It was once the relative path from step 2, which nothing serves in a built
 *    bundle: every request hit mandir-web's own origin and 404'd, so the wizard
 *    opened on "Could not load our plans just now".
 *  - Then it was hardcoded to dev, so the wizard on app.jainerp.org priced real
 *    registrations against the DEV catalogue.
 *  - Then it was hardcoded to prod, which fixed prod and broke dev: a dev
 *    deployment is still a *production* Vite build, so `import.meta.env.DEV` is
 *    false there too and dev-mandir.jainerp.org fetched plans from
 *    admin-api.jainerp.org — visible in the network tab as 8.232.105.22.
 *
 * A constant cannot be right for both, and the deploy workflow passes no
 * VITE_ONBOARDING_API_URL. The hostname already says which side we are on: dev
 * portals are `dev-*.jainerp.org`, production portals are not. See
 * jainerp-deploy/ENVIRONMENTS.md.
 */
export function onboardingOriginFor(hostname: string): string {
  return hostname.startsWith('dev-')
    ? 'https://dev-api-admin.jainerp.org'
    : 'https://admin-api.jainerp.org'
}

const BASE_URL = (() => {
  const configured = (import.meta.env.VITE_ONBOARDING_API_URL as string | undefined)?.replace(/\/+$/, '')
  if (configured) return `${configured}/api/v1/public/onboarding`
  if (import.meta.env.DEV) return '/api/onboarding/api/v1/public/onboarding'
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  return `${onboardingOriginFor(host)}/api/v1/public/onboarding`
})()

export const onboardingApi = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
})

/** Absolute URL for the invoice, which is opened in a tab rather than fetched. */
export function invoiceUrl(registrationId: string, claimToken: string, channel = 'view'): string {
  const base = BASE_URL.startsWith('http') ? BASE_URL : `${window.location.origin}${BASE_URL}`
  // The claim token goes in the query string here because a browser navigation
  // cannot set a header. It is single-purpose and scoped to one registration.
  return `${base}/registrations/${registrationId}/invoice?channel=${channel}&token=${encodeURIComponent(claimToken)}`
}

// ---------------------------------------------------------------------------
// Shapes returned by the API (kept in step with superadmin-api's publicView /
// PlanCatalogueService.decorate — a field declared here that the API does not
// send renders as blank, which is the recurring trap in this codebase).
// ---------------------------------------------------------------------------

/** A plan's caps. -1 means unlimited throughout the plan model. */
export interface PlanLimits {
  max_users: number
  max_devices: number
  max_receipts_per_month: number
  max_sms_per_month: number
  max_storage_mb: number
}

export interface PlanModule {
  key: string
  display_name: string
  description: string | null
}

export interface CataloguePlan {
  id: string
  name: string
  display_name: string
  description: string | null
  badge: string | null
  highlight: boolean
  sort_order: number
  is_custom: boolean
  tenancy_tier: 'pooled' | 'dedicated'
  database_label: string
  trial_days: number
  highlights: string[]
  limits: PlanLimits
  modules: PlanModule[]
  pricing: {
    currency: string
    gst_rate: number
    monthly: { subtotal_paise: number; gst_amount_paise: number; total_paise: number }
    yearly: {
      subtotal_paise: number
      gst_amount_paise: number
      total_paise: number
      saving_vs_monthly_paise: number
    }
  }
}

export interface Catalogue {
  currency: string
  default_gst_rate: number
  modules: Array<{ key: string; display_name: string; description: string | null; is_core: boolean }>
  plans: CataloguePlan[]
}

export type RegistrationStatus =
  | 'started' | 'details_submitted' | 'mobile_verified' | 'plan_selected'
  | 'payment_pending' | 'payment_processing' | 'payment_failed' | 'paid'
  | 'provisioning' | 'active' | 'custom_request' | 'custom_review'
  | 'abandoned' | 'failed'

export interface Registration {
  id: string
  reference: string
  status: RegistrationStatus
  phase: 'details' | 'plan' | 'payment' | 'setup' | 'done'
  message: string
  trust_name: string
  temple_type: string
  sect: string | null
  sub_sect: string | null
  address: Record<string, string> | null
  admin_name: string
  admin_mobile: string
  admin_email: string | null
  profile: Record<string, string | null> | null
  mobile_verified: boolean
  plan_name: string | null
  billing_cycle: 'monthly' | 'yearly'
  tenancy_tier: 'pooled' | 'dedicated'
  modules: string[]
  quote: {
    currency: string
    subtotal_paise: number
    discount_paise: number
    additional_charges_paise: number
    gst_rate: number
    gst_amount_paise: number
    total_paise: number
    note: string | null
  }
  invoice_id: string | null
  paid_at: string | null
  tenant_id: string | null
  tenant_slug: string | null
  created_at: string
  /** Only on POST /registrations — store it, it is never returned again. */
  claim_token?: string
  /** Only on GET /status. */
  timeline?: Array<{ status: string; message: string; created_at: string }>
  login_url?: string | null
}

export interface CheckoutResponse {
  registration: Registration
  checkout: {
    razorpay_order_id: string
    key_id: string
    amount_paise: number
    currency: string
    name: string
    description: string
    prefill: { name: string; contact: string; email?: string }
    mock: boolean
  }
}

/** The envelope every JainERP API answers in. */
function unwrap<T>(data: { data?: T } | T): T {
  return (data as { data?: T })?.data ?? (data as T)
}

function claimHeaders(token: string) {
  return { headers: { 'x-registration-token': token } }
}

export const onboarding = {
  async catalogue(): Promise<Catalogue> {
    const { data } = await onboardingApi.get('/plans')
    return unwrap<Catalogue>(data)
  },

  async create(body: Record<string, unknown>): Promise<Registration> {
    const { data } = await onboardingApi.post('/registrations', body)
    return unwrap<Registration>(data)
  },

  async update(id: string, token: string, body: Record<string, unknown>): Promise<Registration> {
    const { data } = await onboardingApi.patch(`/registrations/${id}`, body, claimHeaders(token))
    return unwrap<Registration>(data)
  },

  async status(id: string, token: string): Promise<Registration> {
    const { data } = await onboardingApi.get(`/registrations/${id}/status`, claimHeaders(token))
    return unwrap<Registration>(data)
  },

  async sendOtp(id: string, token: string): Promise<{ sent: boolean; channel: string; dev_otp?: string }> {
    const { data } = await onboardingApi.post(`/registrations/${id}/send-otp`, {}, claimHeaders(token))
    return unwrap(data)
  },

  async verifyOtp(id: string, token: string, otp: string): Promise<Registration> {
    const { data } = await onboardingApi.post(`/registrations/${id}/verify-otp`, { otp }, claimHeaders(token))
    return unwrap<Registration>(data)
  },

  async selectPlan(
    id: string,
    token: string,
    body: { plan: string; billing_cycle: 'monthly' | 'yearly'; modules?: string[] },
  ): Promise<Registration> {
    const { data } = await onboardingApi.post(`/registrations/${id}/plan`, body, claimHeaders(token))
    return unwrap<Registration>(data)
  },

  async checkout(id: string, token: string): Promise<CheckoutResponse> {
    const { data } = await onboardingApi.post(`/registrations/${id}/checkout`, {}, claimHeaders(token))
    return unwrap<CheckoutResponse>(data)
  },

  async verifyPayment(
    id: string,
    token: string,
    body: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
  ): Promise<Registration> {
    const { data } = await onboardingApi.post(`/registrations/${id}/verify-payment`, body, claimHeaders(token))
    return unwrap<Registration>(data)
  },

  async paymentFailed(
    id: string,
    token: string,
    body: { reason?: string; outcome?: 'cancelled' | 'failed' },
  ): Promise<Registration> {
    const { data } = await onboardingApi.post(`/registrations/${id}/payment-failed`, body, claimHeaders(token))
    return unwrap<Registration>(data)
  },

  async customRequest(body: Record<string, unknown>): Promise<{ reference: string; message: string }> {
    const { data } = await onboardingApi.post('/custom-requests', body)
    return unwrap(data)
  },
}

// ---------------------------------------------------------------------------
// Draft persistence
// ---------------------------------------------------------------------------

const DRAFT_KEY = 'jainerp_registration'

export interface RegistrationDraft {
  id: string
  token: string
}

/**
 * The claim token is returned exactly once, at creation. Losing it means the
 * applicant cannot get back to their own registration — including the receipt
 * for a payment they have already made — so it is persisted immediately and
 * only cleared once onboarding is complete.
 */
export function saveDraft(draft: RegistrationDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    /* private browsing — the wizard still works within this page's lifetime */
  }
}

export function loadDraft(): RegistrationDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RegistrationDraft
    return parsed?.id && parsed?.token ? parsed : null
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* nothing to clear */
  }
}

// ---------------------------------------------------------------------------
// Razorpay Checkout
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

let scriptPromise: Promise<boolean> | null = null

/**
 * Load Razorpay's checkout script on demand.
 *
 * Deliberately not in index.html: this app is also packaged as an offline
 * Electron desktop build, where a blocking third-party script tag on every
 * launch is a hang waiting to happen. The registration wizard is the only
 * screen that needs it.
 */
export function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      scriptPromise = null
      resolve(false)
    }
    document.body.appendChild(s)
  })
  return scriptPromise
}

/** Paise → "₹1,234.00". */
export function inr(paise: number): string {
  return `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Pull the API's `{ code, message }` error out of an axios failure. */
export function apiError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: { message?: string } } } }
  return err.response?.data?.error?.message || fallback
}
