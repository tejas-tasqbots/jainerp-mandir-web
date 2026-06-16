import { useEffect, useState } from 'react'
import { Save, RefreshCw, Image } from 'lucide-react'
import { api } from '../../lib/api'

const TEMPLATES = [
  { id: 'classic', label: 'Classic', desc: 'Navy header, clean white body — professional and formal', icon: 'C', bg: '#0D1B2E', fg: '#fff' },
  { id: 'minimal', label: 'Minimal', desc: 'Clean white with thin borders — understated and modern', icon: 'M', bg: '#fff', fg: '#334155', border: true },
  { id: 'modern', label: 'Modern', desc: 'Gradient header, colored accents — bold and contemporary', icon: 'M', bg: '#1e40af', fg: '#fff' },
  { id: 'traditional', label: 'Traditional', desc: 'Saffron/orange header with Jai Jinendra — temple-appropriate', icon: 'T', bg: '#c2440e', fg: '#fff' },
]

const DOC_TYPES = [
  { key: 'donation_receipt_template', label: 'Donation Receipt' },
  { key: 'room_invoice_template', label: 'Room Invoice' },
  { key: 'hall_invoice_template', label: 'Hall Invoice' },
  { key: 'prasad_receipt_template', label: 'Prasad Receipt' },
  { key: 'seva_receipt_template', label: 'Seva Receipt' },
]

const BLANK = {
  logo_url: '', show_logo_on_receipts: true,
  receipt_template: 'classic',
  donation_receipt_template: '', room_invoice_template: '', hall_invoice_template: '',
  prasad_receipt_template: '', seva_receipt_template: '',
  primary_color: '#0D1B2E', show_gstin_on_header: true, show_80g_on_receipt: true,
  upi_id: '', bank_account_name: '', bank_account_no: '', bank_ifsc: '', bank_name: '',
  custom_receipt_footer: '',
}

export function ReceiptSettings() {
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = r.data.data || {}
      setForm({
        logo_url: p.logo_url || '',
        show_logo_on_receipts: p.show_logo_on_receipts ?? true,
        receipt_template: p.receipt_template || 'classic',
        donation_receipt_template: p.donation_receipt_template || '',
        room_invoice_template: p.room_invoice_template || '',
        hall_invoice_template: p.hall_invoice_template || '',
        prasad_receipt_template: p.prasad_receipt_template || '',
        seva_receipt_template: p.seva_receipt_template || '',
        primary_color: p.primary_color || '#0D1B2E',
        show_gstin_on_header: p.show_gstin_on_header ?? true,
        show_80g_on_receipt: p.show_80g_on_receipt ?? true,
        upi_id: p.upi_id || '',
        bank_account_name: p.bank_account_name || '',
        bank_account_no: p.bank_account_no || '',
        bank_ifsc: p.bank_ifsc || '',
        bank_name: p.bank_name || '',
        custom_receipt_footer: p.custom_receipt_footer || '',
      })
    }).catch(() => {})
  }, [])

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.patch('/tenants/me', form)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-5">
      <h1 className="text-xl font-bold text-navy-900">Receipt & Invoice Templates</h1>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">Settings saved!</div>
      )}

      {/* Temple Logo */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Temple Logo</h3></div>
        <div className="card-body space-y-3">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center bg-slate-50 flex-shrink-0">
              {form.logo_url
                ? <img src={form.logo_url} alt="Temple logo" className="w-full h-full object-contain rounded-lg p-1" />
                : <Image size={24} className="text-slate-300" />
              }
            </div>
            <div className="flex-1 space-y-1">
              <label className="form-label">Logo URL</label>
              <input
                className="form-input"
                placeholder="https://yourdomain.com/logo.png"
                value={form.logo_url}
                onChange={e => set('logo_url', e.target.value)}
              />
              <p className="text-xs text-slate-400">Paste a direct link to your temple logo (PNG or JPG recommended)</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_logo_on_receipts}
              onChange={e => set('show_logo_on_receipts', e.target.checked)} />
            Show logo on receipts
          </label>
        </div>
      </div>

      {/* Default Template */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Default Template</h3></div>
        <div className="card-body">
          <div className="grid grid-cols-2 gap-3">
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => set('receipt_template', t.id)}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-colors ${
                  form.receipt_template === t.id
                    ? 'border-navy-900 bg-slate-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div
                  className="w-10 h-10 rounded flex items-center justify-center text-base font-bold flex-shrink-0"
                  style={{
                    backgroundColor: t.bg,
                    color: t.fg,
                    border: t.border ? '1px solid #e2e8f0' : 'none',
                  }}
                >
                  {t.icon}
                </div>
                <div>
                  <div className="font-semibold text-sm text-navy-900">{t.label}</div>
                  <div className="text-xs text-slate-400 leading-snug mt-0.5">{t.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Per-Document Templates */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm">Per-Document Templates</h3>
          <p className="text-xs text-slate-400 mt-0.5">Override the default for specific document types</p>
        </div>
        <div className="card-body space-y-3">
          {DOC_TYPES.map(d => (
            <div key={d.key} className="flex items-center justify-between gap-4">
              <label className="text-sm text-slate-700">{d.label}</label>
              <select
                className="form-select w-44"
                value={(form as any)[d.key]}
                onChange={e => set(d.key, e.target.value)}
              >
                <option value="">Same as default</option>
                {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Colour & Visibility */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Colour & Visibility</h3></div>
        <div className="card-body space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-700">Primary Colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.primary_color}
                onChange={e => set('primary_color', e.target.value)}
                className="w-10 h-8 rounded border border-slate-200 cursor-pointer p-0.5"
              />
              <input
                type="text"
                className="form-input w-28 font-mono text-sm uppercase"
                value={form.primary_color}
                onChange={e => set('primary_color', e.target.value)}
                maxLength={7}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_gstin_on_header}
              onChange={e => set('show_gstin_on_header', e.target.checked)} />
            Show GSTIN on header
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_80g_on_receipt}
              onChange={e => set('show_80g_on_receipt', e.target.checked)} />
            Show 80G eligibility block on donation receipts
          </label>
        </div>
      </div>

      {/* Payment Details */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Payment Details (shown on receipts)</h3></div>
        <div className="card-body space-y-4">
          <div>
            <label className="form-label">UPI ID</label>
            <input className="form-input" placeholder="temple@upi" value={form.upi_id} onChange={e => set('upi_id', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Bank Account Holder Name</label>
            <input className="form-input" value={form.bank_account_name} onChange={e => set('bank_account_name', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="form-label">Bank Name</label>
              <input className="form-input" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Account No.</label>
              <input className="form-input" value={form.bank_account_no} onChange={e => set('bank_account_no', e.target.value)} />
            </div>
            <div>
              <label className="form-label">IFSC</label>
              <input className="form-input uppercase" value={form.bank_ifsc} onChange={e => set('bank_ifsc', e.target.value.toUpperCase())} />
            </div>
          </div>
        </div>
      </div>

      {/* Receipt Footer */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Receipt Footer</h3></div>
        <div className="card-body">
          <textarea
            className="form-textarea"
            rows={3}
            placeholder="This is a computer-generated document. No physical signature required."
            value={form.custom_receipt_footer}
            onChange={e => set('custom_receipt_footer', e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? 'Saving...' : 'Save Template Settings'}
        </button>
      </div>
    </form>
  )
}
