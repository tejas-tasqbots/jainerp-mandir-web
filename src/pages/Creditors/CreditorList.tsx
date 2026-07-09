import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import type { Creditor } from '../../types'

type PayMode = 'cash' | 'upi' | 'cheque' | 'netbanking'

interface PayModal {
  id: string
  vendorName: string
  outstanding: number
  currentPaid: number
}

interface AddModal {
  open: boolean
  vendor_name: string
  description: string
  amount: string
  due_date: string
}

interface Account { id: string; name: string; type: string }

export function CreditorList() {
  const [creditors, setCreditors] = useState<Creditor[]>([])
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [payModal, setPayModal] = useState<PayModal | null>(null)
  const [payAmt, setPayAmt] = useState('')
  const [payMode, setPayMode] = useState<PayMode>('cash')
  const [payAccountId, setPayAccountId] = useState('')
  const [paying, setPaying] = useState(false)
  const [addModal, setAddModal] = useState<AddModal>({
    open: false, vendor_name: '', description: '', amount: '', due_date: '',
  })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [cr, ac] = await Promise.all([
        api.get('/creditors?limit=100'),
        api.get('/accounts?is_active=true'),
      ])
      setCreditors(cr.data.data || [])
      setAccounts(ac.data.data || [])
    } catch {
      setCreditors([])
    } finally {
      setLoading(false)
    }
  }

  const bankAccounts = accounts.filter(a => a.type !== 'cash')

  function openPayModal(c: Creditor) {
    const outstanding = c.original_amount_paise - c.paid_amount_paise
    setPayModal({ id: c.id, vendorName: c.vendor_name || 'Unknown', outstanding, currentPaid: c.paid_amount_paise })
    setPayAmt('')
    setPayMode('cash')
    setPayAccountId('')
    setError('')
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!payModal) return
    const payPaise = parsePaise(payAmt)
    if (!payPaise || payPaise <= 0) { setError('Enter a valid amount'); return }
    if (payPaise > payModal.outstanding) { setError(`Cannot pay more than outstanding ₹${fmtPaise(payModal.outstanding)}`); return }
    if (payMode !== 'cash' && !payAccountId) { setError('Select the bank account this payment came from'); return }
    setPaying(true)
    setError('')
    try {
      // Dedicated pay endpoint records a real cash/bank outflow (updates the
      // Cash/Bank Book & Balance Sheet), unlike the old generic PATCH.
      await api.post(`/creditors/${payModal.id}/pay`, {
        amount_paise: payPaise,
        payment_mode: payMode,
        payment_account_id: payMode === 'cash' ? undefined : payAccountId,
        payment_date: new Date().toISOString().slice(0, 10),
      })
      setPayModal(null)
      load()
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e2.response?.data?.error?.message || 'Payment failed. Please try again.')
    } finally {
      setPaying(false)
    }
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    setError('')
    try {
      await api.post('/creditors', {
        vendor_name: addModal.vendor_name,
        description: addModal.description,
        original_amount_paise: parsePaise(addModal.amount),
        due_date: addModal.due_date || null,
        status: 'pending',
      })
      setAddModal({ open: false, vendor_name: '', description: '', amount: '', due_date: '' })
      load()
    } catch {
      setError('Failed to add entry.')
    } finally {
      setAdding(false)
    }
  }

  const totalOutstanding = creditors.reduce((s, c) => s + (c.original_amount_paise - c.paid_amount_paise), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Creditors (Udhaar)</h1>
        <div className="flex items-center gap-4">
          {totalOutstanding > 0 && (
            <div className="text-right">
              <p className="text-xs text-slate-400">Total Outstanding</p>
              <p className="font-bold text-red-600 text-lg">₹{fmtPaise(totalOutstanding)}</p>
            </div>
          )}
          <button onClick={() => setAddModal(a => ({ ...a, open: true }))} className="btn-primary">
            <Plus size={15} /> Add Entry
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor / Payee</th>
                <th>Description</th>
                <th>Original</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : creditors.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">No creditor entries found</td></tr>
              ) : creditors.map(c => {
                const outstanding = c.original_amount_paise - c.paid_amount_paise
                return (
                  <tr key={c.id}>
                    <td className="font-medium">{c.vendor_name || '—'}</td>
                    <td className="text-slate-600">{c.description}</td>
                    <td>₹{fmtPaise(c.original_amount_paise)}</td>
                    <td className="text-green-700">₹{fmtPaise(c.paid_amount_paise)}</td>
                    <td className={outstanding > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
                      ₹{fmtPaise(outstanding)}
                    </td>
                    <td className="text-xs text-slate-400">
                      {c.due_date ? new Date(c.due_date).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td>
                      {c.status === 'paid'
                        ? <span className="badge-green">Paid</span>
                        : c.status === 'partially_paid'
                        ? <span className="badge-yellow">Partial</span>
                        : <span className="badge-red">Pending</span>}
                    </td>
                    <td>
                      {c.status !== 'paid' && (
                        <button onClick={() => openPayModal(c)} className="btn-success btn-sm">
                          Pay
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-navy-900">Record Payment</h2>
              <button onClick={() => setPayModal(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitPayment} className="p-6 space-y-4">
              <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
                <p className="text-slate-500">Vendor: <span className="font-semibold text-slate-700">{payModal.vendorName}</span></p>
                <p className="text-slate-500">Outstanding: <span className="font-bold text-red-600">₹{fmtPaise(payModal.outstanding)}</span></p>
              </div>
              <div>
                <label className="form-label">Payment Amount (₹) *</label>
                <input
                  type="number" step="0.01" min="0.01"
                  max={(payModal.outstanding / 100).toFixed(2)}
                  className="form-input" placeholder="0.00"
                  value={payAmt}
                  onChange={e => { setPayAmt(e.target.value); setError('') }}
                  autoFocus required
                />
                <button type="button" className="mt-1 text-xs text-brand-red hover:underline"
                  onClick={() => setPayAmt((payModal.outstanding / 100).toFixed(2))}>
                  Pay full outstanding (₹{fmtPaise(payModal.outstanding)})
                </button>
              </div>
              <div>
                <label className="form-label">Payment Mode *</label>
                <select className="form-input" value={payMode}
                  onChange={e => { setPayMode(e.target.value as PayMode); setError('') }}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="netbanking">Net Banking</option>
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  {payMode === 'cash' ? 'Paid from Cash in Hand.' : 'Paid from the selected bank account.'}
                </p>
              </div>
              {payMode !== 'cash' && (
                <div>
                  <label className="form-label">Bank Account *</label>
                  <select className="form-input" value={payAccountId}
                    onChange={e => { setPayAccountId(e.target.value); setError('') }}>
                    <option value="">Select account…</option>
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setPayModal(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={paying} className="btn-success">
                  {paying ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Creditor Entry Modal */}
      {addModal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-navy-900">Add Creditor Entry</h2>
              <button onClick={() => setAddModal(a => ({ ...a, open: false }))} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitAdd} className="p-6 space-y-4">
              <div>
                <label className="form-label">Vendor / Payee Name *</label>
                <input className="form-input" value={addModal.vendor_name}
                  onChange={e => setAddModal(a => ({ ...a, vendor_name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Description *</label>
                <input className="form-input" value={addModal.description} placeholder="e.g. June electricity bill"
                  onChange={e => setAddModal(a => ({ ...a, description: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Amount (₹) *</label>
                <input type="number" step="0.01" min="1" className="form-input" value={addModal.amount}
                  onChange={e => setAddModal(a => ({ ...a, amount: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Due Date</label>
                <input type="date" className="form-input" value={addModal.due_date}
                  onChange={e => setAddModal(a => ({ ...a, due_date: e.target.value }))} />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setAddModal(a => ({ ...a, open: false }))} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={adding} className="btn-primary">
                  {adding ? 'Adding...' : 'Add Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
