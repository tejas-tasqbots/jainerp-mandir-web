import { useEffect, useState } from 'react'
import { Plus, Save, X, Package, Pencil } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import type { PrasadItem } from '../../types'

export function PrasadItems() {
  const [items, setItems] = useState<PrasadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', name_hindi: '', unit: 'piece', price: '', gst_rate: '0', initial_stock: '0', low_stock_threshold: '10' })
  const [editItem, setEditItem] = useState<PrasadItem | null>(null)
  const [editForm, setEditForm] = useState({ name: '', name_hindi: '', unit: 'piece', price: '', gst_rate: '0', is_available: true, sort_order: '0' })
  const [stockModal, setStockModal] = useState<PrasadItem | null>(null)
  const [stockAdj, setStockAdj] = useState({ qty: '', note: '' })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/prasad/items')
      setItems(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/prasad/items', {
        name: form.name,
        name_hindi: form.name_hindi || undefined,
        unit: form.unit,
        price_paise: parsePaise(form.price),
        gst_rate: parseFloat(form.gst_rate),
        stock_qty: parseInt(form.initial_stock),
        low_stock_threshold: parseInt(form.low_stock_threshold),
      })
      setForm({ name: '', name_hindi: '', unit: 'piece', price: '', gst_rate: '0', initial_stock: '0', low_stock_threshold: '10' })
      setShowAdd(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  function openEdit(item: PrasadItem) {
    setEditItem(item)
    setEditForm({
      name: item.name,
      name_hindi: item.name_hindi || '',
      unit: item.unit || 'piece',
      price: String(item.price_paise / 100),
      gst_rate: String(item.gst_rate),
      is_available: item.is_available,
      sort_order: String(item.sort_order ?? 0),
    })
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editItem) return
    setSaving(true)
    try {
      await api.patch(`/prasad/items/${editItem.id}`, {
        name: editForm.name,
        name_hindi: editForm.name_hindi || undefined,
        unit: editForm.unit,
        price_paise: parsePaise(editForm.price),
        gst_rate: parseFloat(editForm.gst_rate),
        is_available: editForm.is_available,
        sort_order: parseInt(editForm.sort_order),
      })
      setEditItem(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function adjustStock(e: React.FormEvent) {
    e.preventDefault()
    if (!stockModal) return
    setSaving(true)
    try {
      await api.post(`/prasad/items/${stockModal.id}/adjust-stock`, {
        qty_change: parseInt(stockAdj.qty),
        note: stockAdj.note || undefined,
      })
      setStockModal(null)
      setStockAdj({ qty: '', note: '' })
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e.response?.data?.error?.message || 'Stock adjustment failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Prasad Items</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary btn-sm"><Plus size={14} /> Add Item</button>
      </div>

      {showAdd && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="font-semibold text-sm">Add New Item</h3>
            <button onClick={() => setShowAdd(false)}><X size={16} className="text-slate-400" /></button>
          </div>
          <form onSubmit={addItem} className="card-body space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="form-label">Item Name *</label>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Name (Hindi)</label>
                <input className="form-input" value={form.name_hindi} onChange={e => setForm(f => ({ ...f, name_hindi: e.target.value }))} placeholder="Optional" />
              </div>
              <div>
                <label className="form-label">Unit</label>
                <input className="form-input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="piece, kg, box…" />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="form-label">Price (₹) *</label>
                <input type="number" min="0" step="0.01" className="form-input" value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">GST Rate (%)</label>
                <select className="form-select" value={form.gst_rate} onChange={e => setForm(f => ({ ...f, gst_rate: e.target.value }))}>
                  <option value="0">0%</option><option value="5">5%</option>
                  <option value="12">12%</option><option value="18">18%</option>
                </select>
              </div>
              <div>
                <label className="form-label">Opening Stock</label>
                <input type="number" min="0" className="form-input" value={form.initial_stock}
                  onChange={e => setForm(f => ({ ...f, initial_stock: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Low Stock Alert</label>
                <input type="number" min="0" className="form-input" value={form.low_stock_threshold}
                  onChange={e => setForm(f => ({ ...f, low_stock_threshold: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving} className="btn-primary btn-sm">
                <Save size={14} /> {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary btn-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Unit</th>
                <th>Price</th>
                <th>GST</th>
                <th>Price + GST</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">No items yet. Click "Add Item" to create one.</td></tr>
              ) : items.map(item => (
                <tr key={item.id}>
                  <td className="font-medium">
                    {item.name}
                    {item.name_hindi && <span className="block text-xs text-slate-400">{item.name_hindi}</span>}
                  </td>
                  <td className="text-xs text-slate-500">{item.unit || 'piece'}</td>
                  <td>₹{fmtPaise(item.price_paise)}</td>
                  <td>{item.gst_rate}%</td>
                  <td className="font-semibold">₹{fmtPaise(Math.round(item.price_paise * (1 + item.gst_rate / 100)))}</td>
                  <td className={(item.stock_qty ?? 0) <= (item.low_stock_threshold ?? 10) ? 'text-red-600 font-semibold' : ''}>
                    {item.stock_qty ?? 0}
                  </td>
                  <td>
                    {item.is_available
                      ? <span className="badge-green">Available</span>
                      : <span className="badge-gray">Unavailable</span>}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(item)} className="p-1 text-slate-400 hover:text-brand-blue rounded" title="Edit item">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => { setStockModal(item); setStockAdj({ qty: '', note: '' }) }}
                        className="p-1 text-slate-400 hover:text-green-600 rounded" title="Adjust stock">
                        <Package size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit item modal */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4">
            <h3 className="font-bold text-navy-900 mb-4">Edit Prasad Item</h3>
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Item Name *</label>
                  <input className="form-input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div>
                  <label className="form-label">Name (Hindi)</label>
                  <input className="form-input" value={editForm.name_hindi} onChange={e => setEditForm(f => ({ ...f, name_hindi: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="form-label">Unit</label>
                  <input className="form-input" value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Price (₹) *</label>
                  <input type="number" min="0" step="0.01" className="form-input" value={editForm.price}
                    onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))} required />
                </div>
                <div>
                  <label className="form-label">GST Rate (%)</label>
                  <select className="form-select" value={editForm.gst_rate} onChange={e => setEditForm(f => ({ ...f, gst_rate: e.target.value }))}>
                    <option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Sort Order</label>
                  <input type="number" min="0" className="form-input" value={editForm.sort_order}
                    onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))} />
                </div>
                <div className="flex items-center gap-3 mt-5">
                  <input type="checkbox" id="available" checked={editForm.is_available}
                    onChange={e => setEditForm(f => ({ ...f, is_available: e.target.checked }))} className="w-4 h-4" />
                  <label htmlFor="available" className="text-sm">Available (show in POS)</label>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditItem(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock adjustment modal */}
      {stockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">Adjust Stock</h3>
            <p className="text-sm text-slate-500 mb-4">
              Current stock for <span className="font-semibold">{stockModal.name}</span>:{' '}
              <span className="font-bold text-navy-900">{stockModal.stock_qty ?? 0}</span>
            </p>
            <form onSubmit={adjustStock} className="space-y-4">
              <div>
                <label className="form-label">Quantity Adjustment *</label>
                <input type="number" className="form-input" autoFocus value={stockAdj.qty}
                  onChange={e => setStockAdj(f => ({ ...f, qty: e.target.value }))}
                  placeholder="e.g. +50 to add, -10 to remove" required />
                <p className="text-xs text-slate-400 mt-1">Positive to add stock, negative to remove</p>
              </div>
              <div>
                <label className="form-label">Note (optional)</label>
                <input className="form-input" value={stockAdj.note}
                  onChange={e => setStockAdj(f => ({ ...f, note: e.target.value }))}
                  placeholder="e.g. New batch received" />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setStockModal(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Adjusting...' : 'Adjust Stock'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
