import { useEffect, useState } from 'react'
import { Save, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { useProfileStore } from '../../store/profileStore'

export function ProfileSettings() {
  const { fetchProfile } = useProfileStore()
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [form, setForm] = useState({
    name: '', address_line1: '', address_line2: '', city: '', state: '', pincode: '',
    mobile: '', email: '', website: '',
    pan: '', gstin: '', reg_80g_number: '', reg_12ab_number: '', reg_12a_number: '',
    is_gst_registered: false, show_80g_on_receipt: true,
    custom_receipt_footer: '',
  })

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = r.data.data || {}
      setForm({
        name: p.name || '',
        address_line1: p.address_line1 || '',
        address_line2: p.address_line2 || '',
        city: p.city || '',
        state: p.state || '',
        pincode: p.pincode || '',
        mobile: p.mobile || '',
        email: p.email || '',
        website: p.website || '',
        pan: p.pan || '',
        gstin: p.gstin || '',
        reg_80g_number: p.reg_80g_number || '',
        reg_12ab_number: p.reg_12ab_number || '',
        reg_12a_number: p.reg_12a_number || '',
        is_gst_registered: p.is_gst_registered || false,
        show_80g_on_receipt: p.show_80g_on_receipt ?? true,
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
      await fetchProfile()
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-5 max-w-3xl">
      <h1 className="text-xl font-bold text-navy-900">Kshetra Profile</h1>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">
          Profile saved successfully!
        </div>
      )}

      {/* Basic Information */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Basic Information</h3></div>
        <div className="card-body space-y-4">
          <div>
            <label className="form-label">Kshetra Name *</label>
            <input className="form-input" required value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Address Line 1</label>
              <input className="form-input" value={form.address_line1} onChange={e => set('address_line1', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Address Line 2</label>
              <input className="form-input" value={form.address_line2} onChange={e => set('address_line2', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="form-label">City</label>
              <input className="form-input" value={form.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className="form-label">State</label>
              <input className="form-input" value={form.state} onChange={e => set('state', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Pincode</label>
              <input className="form-input" value={form.pincode} onChange={e => set('pincode', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Phone</label>
              <input className="form-input" value={form.mobile} onChange={e => set('mobile', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Registration Numbers */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Registration Numbers</h3></div>
        <div className="card-body space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">PAN</label>
              <input className="form-input uppercase" value={form.pan} onChange={e => set('pan', e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className="form-label">GSTIN</label>
              <input className="form-input uppercase" value={form.gstin} onChange={e => set('gstin', e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">80G Registration No.</label>
              <input className="form-input" value={form.reg_80g_number} onChange={e => set('reg_80g_number', e.target.value)} />
            </div>
            <div>
              <label className="form-label">12AB Registration No.</label>
              <input className="form-input" value={form.reg_12ab_number} onChange={e => set('reg_12ab_number', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="form-label">12A Registration No. <span className="text-slate-400 font-normal">(older)</span></label>
            <input className="form-input w-1/2" value={form.reg_12a_number} onChange={e => set('reg_12a_number', e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.is_gst_registered}
                onChange={e => set('is_gst_registered', e.target.checked)} />
              Kshetra is GST Registered
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_80g_on_receipt}
                onChange={e => set('show_80g_on_receipt', e.target.checked)} />
              Show 80G note on donation receipts
            </label>
          </div>
        </div>
      </div>

      {/* Invoice Footer */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Invoice Footer</h3></div>
        <div className="card-body">
          <textarea className="form-textarea" rows={3}
            placeholder="This is a computer-generated document. No physical signature required."
            value={form.custom_receipt_footer} onChange={e => set('custom_receipt_footer', e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </form>
  )
}
