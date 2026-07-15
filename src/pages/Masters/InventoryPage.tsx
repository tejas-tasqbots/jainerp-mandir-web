import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, X, Search, Package } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'

interface InventoryItem {
  id: string
  name: string
  category?: string
  unit?: string
  current_stock?: number
  reorder_level?: number
  unit_price_paise?: number
  is_active: boolean
  created_at: string
}

const emptyForm = { name: '', category: '', unit: 'piece', current_stock: '0', reorder_level: '0', unit_price: '' }

export function InventoryPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState<InventoryItem[]>([])
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
      const { data } = await api.get(`/inventory-items?${params}`)
      setItems(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  function openAdd() { setEditId(null); setForm(emptyForm); setShowForm(true) }
  function openEdit(item: InventoryItem) {
    setEditId(item.id)
    setForm({
      name: item.name, category: item.category || '', unit: item.unit || 'piece',
      current_stock: String(item.current_stock ?? 0),
      reorder_level: String(item.reorder_level ?? 0),
      unit_price: item.unit_price_paise ? String(item.unit_price_paise / 100) : '',
    })
    setShowForm(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        name: form.name, category: form.category || undefined, unit: form.unit,
        current_stock: parseInt(form.current_stock) || 0,
        reorder_level: parseInt(form.reorder_level) || 0,
        unit_price_paise: form.unit_price ? parsePaise(form.unit_price) : undefined,
      }
      if (editId) await api.patch(`/inventory-items/${editId}`, body)
      else await api.post('/inventory-items', body)
      setShowForm(false); setForm(emptyForm); setEditId(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Package size={18} /> {t('inventory.title')}</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> {t('inventory.addItem')}</button>
      </div>

      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder={t('inventory.searchPlaceholder')}
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('inventory.item')}</th><th>{t('inventory.category')}</th><th>{t('inventory.unit')}</th><th>{t('inventory.stock')}</th><th>{t('inventory.reorderLevel')}</th><th>{t('inventory.unitPrice')}</th><th>{t('inventory.status')}</th><th>{t('inventory.actions')}</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">{t('inventory.noItemsFound')}</td></tr>
              ) : items.map(item => (
                <tr key={item.id}>
                  <td className="font-medium">{item.name}</td>
                  <td className="text-slate-600">{item.category || '—'}</td>
                  <td className="text-slate-600">{item.unit || '—'}</td>
                  <td className={`font-semibold ${item.current_stock !== undefined && item.reorder_level !== undefined && item.current_stock <= item.reorder_level ? 'text-red-600' : 'text-slate-700'}`}>
                    {item.current_stock ?? 0}
                  </td>
                  <td className="text-slate-500">{item.reorder_level ?? 0}</td>
                  <td>{item.unit_price_paise ? `₹${fmtPaise(item.unit_price_paise)}` : '—'}</td>
                  <td>{item.is_active ? <span className="badge-green">{t('inventory.active')}</span> : <span className="badge-gray">{t('inventory.inactive')}</span>}</td>
                  <td>
                    <button onClick={() => openEdit(item)} className="p-1 text-slate-400 hover:text-brand-blue rounded"><Pencil size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">{editId ? t('inventory.editItem') : t('inventory.addInventoryItem')}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><label className="form-label">{t('inventory.nameRequired')}</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">{t('inventory.category')}</label><input className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} /></div>
                <div>
                  <label className="form-label">{t('inventory.unit')}</label>
                  <select className="form-select" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                    <option value="piece">{t('inventory.unitPiece')}</option><option value="kg">{t('inventory.unitKg')}</option><option value="gram">{t('inventory.unitGram')}</option>
                    <option value="litre">{t('inventory.unitLitre')}</option><option value="pack">{t('inventory.unitPack')}</option><option value="box">{t('inventory.unitBox')}</option>
                    <option value="set">{t('inventory.unitSet')}</option><option value="pair">{t('inventory.unitPair')}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="form-label">{t('inventory.currentStock')}</label><input type="number" min="0" className="form-input" value={form.current_stock} onChange={e => setForm(f => ({ ...f, current_stock: e.target.value }))} /></div>
                <div><label className="form-label">{t('inventory.reorderAt')}</label><input type="number" min="0" className="form-input" value={form.reorder_level} onChange={e => setForm(f => ({ ...f, reorder_level: e.target.value }))} /></div>
                <div><label className="form-label">{t('inventory.unitPriceAmount')}</label><input type="number" step="0.01" min="0" className="form-input" value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} /></div>
              </div>
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
