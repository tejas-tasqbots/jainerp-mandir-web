import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Minus, Plus, ShoppingCart, Trash2, Receipt } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { autoPrintSlip, printDonationReceipt } from '../../lib/printReceipt'
import { DevoteePicker } from '../../components/DevoteePicker/DevoteePicker'
import type { PrasadItem, DevoteeSelection } from '../../types'
import { useToast } from '../../components/kit/Toast'

interface CartItem { item: PrasadItem; qty: number }

export function PrasadCounter() {
  const toast = useToast()
  const { t } = useTranslation()
  const [items, setItems] = useState<PrasadItem[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(true)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [reference, setReference] = useState('')
  const [buyer, setBuyer] = useState<DevoteeSelection | null>(null)
  const [showBuyerPicker, setShowBuyerPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSale, setLastSale] = useState<{ id: string; total_paise: number; invoice?: string } | null>(null)
  const [receiptLoading, setReceiptLoading] = useState(false)

  useEffect(() => {
    api.get('/prasad/items?is_available=true').then(r => setItems(r.data.data || [])).finally(() => setLoading(false))
  }, [])

  function addToCart(item: PrasadItem) {
    setCart(c => {
      const existing = c.find(ci => ci.item.id === item.id)
      if (existing) return c.map(ci => ci.item.id === item.id ? { ...ci, qty: ci.qty + 1 } : ci)
      return [...c, { item, qty: 1 }]
    })
  }

  function updateQty(itemId: string, qty: number) {
    if (qty <= 0) setCart(c => c.filter(ci => ci.item.id !== itemId))
    else setCart(c => c.map(ci => ci.item.id === itemId ? { ...ci, qty } : ci))
  }

  const subtotal = cart.reduce((s, ci) => s + ci.item.price_paise * ci.qty, 0)
  const gst = cart.reduce((s, ci) => s + Math.round(ci.item.price_paise * ci.qty * ci.item.gst_rate / 100), 0)
  const total = subtotal + gst

  async function checkout() {
    if (cart.length === 0) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        items: cart.map(ci => ({ item_id: ci.item.id, qty: ci.qty })),
        payment_mode: paymentMode,
      }
      if (paymentMode !== 'cash' && reference.trim()) payload.reference_no = reference.trim()

      if (buyer?.is_anonymous) {
        payload.is_anonymous = true
      } else if (buyer?.global_user_id) {
        payload.buyer = { global_user_id: buyer.global_user_id, name: buyer.name, mobile: buyer.mobile }
      } else if (buyer?.name) {
        payload.buyer = { name: buyer.name, mobile: buyer.mobile }
      }

      const { data } = await api.post('/prasad/sales', payload)
      setLastSale({ id: data.data.id, total_paise: data.data.total_paise, invoice: data.data.invoice_no })
      // Auto-print, when the trust has asked for it (Settings -> Receipts ->
      // Counter slips). Not awaited: the counter must be ready for the next
      // devotee whether or not a printer answers, and autoPrintSlip swallows
      // its own errors precisely so a print problem can never read as a failed
      // sale. The Print button below stays for a reprint.
      void autoPrintSlip(data.data.id, '/prasad/sales', data.data.receipt)
      setCart([])
      setReference('')
      setBuyer(null)
      setShowBuyerPicker(false)
    } catch (err) {
      // The API answers with a precise reason ({ code: 'OUT_OF_STOCK', message }).
      // A bare `catch` swallowed it and showed "Sale failed", which left the
      // cashier with no idea that the item simply had no stock.
      const e = err as { response?: { data?: { error?: { message?: string }; message?: string } } }
      toast.error(
        e.response?.data?.error?.message || e.response?.data?.message || t('prasad.saleFailed'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function printLastReceipt() {
    if (!lastSale) return
    setReceiptLoading(true)
    try {
      await printDonationReceipt(lastSale.id, '/prasad/sales')
    } catch {
      toast.error('Could not load receipt')
    } finally {
      setReceiptLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('prasad.counterTitle')}</h1>
        <div className="flex items-center gap-2">
          <Link to="/prasad/sales" className="btn-secondary btn-sm">{t('prasad.salesTitle')}</Link>
          <Link to="/prasad/items" className="btn-secondary btn-sm">{t('prasad.manageItems')}</Link>
        </div>
      </div>

      {lastSale && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-green-800">{t('prasad.saleRecorded')} {lastSale.invoice && <span className="font-mono text-xs">{lastSale.invoice}</span>}</p>
            <p className="text-sm text-green-600">{t('prasad.totalLabel', { amount: fmtPaise(lastSale.total_paise) })}</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={printLastReceipt} disabled={receiptLoading}
              className="btn-secondary btn-sm flex items-center gap-1 disabled:opacity-50">
              <Receipt size={14} /> {receiptLoading ? t('prasad.loadingEllipsis') : t('prasad.printReceipt')}
            </button>
            <button type="button" onClick={() => setLastSale(null)} className="text-green-600 text-xs underline">{t('prasad.dismiss')}</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* Item grid */}
        <div className="col-span-2 space-y-4">
          {loading ? (
            <div className="text-center py-10 text-slate-400">{t('prasad.loadingItems')}</div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {items.map(item => {
                // The sale is rejected server-side when stock_qty < qty, so an
                // out-of-stock item can only ever fail at checkout. Show that on
                // the tile instead of letting it into the cart.
                const outOfStock = Number(item.stock_qty ?? 0) <= 0
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addToCart(item)}
                    disabled={outOfStock}
                    className={
                      outOfStock
                        ? 'card p-4 text-left opacity-60 cursor-not-allowed'
                        : 'card p-4 text-left hover:border-brand-red hover:shadow-md transition-all group'
                    }
                  >
                    <p className="font-semibold text-slate-800 text-sm group-hover:text-brand-red">{item.name}</p>
                    <p className="text-lg font-bold text-navy-900 mt-1">₹{fmtPaise(item.price_paise)}</p>
                    {item.gst_rate > 0 && (
                      <p className="text-xs text-slate-400">{t('prasad.gstSuffix', { rate: item.gst_rate })}</p>
                    )}
                    {outOfStock ? (
                      <p className="text-xs font-medium text-brand-red mt-1">{t('prasad.outOfStock')}</p>
                    ) : (
                      <p className="text-xs text-slate-400 mt-1">{t('prasad.stock', { qty: item.stock_qty ?? 0 })}</p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="card flex flex-col">
          <div className="card-header">
            <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
              <ShoppingCart size={15} /> {t('prasad.cart')}
            </h3>
            {cart.length > 0 && (
              <button type="button" onClick={() => setCart([])} title={t('prasad.clearCart')} aria-label={t('prasad.clearCart')} className="text-xs text-red-500 hover:text-red-700">
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {cart.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">{t('prasad.noItemsAdded')}</p>
            ) : cart.map(ci => (
              <div key={ci.item.id} className="flex items-center justify-between gap-2">
                <span className="text-sm flex-1 truncate">{ci.item.name}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => updateQty(ci.item.id, ci.qty - 1)} title={t('prasad.decreaseQty')} aria-label={t('prasad.decreaseQty')} className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded hover:bg-slate-200">
                    <Minus size={11} />
                  </button>
                  <input
                    type="number" min="1" value={ci.qty} title={t('prasad.quantity')} aria-label={t('prasad.quantity')}
                    onChange={e => updateQty(ci.item.id, parseInt(e.target.value) || 0)}
                    className="w-10 text-center text-sm border border-slate-200 rounded"
                  />
                  <button type="button" onClick={() => updateQty(ci.item.id, ci.qty + 1)} title={t('prasad.increaseQty')} aria-label={t('prasad.increaseQty')} className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded hover:bg-slate-200">
                    <Plus size={11} />
                  </button>
                </div>
                <span className="text-sm font-medium w-16 text-right">₹{fmtPaise(ci.item.price_paise * ci.qty)}</span>
              </div>
            ))}
          </div>

          {cart.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-3 space-y-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>{t('prasad.subtotal')}</span><span>₹{fmtPaise(subtotal)}</span>
                </div>
                {gst > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>{t('prasad.gst')}</span><span>₹{fmtPaise(gst)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-navy-900 pt-1 border-t border-slate-100">
                  <span>{t('prasad.total')}</span><span>₹{fmtPaise(total)}</span>
                </div>
              </div>

              <select className="form-select text-xs" title={t('prasad.paymentMode')} aria-label={t('prasad.paymentMode')} value={paymentMode}
                onChange={e => setPaymentMode(e.target.value)}>
                <option value="cash">{t('common.cash')}</option>
                <option value="upi">{t('common.upi')}</option>
              </select>

              {/* A non-cash sale had nowhere to record its UTR/txn id, so an
                  online collection could not be reconciled against the bank
                  later. Sent as reference_no, which PaymentsService.normalize
                  puts on the tender itself rather than a parallel scalar. */}
              {paymentMode !== 'cash' && (
                <input
                  className="form-input text-xs"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder={t('prasad.referenceHint', { defaultValue: 'UPI / txn reference (optional)' })}
                  aria-label={t('prasad.referenceHint', { defaultValue: 'UPI / txn reference (optional)' })}
                />
              )}

              {/* Optional buyer picker — collapsed by default */}
              <div>
                <button
                  type="button"
                  onClick={() => { setShowBuyerPicker(v => !v); if (showBuyerPicker) setBuyer(null) }}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                >
                  {showBuyerPicker ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {showBuyerPicker ? t('prasad.removeBuyer') : t('prasad.addBuyerOptional')}
                </button>
                {showBuyerPicker && (
                  <div className="mt-2">
                    <DevoteePicker
                      label=""
                      value={buyer}
                      onChange={setBuyer}
                      showAnonymous
                    />
                  </div>
                )}
              </div>

              <button type="button" onClick={checkout} disabled={saving} className="btn-primary w-full justify-center">
                {saving ? t('prasad.processing') : t('prasad.checkoutButton', { amount: fmtPaise(total) })}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
