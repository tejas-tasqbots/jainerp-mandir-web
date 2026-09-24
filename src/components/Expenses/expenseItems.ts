import { parsePaise } from '../../lib/api'

/** One of a vendor's products (tenant migration 057). */
export interface VendorItem {
  id: string
  vendor_id: string
  name: string
  unit: string | null
  default_rate_paise: number
  category_id: string | null
  category: string | null
  gst_rate: number
  hsn_code: string | null
  is_active: boolean
}

export interface ItemRow {
  key: string
  vendor_item_id: string
  /** "Other…" chosen: an item not on the vendor's list, typed by name. */
  other: boolean
  description: string
  qty: string
  unit: string
  rate: string
  gst_rate: string
  /** The product's own expense head, shown under the row; blank = the bill's category. */
  category: string
}

export const newItemRow = (): ItemRow => ({
  key: Math.random().toString(36).slice(2), vendor_item_id: '', other: false, description: '', qty: '1', unit: '', rate: '', gst_rate: '0', category: '',
})

/**
 * One row's taxable value, GST and total, in paise - the arithmetic the API's
 * prepareExpenseItems does, so the form shows the figure that will be saved.
 */
export function itemAmounts(r: ItemRow): { taxable: number; gst: number; total: number } {
  const taxable = Math.round(parsePaise(r.rate || '0') * Number(r.qty || 0))
  const gst = Math.round((taxable * Number(r.gst_rate || 0)) / 100)
  return { taxable, gst, total: taxable + gst }
}

export function itemsTotals(rows: ItemRow[]): { total: number; gst: number } {
  return rows.reduce((s, r) => {
    const a = itemAmounts(r)
    return { total: s.total + a.total, gst: s.gst + a.gst }
  }, { total: 0, gst: 0 })
}

/** What the API takes; blank rows dropped. */
export function itemsPayload(rows: ItemRow[], billCategory: string) {
  return rows
    .filter(r => r.description.trim() || r.rate)
    .map(r => ({
      ...(r.vendor_item_id ? { vendor_item_id: r.vendor_item_id } : {}),
      description: r.description.trim(),
      qty: Number(r.qty || 1),
      unit: r.unit.trim() || null,
      rate_paise: parsePaise(r.rate || '0'),
      gst_rate: Number(r.gst_rate || 0),
      ...(r.category || billCategory ? { category: r.category || billCategory } : {}),
    }))
}
