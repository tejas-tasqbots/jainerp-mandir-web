import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X, UserPlus, ShieldCheck, Link2, EyeOff, KeyRound, Check } from 'lucide-react'
import { api } from '../../lib/api'
import { CitySelect, CountrySelect, StateSelect } from '../GeoSelect'
import { isValidPhone, PhoneInput } from '../PhoneInput'

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
  showAnonymous?: boolean  // show Gupt Daan option (default true)
  showDanPeti?: boolean    // show Daan Peti option — only on Donations (default false)
  required?: boolean
  label?: string
}

// The picker has just two working modes:
//   'search' — one box: find an existing donor, or open the add-new form
//   'add'    — one inline form to create a donor (OTP verification is optional)
// Anything selected renders as a compact chip regardless of mode.
type Mode = 'search' | 'add'

/**
 * Mask a PAN for display exactly as the API stores it (`AB` + `XXXXX` + `234F`
 * → `ABXXXXX34F`). The full PAN must never be shown after entry — only the
 * OTP-gated reveal endpoint discloses it. Returns undefined for anything that
 * isn't a well-formed PAN, so a partial/typo'd entry is simply not shown.
 */
function maskPanForDisplay(pan?: string): string | undefined {
  if (!pan) return undefined
  const clean = pan.toUpperCase().trim()
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(clean)) return undefined
  return `${clean.slice(0, 2)}XXXXX${clean.slice(-3)}`
}

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

  const [mode, setMode] = useState<Mode>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalDevotee[]>([])
  const [searchDone, setSearchDone] = useState(false)
  const [searching, setSearching] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Add-new form (mirrors the standalone Donor registration form)
  const [f, setF] = useState({
    name: '', mobile: '', email: '', gotra: '',
    country: 'India', state: '', city: '', address: '', pincode: '',
    pan: '', noPan: false,
  })
  const [saving, setSaving] = useState(false)

  // Inline OTP verification (optional) — expands under the add form
  const [otpOpen, setOtpOpen] = useState(false)
  const [otpUserId, setOtpUserId] = useState('')
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)

  const [error, setError] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const setField = (k: keyof typeof f, v: string | boolean) => setF(s => ({ ...s, [k]: v }))

  // Close the results dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Debounced global search
  useEffect(() => {
    if (!isOnline || query.length < 3) {
      setResults([]); setSearchDone(false); return
    }
    setSearchDone(false); setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.get('/devotees/search', { params: { q: query } })
        setResults(r.data?.data || [])
        setSearchDone(true); setDropdownOpen(true)
      } catch {
        setResults([]); setSearchDone(true)
      } finally { setSearching(false) }
    }, 300)
    return () => { clearTimeout(t); setSearching(false) }
  }, [query, isOnline])

  const resetAddForm = useCallback(() => {
    setF({ name: '', mobile: '', email: '', gotra: '', country: 'India', state: '', city: '', address: '', pincode: '', pan: '', noPan: false })
    setOtpOpen(false); setOtpUserId(''); setOtp(''); setDevOtp('')
  }, [])

  const clear = useCallback(() => {
    onChange(null)
    setMode('search'); setQuery(''); setResults([]); setSearchDone(false)
    setDropdownOpen(false); setError(''); resetAddForm()
  }, [onChange, resetAddForm])

  function selectDevotee(d: GlobalDevotee) {
    onChange({
      global_user_id: d.id, name: d.name, mobile: d.mobile,
      verified: d.verified, linked_to_this_temple: d.linked_to_this_temple, pan_masked: d.pan_masked,
    })
    setDropdownOpen(false); setError('')
  }

  function selectAnonymous(category: 'gupt_dan' | 'dan_peti' = 'gupt_dan') {
    onChange({ is_anonymous: true, anonymous_category: category })
    setDropdownOpen(false); setError('')
  }

  /** Everything the add-new form captured — mirrors the standalone Donor form. */
  function registerPayload() {
    return {
      mobile: f.mobile,
      name: f.name.trim(),
      pan: (!f.noPan && f.pan) ? f.pan : undefined,
      email: f.email.trim() || undefined,
      gotra: f.gotra.trim() || undefined,
      country: f.country || undefined,
      state: f.state.trim() || undefined,
      city: f.city.trim() || undefined,
      address: f.address.trim() || undefined,
      pincode: f.pincode.trim() || undefined,
    }
  }

  // Open the add-new form, pre-filling name or mobile from whatever was typed.
  function openAddForm() {
    const digits = query.replace(/\D/g, '')
    const looksLikeMobile = /^\d{10}$/.test(digits)
    resetAddForm()
    setF(s => ({
      ...s,
      name: looksLikeMobile ? '' : query,
      mobile: looksLikeMobile ? `+91${digits}` : '',
    }))
    setError(''); setDropdownOpen(false); setMode('add')
  }

  // Save the donor. If online with a valid mobile, persist to the global
  // directory (unverified) so nothing is lost; otherwise record on the txn only.
  async function saveDonor() {
    if (!f.name.trim()) { setError('Name is required'); return }
    if (f.mobile && !isValidPhone(f.mobile)) { setError('Enter a valid mobile number'); return }
    // Store the MASKED PAN on the selection — the raw PAN goes to the API in the
    // register/donation payload but must never be surfaced back in the UI chip.
    const panMasked = (!f.noPan) ? maskPanForDisplay(f.pan) : undefined

    if (isOnline && f.mobile) {
      setSaving(true); setError('')
      try {
        const resp = await api.post('/devotees/register', registerPayload())
        const data = resp.data?.data ?? resp.data
        onChange({
          global_user_id: data.user_id,
          name: f.name.trim(), mobile: f.mobile,
          verified: !!data.already_verified,
          linked_to_this_temple: false,
          pan_masked: panMasked,
        })
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: { message?: string } } } }
        setError(err.response?.data?.error?.message || 'Failed to save donor')
      } finally { setSaving(false) }
      return
    }
    // No mobile (or offline) — record on the transaction only.
    onChange({ name: f.name.trim(), mobile: f.mobile || undefined, pan_masked: panMasked, verified: false, is_offline: !isOnline })
  }

  // Optional OTP: send, then verify. Verifying marks the donor Verified + linked.
  async function sendOtp() {
    if (!isValidPhone(f.mobile)) { setError('Enter a valid mobile number to verify'); return }
    if (!f.name.trim()) { setError('Name is required'); return }
    setOtpSending(true); setError('')
    try {
      const resp = await api.post('/devotees/register', registerPayload())
      const data = resp.data?.data ?? resp.data
      if (data.already_verified) {
        selectDevotee({ id: data.user_id, name: data.user.name, mobile: data.user.mobile, pan_masked: data.user.pan_masked, city: data.user.city, verified: true, linked_to_this_temple: false })
        return
      }
      setOtpUserId(data.user_id)
      setDevOtp(data.dev_otp || '')
      setOtpOpen(true)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to send OTP')
    } finally { setOtpSending(false) }
  }

  async function verifyOtp() {
    if (otp.length !== 6) { setError('Enter the 6-digit OTP'); return }
    setOtpVerifying(true); setError('')
    try {
      const resp = await api.post('/devotees/verify-otp', { user_id: otpUserId, otp })
      const data = resp.data?.data ?? resp.data
      onChange({
        global_user_id: data.global_user_id, name: f.name.trim(), mobile: f.mobile,
        verified: true, linked_to_this_temple: true,
        // verify-otp returns an already-masked PAN; fall back to a locally-masked
        // one (never the raw entry) if the API didn't echo it.
        pan_masked: data.pan_masked ?? (!f.noPan ? maskPanForDisplay(f.pan) : undefined),
      })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'OTP verification failed')
    } finally { setOtpVerifying(false) }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const fieldLabel = label ?? 'Donor'

  // ── SELECTED: identified donor or offline-name ─────────────────────────────
  if (value && !value.is_anonymous && (value.global_user_id || value.is_offline || value.name)) {
    return (
      <div>
        <label className="form-label">{fieldLabel}{required && ' *'}</label>
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-green-800">{value.name}</span>
              {value.mobile && <span className="text-xs text-green-600">{value.mobile}</span>}
              {value.pan_masked && <span className="text-xs text-green-600 font-mono">PAN {value.pan_masked}</span>}
              {value.verified ? (
                <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600 font-medium">
                  <ShieldCheck size={11} /> Verified
                </span>
              ) : value.is_offline ? (
                <span className="text-xs text-amber-600 font-medium">Offline — links on sync</span>
              ) : (
                <span className="text-xs text-slate-400 font-medium">Unverified</span>
              )}
              {value.linked_to_this_temple && (
                <span className="inline-flex items-center gap-0.5 text-xs text-blue-600 font-medium">
                  <Link2 size={11} /> Donates here
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={clear} aria-label="Clear selection" className="ml-auto text-slate-400 hover:text-red-500 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  // ── SELECTED: anonymous / Daan Peti ────────────────────────────────────────
  if (value?.is_anonymous) {
    const label2 = value.anonymous_category === 'dan_peti' ? 'Daan Peti (Donation Box)' : 'Anonymous / Gupt Daan'
    return (
      <div>
        <label className="form-label">{fieldLabel}{required && ' *'}</label>
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 border border-slate-200 rounded-md">
          <EyeOff size={14} className="text-slate-400 flex-shrink-0" />
          <span className="text-sm font-medium text-slate-600">{label2}</span>
          <span className="text-xs text-slate-400">— not 80G eligible</span>
          <button type="button" onClick={clear} aria-label="Clear selection" className="ml-auto text-slate-400 hover:text-red-500 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  // ── ADD-NEW FORM (one inline form; OTP is optional) ────────────────────────
  if (mode === 'add') {
    const isIndia = !f.country || f.country === 'India'
    return (
      <div>
        <label className="form-label">{fieldLabel}{required && ' *'}</label>
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 space-y-2">
          <p className="text-xs text-blue-700 font-medium">New donor</p>

          <input className="form-input" placeholder="Full name *" value={f.name}
            onChange={e => { setField('name', e.target.value); setError('') }} autoFocus />
          <PhoneInput value={f.mobile} onChange={v => { setField('mobile', v); setError('') }} />

          <div className="grid grid-cols-2 gap-2">
            <input type="email" className="form-input" placeholder="Email (optional)" value={f.email}
              onChange={e => setField('email', e.target.value)} />
            <input className="form-input" placeholder="Gotra (optional)" value={f.gotra}
              onChange={e => setField('gotra', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CountrySelect value={f.country} onChange={c => { setField('country', c); setField('state', ''); setField('city', '') }} />
            {isIndia ? (
              <StateSelect value={f.state} onChange={s => { setField('state', s); setField('city', '') }} />
            ) : (
              <input className="form-input" placeholder="State / Province" value={f.state}
                onChange={e => setField('state', e.target.value)} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {isIndia ? (
              <CitySelect state={f.state} value={f.city} onChange={c => setField('city', c)} />
            ) : (
              <input className="form-input" placeholder="City" value={f.city}
                onChange={e => setField('city', e.target.value)} />
            )}
            <input className="form-input" placeholder={isIndia ? 'Pincode' : 'Postal code'} value={f.pincode}
              maxLength={isIndia ? 6 : 12}
              onChange={e => setField('pincode', isIndia ? e.target.value.replace(/\D/g, '') : e.target.value)} />
          </div>
          <input className="form-input" placeholder="Address (optional)" value={f.address}
            onChange={e => setField('address', e.target.value)} />

          {/* PAN — only needed for 80G */}
          {!f.noPan && (
            <input className="form-input uppercase" placeholder="PAN (needed only for 80G)" value={f.pan}
              onChange={e => setField('pan', e.target.value.toUpperCase())} maxLength={10} />
          )}
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={f.noPan} onChange={e => { setField('noPan', e.target.checked); setField('pan', '') }} />
            Donor doesn&apos;t want to share PAN
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {/* Actions: Save is enough. OTP is a small optional extra. */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button type="button" onClick={saveDonor} disabled={saving} className="btn-primary btn-sm text-xs">
              {saving ? 'Saving…' : 'Save donor'}
            </button>
            <button type="button" onClick={() => { resetAddForm(); setMode('search'); setError('') }} className="btn-secondary btn-sm text-xs">
              Cancel
            </button>
            {isValidPhone(f.mobile) && !otpOpen && (
              <button type="button" onClick={sendOtp} disabled={otpSending}
                className="ml-auto text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 underline underline-offset-2">
                <KeyRound size={11} /> {otpSending ? 'Sending…' : 'Verify by OTP (optional)'}
              </button>
            )}
          </div>

          {/* Inline OTP row — no separate screen */}
          {otpOpen && (
            <div className="border-t border-blue-200 pt-2 mt-1 space-y-2">
              <p className="text-xs text-blue-700">
                OTP sent to <strong>{f.mobile}</strong> — ask the donor to read it out.
                {devOtp && <span className="ml-1 font-bold text-orange-600">[Dev: {devOtp}]</span>}
              </p>
              <div className="flex items-center gap-2">
                <input className="form-input text-base tracking-widest w-32" placeholder="6-digit OTP"
                  value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6} inputMode="numeric" />
                <button type="button" onClick={verifyOtp} disabled={otpVerifying}
                  className="btn-primary btn-sm text-xs flex items-center gap-1">
                  <Check size={12} /> {otpVerifying ? 'Verifying…' : 'Verify'}
                </button>
                <button type="button" onClick={() => { setOtpOpen(false); setOtp('') }} className="text-xs text-slate-500 hover:text-slate-700">
                  Skip
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400">
            Saving is enough to record the donation. OTP just confirms the donor&apos;s mobile —
            they can also verify later from their own login.
          </p>
        </div>
      </div>
    )
  }

  // ── SEARCH (default) ────────────────────────────────────────────────────────
  const showDropdown = dropdownOpen && query.length >= 3
  const mobileLike = /^\d+$/.test(query.replace(/\D/g, '')) && query.replace(/\D/g, '').length >= 5

  return (
    <div>
      <label className="form-label">{fieldLabel}{required && ' *'}</label>
      <div className="space-y-1">
        <div className="relative" ref={dropdownRef}>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="form-input pl-9"
            placeholder="Search by name or mobile — or add a new donor"
            value={query}
            onChange={e => { setQuery(e.target.value); setDropdownOpen(true) }}
            onFocus={() => { if (query.length >= 3) setDropdownOpen(true) }}
          />
          {searching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
          )}

          {showDropdown && (
            <div className="absolute z-30 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
              {results.map(d => (
                <button type="button" key={d.id} onClick={() => selectDevotee(d)}
                  className="w-full flex items-center border-b border-slate-100 last:border-0 hover:bg-slate-50 text-left px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-slate-400 text-xs">{d.mobile}</span>
                    {d.city && <span className="text-slate-400 text-xs">• {d.city}</span>}
                    {d.pan_masked && <span className="text-slate-400 text-xs font-mono">• PAN {d.pan_masked}</span>}
                    {d.verified && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600"><ShieldCheck size={10} /> Verified</span>
                    )}
                    {d.linked_to_this_temple && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-blue-600"><Link2 size={10} /> Donates here</span>
                    )}
                  </div>
                </button>
              ))}

              {searchDone && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">No donor found for &quot;{query}&quot;</div>
              )}

              {searchDone && (
                <button type="button" onClick={openAddForm}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm text-blue-700 border-t border-slate-100 flex items-center gap-2">
                  <UserPlus size={14} /> Add new donor
                </button>
              )}
            </div>
          )}
        </div>

        {/* Add-new + anonymous chips (always available, plain language) */}
        <div className="flex gap-3 flex-wrap items-center pt-0.5">
          <button type="button" onClick={openAddForm}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <UserPlus size={12} /> Add new donor
          </button>
          {showAnonymous && (
            <button type="button" onClick={() => selectAnonymous('gupt_dan')}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <EyeOff size={11} /> Anonymous / Gupt Daan
            </button>
          )}
          {showDanPeti && (
            <button type="button" onClick={() => selectAnonymous('dan_peti')}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <EyeOff size={11} /> Daan Peti (Box)
            </button>
          )}
        </div>

        {!isOnline && (
          <p className="text-xs text-amber-600">Offline — new donors are saved on the receipt and link to the global profile on sync.</p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}
