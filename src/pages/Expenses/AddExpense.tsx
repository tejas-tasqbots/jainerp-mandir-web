import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, X } from 'lucide-react'
import { api, parsePaise } from '../../lib/api'
import { usePaymentModes, useResourceNames } from '../../lib/useDropdownOptions'

export function AddExpense() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    vendor_name: '',
    category: '',
    description: '',
    amount: '',
    payment_mode: 'cash',
    bill_number: '',
    bill_date: new Date().toISOString().slice(0, 10),
    utr_number: '',
    is_on_credit: false,
    gst_amount: '',
    note: '',
  })

  const expenseCategories = useResourceNames('expense-categories', [
    'Electricity', 'Water', 'Salary', 'Maintenance', 'Food & Supplies',
    'Decoration', 'Pooja Material', 'Printing', 'Transport', 'Other',
  ])
  const paymentModes = usePaymentModes()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.description) { setError('Enter expense description'); return }
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Enter valid amount'); return }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        description: form.description,
        amount_paise: parsePaise(form.amount),
        payment_mode: form.payment_mode,
        is_on_credit: form.is_on_credit,
        bill_date: form.bill_date,
      }
      if (form.vendor_name) payload.vendor_name = form.vendor_name
      if (form.category) payload.category = form.category
      if (form.bill_number) payload.bill_number = form.bill_number
      if (form.utr_number) payload.utr_number = form.utr_number
      if (form.gst_amount) payload.gst_amount_paise = parsePaise(form.gst_amount)
      if (form.note) payload.note = form.note

      await api.post('/expenses', payload)
      navigate('/expenses')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to save expense')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-navy-900">New Expense</h1>
        <button onClick={() => navigate('/expenses')} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Vendor / Payee</label>
              <input className="form-input" placeholder="Vendor name" value={form.vendor_name}
                onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Category</label>
              <select className="form-select" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="">Select category...</option>
                {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Description *</label>
            <input className="form-input" placeholder="Brief description of expense" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Amount (₹) *</label>
              <input type="number" min="1" step="0.01" className="form-input" placeholder="0.00"
                value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">GST Amount (₹)</label>
              <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00"
                value={form.gst_amount} onChange={e => setForm(f => ({ ...f, gst_amount: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Payment Mode</label>
              <select className="form-select" value={form.payment_mode}
                onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                {paymentModes.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Bill Date</label>
              <input type="date" className="form-input" value={form.bill_date}
                onChange={e => setForm(f => ({ ...f, bill_date: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Bill / Invoice Number</label>
              <input className="form-input" placeholder="Bill no" value={form.bill_number}
                onChange={e => setForm(f => ({ ...f, bill_number: e.target.value }))} />
            </div>
            {(form.payment_mode !== 'cash') && (
              <div>
                <label className="form-label">UTR / Reference</label>
                <input className="form-input" placeholder="Transaction reference" value={form.utr_number}
                  onChange={e => setForm(f => ({ ...f, utr_number: e.target.value }))} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="on_credit" checked={form.is_on_credit}
              onChange={e => setForm(f => ({ ...f, is_on_credit: e.target.checked }))}
              className="w-4 h-4 accent-orange-600" />
            <label htmlFor="on_credit" className="text-sm text-slate-700">
              On Credit (creates creditor liability — payment to be made later)
            </label>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/expenses')} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? 'Saving...' : 'Save Expense'}
          </button>
        </div>
      </form>
    </div>
  )
}
