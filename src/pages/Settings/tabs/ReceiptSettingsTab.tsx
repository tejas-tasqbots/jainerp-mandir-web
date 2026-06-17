import { useEffect, useState } from 'react'
import { Save, RefreshCw } from 'lucide-react'
import { api } from '../../../lib/api'

const TEMPLATES = [
  { id: 'classic', label: 'Classic', desc: 'Navy header, clean white body' },
  { id: 'minimal', label: 'Minimal', desc: 'White with thin borders' },
  { id: 'modern', label: 'Modern', desc: 'Bold gradient header, accents' },
  { id: 'traditional', label: 'Traditional', desc: 'Saffron header, temple style' },
]

const BLANK = {
  logo_cdn_url: '', show_logo_on_receipts: true,
  receipt_template: 'classic', primary_color: '#0D1B2E',
  show_gstin_on_header: true, show_80g_on_receipt: true,
  upi_id: '', bank_account_name: '', bank_account_no: '', bank_ifsc: '', bank_name: '',
  custom_receipt_footer: '',
}

export function ReceiptSettingsTab() {
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = (r.data.data || {}) as Record<string, unknown>
      setForm(f => ({
        ...f,
        logo_cdn_url: (p.logo_cdn_url as string) || '',
        show_logo_on_receipts: p.show_logo_on_receipts !== false,
        receipt_template: (p.receipt_template as string) || 'classic',
        primary_color: (p.primary_color as string) || '#0D1B2E',
        show_gstin_on_header: p.show_gstin_on_header !== false,
        show_80g_on_receipt: Boolean(p.show_80g_on_receipt),
        upi_id: (p.upi_id as string) || '',
        bank_account_name: (p.bank_account_name as string) || '',
        bank_account_no: (p.bank_account_no as string) || '',
        bank_ifsc: (p.bank_ifsc as string) || '',
        bank_name: (p.bank_name as string) || '',
        custom_receipt_footer: (p.custom_receipt_footer as string) || '',
      }))
    }).catch(() => {})
  }, [])

  function set<K extends keyof typeof BLANK>(k: K, v: (typeof BLANK)[K]) { setForm(f => ({ ...f, [k]: v })) }

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
    <form onSubmit={save} className="space-y-4">
      {success && <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">Receipt settings saved!</div>}

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Logo</h3></div>
        <div className="card-body space-y-3">
          <div>
            <label className="form-label">Logo Image URL</label>
            <input className="form-input" placeholder="https://yourdomain.com/logo.png" value={form.logo_cdn_url} onChange={e => set('logo_cdn_url', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-4 h-4" checked={form.show_logo_on_receipts} onChange={e => set('show_logo_on_receipts', e.target.checked)} />
            Show logo on receipts & invoices
          </label>
          {form.logo_cdn_url && <img src={form.logo_cdn_url} alt="Logo preview" className="h-16 object-contain border border-slate-200 rounded p-1" />}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Default Template</h3></div>
        <div className="card-body grid grid-cols-2 gap-3">
          {TEMPLATES.map(t => (
            <button type="button" key={t.id} onClick={() => set('receipt_template', t.id)}
              className={`text-left border rounded-md p-3 ${form.receipt_template === t.id ? 'border-navy-900 ring-1 ring-navy-900' : 'border-slate-200'}`}>
              <p className="font-semibold text-sm">{t.label}</p>
              <p className="text-xs text-slate-400">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Colour & Visibility</h3></div>
        <div className="card-body space-y-3">
          <div className="flex items-center gap-3">
            <label className="form-label mb-0">Primary Colour</label>
            <input type="color" value={form.primary_color} onChange={e => set('primary_color', e.target.value)} className="h-9 w-16 rounded border border-slate-200" />
            <span className="text-xs font-mono text-slate-500">{form.primary_color}</span>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-4 h-4" checked={form.show_gstin_on_header} onChange={e => set('show_gstin_on_header', e.target.checked)} />
            Show GSTIN in receipt header
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-4 h-4" checked={form.show_80g_on_receipt} onChange={e => set('show_80g_on_receipt', e.target.checked)} />
            Show 80G details on receipts
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Payment Details (shown on receipts)</h3></div>
        <div className="card-body grid grid-cols-2 gap-3">
          <div><label className="form-label">UPI ID</label><input className="form-input" placeholder="temple@upi" value={form.upi_id} onChange={e => set('upi_id', e.target.value)} /></div>
          <div><label className="form-label">Bank Account Name</label><input className="form-input" value={form.bank_account_name} onChange={e => set('bank_account_name', e.target.value)} /></div>
          <div><label className="form-label">Bank Account No.</label><input className="form-input" value={form.bank_account_no} onChange={e => set('bank_account_no', e.target.value)} /></div>
          <div><label className="form-label">IFSC</label><input className="form-input uppercase" value={form.bank_ifsc} onChange={e => set('bank_ifsc', e.target.value.toUpperCase())} /></div>
          <div><label className="form-label">Bank Name</label><input className="form-input" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Receipt Footer</h3></div>
        <div className="card-body">
          <textarea className="form-input" rows={2} value={form.custom_receipt_footer} onChange={e => set('custom_receipt_footer', e.target.value)}
            placeholder="Jai Jinendra! Thank you for your donation." />
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
        {saving ? 'Saving...' : 'Save Receipt Settings'}
      </button>
    </form>
  )
}
