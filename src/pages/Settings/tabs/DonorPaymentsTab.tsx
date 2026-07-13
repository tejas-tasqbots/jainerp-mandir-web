import { useEffect, useState } from 'react'
import { Save, Landmark, QrCode, Award } from 'lucide-react'
import { api } from '../../../lib/api'

/**
 * Settings → Donor Payments — the bank/UPI details shown to devotees on the
 * devotee portal's "UPI / Bank Transfer" donation flow, plus the master toggle
 * for accepting those donor requests. Approvals happen in Donation Requests.
 */
export function DonorPaymentsTab() {
  const [form, setForm] = useState({
    accept_donor_requests: true,
    upi_id: '',
    upi_qr_cdn_url: '',
    bank_account_name: '',
    bank_account_no: '',
    bank_ifsc: '',
    bank_name: '',
  })
  const [reg80g, setReg80g] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = (r.data.data || {}) as Record<string, unknown>
      setForm({
        accept_donor_requests: p.accept_donor_requests !== false,
        upi_id: (p.upi_id as string) || '',
        upi_qr_cdn_url: (p.upi_qr_cdn_url as string) || '',
        bank_account_name: (p.bank_account_name as string) || '',
        bank_account_no: (p.bank_account_no as string) || '',
        bank_ifsc: (p.bank_ifsc as string) || '',
        bank_name: (p.bank_name as string) || '',
      })
      setReg80g((p.reg_80g_number as string) || null)
    }).catch(() => {})
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await api.patch('/tenants/me', {
        ...form,
        upi_id: form.upi_id.trim() || null,
        upi_qr_cdn_url: form.upi_qr_cdn_url.trim() || null,
        bank_account_name: form.bank_account_name.trim() || null,
        bank_account_no: form.bank_account_no.trim() || null,
        bank_ifsc: form.bank_ifsc.trim().toUpperCase() || null,
        bank_name: form.bank_name.trim() || null,
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 max-w-2xl">
      {success && <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">Donor payment details saved!</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-md px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Landmark size={15} /> Direct donations from devotees</h3>
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
              <p className="font-medium text-sm">Accept UPI / bank-transfer donation requests</p>
              <p className="text-xs text-slate-400">
                Devotees on the devotee portal see the details below, pay you directly, and submit the
                transaction reference + screenshot. You verify and approve each one in
                <strong> Donation Requests</strong> — only then is the receipt issued.
              </p>
            </div>
          </label>
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            <Award size={13} className={reg80g ? 'text-green-600' : 'text-amber-500'} />
            {reg80g
              ? <>80G registered (<span className="font-mono">{reg80g}</span>) — devotees can claim 80G on these donations.</>
              : <>No 80G registration on Temple Profile — devotees won't be offered 80G on donations here.</>}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><QrCode size={15} /> UPI</h3></div>
        <div className="card-body space-y-4">
          <div>
            <label className="form-label">UPI ID (VPA)</label>
            <input type="text" className="form-input font-mono" placeholder="templename@sbi"
              value={form.upi_id} onChange={e => setForm(f => ({ ...f, upi_id: e.target.value }))} />
            <p className="text-xs text-slate-400 mt-1">The devotee app also generates a scannable UPI QR from this ID automatically.</p>
          </div>
          <div>
            <label className="form-label">UPI QR image URL (optional)</label>
            <input type="url" className="form-input" placeholder="https://…/upi-qr.png"
              value={form.upi_qr_cdn_url} onChange={e => setForm(f => ({ ...f, upi_qr_cdn_url: e.target.value }))} />
            <p className="text-xs text-slate-400 mt-1">If your bank issued a QR poster, host it and paste the image URL — it is shown instead of the generated QR.</p>
            {form.upi_qr_cdn_url.trim() && (
              <img src={form.upi_qr_cdn_url.trim()} alt="UPI QR preview" className="mt-2 w-32 h-32 object-contain rounded-md border border-slate-200 bg-white" />
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Bank account (shown for NEFT / RTGS / IMPS)</h3></div>
        <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Account holder name</label>
            <input type="text" className="form-input" placeholder="Shree … Trust"
              value={form.bank_account_name} onChange={e => setForm(f => ({ ...f, bank_account_name: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Account number</label>
            <input type="text" className="form-input font-mono" maxLength={20}
              value={form.bank_account_no} onChange={e => setForm(f => ({ ...f, bank_account_no: e.target.value.replace(/\D/g, '') }))} />
          </div>
          <div>
            <label className="form-label">IFSC</label>
            <input type="text" className="form-input font-mono uppercase" maxLength={11} placeholder="SBIN0001234"
              value={form.bank_ifsc} onChange={e => setForm(f => ({ ...f, bank_ifsc: e.target.value.toUpperCase() }))} />
          </div>
          <div>
            <label className="form-label">Bank name</label>
            <input type="text" className="form-input" placeholder="State Bank of India"
              value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} />
          </div>
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary">
        <Save size={15} /> {saving ? 'Saving…' : 'Save Donor Payments'}
      </button>
    </form>
  )
}
