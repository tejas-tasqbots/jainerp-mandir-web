import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Building2, Phone, ShieldCheck, ChevronLeft, ChevronRight, RotateCw, Lock } from 'lucide-react'
import { LanguageSwitcher } from '../../components/Layout/LanguageSwitcher'
import { useAuthStore } from '../../store/authStore'
import { useProfileStore } from '../../store/profileStore'
import { api } from '../../lib/api'
import { isValidPhone, PhoneInput } from '../../components/PhoneInput'

type Step = 'mobile' | 'otp' | 'tenant'

interface TenantChoice {
  slug: string
  name: string
  status: string
  roles: string[]
  /** true when the super admin has suspended / deactivated / deleted this mandir. */
  blocked?: boolean
  /** Exactly what to tell the user, ending in who to contact. */
  block_message?: string | null
}

const SUPPORT_EMAIL = 'contact@jainerp.org'

/**
 * True inside the Electron desktop shell (loaded over file://). Mirrors the
 * check in App.tsx. The desktop edition is licensed to a mandir that already
 * exists, so it has no signup path — offering "Register" there would send an
 * offline user to a page that cannot reach the onboarding API.
 */
const isDesktopBuild =
  typeof window !== 'undefined' &&
  (Boolean((window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron) ||
    window.location.protocol === 'file:')

/**
 * Shown whenever a mandir is suspended / deactivated / deleted.
 *
 * Declared at module scope, not inside LoginPage: a component defined during
 * render is a brand-new type on every render, so React unmounts and remounts it
 * each time instead of updating it.
 */
function BlockedNotice({ message }: { message: string }) {
  return (
    <div data-testid="tenant-blocked" className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
      <div className="flex items-start gap-2">
        <Lock size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-900 font-medium">{message}</p>
      </div>
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="inline-block text-xs font-semibold text-amber-800 underline"
      >
        {SUPPORT_EMAIL}
      </a>
    </div>
  )
}

export function LoginPage() {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('mobile')
  const [mobile, setMobile] = useState('')
  const [otp, setOtp] = useState('')
  const [mockOtp, setMockOtp] = useState<string | null>(null)
  const [selectionToken, setSelectionToken] = useState('')
  const [tenants, setTenants] = useState<TenantChoice[]>([])
  const [error, setError] = useState('')
  /** Set when access is blocked — rendered as a help panel, not a red one-liner. */
  const [blockedMsg, setBlockedMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [resending, setResending] = useState(false)
  const [resentNote, setResentNote] = useState('')

  const { setTokens, setUser, setLanguage, setModules, deviceId, clearLanguagePin } = useAuthStore()
  const { fetchProfile } = useProfileStore()

  // A session killed mid-flight because the mandir was suspended/deactivated
  // hands its reason over via sessionStorage (see the 403 interceptor).
  useEffect(() => {
    const carried = sessionStorage.getItem('jainerp_blocked_message')
    if (carried) {
      setBlockedMsg(carried)
      sessionStorage.removeItem('jainerp_blocked_message')
    }
  }, [])

  // Countdown that gates the "Resend OTP" action (avoids spamming the SMS/WA gateway).
  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  async function sendOtp() {
    if (!isValidPhone(mobile)) {
      setError(t('login.invalidMobile'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/auth/send-otp', { mobile, purpose: 'login' })
      if (data.data?.dev_otp) setMockOtp(data.data.dev_otp)
      setStep('otp')
      setResendIn(30)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || t('login.sendOtpFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function resendOtp() {
    if (resendIn > 0 || resending) return
    setResending(true)
    setError('')
    setResentNote('')
    try {
      const { data } = await api.post('/auth/send-otp', { mobile, purpose: 'login' })
      if (data.data?.dev_otp) setMockOtp(data.data.dev_otp)
      // "WhatsApp"/"SMS", not the API's lower-case code; the mock and review
      // channels name nothing a user would recognise.
      const via = ({ whatsapp: 'WhatsApp', sms: 'SMS' } as Record<string, string>)[data.data?.channel ?? '']
      setResentNote(via ? t('login.otpResentVia', { channel: via }) : t('login.otpResent'))
      setOtp('')
      setResendIn(30)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || t('login.resendFailed'))
    } finally {
      setResending(false)
    }
  }

  async function verifyOtp() {
    if (otp.length !== 6) { setError(t('login.invalidOtp')); return }
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/auth/verify-otp', {
        mobile,
        otp,
        device_id: deviceId,
      })
      const result = data.data
      const choices: TenantChoice[] = result.tenants ?? []
      // Auto-select only when there is exactly one mandir AND it is usable —
      // otherwise show the picker so the block reason is visible.
      const usable = choices.filter(t => !t.blocked)
      if (usable.length === 1 && choices.length === 1) {
        await doSelectTenant(result.selection_token, usable[0].slug)
      } else if (choices.length > 0) {
        setSelectionToken(result.selection_token)
        setTenants(choices)
        setStep('tenant')
      }
    } catch (e: unknown) {
      const err = e as {
        response?: { data?: { error?: { code?: string; message?: string } } }
      }
      const apiErr = err.response?.data?.error
      // Every mandir this person belongs to is blocked — show the platform's
      // message (who to contact) instead of a bare "forbidden".
      if (apiErr?.code === 'TENANT_INACTIVE') {
        setBlockedMsg(apiErr.message || t('login.templeUnavailable', { email: SUPPORT_EMAIL }))
        setError('')
      } else {
        setError(apiErr?.message || t('login.verifyFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  async function doSelectTenant(token: string, slug: string) {
    const { data } = await api.post('/auth/select-tenant', {
      selection_token: token,
      tenant_slug: slug,
    })
    const result = data.data
    setTokens(result.access_token, result.refresh_token)
    // Seed from the login response, then GET /auth/me fills in the real
    // user name/roles + temple display name (never show the raw slug).
    setUser(
      { id: '', mobile, name: null, roles: result.roles ?? [] },
      { id: result.tenant?.id ?? '', slug: result.tenant?.slug ?? slug, name: result.tenant?.name ?? slug },
    )
    if (result.language && !useAuthStore.getState().languagePinned) setLanguage(result.language)
    // select-tenant already carries the entitlements, so the first paint after
    // login has the right sidebar rather than briefly showing modules this
    // trust does not have and then removing them.
    if (Array.isArray(result.effective_modules)) setModules(result.effective_modules)
    await hydrateSession()
  }

  // Pull the authoritative user (name + roles) and temple (display name) so the
  // header shows "Ramesh Shah (Temple Admin)" and the real mandir name.
  async function hydrateSession() {
    try {
      const { data } = await api.get('/auth/me')
      const me = data.data ?? data
      if (me?.user || me?.tenant) {
        setUser(
          {
            id: me.user?.id ?? '',
            mobile: me.user?.mobile ?? mobile,
            name: me.user?.name ?? null,
            roles: me.user?.roles ?? [],
          },
          { id: me.tenant?.id ?? '', slug: me.tenant?.slug ?? '', name: me.tenant?.name ?? '' },
        )
      }
      if (me?.language && !useAuthStore.getState().languagePinned) setLanguage(me.language)
    } catch { /* header falls back to seeded values */ }
    // A language picked on the login screen had no session to save against.
    // Now there is one — persist it server-side, then stop overriding.
    if (useAuthStore.getState().languagePinned) {
      try {
        await api.patch('/users/me/language', { language: useAuthStore.getState().language })
      } catch { /* keep the local choice even if the save fails */ }
      clearLanguagePin()
    }
    await fetchProfile()
  }

  async function selectTenant(slug: string) {
    setLoading(true)
    setError('')
    setBlockedMsg('')
    try {
      await doSelectTenant(selectionToken, slug)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { code?: string; message?: string } } } }
      const apiErr = err.response?.data?.error
      if (apiErr?.code === 'TENANT_INACTIVE') {
        setBlockedMsg(apiErr.message || t('login.templeUnavailable', { email: SUPPORT_EMAIL }))
      } else {
        setError(apiErr?.message || t('login.selectTempleFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm relative">
        {/* Language is switchable before sign-in — a Hindi-only cashier used to
            meet an English-only login with no way out. */}
        {/* The switcher sits in its own row rather than floating over the
            header. It used to be absolutely positioned on top of the logo and
            hero, so opening it covered the branding — the menu was always
            clickable, it just landed on top of the artwork. Giving it a row of
            its own makes all three portal logins read the same way. */}
        <div className="flex justify-end -mt-2 mb-1 relative z-50"><LanguageSwitcher variant="pill" /></div>
        {/* Header — wordmark over the portal label, and nothing else. The mark is
            text and colour only (tools/brand/generate-brand-assets.py: "There is
            no icon, badge or illustration in the mark"), which is why the
            Building2 glyph in a red plate that used to sit here is gone. The
            sidebar, the favicon and every app icon already read this way. */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-navy-900">Jain</span><span className="text-brand-red">ERP</span>
          </h1>
          <p className="text-slate-500 text-sm font-semibold mt-1">{t('brand.portal')}</p>
        </div>

        {/* Step 1: Mobile number */}
        {step === 'mobile' && (
          <div className="space-y-4">
            <div>
              <label className="form-label">{t('login.mobileLabel')}</label>
              <div onKeyDown={e => e.key === 'Enter' && sendOtp()}>
                <PhoneInput value={mobile} onChange={v => { setMobile(v); setError('') }} autoFocus />
              </div>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            {blockedMsg && <BlockedNotice message={blockedMsg} />}
            <button
              onClick={sendOtp}
              disabled={loading || !isValidPhone(mobile)}
              className="btn-primary w-full justify-center py-3"
            >
              <Phone size={16} />
              {loading ? t('login.sendingOtp') : t('login.sendOtp')}
            </button>

            {/* Second entry point into the ONE registration flow. The website's
                "Register Your Trust/Temple" CTA lands on this same /register
                route — there is no separate signup for people who arrive here
                instead of at jainerp.org. Hidden on the desktop edition, which
                is licensed to an existing mandir and has no signup path. */}
            {!isDesktopBuild && (
              <div className="pt-4 mt-2 border-t border-slate-100 text-center">
                <p className="text-sm text-slate-500">{t('login.newMandir')}</p>
                <Link
                  to="/register"
                  className="btn-secondary w-full justify-center py-2.5 mt-2"
                  data-testid="register-cta"
                >
                  <Building2 size={15} />
                  {t('login.registerCta')}
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Step 2: OTP verification */}
        {step === 'otp' && (
          <div className="space-y-4">
            <button onClick={() => { setStep('mobile'); setOtp(''); setError('') }} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600">
              <ChevronLeft size={15} /> {t('login.back')}
            </button>
            <p className="text-sm text-slate-600">
              {t('login.otpSentTo')} <span className="font-semibold">{mobile}</span>
            </p>
            {mockOtp && (
              <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-700">
                {t('login.devModeOtp')} <span className="font-mono font-bold">{mockOtp}</span>
              </div>
            )}
            {resentNote && (
              <div className="bg-green-50 border border-green-200 rounded-md px-3 py-2 text-xs text-green-700">
                {resentNote}
              </div>
            )}
            <div>
              <label className="form-label">{t('login.otpLabel')}</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder={t('login.otpPlaceholder')}
                className="form-input text-center text-2xl font-mono tracking-[0.5em]"
                value={otp}
                onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setError('') }}
                onKeyDown={e => e.key === 'Enter' && verifyOtp()}
                autoFocus
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            {blockedMsg && <BlockedNotice message={blockedMsg} />}
            <button
              onClick={verifyOtp}
              disabled={loading || otp.length !== 6}
              className="btn-primary w-full justify-center py-3"
            >
              <ShieldCheck size={16} />
              {loading ? t('login.verifying') : t('login.verifyOtp')}
            </button>
            {/* Resend OTP — gated by a short countdown so users can re-request if the code didn't arrive */}
            <div className="text-center text-sm">
              <span className="text-slate-400">{t('login.noCode')} </span>
              {resendIn > 0 ? (
                <span className="text-slate-400">{t('login.resendIn', { seconds: resendIn })}</span>
              ) : (
                <button
                  type="button"
                  onClick={resendOtp}
                  disabled={resending}
                  className="inline-flex items-center gap-1 font-semibold text-brand-blue hover:underline disabled:opacity-50"
                >
                  <RotateCw size={13} className={resending ? 'animate-spin' : ''} />
                  {resending ? t('login.resending') : t('login.resend')}
                </button>
              )}
            </div>
            {/* OTP numpad */}
            <div className="grid grid-cols-3 gap-2 mt-2">
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (d === '⌫') setOtp(p => p.slice(0, -1))
                    else if (d !== '') setOtp(p => p.length < 6 ? p + d : p)
                    setError('')
                  }}
                  className={`h-11 rounded-lg text-lg font-semibold transition-colors ${
                    d === '' ? '' :
                    d === '⌫' ? 'bg-red-50 text-red-600 hover:bg-red-100' :
                    'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Temple selection (multi-tenant) */}
        {step === 'tenant' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 font-medium">{t('login.selectTemple')}</p>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            {blockedMsg && <BlockedNotice message={blockedMsg} />}
            <div className="space-y-2">
              {tenants.map(choice => (
                <button
                  key={choice.slug}
                  data-testid={`tenant-choice-${choice.slug}`}
                  onClick={() => (choice.blocked
                    ? setBlockedMsg(choice.block_message || t('login.templeUnavailable', { email: SUPPORT_EMAIL }))
                    : selectTenant(choice.slug))}
                  disabled={loading}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors text-left group disabled:opacity-50 ${
                    choice.blocked
                      ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
                      : 'border-slate-200 hover:border-brand-red hover:bg-red-50'
                  }`}
                >
                  <div>
                    <p className={`font-semibold text-sm ${choice.blocked ? 'text-slate-400' : 'text-slate-800'}`}>
                      {choice.name}
                      {choice.blocked && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                          {t('login.unavailable')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{choice.roles.join(', ')}</p>
                  </div>
                  {choice.blocked
                    ? <Lock size={16} className="text-amber-500" />
                    : <ChevronRight size={16} className="text-slate-400 group-hover:text-brand-red" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
