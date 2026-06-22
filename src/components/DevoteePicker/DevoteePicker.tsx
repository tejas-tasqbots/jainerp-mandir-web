import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X, UserPlus, ShieldCheck, Link2, EyeOff, KeyRound } from 'lucide-react'
import { api } from '../../lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GlobalDevotee {
  id: string
  name: string
  mobile: string
  pan_masked?: string
  city?: string
  verified: boolean
  linked_to_this_temple: boolean
  link_status?: string
}

export interface DevoteeSelection {
  global_user_id?: string
  name?: string
  mobile?: string
  verified?: boolean
  linked_to_this_temple?: boolean
  pan_masked?: string
  is_anonymous?: boolean
  anonymous_category?: 'gupt_dan' | 'dan_peti'
  is_offline?: boolean
}

interface DevoteePickerProps {
  value: DevoteeSelection | null
  onChange: (val: DevoteeSelection | null) => void
  showAnonymous?: boolean  // show Gupt Dan option (default true)
  showDanPeti?: boolean    // show Dan Peti option — only on Donations (default false)
  required?: boolean
  label?: string
}

type Step = 'idle' | 'searching' | 'results' | 'register_name' | 'register_otp' | 'selected' | 'anonymous' | 'offline'

// ─── Hook: detect online/offline for desktop ─────────────────────────────────

function useIsOnline(): boolean {
  const isDesktop = typeof window !== 'undefined' && (window.__JAINERP_DESKTOP__ || window.electronAPI?.isElectron)
  const [online, setOnline] = useState<boolean>(!isDesktop || true)

  useEffect(() => {
    if (!isDesktop || !window.electronAPI) return
    window.electronAPI.checkConnectivity().then(setOnline).catch(() => setOnline(false))
    const unsub = window.electronAPI.onConnectivityChange(setOnline)
    return () => unsub()
  }, [isDesktop])

  return online
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DevoteePicker({
  value,
  onChange,
  showAnonymous = true,
  showDanPeti = false,
  required = false,
  label,
}: DevoteePickerProps) {
  const isOnline = useIsOnline()

  const [step, setStep] = useState<Step>('idle')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalDevotee[]>([])
  const [searchDone, setSearchDone] = useState(false)
  const [searching, setSearching] = useState(false)

  // Offline mode inputs
  const [offlineName, setOfflineName] = useState('')
  const [offlineMobile, setOfflineMobile] = useState('')

  // Register step 1
  const [regName, setRegName] = useState('')
  const [regPan, setRegPan] = useState('')
  const [regNoPan, setRegNoPan] = useState(false)
  const [regUserId, setRegUserId] = useState('')
  const [regSending, setRegSending] = useState(false)
  const [regDevOtp, setRegDevOtp] = useState('')

  // Register step 2
  const [otp, setOtp] = useState('')
  const [otpVerifying, setOtpVerifying] = useState(false)

  const [error, setError] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        if (step === 'results') setStep('idle')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [step])

  // Debounced search
  useEffect(() => {
    if (!isOnline || query.length < 3) {
      setResults([])
      setSearchDone(false)
      return
    }
    setSearchDone(false)
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.get('/devotees/search', { params: { q: query } })
        setResults(r.data?.data || [])
        setSearchDone(true)
        setStep('results')
      } catch {
        setResults([])
        setSearchDone(true)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => { clearTimeout(t); setSearching(false) }
  }, [query, isOnline])

  const clear = useCallback(() => {
    onChange(null)
    setStep('idle')
    setQuery('')
    setResults([])
    setSearchDone(false)
    setError('')
    setOfflineName('')
    setOfflineMobile('')
    setRegName('')
    setRegPan('')
    setRegNoPan(false)
    setRegUserId('')
    setOtp('')
    setRegDevOtp('')
  }, [onChange])

  function selectDevotee(d: GlobalDevotee) {
    onChange({
      global_user_id: d.id,
      name: d.name,
      mobile: d.mobile,
      verified: d.verified,
      linked_to_this_temple: d.linked_to_this_temple,
      pan_masked: d.pan_masked,
    })
    setStep('selected')
    setQuery('')
    setError('')
  }

  function startRegister() {
    // Pre-fill name if query looks like a name
    const looksLikeMobile = /^\d{10}$/.test(query.replace(/\D/g, ''))
    setRegName(looksLikeMobile ? '' : query)
    setRegPan('')
    setRegNoPan(false)
    setError('')
    setStep('register_name')
  }

  async function sendOtp() {
    const mobile = query.replace(/\D/g, '')
    if (mobile.length !== 10) { setError('Enter a valid 10-digit mobile number to continue'); return }
    if (!regName.trim()) { setError('Name is required'); return }
    setRegSending(true)
    setError('')
    try {
      const resp = await api.post('/devotees/register', {
        mobile,
        name: regName.trim(),
        pan: (!regNoPan && regPan) ? regPan : undefined,
      })
      const data = resp.data?.data ?? resp.data
      if (data.already_verified) {
        // Devotee is already in the system and verified — select directly
        selectDevotee({
          id: data.user_id,
          name: data.user.name,
          mobile: data.user.mobile,
          pan_masked: data.user.pan_masked,
          city: data.user.city,
          verified: true,
          linked_to_this_temple: false,
        })
        return
      }
      setRegUserId(data.user_id)
      setRegDevOtp(data.dev_otp || '')
      setStep('register_otp')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to send OTP')
    } finally {
      setRegSending(false)
    }
  }

  async function verifyOtp() {
    if (otp.length !== 6) { setError('Enter the 6-digit OTP'); return }
    setOtpVerifying(true)
    setError('')
    try {
      const resp = await api.post('/devotees/verify-otp', { user_id: regUserId, otp })
      const data = resp.data?.data ?? resp.data
      onChange({
        global_user_id: data.global_user_id,
        name: regName,
        mobile: query.replace(/\D/g, ''),
        verified: true,
        linked_to_this_temple: true,
        pan_masked: data.pan_masked,
      })
      setStep('selected')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'OTP verification failed')
    } finally {
      setOtpVerifying(false)
    }
  }

  function selectAnonymous(category?: 'gupt_dan' | 'dan_peti') {
    onChange({ is_anonymous: true, anonymous_category: category ?? 'gupt_dan' })
    setStep('anonymous')
    setQuery('')
    setError('')
  }

  function confirmOffline() {
    if (!offlineName.trim()) { setError('Name is required'); return }
    onChange({ name: offlineName.trim(), mobile: offlineMobile.replace(/\D/g, '') || undefined, is_offline: true })
    setStep('selected')
    setError('')
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const fieldLabel = label ?? 'Devotee'

  // ── SELECTED STATE ─────────────────────────────────────────────────────────
  if (value && (step === 'selected' || (value.global_user_id || value.is_offline))) {
    return (
      <div>
        <label className="form-label">{fieldLabel}{required && ' *'}</label>
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-green-800">{value.name}</span>
              {value.mobile && <span className="text-xs text-green-600">{value.mobile}</span>}
              {value.verified && (
                <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600 font-medium">
                  <ShieldCheck size={11} /> Verified
                </span>
              )}
              {value.linked_to_this_temple && (
                <span className="inline-flex items-center gap-0.5 text-xs text-blue-600 font-medium">
                  <Link2 size={11} /> Connected
                </span>
              )}
              {value.is_offline && (
                <span className="text-xs text-amber-600 font-medium">Offline — will link on sync</span>
              )}
            </div>
          </div>
          <button type="button" onClick={clear} className="ml-auto text-slate-400 hover:text-red-500 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  // ── ANONYMOUS STATE ────────────────────────────────────────────────────────
  if (step === 'anonymous' && value?.is_anonymous) {
    const label2 = value.anonymous_category === 'dan_peti' ? 'Dan Peti (Donation Box)' : 'Anonymous / Gupt Dan'
    return (
      <div>
        <label className="form-label">{fieldLabel}{required && ' *'}</label>
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 border border-slate-200 rounded-md">
          <EyeOff size={14} className="text-slate-400 flex-shrink-0" />
          <span className="text-sm font-medium text-slate-600">{label2}</span>
          <button type="button" onClick={clear} className="ml-auto text-slate-400 hover:text-red-500 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  // ── OFFLINE MODE (desktop, no connectivity) ────────────────────────────────
  if (!isOnline) {
    return (
      <div>
        <label className="form-label">{fieldLabel}{required && ' *'}</label>
        <div className="space-y-2">
          <div className="text-xs text-amber-600 flex items-center gap-1 mb-1">
            <span className="font-medium">Offline mode</span> — name and mobile only. Will link to global profile on sync.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className="form-input" placeholder={`${fieldLabel} name${required ? ' *' : ''}`}
              value={offlineName} onChange={e => setOfflineName(e.target.value)} />
            <input className="form-input" placeholder="Mobile (optional)" type="tel"
              value={offlineMobile} onChange={e => setOfflineMobile(e.target.value)} />
          </div>
          {showAnonymous && (
            <button type="button" onClick={() => selectAnonymous()}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 mt-1">
              <EyeOff size={11} /> Mark as anonymous / Gupt Dan
            </button>
          )}
          {showDanPeti && (
            <button type="button" onClick={() => selectAnonymous('dan_peti')}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <EyeOff size={11} /> Dan Peti (Donation Box)
            </button>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="button" onClick={confirmOffline} className="btn-secondary btn-sm text-xs">
            Confirm
          </button>
        </div>
      </div>
    )
  }

  // ── REGISTER STEP 1: Name + PAN ────────────────────────────────────────────
  if (step === 'register_name') {
    return (
      <div>
        <label className="form-label">{fieldLabel}{required && ' *'}</label>
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 space-y-2">
          <p className="text-xs text-blue-700 font-medium">
            Register devotee — OTP will be sent to <strong>{query.replace(/\D/g, '')}</strong>
          </p>
          <input className="form-input" placeholder="Full name *" value={regName}
            onChange={e => setRegName(e.target.value)} />
          {!regNoPan && (
            <input className="form-input uppercase" placeholder="PAN (optional, for 80G)" value={regPan}
              onChange={e => setRegPan(e.target.value.toUpperCase())} maxLength={10} />
          )}
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={regNoPan} onChange={e => { setRegNoPan(e.target.checked); setRegPan('') }} />
            Devotee doesn't want to share PAN
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={sendOtp} disabled={regSending}
              className="btn-primary btn-sm text-xs flex items-center gap-1">
              <KeyRound size={12} /> {regSending ? 'Sending…' : 'Send OTP'}
            </button>
            <button type="button" onClick={() => { setStep('idle'); setQuery('') }} className="btn-secondary btn-sm text-xs">
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── REGISTER STEP 2: OTP verification ─────────────────────────────────────
  if (step === 'register_otp') {
    return (
      <div>
        <label className="form-label">{fieldLabel}{required && ' *'}</label>
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 space-y-2">
          <p className="text-xs text-blue-700">
            OTP sent to <strong>{query.replace(/\D/g, '')}</strong>. Ask the devotee to read it out.
            {regDevOtp && <span className="ml-1 font-bold text-orange-600">[Dev: {regDevOtp}]</span>}
          </p>
          <input className="form-input text-lg tracking-widest w-40" placeholder="6-digit OTP"
            value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6} inputMode="numeric" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={verifyOtp} disabled={otpVerifying}
              className="btn-primary btn-sm text-xs flex items-center gap-1">
              <ShieldCheck size={12} /> {otpVerifying ? 'Verifying…' : 'Verify OTP'}
            </button>
            <button type="button" onClick={() => setStep('register_name')} className="btn-secondary btn-sm text-xs">
              Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── IDLE / SEARCH / RESULTS ────────────────────────────────────────────────
  const showDropdown = (step === 'results' || searching) && query.length >= 3
  const mobileLike = /^\d+$/.test(query.replace(/\D/g, '')) && query.replace(/\D/g, '').length >= 5

  return (
    <div>
      <label className="form-label">{fieldLabel}{required && ' *'}</label>
      <div className="space-y-1">
        <div className="relative" ref={dropdownRef}>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            ref={inputRef}
            className="form-input pl-9"
            placeholder={mobileLike || query.length === 0 ? 'Search by mobile number or name…' : 'Keep typing…'}
            value={query}
            onChange={e => { setQuery(e.target.value); setStep('searching') }}
            onFocus={() => { if (query.length >= 3) setStep('results') }}
          />
          {searching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
          )}

          {showDropdown && (
            <div className="absolute z-30 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
              {results.map(d => (
                <button key={d.id} type="button" onClick={() => selectDevotee(d)}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-sm border-b border-slate-100 last:border-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-slate-400 text-xs">{d.mobile}</span>
                    {d.city && <span className="text-slate-400 text-xs">• {d.city}</span>}
                    {d.verified && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600">
                        <ShieldCheck size={10} /> Verified
                      </span>
                    )}
                    {d.linked_to_this_temple && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-blue-600">
                        <Link2 size={10} /> Connected
                      </span>
                    )}
                  </div>
                </button>
              ))}

              {searchDone && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">No devotee found for "{query}"</div>
              )}

              {searchDone && (
                <button type="button" onClick={startRegister}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm text-blue-700 border-t border-slate-100 flex items-center gap-2">
                  <UserPlus size={14} />
                  Register this {mobileLike ? 'mobile' : 'devotee'} on-site
                </button>
              )}

              {showAnonymous && searchDone && (
                <button type="button" onClick={() => selectAnonymous()}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-xs text-slate-500 border-t border-slate-100 flex items-center gap-2">
                  <EyeOff size={12} /> Anonymous / Gupt Dan
                </button>
              )}

              {showDanPeti && searchDone && (
                <button type="button" onClick={() => selectAnonymous('dan_peti')}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-xs text-slate-500 flex items-center gap-2">
                  <EyeOff size={12} /> Dan Peti (Donation Box)
                </button>
              )}
            </div>
          )}
        </div>

        {/* Quick anonymous buttons when query is empty */}
        {query.length === 0 && (showAnonymous || showDanPeti) && (
          <div className="flex gap-2 flex-wrap">
            {showAnonymous && (
              <button type="button" onClick={() => selectAnonymous()}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <EyeOff size={11} /> Anonymous / Gupt Dan
              </button>
            )}
            {showDanPeti && (
              <button type="button" onClick={() => selectAnonymous('dan_peti')}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <EyeOff size={11} /> Dan Peti
              </button>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}
