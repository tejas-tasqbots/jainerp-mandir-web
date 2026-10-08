import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTrustHas80g } from '../../store/profileStore'
import { Search, X, UserPlus, Link2, EyeOff, KeyRound, Check } from 'lucide-react'
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
  /** No label of its own: the page's section heading already names it. */
  hideLabel?: boolean
  /** Who is being picked, for "Add new …" and "No … found": a room guest is
   *  not a donor. */
  noun?: 'donor' | 'guest'
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
  hideLabel = false,
  noun = 'donor',
}: DevoteePickerProps) {
  const { t } = useTranslation()
  const has80g = useTrustHas80g()
  const guest = noun === 'guest'
  const addNewLabel = guest ? t('ui.addNewGuest') : t('ui.addNewDonor')
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
    if (!f.name.trim()) { setError(t('msg.nameRequired')); return }
    if (f.mobile && !isValidPhone(f.mobile)) { setError(t('msg.validMobile')); return }
    // Store the MASKED PAN on the selection — the raw PAN goes to the API in the
    // register/donation payload but must never be surfaced back in the UI chip.
    const panMasked = (!f.noPan) ? maskPanForDisplay(f.pan) : undefined

    if (isOnline && f.mobile) {
      setSaving(true); setError('')
      try {
        // Plain save must never message the devotee — OTP only via the explicit
        // "Verify by OTP" button below.
        const resp = await api.post('/devotees/register', { ...registerPayload(), send_otp: false })
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
    if (!isValidPhone(f.mobile)) { setError(t('msg.validMobileToVerify')); return }
    if (!f.name.trim()) { setError(t('msg.nameRequired')); return }
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
    if (otp.length !== 6) { setError(t('msg.enterOtp')); return }
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
        {!hideLabel && <label className="form-label">{fieldLabel}{required && ' *'}</label>}
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-green-800">{value.name}</span>
              {value.mobile && <span className="text-xs text-green-600">{value.mobile}</span>}
              {value.pan_masked && <span className="text-xs text-green-600 font-mono">PAN {value.pan_masked}</span>}
              {/* Verified/Unverified badges deliberately not shown at donor
                  selection — the counter doesn't act on them and they read as
                  a judgement on the donor. Verification itself still happens
                  (OTP is still required for 80G); only the label is hidden.
                  "Offline" is kept: it's a sync state the cashier must act on. */}
              {value.is_offline && (
                <span className="text-xs text-amber-600 font-medium">{t('ui.offlineLinksOnSync')}</span>
              )}
              {value.linked_to_this_temple && (
                <span className="inline-flex items-center gap-0.5 text-xs text-blue-600 font-medium">
                  <Link2 size={11} />{t('ui.donatesHere')}</span>
              )}
            </div>
          </div>
          <button type="button" onClick={clear} aria-label={t('ui.clearSelection')} className="ml-auto text-slate-400 hover:text-red-500 flex-shrink-0">
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
        {!hideLabel && <label className="form-label">{fieldLabel}{required && ' *'}</label>}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 border border-slate-200 rounded-md">
          <EyeOff size={14} className="text-slate-400 flex-shrink-0" />
          <span className="text-sm font-medium text-slate-600">{label2}</span>
          {has80g && <span className="text-xs text-slate-400">— not 80G eligible</span>}
          <button type="button" onClick={clear} aria-label={t('ui.clearSelection')} className="ml-auto text-slate-400 hover:text-red-500 flex-shrink-0">
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
        {!hideLabel && <label className="form-label">{fieldLabel}{required && ' *'}</label>}
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 space-y-2">
          <p className="text-xs text-blue-700 font-medium">{t('ui.newDonor')}</p>

          <input className="form-input" placeholder={t('ui.fullNameReq')} value={f.name}
            onChange={e => { setField('name', e.target.value); setError('') }} autoFocus />
          <PhoneInput value={f.mobile} onChange={v => { setField('mobile', v); setError('') }} />

          <div className="grid grid-cols-2 gap-2">
            <input type="email" className="form-input" placeholder={t('ui.emailOpt')} value={f.email}
              onChange={e => setField('email', e.target.value)} />
            <input className="form-input" placeholder={t('ui.gotraOpt')} value={f.gotra}
              onChange={e => setField('gotra', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CountrySelect value={f.country} onChange={c => { setField('country', c); setField('state', ''); setField('city', '') }} />
            {isIndia ? (
              <StateSelect value={f.state} onChange={s => { setField('state', s); setField('city', '') }} />
            ) : (
              <input className="form-input" placeholder={t('ui.stateProvince')} value={f.state}
                onChange={e => setField('state', e.target.value)} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {isIndia ? (
              <CitySelect state={f.state} value={f.city} onChange={c => setField('city', c)} />
            ) : (
              <input className="form-input" placeholder={t('ui.city')} value={f.city}
                onChange={e => setField('city', e.target.value)} />
            )}
            <input className="form-input" placeholder={isIndia ? 'Pincode' : 'Postal code'} value={f.pincode}
              maxLength={isIndia ? 6 : 12}
              onChange={e => setField('pincode', isIndia ? e.target.value.replace(/\D/g, '') : e.target.value)} />
          </div>
          <input className="form-input" placeholder={t('ui.addressOpt')} value={f.address}
            onChange={e => setField('address', e.target.value)} />

          {/* PAN — only needed for 80G, so not asked at a trust without it. */}
          {has80g && !f.noPan && (
            <input className="form-input uppercase" placeholder={t('ui.panFor80g')} value={f.pan}
              onChange={e => setField('pan', e.target.value.toUpperCase())} maxLength={10} />
          )}
          {has80g && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={f.noPan} onChange={e => { setField('noPan', e.target.checked); setField('pan', '') }} />{t('ui.noPanShare')}</label>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          {/* Actions: Save is enough. OTP is a small optional extra. */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button type="button" onClick={saveDonor} disabled={saving} className="btn-primary btn-sm text-xs">
              {saving ? 'Saving…' : 'Save donor'}
            </button>
            <button type="button" onClick={() => { resetAddForm(); setMode('search'); setError('') }} className="btn-secondary btn-sm text-xs">{t('ui.cancel')}</button>
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
              <p className="text-xs text-blue-700">{t('ui.otpSentTo')}<strong>{f.mobile}</strong> — ask the donor to read it out.
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

  return (
    <div>
      {!hideLabel && <label className="form-label">{fieldLabel}{required && ' *'}</label>}
      <div className="space-y-1">
        <div className="relative" ref={dropdownRef}>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="form-input pl-9"
            placeholder={guest ? t('ui.searchOrAddGuest') : t('ui.searchOrAdd')}
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
                    {/* No Verified badge here either — see the selection chip above. */}
                    {d.linked_to_this_temple && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-blue-600"><Link2 size={10} />{t('ui.donatesHere')}</span>
                    )}
                  </div>
                </button>
              ))}

              {searchDone && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">{t(guest ? 'ui.noGuestFound' : 'ui.noDonorFound', { query })}</div>
              )}

              {searchDone && (
                <button type="button" onClick={openAddForm}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm text-blue-700 border-t border-slate-100 flex items-center gap-2">
                  <UserPlus size={14} />{addNewLabel}</button>
              )}
            </div>
          )}
        </div>

        {/* Add-new + anonymous chips (always available, plain language) */}
        <div className="flex gap-3 flex-wrap items-center pt-0.5">
          <button type="button" onClick={openAddForm}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <UserPlus size={12} />{addNewLabel}</button>
          {showAnonymous && (
            <button type="button" onClick={() => selectAnonymous('gupt_dan')}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <EyeOff size={11} />{t('ui.anonymousGupt')}</button>
          )}
          {showDanPeti && (
            <button type="button" onClick={() => selectAnonymous('dan_peti')}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <EyeOff size={11} />{t('ui.daanPeti')}</button>
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
