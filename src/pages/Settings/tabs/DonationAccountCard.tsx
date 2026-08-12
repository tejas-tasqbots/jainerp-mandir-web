import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BadgeCheck, Landmark, Lock, RefreshCw } from 'lucide-react'
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
}

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

  useEffect(() => { load() }, [])

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
