import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save, X, Package, Pencil } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise, parsePaise } from '../../lib/api'
import type { PrasadItem } from '../../types'
import { useToast } from '../../components/kit/Toast'

const blankItem = { name: '', name_hindi: '', unit: 'piece', price: '', gst_rate: '0', initial_stock: '0', low_stock_threshold: '10', unlimited: false }

/**
 * "Unlimited stock" (tenant migration 066): an offering made to order - bhata,
 * sukhdi - has no count. It is never out of stock, never low, and has no
 * stock to adjust. Everything else is counted as before.
 */
function UnlimitedTick({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-3">
      <input type="checkbox" id={id} checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 w-4 h-4" />
      <label htmlFor={id} className="text-sm text-slate-700">
        {t('prasad.unlimitedStock')}
        <span className="block text-xs text-slate-500">{t('prasad.unlimitedStockHint')}</span>
      </label>
    </div>
  )
}

export function PrasadItems() {
  const toast = useToast()
  const { t } = useTranslation()
  const [items, setItems] = useState<PrasadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(blankItem)
  const [editItem, setEditItem] = useState<PrasadItem | null>(null)
  const [editForm, setEditForm] = useState({ name: '', name_hindi: '', unit: 'piece', price: '', gst_rate: '0', is_available: true, sort_order: '0', unlimited_stock: false })
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
        ...(form.unlimited
          ? { unlimited_stock: true }
          : {
              stock_qty: parseInt(form.initial_stock) || 0,
              low_stock_threshold: parseInt(form.low_stock_threshold) || 0,
            }),
      })
      setForm(blankItem)
      setShowAdd(false)
      load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
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
      unlimited_stock: !!item.unlimited_stock,
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
        unlimited_stock: editForm.unlimited_stock,
      })
      // Counted again: its count is whatever it was before it went unlimited,
      // so say where to set it rather than leave a stale number unexplained.
      if (editItem.unlimited_stock && !editForm.unlimited_stock) toast.info(t('prasad.nowCountedHint'))
      setEditItem(null)
      load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
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
      toast.error(e.response?.data?.error?.message || 'Stock adjustment failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('prasad.itemsTitle')}</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary btn-sm"><Plus size={14} /> {t('prasad.addItem')}</button>
      </div>

      {showAdd && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="font-semibold text-sm">{t('prasad.addNewItem')}</h3>
            <button onClick={() => setShowAdd(false)}><X size={16} className="text-slate-400" /></button>
          </div>
          <form onSubmit={addItem} className="card-body space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="form-label" htmlFor="prasad-items-name">{t('prasad.itemName')}</label>
                <input id="prasad-items-name" className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label" htmlFor="prasad-items-name-hindi">{t('prasad.nameHindi')}</label>
                <input id="prasad-items-name-hindi" className="form-input" value={form.name_hindi} onChange={e => setForm(f => ({ ...f, name_hindi: e.target.value }))} placeholder={t('prasad.optional')} />
              </div>
              <div>
                <label className="form-label" htmlFor="prasad-items-unit">{t('prasad.unit')}</label>
                <input id="prasad-items-unit" className="form-input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder={t('prasad.unitPlaceholder')} />
              </div>
            </div>
            <UnlimitedTick id="prasad-items-unlimited" checked={form.unlimited} onChange={v => setForm(f => ({ ...f, unlimited: v }))} />
            <div className={`grid gap-3 ${form.unlimited ? 'grid-cols-2' : 'grid-cols-4'}`}>
              <div>
                <label className="form-label" htmlFor="prasad-items-price">{t('prasad.priceLabel')}</label>
                <input id="prasad-items-price" type="number" min="0" step="0.01" className="form-input" value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label" htmlFor="prasad-items-gst-rate">{t('prasad.gstRate')}</label>
                <select id="prasad-items-gst-rate" className="form-select" value={form.gst_rate} onChange={e => setForm(f => ({ ...f, gst_rate: e.target.value }))}>
                  <option value="0">0%</option><option value="5">5%</option>
                  <option value="12">12%</option><option value="18">18%</option>
                </select>
              </div>
              {/* Nothing to count on an unlimited item, so nothing to ask. */}
              {!form.unlimited && (
                <>
                  <div>
                    <label className="form-label" htmlFor="prasad-items-initial-stock">{t('prasad.openingStock')}</label>
                    <input id="prasad-items-initial-stock" type="number" min="0" className="form-input" value={form.initial_stock}
                      onChange={e => setForm(f => ({ ...f, initial_stock: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prasad-items-low-stock-threshold">{t('prasad.lowStockAlert')}</label>
                    <input id="prasad-items-low-stock-threshold" type="number" min="0" className="form-input" value={form.low_stock_threshold}
                      onChange={e => setForm(f => ({ ...f, low_stock_threshold: e.target.value }))} />
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving} className="btn-primary btn-sm">
                <Save size={14} /> {saving ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('prasad.itemNameCol')}</th>
                <th>{t('prasad.unit')}</th>
                <th>{t('prasad.price')}</th>
                <th>{t('prasad.gstCol')}</th>
                <th>{t('prasad.priceGst')}</th>
                <th>{t('prasad.stockCol')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">{t('prasad.noItemsYet')}</td></tr>
              ) : items.map(item => (
                <tr key={item.id}>
                  <td className="font-medium">
                    {item.name}
                    {item.name_hindi && <span className="block text-xs text-slate-400">{item.name_hindi}</span>}
                  </td>
                  <td className="text-xs text-slate-500">{item.unit || 'piece'}</td>
                  <td>₹{fmtPaise(item.price_paise)}</td>
                  {/* What a sale charges (0 without a GSTIN), not the stored rate. */}
                  <td>{item.effective_gst_rate ?? item.gst_rate}%</td>
                  <td className="font-semibold">₹{fmtPaise(Math.round(item.price_paise * (1 + (item.effective_gst_rate ?? item.gst_rate) / 100)))}</td>
                  {item.unlimited_stock ? (
                    <td><span className="badge-blue" title={t('prasad.unlimitedStockHint')}>{t('prasad.unlimited')}</span></td>
                  ) : (
                    <td className={(item.stock_qty ?? 0) <= (item.low_stock_threshold ?? 10) ? 'text-red-600 font-semibold' : ''}>
                      {item.stock_qty ?? 0}
                    </td>
                  )}
                  <td>
                    {item.is_available
                      ? <span className="badge-green">{t('prasad.available')}</span>
                      : <span className="badge-gray">{t('prasad.unavailable')}</span>}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(item)} className="p-1 text-slate-400 hover:text-brand-blue rounded" title={t('prasad.editItemTitle')}>
                        <Pencil size={14} />
                      </button>
                      {!item.unlimited_stock && (
                        <button onClick={() => { setStockModal(item); setStockAdj({ qty: '', note: '' }) }}
                          className="p-1 text-slate-400 hover:text-green-600 rounded" title={t('prasad.adjustStockTitle')}
                          aria-label={t('prasad.adjustStockTitle')}>
                          <Package size={14} />
                        </button>
                      )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4">
            <h3 className="font-bold text-navy-900 mb-4">{t('prasad.editPrasadItem')}</h3>
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label" htmlFor="prasad-items-editForm">{t('prasad.itemName')}</label>
                  <input id="prasad-items-editForm" className="form-input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div>
                  <label className="form-label" htmlFor="prasad-items-editForm-2">{t('prasad.nameHindi')}</label>
                  <input id="prasad-items-editForm-2" className="form-input" value={editForm.name_hindi} onChange={e => setEditForm(f => ({ ...f, name_hindi: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="form-label" htmlFor="prasad-items-editForm-2-2">{t('prasad.unit')}</label>
                  <input id="prasad-items-editForm-2-2" className="form-input" value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label" htmlFor="prasad-items-editForm-2-2-2">{t('prasad.priceLabel')}</label>
                  <input id="prasad-items-editForm-2-2-2" type="number" min="0" step="0.01" className="form-input" value={editForm.price}
                    onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))} required />
                </div>
                <div>
                  <label className="form-label" htmlFor="prasad-items-editForm-2-2-2-2">{t('prasad.gstRate')}</label>
                  <select id="prasad-items-editForm-2-2-2-2" className="form-select" value={editForm.gst_rate} onChange={e => setEditForm(f => ({ ...f, gst_rate: e.target.value }))}>
                    <option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label" htmlFor="prasad-items-editForm-2-2-2-2-2">{t('prasad.sortOrder')}</label>
                  <input id="prasad-items-editForm-2-2-2-2-2" type="number" min="0" className="form-input" value={editForm.sort_order}
                    onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))} />
                </div>
                <div className="flex items-center gap-3 mt-5">
                  <input type="checkbox" id="available" checked={editForm.is_available}
                    onChange={e => setEditForm(f => ({ ...f, is_available: e.target.checked }))} className="w-4 h-4" />
                  <label htmlFor="available" className="text-sm">{t('prasad.availableInPos')}</label>
                </div>
              </div>
              <UnlimitedTick id="prasad-items-edit-unlimited" checked={editForm.unlimited_stock}
                onChange={v => setEditForm(f => ({ ...f, unlimited_stock: v }))} />
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditItem(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock adjustment modal */}
      {stockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('prasad.adjustStock')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('prasad.currentStockFor', { name: stockModal.name })}{' '}
              <span className="font-bold text-navy-900">{stockModal.stock_qty ?? 0}</span>
            </p>
            <form onSubmit={adjustStock} className="space-y-4">
              <div>
                <label className="form-label" htmlFor="prasad-items-stockAdj">{t('prasad.quantityAdjustment')}</label>
                <input id="prasad-items-stockAdj" type="number" className="form-input" autoFocus value={stockAdj.qty}
                  onChange={e => setStockAdj(f => ({ ...f, qty: e.target.value }))}
                  placeholder={t('prasad.qtyPlaceholder')} required />
                <p className="text-xs text-slate-400 mt-1">{t('prasad.qtyHint')}</p>
              </div>
              <div>
                <label className="form-label" htmlFor="prasad-items-stockAdj-2">{t('prasad.noteOptional')}</label>
                <input id="prasad-items-stockAdj-2" className="form-input" value={stockAdj.note}
                  onChange={e => setStockAdj(f => ({ ...f, note: e.target.value }))}
                  placeholder={t('prasad.notePlaceholder')} />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setStockModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('prasad.adjusting') : t('prasad.adjustStock')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
