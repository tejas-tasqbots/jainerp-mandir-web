import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BadgeCheck, FileImage, Landmark, Lock, RefreshCw, Upload } from 'lucide-react'
import { api, apiErrorMessage } from '../../../lib/api'

/**
 * "Which account do devotees pay into?" — and whether the platform has checked it.
 *
 * This exists because the answer used to be four bank fields typed into the
 * temple profile, unrelated to the accounts receipts post against, shown to any
 * devotee the moment donations-from-devotees was switched on. Nobody verified
 * them. A donor could be given, and pay into, digits no human had ever read.
 *
 * The three states a trust can be in are each shown differently on purpose:
 *
 *   nothing nominated  → pick an account. Devotees see no bank option at all.
 *   nominated, pending → "we are checking this", and still no bank option.
 *   verified           → live, and LOCKED. Changing where donor money lands is
 *                        not a self-service edit.
 *
 * The fourth state is the one worth building for: verified, then the account
 * was edited. The server drops it back to unverified automatically, and this
 * says so plainly — "you changed it, donors can no longer see it" is
 * actionable, whereas silently reading "not verified" looks like the approval
 * was lost and invites a support ticket.
 */

interface Account {
  id: string
  name: string
  type: string
  account_no: string | null
  bank_name: string | null
  ifsc: string | null
  is_active: boolean
}

interface DonationAccount {
  id: string
  name: string
  account_no: string | null
  bank_name: string | null
  ifsc: string | null
  is_verified: boolean
  verified_at: string | null
  changed_since_verification: boolean
  verify_note: string | null
  has_proof: boolean
  proof_kind: string | null
  proof_name: string | null
  proof_uploaded_at: string | null
}

/** Matches the server's list. A PDF is deliberately not accepted. */
const PROOF_ACCEPT = 'image/jpeg,image/png'
const PROOF_MAX_BYTES = 4 * 1024 * 1024

export function DonationAccountCard({ accounts, onChanged }: {
  accounts: Account[]
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState<DonationAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [choice, setChoice] = useState('')
  const [uploading, setUploading] = useState(false)
  const [proofKind, setProofKind] = useState('passbook')
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  /**
   * Show the document already on file.
   *
   * Fetched on demand rather than with the account row: a trust opening
   * Settings should not pull a few hundred KB of base64 it may never look at,
   * and the same shape is used by the platform's review queue where that cost
   * would be paid once per trust in the list.
   */
  async function showProof() {
    if (preview) { setPreview(null); return }
    try {
      const { data } = await api.get('/tenants/me/donation-account/proof')
      const p = data.data
      setPreview(`data:${p.mime};base64,${p.data}`)
    } catch (e) {
      setError(apiErrorMessage(e, t('settings.donationAccount.proofLoadFailed', { defaultValue: 'Could not open the uploaded file.' })))
    }
  }

  async function uploadProof(file: File) {
    setError('')
    if (!PROOF_ACCEPT.split(',').includes(file.type)) {
      setError(t('settings.donationAccount.proofType', { defaultValue: 'Please choose a JPG or PNG photo.' }))
      return
    }
    // Checked here as well as on the server so the trust is told before they
    // spend a minute uploading over a temple's connection, not after.
    if (file.size > PROOF_MAX_BYTES) {
      setError(t('settings.donationAccount.proofSize', {
        defaultValue: 'That image is {{size}} MB. Please choose one under 4 MB.',
        size: (file.size / 1024 / 1024).toFixed(1),
      }))
      return
    }
    setUploading(true)
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
      const { data } = await api.post('/tenants/me/donation-account/proof', {
        // The server strips the prefix itself, but sending the bare payload
        // keeps the request smaller and the stored value unambiguous.
        data: dataUrl.replace(/^data:[^;]+;base64,/, ''),
        mime: file.type,
        name: file.name,
        kind: proofKind,
      })
      setCurrent(data.data ?? null)
      setPreview(dataUrl)
      onChanged?.()
    } catch (e) {
      setError(apiErrorMessage(e, t('settings.donationAccount.proofFailed', { defaultValue: 'Could not upload that file.' })))
    } finally {
      setUploading(false)
    }
  }

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/tenants/me/donation-account')
      setCurrent(data.data ?? null)
      setChoice(data.data?.id ?? '')
    } catch {
      setCurrent(null)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!choice) return
    setSaving(true); setError('')
    try {
      const { data } = await api.patch('/tenants/me/donation-account', { account_id: choice })
      setCurrent(data.data ?? null)
      onChanged?.()
    } catch (e) {
      // The server's message carries the reason — only a bank account, digits
      // required, or locked because it is verified. Each is actionable, so show
      // it rather than a generic failure.
      setError(apiErrorMessage(e, t('settings.donationAccount.saveFailed', { defaultValue: 'Could not save. Please try again.' })))
    } finally {
      setSaving(false)
    }
  }

  // Only a bank account with digits can receive a transfer; offering the rest
  // would produce payment details no donor can act on, and the server refuses
  // them anyway.
  const eligible = accounts.filter(
    a => a.type === 'bank' && a.is_active && (a.account_no ?? '').trim() && (a.ifsc ?? '').trim(),
  )
  const locked = !!current?.is_verified

  if (loading) {
    return (
      <div className="card p-6 flex items-center gap-2 text-sm text-slate-400">
        <RefreshCw size={14} className="animate-spin" /> {t('common.loading', { defaultValue: 'Loading…' })}
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Landmark size={15} className="text-slate-400" />
        <h3 className="font-semibold text-sm text-navy-900">
          {t('settings.donationAccount.title', { defaultValue: 'Account devotees pay into' })}
        </h3>
        {locked && (
          <span className="badge-green ml-auto inline-flex items-center gap-1">
            <BadgeCheck size={12} /> {t('settings.donationAccount.verified', { defaultValue: 'Verified' })}
          </span>
        )}
      </div>

      <div className="card-body space-y-4">
        <p className="text-sm text-slate-500">
          {t('settings.donationAccount.intro', {
            defaultValue:
              'Devotees are shown these details in the devotee app, so JainERP verifies them first. Until then no bank transfer option appears.',
          })}
        </p>

        {/* Approved, then edited. The server has already stopped showing it. */}
        {current?.changed_since_verification && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">
                {t('settings.donationAccount.changedTitle', { defaultValue: 'These details changed after they were verified' })}
              </p>
              <p className="mt-0.5">
                {t('settings.donationAccount.changedBody', {
                  defaultValue:
                    'Devotees are not being shown this account. We will re-check it — no action needed from you unless we get in touch.',
                })}
              </p>
            </div>
          </div>
        )}

        {current && !current.is_verified && !current.changed_since_verification && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            {t('settings.donationAccount.pending', {
              defaultValue: 'Waiting for JainERP to verify this account. Devotees cannot see it yet.',
            })}
            {current.verify_note && (
              <p className="mt-2 text-amber-800">
                <strong>{t('settings.donationAccount.noteFromUs', { defaultValue: 'Note from JainERP' })}:</strong>{' '}
                {current.verify_note}
              </p>
            )}
          </div>
        )}

        {eligible.length === 0 ? (
          <p className="text-sm text-slate-500">
            {t('settings.donationAccount.noEligible', {
              defaultValue:
                'Add a bank account above with its account number and IFSC, then choose it here.',
            })}
          </p>
        ) : (
          <div className="space-y-2">
            {eligible.map(a => (
              <label
                key={a.id}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  choice === a.id ? 'border-brand-red bg-red-50/40' : 'border-slate-200'
                } ${locked ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50'}`}
              >
                <input
                  type="radio"
                  name="donation-account"
                  disabled={locked}
                  checked={choice === a.id}
                  onChange={() => setChoice(a.id)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">{a.name}</span>
                  <span className="block text-xs text-slate-500">
                    {[a.bank_name, a.account_no, a.ifsc].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        {/* ── proof of the account ──────────────────────────────────────────
            Only once an account is nominated: asking for a passbook page
            before there is an account for it to evidence has nothing to
            attach it to, and the server refuses it for that reason. */}
        {current && (
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <FileImage size={15} className="text-slate-400" />
              <h4 className="text-sm font-semibold text-slate-800">
                {t('settings.donationAccount.proofTitle', { defaultValue: 'Proof this account belongs to the trust' })}
              </h4>
              {current.has_proof && (
                <span className="badge-green ml-auto inline-flex items-center gap-1">
                  <BadgeCheck size={12} /> {t('settings.donationAccount.proofOnFile', { defaultValue: 'Uploaded' })}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">
              {t('settings.donationAccount.proofHelp', {
                defaultValue:
                  'Photograph the first page of the passbook — the page showing the account holder name, account number and IFSC together. A statement first page or a cancelled cheque works too. We check the details above against it before devotees are shown anything.',
              })}
            </p>

            {!locked && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="form-input w-auto text-sm"
                  value={proofKind}
                  onChange={e => setProofKind(e.target.value)}
                >
                  <option value="passbook">{t('settings.donationAccount.proofPassbook', { defaultValue: 'Passbook first page' })}</option>
                  <option value="statement">{t('settings.donationAccount.proofStatement', { defaultValue: 'Statement first page' })}</option>
                  <option value="cheque">{t('settings.donationAccount.proofCheque', { defaultValue: 'Cancelled cheque' })}</option>
                </select>
                <label className={`btn-secondary cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
                  {uploading ? <RefreshCw size={15} className="animate-spin" /> : <Upload size={15} />}
                  {current.has_proof
                    ? t('settings.donationAccount.proofReplace', { defaultValue: 'Replace photo' })
                    : t('settings.donationAccount.proofUpload', { defaultValue: 'Upload photo' })}
                  <input
                    type="file"
                    accept={PROOF_ACCEPT}
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      // Reset the input so re-picking the same file after a
                      // failed upload still fires a change event.
                      e.target.value = ''
                      if (f) void uploadProof(f)
                    }}
                  />
                </label>
                {current.has_proof && (
                  <button type="button" className="btn-ghost text-sm" onClick={showProof}>
                    {preview
                      ? t('settings.donationAccount.proofHide', { defaultValue: 'Hide' })
                      : t('settings.donationAccount.proofView', { defaultValue: 'View uploaded photo' })}
                  </button>
                )}
              </div>
            )}

            {!current.has_proof && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t('settings.donationAccount.proofMissing', {
                  defaultValue:
                    'We cannot verify the account until this is uploaded — this is what is holding up your bank transfer option.',
                })}
              </p>
            )}

            {preview && (
              <img
                src={preview}
                alt={t('settings.donationAccount.proofTitle', { defaultValue: 'Proof this account belongs to the trust' }) as string}
                className="max-h-80 rounded-lg border border-slate-200"
              />
            )}
          </div>
        )}

        {error && <p className="text-sm text-brand-red">{error}</p>}

        {locked ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-start gap-2 text-sm text-slate-600">
            <Lock size={14} className="mt-0.5 shrink-0 text-slate-400" />
            <span>
              {t('settings.donationAccount.lockedBody', {
                defaultValue:
                  'This account is verified and live, so it cannot be changed here. Contact JainERP support to move donations to a different account — we verify the new one before anything changes for donors.',
              })}
            </span>
          </div>
        ) : (
          <button
            onClick={save}
            disabled={saving || !choice || choice === current?.id}
            className="btn-primary"
          >
            {saving && <RefreshCw size={15} className="animate-spin" />}
            {t('settings.donationAccount.save', { defaultValue: 'Use this account for donations' })}
          </button>
        )}
      </div>
    </div>
  )
}
