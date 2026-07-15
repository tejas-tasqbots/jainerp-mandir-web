import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Pencil, X } from 'lucide-react'
import { api } from '../../lib/api'

interface Vendor {
  id: string
  name: string
  contact_person?: string
  mobile?: string
  email?: string
  gstin?: string
  pan_masked?: string
  tds_section?: string
  bank_account?: string
  bank_ifsc?: string
  notes?: string
  is_active: boolean
  created_at: string
}

const emptyForm = {
  name: '', contact_person: '', mobile: '', email: '', gstin: '', pan: '',
  tds_section: '', bank_account: '', bank_ifsc: '', notes: '',
}

export function VendorsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [search])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (search) params.set('q', search)
      const { data } = await api.get(`/vendors?${params}`)
      setVendors(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  function openAdd() { setEditId(null); setForm(emptyForm); setShowForm(true) }
  function openEdit(v: Vendor) {
    setEditId(v.id)
    setForm({
      name: v.name, contact_person: v.contact_person || '', mobile: v.mobile || '', email: v.email || '',
      gstin: v.gstin || '', pan: '', tds_section: v.tds_section || '',
      bank_account: v.bank_account || '', bank_ifsc: v.bank_ifsc || '', notes: v.notes || '',
    })
    setShowForm(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        contact_person: form.contact_person || undefined,
        mobile: form.mobile || undefined,
        email: form.email || undefined,
        gstin: form.gstin || undefined,
        tds_section: form.tds_section || undefined,
        bank_account: form.bank_account || undefined,
        bank_ifsc: form.bank_ifsc || undefined,
        notes: form.notes || undefined,
      }
      if (form.pan) body.pan_masked = form.pan  // store as entered; backend masks elsewhere
      if (editId) await api.patch(`/vendors/${editId}`, body)
      else await api.post('/vendors', body)
      setShowForm(false)
      setForm(emptyForm)
      setEditId(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('vendors.title')}</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> {t('vendors.addVendor')}</button>
      </div>

      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder={t('vendors.searchPlaceholder')}
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('vendors.name')}</th><th>{t('vendors.mobile')}</th><th>{t('vendors.gstin')}</th><th>{t('vendors.pan')}</th><th>{t('vendors.status')}</th><th>{t('vendors.actions')}</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : vendors.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">{t('vendors.noVendorsFound')}</td></tr>
              ) : vendors.map(v => (
                <tr key={v.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/masters/vendors/${v.id}`)}>
                  <td className="font-medium text-brand-blue">{v.name}</td>
                  <td>{v.mobile || '—'}</td>
                  <td className="font-mono text-xs">{v.gstin || '—'}</td>
                  <td className="font-mono text-xs">{v.pan_masked || '—'}</td>
                  <td>{v.is_active ? <span className="badge-green">{t('vendors.active')}</span> : <span className="badge-gray">{t('vendors.inactive')}</span>}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <button type="button" onClick={() => openEdit(v)} className="p-1 text-slate-400 hover:text-brand-blue rounded" title={t('vendors.edit')} aria-label="Edit vendor">
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">{editId ? t('vendors.editVendor') : t('vendors.addVendor')}</h3>
              <button type="button" onClick={() => setShowForm(false)} title="Close" aria-label="Close"><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">{t('vendors.nameRequired')}</label><input className="form-input" placeholder={t('vendors.namePlaceholder')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
                <div><label className="form-label">{t('vendors.contactPerson')}</label><input className="form-input" value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">{t('vendors.mobile')}</label><input type="tel" className="form-input" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
                <div><label className="form-label">{t('vendors.email')}</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">{t('vendors.gstin')}</label><input className="form-input uppercase" placeholder="22ABCDE1234F1Z5" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} /></div>
                <div><label className="form-label">{t('vendors.pan')}</label><input className="form-input uppercase" placeholder="ABCDE1234F" maxLength={10} value={form.pan} onChange={e => setForm(f => ({ ...f, pan: e.target.value.toUpperCase() }))} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="v-tds" className="form-label">{t('vendors.tdsSection')}</label>
                  <select id="v-tds" className="form-select" value={form.tds_section} onChange={e => setForm(f => ({ ...f, tds_section: e.target.value }))}>
                    <option value="">{t('vendors.none')}</option>
                    <option value="194C">194C</option>
                    <option value="194J">194J</option>
                    <option value="194I">194I</option>
                    <option value="194H">194H</option>
                  </select>
                </div>
                <div><label className="form-label">{t('vendors.bankAc')}</label><input className="form-input" placeholder={t('vendors.accountNoPlaceholder')} value={form.bank_account} onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))} /></div>
                <div><label className="form-label">{t('vendors.ifsc')}</label><input className="form-input uppercase" placeholder="IFSC" value={form.bank_ifsc} onChange={e => setForm(f => ({ ...f, bank_ifsc: e.target.value.toUpperCase() }))} /></div>
              </div>
              <div><label className="form-label">{t('vendors.notes')}</label><input className="form-input" placeholder={t('vendors.notesPlaceholder')} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
