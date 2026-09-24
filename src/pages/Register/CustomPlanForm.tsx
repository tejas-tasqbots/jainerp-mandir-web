import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { isValidPhone, PhoneInput } from '../../components/PhoneInput'
import { apiError, Catalogue, onboarding } from '../../lib/onboardingApi'

/**
 * The Custom plan path.
 *
 * Deliberately NOT a checkout. A trust that runs five mandirs, or needs
 * separate databases per trust, or wants an integration, cannot be priced by a
 * form — so this collects the requirement, stores it as a lead the super-admin
 * console works through, and tells the customer the team will call. Nothing is
 * activated until the commercial process finishes.
 */
export function CustomPlanForm({
  catalogue,
  planLabel,
  prefill,
  registrationId,
  onClose,
  onSubmitted,
}: {
  catalogue: Catalogue | null
  planLabel: string
  prefill: {
    trust_name: string
    contact_name: string
    mobile: string
    email: string
    city: string
    state: string
  }
  registrationId: string | null
  onClose: () => void
  onSubmitted: (reference: string) => void
}) {
  const [f, setF] = useState({
    trust_name: prefill.trust_name,
    contact_name: prefill.contact_name,
    mobile: prefill.mobile,
    email: prefill.email,
    city: prefill.city,
    state: prefill.state,
    num_mandirs: '',
    num_trusts: '',
    num_users: '',
    needs_separate_dbs: false,
    expected_scale: '',
    integrations: '',
    special_requirements: '',
    notes: '',
  })
  const [modules, setModules] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)

  // Only optional modules are selectable — the core ledger is in every plan, so
  // offering it as a choice would imply it could be left out.
  const selectable = (catalogue?.modules ?? []).filter((m) => !m.is_core)

  const set = (k: keyof typeof f) => (v: string | boolean) => {
    setF((prev) => ({ ...prev, [k]: v }))
    setError('')
  }

  function toggle(key: string) {
    setModules((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]))
  }

  const num = (v: string) => {
    const n = Number(v)
    return v.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
  }

  async function submit() {
    if (!f.trust_name.trim()) return setError('Enter your Trust/Temple name')
    if (!f.contact_name.trim()) return setError('Enter a contact name')
    if (!isValidPhone(f.mobile)) return setError('Enter a valid mobile number')

    setLoading(true)
    setError('')
    try {
      const res = await onboarding.customRequest({
        trust_name: f.trust_name.trim(),
        contact_name: f.contact_name.trim(),
        mobile: f.mobile,
        email: f.email.trim() || undefined,
        city: f.city.trim() || undefined,
        state: f.state.trim() || undefined,
        modules,
        num_mandirs: num(f.num_mandirs),
        num_trusts: num(f.num_trusts),
        num_users: num(f.num_users),
        needs_separate_dbs: f.needs_separate_dbs,
        expected_scale: f.expected_scale.trim() || undefined,
        integrations: f.integrations.trim() || undefined,
        special_requirements: f.special_requirements.trim() || undefined,
        notes: f.notes.trim() || undefined,
        registration_id: registrationId ?? undefined,
        source: 'website',
      })
      setDone(res.reference)
    } catch (e) {
      setError(apiError(e, 'Could not submit your requirements. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-navy-900">{planLabel} plan — tell us what you need</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <Check size={26} className="text-green-700" />
            </div>
            <h3 className="text-lg font-bold text-navy-900">Thank you — we have your requirements</h3>
            <p className="text-sm text-slate-600 mt-2">
              The JainERP team will contact you shortly to discuss and price them.
            </p>
            <p className="text-xs text-slate-400 mt-3">Reference: {done}</p>
            <button onClick={() => onSubmitted(done)} className="btn-primary mt-6">Done</button>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-5">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="form-label" htmlFor="custom-plan-form-trust-name">Trust/Temple Name <span className="text-brand-red">*</span></label>
                  <input id="custom-plan-form-trust-name" className="form-input" value={f.trust_name} onChange={(e) => set('trust_name')(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor="custom-plan-form-contact-name">Contact person <span className="text-brand-red">*</span></label>
                  <input id="custom-plan-form-contact-name" className="form-input" value={f.contact_name} onChange={(e) => set('contact_name')(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Mobile <span className="text-brand-red">*</span></label>
                  <PhoneInput value={f.mobile} onChange={set('mobile') as (v: string) => void} />
                </div>
                <div>
                  <label className="form-label" htmlFor="custom-plan-form-email">Email</label>
                  <input id="custom-plan-form-email" className="form-input" type="email" value={f.email} onChange={(e) => set('email')(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label" htmlFor="custom-plan-form-city">City</label>
                    <input id="custom-plan-form-city" className="form-input" value={f.city} onChange={(e) => set('city')(e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="custom-plan-form-state">State</label>
                    <input id="custom-plan-form-state" className="form-input" value={f.state} onChange={(e) => set('state')(e.target.value)} />
                  </div>
                </div>
              </div>

              <div>
                <label className="form-label">Scale</label>
                <div className="grid grid-cols-3 gap-3">
                  <input
                    className="form-input" placeholder="Mandirs" inputMode="numeric"
                    value={f.num_mandirs} onChange={(e) => set('num_mandirs')(e.target.value)}
                  />
                  <input
                    className="form-input" placeholder="Trusts" inputMode="numeric"
                    value={f.num_trusts} onChange={(e) => set('num_trusts')(e.target.value)}
                  />
                  <input
                    className="form-input" placeholder="Users" inputMode="numeric"
                    value={f.num_users} onChange={(e) => set('num_users')(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 mt-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={f.needs_separate_dbs}
                    onChange={(e) => set('needs_separate_dbs')(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  We manage multiple Trusts/Temples and need separate databases
                </label>
              </div>

              <div>
                <label className="form-label">Modules you need</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {selectable.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => toggle(m.key)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        modules.includes(m.key)
                          ? 'bg-brand-red text-white border-brand-red'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {m.display_name}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Donations, donors, accounting, reports and settings are included in every plan.
                </p>
              </div>

              <div className="grid gap-4">
                <div>
                  <label className="form-label" htmlFor="custom-plan-form-integrations">Integrations you need</label>
                  <input id="custom-plan-form-integrations"
                    className="form-input" placeholder="Tally, bank statements, an existing website…"
                    value={f.integrations} onChange={(e) => set('integrations')(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="custom-plan-form-special-requirements">Special requirements</label>
                  <textarea id="custom-plan-form-special-requirements"
                    className="form-input" rows={3}
                    placeholder="e.g. We have 5 Mandirs and require a centralized system with consolidated reporting."
                    value={f.special_requirements} onChange={(e) => set('special_requirements')(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="custom-plan-form-notes">Anything else</label>
                  <textarea id="custom-plan-form-notes"
                    className="form-input" rows={2}
                    value={f.notes} onChange={(e) => set('notes')(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={submit} disabled={loading} className="btn-primary">
                {loading && <Loader2 size={15} className="animate-spin" />}
                {loading ? 'Submitting…' : 'Submit requirements'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
