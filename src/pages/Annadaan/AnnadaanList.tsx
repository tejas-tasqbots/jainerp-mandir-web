import { useEffect, useState } from 'react'
import { Plus, Save, RefreshCw, Receipt } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { printDonationReceipt } from '../../lib/printReceipt'
import type { BhojanshalaSale } from '../../types'

export function AnnadaanList() {
  const [sales, setSales] = useState<BhojanshalaSale[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10))
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<{ tokens: number; collection_paise: number } | null>(null)
  const [redeemId, setRedeemId] = useState<string | null>(null)
  const [redeemTokens, setRedeemTokens] = useState('')
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null)

  const [form, setForm] = useState({
    meal_type: 'lunch',
    tokens: '',
    rate: '20',
    payment_mode: 'cash',
    devotee_mobile: '',
    buyer_name: '',
  })

  useEffect(() => { load() }, [dateFilter])

  async function load() {
    setLoading(true)
    try {
      const [salesResp, summaryResp] = await Promise.allSettled([
        api.get(`/bhojanshala/sales?date=${dateFilter}&limit=50`),
        api.get(`/bhojanshala/daily-summary?date=${dateFilter}`),
      ])
      if (salesResp.status === 'fulfilled') setSales(salesResp.value.data.data || [])
      // daily-summary returns { date, by_meal, totals: { tokens, collection_paise } }
      if (summaryResp.status === 'fulfilled') setSummary(summaryResp.value.data.data?.totals ?? null)
    } finally {
      setLoading(false)
    }
  }

  async function recordSale(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/bhojanshala/sales', {
        meal_type: form.meal_type,
        tokens: parseInt(form.tokens),
        rate_paise: parsePaise(form.rate),
        payment_mode: form.payment_mode,
        devotee_mobile: form.devotee_mobile || undefined,
        buyer_name: form.buyer_name || undefined,
        sale_date: dateFilter,
      })
      setForm({ meal_type: 'lunch', tokens: '', rate: '20', payment_mode: 'cash', devotee_mobile: '', buyer_name: '' })
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function openReceipt(id: string) {
    setReceiptLoading(id)
    try {
      await printDonationReceipt(id, '/bhojanshala/sales')
    } catch {
      alert('Could not load receipt')
    } finally {
      setReceiptLoading(null)
    }
  }

  async function redeemSale(id: string) {
    if (!redeemTokens) return
    setSaving(true)
    try {
      await api.patch(`/bhojanshala/sales/${id}/redeem`, { tokens_redeemed: parseInt(redeemTokens) })
      setRedeemId(null)
      setRedeemTokens('')
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e.response?.data?.error?.message || 'Redeem failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Bhojanshala</h1>
        <div className="flex gap-2">
          <input type="date" className="form-input w-44" value={dateFilter}
            onChange={e => setDateFilter(e.target.value)} />
          <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm">
            <Plus size={14} /> Record Sale
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card">
            <div className="card-body py-3">
              <p className="text-xs text-slate-400">Total Tokens (this date)</p>
              <p className="text-2xl font-bold text-navy-900">{summary.tokens ?? 0}</p>
            </div>
          </div>
          <div className="card">
            <div className="card-body py-3">
              <p className="text-xs text-slate-400">Total Collection</p>
              <p className="text-2xl font-bold text-green-700">₹{fmtPaise(summary.collection_paise ?? 0)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Record Bhojanshala Sale</h3></div>
          <form onSubmit={recordSale} className="card-body">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="form-label">Buyer Name</label>
                <input className="form-input" value={form.buyer_name}
                  onChange={e => setForm(f => ({ ...f, buyer_name: e.target.value }))} placeholder="Optional" />
              </div>
              <div>
                <label className="form-label">Meal Type</label>
                <select className="form-select" value={form.meal_type} onChange={e => setForm(f => ({ ...f, meal_type: e.target.value }))}>
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                </select>
              </div>
              <div>
                <label className="form-label">Tokens</label>
                <input type="number" min="1" className="form-input" value={form.tokens}
                  onChange={e => setForm(f => ({ ...f, tokens: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Rate/Token (₹)</label>
                <input type="number" min="0" step="0.01" className="form-input" value={form.rate}
                  onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Payment Mode</label>
                <select className="form-select" value={form.payment_mode} onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="free">Free / Sponsored</option>
                </select>
              </div>
              <div>
                <label className="form-label">Mobile (opt.)</label>
                <div className="flex gap-0">
                  <span className="flex items-center px-3 bg-slate-50 border border-slate-300 border-r-0 rounded-l-md text-sm text-slate-500">+91</span>
                  <input className="form-input rounded-l-none flex-1" value={form.devotee_mobile} inputMode="numeric" maxLength={10}
                    onChange={e => setForm(f => ({ ...f, devotee_mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="10-digit mobile" />
                </div>
              </div>
            </div>
            {form.tokens && form.rate && (
              <p className="text-sm font-semibold text-green-700 mb-3">
                Total: ₹{fmtPaise(parseInt(form.tokens || '0') * parsePaise(form.rate))}
              </p>
            )}
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary btn-sm">
                <Save size={14} /> {saving ? 'Saving...' : 'Record'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Meal Type</th>
                <th>Tokens Sold</th>
                <th>Redeemed</th>
                <th>Rate</th>
                <th>Total</th>
                <th>Mode</th>
                <th>Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">Loading...</td></tr>
              ) : sales.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">No sales recorded</td></tr>
              ) : sales.map(s => {
                const remaining = s.plates - (s.tokens_redeemed ?? 0)
                return (
                <tr key={s.id}>
                  <td className="font-medium">{s.buyer_name || '—'}</td>
                  <td className="capitalize">{s.meal_type}</td>
                  <td className="font-semibold">{s.plates}</td>
                  <td className={s.tokens_redeemed ? 'text-green-700' : 'text-slate-400'}>
                    {s.tokens_redeemed ?? 0}{s.tokens_redeemed ? ` / ${s.plates}` : ''}
                  </td>
                  <td>₹{fmtPaise(s.rate_per_plate_paise)}</td>
                  <td className="font-semibold">₹{fmtPaise(s.total_paise)}</td>
                  <td><span className="badge-gray">{s.payment_mode}</span></td>
                  <td className="text-xs text-slate-400">{new Date(s.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>
                    <div className="flex gap-1 items-center">
                      {redeemId === s.id ? (
                        <>
                          <input type="number" min="1" max={remaining} title="Tokens to redeem" className="form-input w-16 text-xs py-0.5" autoFocus
                            value={redeemTokens} onChange={e => setRedeemTokens(e.target.value)} placeholder="qty" />
                          <button type="button" onClick={() => redeemSale(s.id)} disabled={saving} className="btn-success btn-sm" aria-label="Confirm redeem">
                            <RefreshCw size={12} />
                          </button>
                          <button type="button" onClick={() => { setRedeemId(null); setRedeemTokens('') }} className="btn-secondary btn-sm" aria-label="Cancel redeem">×</button>
                        </>
                      ) : (
                        remaining > 0 && (
                          <button type="button" onClick={() => setRedeemId(s.id)} className="btn-secondary btn-sm text-xs">Redeem</button>
                        )
                      )}
                      <button
                        type="button"
                        onClick={() => openReceipt(s.id)}
                        title="Print token slip"
                        aria-label="Print token slip"
                        disabled={receiptLoading === s.id}
                        className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
                      >
                        <Receipt size={14} className={receiptLoading === s.id ? 'animate-pulse' : ''} />
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
