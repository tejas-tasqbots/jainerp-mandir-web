import { useState } from 'react'
import { Building2, Phone, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useProfileStore } from '../../store/profileStore'
import { api } from '../../lib/api'

type Step = 'mobile' | 'otp' | 'tenant'

interface TenantChoice {
  slug: string
  name: string
  status: string
  roles: string[]
}

export function LoginPage() {
  const [step, setStep] = useState<Step>('mobile')
  const [mobile, setMobile] = useState('')
  const [otp, setOtp] = useState('')
  const [mockOtp, setMockOtp] = useState<string | null>(null)
  const [selectionToken, setSelectionToken] = useState('')
  const [tenants, setTenants] = useState<TenantChoice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { setTokens, setUser, deviceId } = useAuthStore()
  const { fetchProfile } = useProfileStore()

  async function sendOtp() {
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setError('Enter a valid 10-digit mobile number')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/auth/send-otp', { mobile: `+91${mobile}`, purpose: 'login' })
      if (data.data?.dev_otp) setMockOtp(data.data.dev_otp)
      setStep('otp')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  async function verifyOtp() {
    if (otp.length !== 6) { setError('Enter 6-digit OTP'); return }
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/auth/verify-otp', {
        mobile: `+91${mobile}`,
        otp,
        device_id: deviceId,
      })
      const result = data.data
      if (result.tenants?.length === 1) {
        // Auto-select single tenant
        await doSelectTenant(result.selection_token, result.tenants[0].slug)
      } else if (result.tenants?.length > 1) {
        setSelectionToken(result.selection_token)
        setTenants(result.tenants)
        setStep('tenant')
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Invalid OTP')
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
    setUser({ id: '', mobile: `+91${mobile}`, name: null, roles: [] }, { id: '', slug, name: slug })
    await fetchProfile()
  }

  async function selectTenant(slug: string) {
    setLoading(true)
    setError('')
    try {
      await doSelectTenant(selectionToken, slug)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to select temple')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-96">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-red flex items-center justify-center mx-auto mb-4">
            <Building2 size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-navy-900">Jain</span><span className="text-brand-red">ERP</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">Mandir Admin Portal</p>
        </div>

        {/* Step 1: Mobile number */}
        {step === 'mobile' && (
          <div className="space-y-4">
            <div>
              <label className="form-label">Mobile Number</label>
              <div className="flex gap-2">
                <span className="flex items-center px-3 bg-slate-50 border border-slate-300 rounded-md text-sm text-slate-500 border-r-0 rounded-r-none">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="9876543210"
                  className="form-input rounded-l-none flex-1"
                  value={mobile}
                  onChange={e => { setMobile(e.target.value.replace(/\D/g, '')); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && sendOtp()}
                  autoFocus
                />
              </div>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              onClick={sendOtp}
              disabled={loading || mobile.length !== 10}
              className="btn-primary w-full justify-center py-3"
            >
              <Phone size={16} />
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
          </div>
        )}

        {/* Step 2: OTP verification */}
        {step === 'otp' && (
          <div className="space-y-4">
            <button onClick={() => { setStep('mobile'); setOtp(''); setError('') }} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600">
              <ChevronLeft size={15} /> Back
            </button>
            <p className="text-sm text-slate-600">
              OTP sent to <span className="font-semibold">+91 {mobile}</span>
            </p>
            {mockOtp && (
              <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-700">
                Dev mode — OTP: <span className="font-mono font-bold">{mockOtp}</span>
              </div>
            )}
            <div>
              <label className="form-label">Enter OTP</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit OTP"
                className="form-input text-center text-2xl font-mono tracking-[0.5em]"
                value={otp}
                onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setError('') }}
                onKeyDown={e => e.key === 'Enter' && verifyOtp()}
                autoFocus
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              onClick={verifyOtp}
              disabled={loading || otp.length !== 6}
              className="btn-primary w-full justify-center py-3"
            >
              <ShieldCheck size={16} />
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>
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
            <p className="text-sm text-slate-600 font-medium">Select your temple</p>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="space-y-2">
              {tenants.map(t => (
                <button
                  key={t.slug}
                  onClick={() => selectTenant(t.slug)}
                  disabled={loading}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 hover:border-brand-red hover:bg-red-50 transition-colors text-left group disabled:opacity-50"
                >
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{t.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{t.roles.join(', ')}</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-400 group-hover:text-brand-red" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
