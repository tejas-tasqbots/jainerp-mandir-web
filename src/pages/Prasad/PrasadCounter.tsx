import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { DevoteePicker } from '../../components/DevoteePicker/DevoteePicker'
import type { PrasadItem, DevoteeSelection } from '../../types'

interface CartItem { item: PrasadItem; qty: number }

export function PrasadCounter() {
  const [items, setItems] = useState<PrasadItem[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(true)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [buyer, setBuyer] = useState<DevoteeSelection | null>(null)
  const [showBuyerPicker, setShowBuyerPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSale, setLastSale] = useState<{ total_paise: number; invoice?: string } | null>(null)

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

      if (buyer?.is_anonymous) {
        payload.is_anonymous = true
      } else if (buyer?.global_user_id) {
        payload.buyer = { global_user_id: buyer.global_user_id, name: buyer.name, mobile: buyer.mobile }
      } else if (buyer?.name) {
        payload.buyer = { name: buyer.name, mobile: buyer.mobile }
      }

      const { data } = await api.post('/prasad/sales', payload)
      setLastSale({ total_paise: data.data.total_paise, invoice: data.data.invoice_no })
      setCart([])
      setBuyer(null)
      setShowBuyerPicker(false)
    } catch {
      alert('Sale failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Prasad Counter</h1>
        <Link to="/prasad/items" className="btn-secondary btn-sm">Manage Items</Link>
      </div>

      {lastSale && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-green-800">Sale recorded!</p>
            <p className="text-sm text-green-600">Total: ₹{fmtPaise(lastSale.total_paise)}</p>
          </div>
          <button onClick={() => setLastSale(null)} className="text-green-600 text-xs underline">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* Item grid */}
        <div className="col-span-2 space-y-4">
          {loading ? (
            <div className="text-center py-10 text-slate-400">Loading items...</div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {items.map(item => (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  className="card p-4 text-left hover:border-brand-red hover:shadow-md transition-all group"
                >
                  <p className="font-semibold text-slate-800 text-sm group-hover:text-brand-red">{item.name}</p>
                  <p className="text-lg font-bold text-navy-900 mt-1">₹{fmtPaise(item.price_paise)}</p>
                  {item.gst_rate > 0 && (
                    <p className="text-xs text-slate-400">+{item.gst_rate}% GST</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">Stock: {item.stock_qty ?? 0}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="card flex flex-col">
          <div className="card-header">
            <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
              <ShoppingCart size={15} /> Cart
            </h3>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs text-red-500 hover:text-red-700">
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {cart.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">No items added</p>
            ) : cart.map(ci => (
              <div key={ci.item.id} className="flex items-center justify-between gap-2">
                <span className="text-sm flex-1 truncate">{ci.item.name}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQty(ci.item.id, ci.qty - 1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded hover:bg-slate-200">
                    <Minus size={11} />
                  </button>
                  <input
                    type="number" min="1" value={ci.qty}
                    onChange={e => updateQty(ci.item.id, parseInt(e.target.value) || 0)}
                    className="w-10 text-center text-sm border border-slate-200 rounded"
                  />
                  <button onClick={() => updateQty(ci.item.id, ci.qty + 1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded hover:bg-slate-200">
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
                  <span>Subtotal</span><span>₹{fmtPaise(subtotal)}</span>
                </div>
                {gst > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>GST</span><span>₹{fmtPaise(gst)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-navy-900 pt-1 border-t border-slate-100">
                  <span>Total</span><span>₹{fmtPaise(total)}</span>
                </div>
              </div>

              <select className="form-select text-xs" value={paymentMode}
                onChange={e => setPaymentMode(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
              </select>

              {/* Optional buyer picker — collapsed by default */}
              <div>
                <button
                  type="button"
                  onClick={() => { setShowBuyerPicker(v => !v); if (showBuyerPicker) setBuyer(null) }}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                >
                  {showBuyerPicker ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {showBuyerPicker ? 'Remove buyer' : 'Add buyer (optional)'}
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

              <button onClick={checkout} disabled={saving} className="btn-primary w-full justify-center">
                {saving ? 'Processing...' : `Checkout — ₹${fmtPaise(total)}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
