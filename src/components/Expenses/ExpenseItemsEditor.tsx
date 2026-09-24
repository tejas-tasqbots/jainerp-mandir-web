import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { fmtPaise } from '../../lib/api'
import { itemAmounts, newItemRow, type ItemRow, type VendorItem } from './expenseItems'

/**
 * The items of one vendor's bill (tenant migration 057): "One Vendor Can give
 * multiple thing or multiple type of products".
 *
 * Picking one of the vendor's products fills its unit, rate, GST and expense
 * head; anything else can be typed. Each row is qty x rate plus its GST, and
 * the bill's amount and GST are the sums - the API derives them the same way.
 */
const OTHER = '__other__'

export function ExpenseItemsEditor({ rows, onChange, products }: {
  rows: ItemRow[]
  onChange: (rows: ItemRow[]) => void
  /** The chosen vendor's product list; empty for a vendor with none. */
  products: VendorItem[]
}) {
  const { t } = useTranslation()
  const set = (key: string, patch: Partial<ItemRow>) =>
    onChange(rows.map(r => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-2" data-testid="expense-items">
      {rows.map((row, i) => {
        const { total } = itemAmounts(row)
        return (
          <div key={row.key} className="rounded-lg border border-slate-200 p-2.5 space-y-2" data-testid="expense-item">
            <div className="grid grid-cols-2 md:grid-cols-[1fr_4.5rem_4.5rem_6rem_4rem_auto] gap-2 items-end">
              <div className="col-span-2 md:col-span-1 space-y-1.5">
                <label className="form-label text-xs">{t('expenseItems.item', { n: i + 1 })}</label>
                {/* The vendor's products first; "Other…" for anything not on the list. */}
                <select className="form-select" aria-label={t('expenseItems.item', { n: i + 1 })}
                  value={row.other ? OTHER : row.vendor_item_id}
                  onChange={e => {
                    const v = e.target.value
                    if (v === OTHER) { set(row.key, { other: true, vendor_item_id: '', description: '', category: '' }); return }
                    const p = products.find(x => x.id === v)
                    set(row.key, p
                      ? {
                        other: false, vendor_item_id: p.id, description: p.name, unit: p.unit ?? '',
                        rate: p.default_rate_paise ? String(p.default_rate_paise / 100) : row.rate,
                        gst_rate: String(p.gst_rate ?? 0), category: p.category ?? '',
                      }
                      : { other: false, vendor_item_id: '', description: '', category: '' })
                  }}>
                  <option value="">{products.length ? t('expenseItems.chooseProduct') : t('expenseItems.noProducts')}</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.unit ? ` (${p.unit})` : ''}</option>)}
                  <option value={OTHER}>{t('expenseItems.other')}</option>
                </select>
                {row.other && (
                  <input className="form-input" autoFocus maxLength={200} value={row.description}
                    aria-label={t('expenseItems.otherName')} placeholder={t('expenseItems.itemPlaceholder')}
                    onChange={e => set(row.key, { description: e.target.value })} />
                )}
              </div>
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
              <button type="button" className="p-2 text-slate-400 hover:text-brand-red rounded mb-0.5"
                title={t('expenseItems.remove')} aria-label={t('expenseItems.remove')}
                onClick={() => onChange(rows.filter(r => r.key !== row.key))}>
                <Trash2 size={14} />
              </button>
            </div>
            {(total > 0 || row.category) && (
              <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                {row.category && <span data-testid="item-category">{row.category}</span>}
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
