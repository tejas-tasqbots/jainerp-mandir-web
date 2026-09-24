import { useEffect, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Save, Landmark, QrCode, Award } from 'lucide-react'
import { api } from '../../../lib/api'
import { useSensitiveFields, LockedField, VerifiedBanner } from '../../../components/SensitiveFields'

/**
 * Settings → Donor Payments — the bank/UPI details shown to devotees on the
 * devotee portal's "UPI / Bank Transfer" donation flow, plus the master toggle
 * for accepting those donor requests. Approvals happen in Donation Requests.
 */
export function DonorPaymentsTab() {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    accept_donor_requests: true,
    upi_id: '',
  })
  const [reg80g, setReg80g] = useState<string | null>(null)
  const sens = useSensitiveFields()
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = (r.data.data || {}) as Record<string, unknown>
      setForm({
        accept_donor_requests: p.accept_donor_requests !== false,
        upi_id: (p.upi_id as string) || '',
      })
      setReg80g((p.reg_80g_number as string) || null)
    }).catch(() => {})
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const payload: Record<string, unknown> = {
        ...form,
        upi_id: form.upi_id.trim() || null,
      }
      // A verified mandir's locked fields are rejected outright by the API, and
      // it rejects the whole payload — so sending an unchanged locked value
      // alongside an edited free one (accept_donor_requests) would block the
      // save entirely. Drop them; they only move via a change request.
      for (const key of Object.keys(payload)) {
        if (sens.isLocked(key)) delete payload[key]
      }
      await api.patch('/tenants/me', payload)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || t('settings.donorPayments.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 max-w-2xl">
      {success && <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">{t('settings.donorPayments.saved')}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-md px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Landmark size={15} /> {t('settings.donorPayments.heading')}</h3>
        </div>
        <div className="card-body space-y-4">
          <label className="flex items-start gap-3 border rounded-md p-3 cursor-pointer border-slate-200">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.accept_donor_requests}
              onChange={e => setForm(f => ({ ...f, accept_donor_requests: e.target.checked }))}
            />
            <div>
              <p className="font-medium text-sm">{t('settings.donorPayments.acceptRequests')}</p>
              <p className="text-xs text-slate-400">
                <Trans i18nKey="settings.donorPayments.acceptRequestsHelp" components={{ bold: <strong /> }} />
              </p>
            </div>
          </label>
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            <Award size={13} className={reg80g ? 'text-green-600' : 'text-amber-500'} />
            {reg80g
              ? t('settings.donorPayments.reg80gYes', { number: reg80g })
              : t('settings.donorPayments.reg80gNo')}
          </p>
        </div>
      </div>

      {sens.locked && <VerifiedBanner verifiedAt={sens.state?.verified_at ?? null} />}

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><QrCode size={15} /> {t('settings.donorPayments.upiHeading')}</h3></div>
        <div className="card-body space-y-4">
          <div>
            
            {sens.isLocked('upi_id') ? (
              <LockedField label={t('settings.donorPayments.upiId') as string} value={form.upi_id}
                field="upi_id" pending={sens.pendingFor('upi_id')} onRequest={sens.openRequest} />
            ) : (<><label className="form-label" htmlFor="donor-payments-tab-upi-id">{t('settings.donorPayments.upiId')}</label>
            <input id="donor-payments-tab-upi-id" type="text" className="form-input font-mono" placeholder="templename@sbi"
              value={form.upi_id} onChange={e => setForm(f => ({ ...f, upi_id: e.target.value }))} />
            <p className="text-xs text-slate-400 mt-1">{t('settings.donorPayments.upiIdHelp')}</p></>)}
          
          </div>
          {/* No "UPI QR image URL" field. The devotee app draws the QR from the
              UPI id above, client-side, everywhere it shows one. A hosted image
              would be a second place the same payment address lives — and the
              one that silently goes stale when the UPI id changes, pointing
              donors at an account the trust no longer uses. */}
        </div>
      </div>

      {/* No bank-account fields here.
          They used to sit right below the UPI card: the same account number,
          IFSC, holder name and bank the trust had already entered under Bank &
          Cash Accounts, retyped, and locked behind a SECOND approval flow of
          their own (field change requests). So one bank account was captured
          twice and had to be approved twice, by two different mechanisms, and
          the two copies could disagree with nothing to reconcile them.
          The nominated account above is the single source now — it is the row
          the devotee app reads, and the row the platform verifies. */}

      <button type="submit" disabled={saving} className="btn-primary">
        <Save size={15} /> {saving ? t('settings.saving') : t('settings.donorPayments.saveButton')}
      </button>
      {sens.modal}
    </form>
  )
}
