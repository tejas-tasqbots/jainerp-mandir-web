import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PackagePlus, Search } from 'lucide-react'
import { fmtPaise } from '../../lib/api'
import type { VendorItem } from './expenseItems'

/**
 * An expense item's name box, over the chosen vendor's product list.
 *
 * Typing searches the vendor's products; picking one fills the row (unit, rate,
 * GST, head). Something the vendor has not got on file is either kept as typed
 * for this bill, or added to the vendor's products from right here - no trip
 * to Masters → Vendors (founder, 2026-09-24: "the vendor expenses item add or
 * update or search here itself so it will be easy to access").
 */
export function ProductPicker({ label, value, products, vendorName, onPick, onType, onAdd, busy }: {
  label: string
  /** What the row says now: a picked product's name or the typed text. */
  value: string
  products: VendorItem[]
  /** The bill's vendor; null until one is picked (their list is then unknown). */
  vendorName: string | null
  onPick: (p: VendorItem) => void
  onType: (text: string) => void
  /** Adds the typed name to the vendor's products; absent when that is not allowed. */
  onAdd?: (name: string) => void
  busy?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const q = value.trim().toLowerCase()
  const exact = products.find(p => p.name.trim().toLowerCase() === q)
  // A picked product shows the whole list again, so it can be swapped.
  const matches = useMemo(() => (!q || exact ? products : products.filter(p => p.name.toLowerCase().includes(q))), [products, q, exact])

  return (
    <div className="relative" ref={box}>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input className="form-input pl-8" value={value} aria-label={label} autoComplete="off" data-testid="item-product"
        placeholder={vendorName ? t('expenseItems.searchProducts') : t('expenseItems.typeItem')}
        onFocus={() => setOpen(true)}
        onChange={e => { onType(e.target.value); setOpen(true) }}
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && open && matches.length === 1 && q) { e.preventDefault(); onPick(matches[0]); setOpen(false) }
        }} />
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[16rem] rounded-lg border border-slate-200 bg-white shadow-lg max-h-72 overflow-y-auto" role="listbox">
          {!vendorName && (
            <p className="px-3 py-2 text-xs text-slate-500">{t('expenseItems.pickVendorFirst')}</p>
          )}
          {vendorName && products.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-500">{t('expenseItems.noProductsYet', { vendor: vendorName })}</p>
          )}
          {matches.map(p => (
            <button key={p.id} type="button" role="option" aria-selected={p.name === value} data-testid="product-option"
              className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-3 border-b border-slate-50 last:border-0"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(p); setOpen(false) }}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-navy-900">{p.name}{p.unit ? ` (${p.unit})` : ''}</span>
                {p.category && <span className="block truncate text-xs text-slate-400">{p.category}</span>}
              </span>
              <span className="shrink-0 text-right text-xs text-slate-500">
                {p.default_rate_paise > 0 && <span className="block font-semibold text-slate-700">₹{fmtPaise(p.default_rate_paise)}</span>}
                {Number(p.gst_rate) > 0 && <span className="block">{t('expenseItems.gstShort', { rate: Number(p.gst_rate) })}</span>}
              </span>
            </button>
          ))}
          {vendorName && q && matches.length === 0 && products.length > 0 && (
            <p className="px-3 py-2 text-xs text-slate-500">{t('expenseItems.noProductMatch')}</p>
          )}
          {q && !exact && (
            <div className="border-t border-slate-100 bg-slate-50/60">
              {vendorName && onAdd && (
                <button type="button" disabled={busy} data-testid="product-add"
                  className="w-full text-left px-3 py-2 text-sm text-brand-blue hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onAdd(value.trim()); setOpen(false) }}>
                  <PackagePlus size={14} /> {t('expenseItems.addToVendor', { name: value.trim(), vendor: vendorName })}
                </button>
              )}
              <button type="button" data-testid="product-keep-typed"
                className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-100"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setOpen(false)}>
                {t('expenseItems.useJustThisBill', { name: value.trim() })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
