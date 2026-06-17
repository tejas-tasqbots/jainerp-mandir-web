import { useEffect, useRef, useState } from 'react'
import { Save, RefreshCw, Upload, X, Eye } from 'lucide-react'
import { api } from '../../../lib/api'
import { buildReceiptHtml, type ReceiptData } from '../../../lib/printReceipt'

const TEMPLATES = [
  {
    id: 'classic',
    label: 'Classic',
    desc: 'Navy header, donor box, amount highlight',
    thumb: (color: string) => `
      <div style="font-family:sans-serif;font-size:6px;border-radius:3px;overflow:hidden;border:1px solid #e2e8f0">
        <div style="background:${color};color:#fff;padding:5px 7px">
          <div style="font-weight:700;font-size:7px">Mandir Name</div>
          <div style="opacity:.8;font-size:5px">Address, City</div>
        </div>
        <div style="padding:5px 7px">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:2px;padding:3px 4px;margin-bottom:3px">
            <div style="font-weight:700;font-size:6.5px">Donor Name</div>
            <div style="color:#9ca3af;font-size:5px">+91 98765 43210</div>
          </div>
          <div style="background:${color}15;border:1px solid ${color}40;border-radius:2px;padding:3px 4px;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:5px;color:${color}">Donation Amount</div>
            <div style="font-size:9px;font-weight:800;color:${color}">₹1,500</div>
          </div>
          <div style="margin-top:3px;font-size:5px;color:#6b7280;border-top:1px solid #f1f5f9;padding-top:3px">
            <div>Category: General</div><div>Mode: Cash &nbsp; 80G: Yes</div>
          </div>
        </div>
      </div>`,
  },
  {
    id: 'minimal',
    label: 'Minimal',
    desc: 'Clean lines, no background colours',
    thumb: (color: string) => `
      <div style="font-family:sans-serif;font-size:6px;border:1px solid #d1d5db;border-radius:2px;padding:7px 8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:5px;border-bottom:2px solid ${color};margin-bottom:5px">
          <div>
            <div style="font-weight:700;font-size:7px">Mandir Name</div>
            <div style="color:#9ca3af;font-size:5px">Address, City</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:5px;color:${color};font-weight:700">RECEIPT</div>
            <div style="font-size:6px;font-family:monospace">DON/001</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #f3f4f6"><span style="color:#9ca3af">Donor</span><span style="font-weight:600">Name Here</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #f3f4f6"><span style="color:#9ca3af">Amount</span><span style="font-weight:800;font-size:8px;color:${color}">₹1,500</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:#9ca3af">Mode</span><span>Cash</span></div>
      </div>`,
  },
  {
    id: 'modern',
    label: 'Modern',
    desc: 'Gradient hero, info cards, bold design',
    thumb: (color: string) => `
      <div style="font-family:sans-serif;font-size:6px;border-radius:4px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(0,0,0,.1)">
        <div style="height:3px;background:linear-gradient(90deg,${color},${color}99)"></div>
        <div style="background:#fff;padding:4px 6px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #f1f5f9">
          <div><div style="font-weight:800;font-size:7px">Mandir</div><div style="color:#9ca3af;font-size:5px">Address</div></div>
          <div style="text-align:right"><div style="background:${color}15;color:${color};font-size:4.5px;padding:1px 4px;border-radius:9px;font-weight:700">RECEIPT</div><div style="font-size:6px;margin-top:2px;font-family:monospace">DON/001</div></div>
        </div>
        <div style="padding:4px 6px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:4px">
            <div style="background:#f8fafc;border-radius:2px;padding:2px 3px"><div style="font-size:4px;color:#9ca3af">From</div><div style="font-size:6px;font-weight:700">Donor Name</div></div>
            <div style="background:#f8fafc;border-radius:2px;padding:2px 3px"><div style="font-size:4px;color:#9ca3af">Category</div><div style="font-size:6px;font-weight:700">General</div></div>
          </div>
          <div style="background:linear-gradient(135deg,${color},${color}cc);border-radius:3px;padding:4px 6px;color:#fff;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:5px;opacity:.9">Donation Amount</div>
            <div style="font-size:11px;font-weight:900;font-family:monospace">₹1,500</div>
          </div>
        </div>
      </div>`,
  },
  {
    id: 'traditional',
    label: 'Traditional',
    desc: 'Saffron border, 🕉, Sanskrit style',
    thumb: (_color: string) => `
      <div style="font-family:'Times New Roman',serif;font-size:6px;border:2px solid #c97b22;border-radius:2px;overflow:hidden">
        <div style="height:4px;background:linear-gradient(90deg,#c97b22,#f59e0b,#c97b22)"></div>
        <div style="background:linear-gradient(180deg,#fef3c7,#fffef9);padding:5px 7px;text-align:center;border-bottom:2px solid #f59e0b">
          <div style="font-size:10px">🕉</div>
          <div style="font-weight:700;font-size:7px;color:#92400e">Mandir Name</div>
          <div style="font-size:5px;color:#78350f">Address, City</div>
          <div style="font-size:5px;font-weight:700;color:#c97b22;letter-spacing:1px;margin-top:3px;border-top:1px dashed #f59e0b;padding-top:2px">DONATION RECEIPT</div>
        </div>
        <div style="padding:4px 7px">
          <div style="font-size:5px;color:#78350f;font-style:italic">Received with gratitude from:</div>
          <div style="font-weight:700;font-size:7px;color:#92400e;margin:2px 0">Donor Name</div>
          <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #fef3c7"><span style="color:#78350f">Amount</span><span style="font-weight:800;color:#c97b22;font-size:8px">₹1,500</span></div>
        </div>
        <div style="height:4px;background:linear-gradient(90deg,#c97b22,#f59e0b,#c97b22);margin-top:2px"></div>
      </div>`,
  },
  {
    id: 'elegant',
    label: 'Elegant',
    desc: 'Serif typography, premium minimalist',
    thumb: (color: string) => `
      <div style="font-family:Georgia,serif;font-size:6px;border-radius:1px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 1px 6px rgba(0,0,0,.08)">
        <div style="height:3px;background:${color}"></div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:6px 8px;border-bottom:1px solid #e5e7eb;align-items:start">
          <div>
            <div style="font-weight:700;font-size:7.5px">Mandir Name</div>
            <div style="font-size:5px;color:#9ca3af;margin-top:1px">Address, City</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:4.5px;color:${color};font-weight:700;letter-spacing:1px">RECEIPT</div>
            <div style="font-size:6px;font-family:monospace;margin-top:2px">DON/001</div>
          </div>
        </div>
        <div style="padding:6px 8px">
          <div style="font-size:4.5px;letter-spacing:1.5px;color:${color};font-weight:700;border-bottom:1px solid #f3f4f6;padding-bottom:3px;margin-bottom:4px">RECEIVED FROM</div>
          <div style="font-weight:700;font-size:8px">Donor Name</div>
          <div style="margin-top:6px">
            <div style="font-size:4.5px;letter-spacing:1.5px;color:${color};font-weight:700;border-bottom:1px solid #f3f4f6;padding-bottom:2px;margin-bottom:3px">AMOUNT</div>
            <div style="font-size:13px;font-weight:700;color:${color};font-family:monospace;letter-spacing:-1px">₹1,500.00</div>
          </div>
        </div>
        <div style="height:3px;background:${color}20"></div>
      </div>`,
  },
]

const BLANK = {
  logo_cdn_url: '', logo_base64: '', show_logo_on_receipts: true,
  receipt_template: 'classic', primary_color: '#0D1B2E',
  show_gstin_on_header: true, show_80g_on_receipt: true,
  upi_id: '', bank_account_name: '', bank_account_no: '',
  bank_ifsc: '', bank_name: '', custom_receipt_footer: '',
  // profile fields for preview
  name: '', address: '', gstin: '', pan: '',
  reg_80g_number: '', reg_12a_number: '',
}

function buildPreviewData(form: typeof BLANK): ReceiptData {
  return {
    receipt_number: 'DON/2025-26/000001',
    date: new Date().toISOString(),
    is_voided: false,
    donor: { name: 'Ayush Kasliwal', mobile: '+919876543210' },
    category: 'General Donation',
    amount_paise: 150000,
    payment_mode: 'cash',
    is_80g_eligible: true,
    mandir: {
      name: form.name || 'Shree Jain Mandir',
      address: form.address || '123, Temple Road, Ahmedabad, Gujarat 380001',
      gstin: form.gstin || 'GSTIN: 24XXXXX1234A1Z5',
      pan: form.pan || 'AAAAB1234C',
      reg_80g_number: form.reg_80g_number || '80G/2024/AHM/001',
      reg_12a_number: form.reg_12a_number || null,
      upi_id: form.upi_id || 'temple@upi',
      bank_account_name: form.bank_account_name || null,
      bank_account_no: form.bank_account_no || null,
      bank_ifsc: form.bank_ifsc || null,
      bank_name: form.bank_name || null,
      logo_cdn_url: form.logo_cdn_url || null,
      logo_base64: form.logo_base64 || null,
      show_logo: form.show_logo_on_receipts,
      show_80g: form.show_80g_on_receipt,
      show_gstin: form.show_gstin_on_header,
      footer: form.custom_receipt_footer || 'Jai Jinendra! Thank you for your generous donation.',
      template: form.receipt_template,
      primary_color: form.primary_color,
    },
  }
}

export function ReceiptSettingsTab() {
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = (r.data.data || {}) as Record<string, unknown>
      setForm(f => ({
        ...f,
        logo_cdn_url: (p.logo_cdn_url as string) || '',
        logo_base64: (p.logo_base64 as string) || '',
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
        name: (p.name as string) || '',
        address: [p.address_line1, p.city, p.state, p.pincode].filter(Boolean).join(', '),
        gstin: (p.gstin as string) || '',
        pan: (p.pan as string) || '',
        reg_80g_number: (p.reg_80g_number as string) || '',
        reg_12a_number: (p.reg_12a_number as string) || '',
      }))
    }).catch(() => {})
  }, [])

  // Update preview iframe whenever form changes
  useEffect(() => {
    const html = buildReceiptHtml(buildPreviewData(form))
    // Remove the auto-print script for preview
    const previewHtml = html.replace('<script>window.onload=()=>{window.print()}</script>', '')
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (doc) {
        doc.open()
        doc.write(previewHtml)
        doc.close()
      }
    }
  }, [form])

  function set<K extends keyof typeof BLANK>(k: K, v: (typeof BLANK)[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function handleLogoFile(file: File) {
    if (!file.type.startsWith('image/')) return
    if (file.size > 2 * 1024 * 1024) { alert('Logo file must be under 2 MB'); return }
    setLogoUploading(true)
    const reader = new FileReader()
    reader.onload = e => {
      set('logo_base64', e.target?.result as string)
      set('logo_cdn_url', '')
      setLogoUploading(false)
    }
    reader.readAsDataURL(file)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.patch('/tenants/me', {
        logo_cdn_url: form.logo_cdn_url,
        logo_base64: form.logo_base64,
        show_logo_on_receipts: form.show_logo_on_receipts,
        receipt_template: form.receipt_template,
        primary_color: form.primary_color,
        show_gstin_on_header: form.show_gstin_on_header,
        show_80g_on_receipt: form.show_80g_on_receipt,
        upi_id: form.upi_id,
        bank_account_name: form.bank_account_name,
        bank_account_no: form.bank_account_no,
        bank_ifsc: form.bank_ifsc,
        bank_name: form.bank_name,
        custom_receipt_footer: form.custom_receipt_footer,
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const logoSrc = form.logo_base64 || form.logo_cdn_url

  return (
    <div className="flex gap-6 items-start">
      {/* ── Left: Settings panel ── */}
      <form onSubmit={save} className="flex-1 min-w-0 space-y-4">
        {success && (
          <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">
            Receipt settings saved!
          </div>
        )}

        {/* Logo */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Logo</h3></div>
          <div className="card-body space-y-3">
            {logoSrc ? (
              <div className="flex items-center gap-3">
                <img src={logoSrc} alt="Logo" className="h-14 object-contain border border-slate-200 rounded p-1 bg-white" />
                <div className="flex-1">
                  <p className="text-xs text-slate-500">{form.logo_base64 ? 'Stored as base64 (embedded in receipt)' : 'External URL'}</p>
                </div>
                <button type="button" onClick={() => { set('logo_base64', ''); set('logo_cdn_url', '') }}
                  className="p-1 text-slate-400 hover:text-red-500">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleLogoFile(f) }}
                className="border-2 border-dashed border-slate-200 rounded-md p-6 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors"
              >
                <Upload size={20} className="mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-600">Upload logo</p>
                <p className="text-xs text-slate-400 mt-1">PNG, JPG, SVG · max 2 MB · stored as base64</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = '' }} />
            {logoUploading && <p className="text-xs text-blue-600 animate-pulse">Processing logo...</p>}

            <div>
              <label className="form-label">Or enter image URL</label>
              <input className="form-input" placeholder="https://yourdomain.com/logo.png"
                value={form.logo_cdn_url}
                onChange={e => { set('logo_cdn_url', e.target.value); if (e.target.value) set('logo_base64', '') }} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_logo_on_receipts}
                onChange={e => set('show_logo_on_receipts', e.target.checked)} />
              Show logo on receipts
            </label>
          </div>
        </div>

        {/* Template */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Template</h3></div>
          <div className="card-body grid grid-cols-1 gap-3">
            {TEMPLATES.map(t => (
              <button type="button" key={t.id} onClick={() => set('receipt_template', t.id)}
                className={`flex items-center gap-3 text-left border rounded-lg p-3 transition-all ${form.receipt_template === t.id ? 'border-navy-900 ring-2 ring-navy-900 bg-navy-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="w-24 flex-shrink-0" dangerouslySetInnerHTML={{ __html: t.thumb(form.primary_color) }} />
                <div>
                  <p className="font-semibold text-sm">{t.label}</p>
                  <p className="text-xs text-slate-400">{t.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Colour & Visibility */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Colour & Visibility</h3></div>
          <div className="card-body space-y-3">
            <div className="flex items-center gap-3">
              <label className="form-label mb-0 w-28">Primary Colour</label>
              <input type="color" value={form.primary_color} onChange={e => set('primary_color', e.target.value)}
                className="h-9 w-16 rounded border border-slate-200 cursor-pointer" />
              <span className="text-xs font-mono text-slate-500">{form.primary_color}</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_gstin_on_header}
                onChange={e => set('show_gstin_on_header', e.target.checked)} />
              Show GSTIN in header
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_80g_on_receipt}
                onChange={e => set('show_80g_on_receipt', e.target.checked)} />
              Show 80G / registration numbers on receipt
            </label>
          </div>
        </div>

        {/* Payment details */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Payment Details (on receipts)</h3></div>
          <div className="card-body grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="form-label">UPI ID</label>
              <input className="form-input" placeholder="temple@upi" value={form.upi_id}
                onChange={e => set('upi_id', e.target.value)} />
            </div>
            <div><label className="form-label">Bank Account Name</label>
              <input className="form-input" value={form.bank_account_name} onChange={e => set('bank_account_name', e.target.value)} /></div>
            <div><label className="form-label">Account Number</label>
              <input className="form-input" value={form.bank_account_no} onChange={e => set('bank_account_no', e.target.value)} /></div>
            <div><label className="form-label">IFSC</label>
              <input className="form-input uppercase" value={form.bank_ifsc}
                onChange={e => set('bank_ifsc', e.target.value.toUpperCase())} /></div>
            <div><label className="form-label">Bank Name</label>
              <input className="form-input" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} /></div>
          </div>
        </div>

        {/* Footer */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Receipt Footer</h3></div>
          <div className="card-body">
            <textarea className="form-input" rows={2} value={form.custom_receipt_footer}
              onChange={e => set('custom_receipt_footer', e.target.value)}
              placeholder="Jai Jinendra! Thank you for your generous donation." />
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? 'Saving...' : 'Save Receipt Settings'}
        </button>
      </form>

      {/* ── Right: Live preview panel ── */}
      <div className="w-[420px] flex-shrink-0 sticky top-4">
        <div className="card overflow-hidden">
          <div className="card-header flex items-center gap-2">
            <Eye size={14} className="text-slate-500" />
            <h3 className="font-semibold text-sm">Live Preview</h3>
            <span className="ml-auto text-xs text-slate-400 capitalize">{form.receipt_template} template</span>
          </div>
          <div className="bg-slate-100 p-3">
            <div className="bg-white rounded shadow-sm overflow-hidden" style={{ height: '580px' }}>
              <iframe
                ref={iframeRef}
                title="Receipt Preview"
                sandbox="allow-same-origin"
                className="w-full h-full border-0"
                style={{ zoom: 0.6, height: '967px', transformOrigin: 'top left' }}
              />
            </div>
          </div>
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
            <p className="text-xs text-slate-400 text-center">Preview updates as you change settings</p>
          </div>
        </div>
      </div>
    </div>
  )
}
