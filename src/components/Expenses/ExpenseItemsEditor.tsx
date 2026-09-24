import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise, parsePaise } from '../../lib/api'
import { useToast } from '../kit/Toast'
import { itemAmounts, newItemRow, type ItemRow, type VendorItem } from './expenseItems'
import { ProductPicker } from './ProductPicker'

/**
 * The items of one vendor's bill (tenant migration 057): "One Vendor Can give
 * multiple thing or multiple type of products".
 *
 * Each item is searched in the vendor's product list; a pick fills its unit,
 * rate, GST and expense head. Something not on the list can be kept as typed,
 * or added to the vendor's products on the spot; a product billed at a new
 * rate can have that rate saved back as the vendor's usual one. Each row is
 * qty x rate plus its GST, and the bill's amount and GST are the sums - the
 * API derives them the same way.
 */
export function ExpenseItemsEditor({ rows, onChange, products, vendor, onProductsChanged, billCategory = '' }: {
  rows: ItemRow[]
  onChange: (rows: ItemRow[]) => void
  /** The chosen vendor's product list; empty for a vendor with none. */
  products: VendorItem[]
  /** The bill's vendor, when one is picked. */
  vendor?: { id: string; name: string } | null
  /** Reloads the product list after one is added or updated here; resolves to the new list. */
  onProductsChanged?: () => Promise<VendorItem[]>
  /** The bill's category, filed on a product added from here. */
  billCategory?: string
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const set = (key: string, patch: Partial<ItemRow>) =>
    onChange(rows.map(r => (r.key === key ? { ...r, ...patch } : r)))

  const fromProduct = (row: ItemRow, p: VendorItem): Partial<ItemRow> => ({
    other: false, vendor_item_id: p.id, description: p.name, unit: p.unit ?? '',
    rate: p.default_rate_paise ? String(p.default_rate_paise / 100) : row.rate,
    gst_rate: String(p.gst_rate ?? 0), category: p.category ?? '',
  })

  /** Adds a typed item to the vendor's products, with this row's unit, rate and GST. */
  async function addToVendor(row: ItemRow, name: string) {
    if (!vendor) return
    setBusy(true)
    try {
      const { data } = await api.post(`/vendors/${vendor.id}/items`, {
        name, unit: row.unit.trim() || null, default_rate_paise: parsePaise(row.rate || '0'),
        gst_rate: Number(row.gst_rate || 0), ...(billCategory ? { category: billCategory } : {}),
      })
      const list = (await onProductsChanged?.()) ?? products
      const made: VendorItem | undefined = list.find(p => p.id === data.data?.id) ?? data.data
      if (made) set(row.key, { ...fromProduct(row, made), qty: row.qty, rate: row.rate || fromProduct(row, made).rate })
      toast.success(t('expenseItems.addedToVendor', { name, vendor: vendor.name }))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('vendorProducts.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  /** Saves this row's unit, rate and GST as the product's usual ones. */
  async function updateProduct(row: ItemRow, p: VendorItem) {
    setBusy(true)
    try {
      await api.patch(`/vendors/items/${p.id}`, {
        unit: row.unit.trim() || null, default_rate_paise: parsePaise(row.rate || '0'), gst_rate: Number(row.gst_rate || 0),
      })
      await onProductsChanged?.()
      toast.success(t('expenseItems.productUpdated', { name: p.name }))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('vendorProducts.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="expense-items">
      {rows.map((row, i) => {
        const { total } = itemAmounts(row)
        const picked = row.vendor_item_id ? products.find(p => p.id === row.vendor_item_id) : undefined
        // Billed differently from what is on file: offer to make it the usual.
        const changed = picked && row.rate !== '' && (
          parsePaise(row.rate) !== Number(picked.default_rate_paise)
          || (row.unit.trim() || null) !== (picked.unit || null)
          || Number(row.gst_rate || 0) !== Number(picked.gst_rate || 0)
        )
        return (
          <div key={row.key} className="rounded-lg border border-slate-200 p-2.5 space-y-2" data-testid="expense-item">
            {/* A phone: the product and its bin on one line, then qty, unit,
                rate and GST side by side. */}
            <div className="grid grid-cols-4 md:grid-cols-[1fr_4.5rem_4.5rem_6rem_4rem_auto] gap-2 items-end">
              <div className="col-span-3 md:col-span-1">
                <label className="form-label text-xs">{t('expenseItems.item', { n: i + 1 })}</label>
                <ProductPicker
                  label={t('expenseItems.item', { n: i + 1 })}
                  value={row.description}
                  products={products}
                  vendorName={vendor?.name ?? null}
                  busy={busy}
                  onPick={p => set(row.key, fromProduct(row, p))}
                  onType={text => {
                    // Typing over a picked product makes it a typed item, unless
                    // it is exactly one of the vendor's.
                    const same = products.find(p => p.name.trim().toLowerCase() === text.trim().toLowerCase())
                    set(row.key, same && same.id === row.vendor_item_id
                      ? { description: text }
                      : { description: text, vendor_item_id: '', other: text.trim() !== '', category: '' })
                  }}
                  onAdd={vendor ? name => addToVendor(row, name) : undefined}
                />
              </div>
              <button type="button" className="p-2 text-slate-400 hover:text-brand-red rounded mb-0.5 justify-self-end md:order-last"
                title={t('expenseItems.remove')} aria-label={t('expenseItems.remove')}
                onClick={() => onChange(rows.filter(r => r.key !== row.key))}>
                <Trash2 size={14} />
              </button>
              <div>
                <label className="form-label text-xs">{t('expenseItems.qty')}</label>
                <input type="number" min="0.001" step="0.001" className="form-input" value={row.qty}
                  aria-label={t('expenseItems.qty')} onChange={e => set(row.key, { qty: e.target.value })} />
              </div>
              <div>
                <label className="form-label text-xs">{t('expenseItems.unit')}</label>
                <input className="form-input" value={row.unit} maxLength={30} placeholder="kg"
                  aria-label={t('expenseItems.unit')} onChange={e => set(row.key, { unit: e.target.value })} />
              </div>
              <div>
                <label className="form-label text-xs">{t('expenseItems.rate')}</label>
                <input type="number" min="0" step="0.01" className="form-input" value={row.rate} placeholder="0.00"
                  aria-label={t('expenseItems.rate')} onChange={e => set(row.key, { rate: e.target.value })} />
              </div>
              <div>
                <label className="form-label text-xs">{t('expenseItems.gstPct')}</label>
                <input type="number" min="0" max="40" step="0.01" className="form-input" value={row.gst_rate}
                  aria-label={t('expenseItems.gstPct')} onChange={e => set(row.key, { gst_rate: e.target.value })} />
              </div>
            </div>
            {(total > 0 || row.category || changed) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mt-1">
                {row.category && <span data-testid="item-category">{row.category}</span>}
                {changed && picked && (
                  <button type="button" disabled={busy} data-testid="product-update"
                    className="inline-flex items-center gap-1 text-brand-blue hover:underline disabled:opacity-50"
                    onClick={() => updateProduct(row, picked)}>
                    <RefreshCw size={12} /> {t('expenseItems.saveAsUsual', { name: picked.name, rate: fmtPaise(parsePaise(row.rate)) })}
                  </button>
                )}
                {total > 0 && <span className="ml-auto text-sm font-semibold text-navy-900" data-testid="item-amount">₹{fmtPaise(total)}</span>}
              </div>
            )}
          </div>
        )
      })}
      <button type="button" className="btn-secondary btn-sm" onClick={() => onChange([...rows, newItemRow()])}>
        <Plus size={14} /> {t('expenseItems.add')}
      </button>
    </div>
  )
}
