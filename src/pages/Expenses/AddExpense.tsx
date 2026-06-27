import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, X } from 'lucide-react'
import { api, parsePaise } from '../../lib/api'
import { useAccounts, usePaymentModes, useResourceNames, autoSelectAccount } from '../../lib/useDropdownOptions'

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
    payment_account_id: '',
    bill_number: '',
    bill_date: new Date().toISOString().slice(0, 10),
    utr_number: '',
    is_on_credit: false,
    gst_amount: '',
    tds_deducted: false,
    tds_amount: '',
    tds_section: '',
    note: '',
  })

  const accounts = useAccounts()
  useEffect(() => {
    const id = autoSelectAccount(accounts, form.payment_mode)
    if (id) setForm(f => ({ ...f, payment_account_id: id }))
  }, [form.payment_mode, accounts])

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
        payment_account_id: form.payment_account_id || undefined,
        is_on_credit: form.is_on_credit,
        bill_date: form.bill_date,
      }
      if (form.vendor_name) payload.vendor_name = form.vendor_name
      if (form.category) payload.category = form.category
      if (form.bill_number) payload.bill_number = form.bill_number
      if (form.utr_number) payload.utr_number = form.utr_number
      if (form.gst_amount) payload.gst_paid_paise = parsePaise(form.gst_amount)
      if (form.tds_deducted) {
        payload.tds_deducted = true
        if (form.tds_amount) payload.tds_amount_paise = parsePaise(form.tds_amount)
        if (form.tds_section) payload.tds_section = form.tds_section
      }
      if (form.note) payload.notes = form.note

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

          {(() => {
            const isCash = form.payment_mode === 'cash'
            const relevantAccounts = form.is_on_credit ? [] : accounts.filter(a => a.type === (isCash ? 'cash' : 'bank'))
            return (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Payment Mode</label>
                  <select className="form-select" value={form.payment_mode}
                    onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value, payment_account_id: '' }))}
                    disabled={form.is_on_credit}>
                    {paymentModes.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Bill Date</label>
                  <input type="date" className="form-input" value={form.bill_date}
                    onChange={e => setForm(f => ({ ...f, bill_date: e.target.value }))} />
                </div>
                {!form.is_on_credit && relevantAccounts.length > 0 && (
                  <div className="col-span-2">
                    <label className="form-label">Paid from Account *</label>
                    <select className="form-select" value={form.payment_account_id}
                      onChange={e => setForm(f => ({ ...f, payment_account_id: e.target.value }))}>
                      <option value="">Select account…</option>
                      {relevantAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.bank_name ? ` — ${a.bank_name}` : ''}{a.account_number ? ` (${a.account_number})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )
          })()}

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

          {/* TDS */}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="tds_deducted" checked={form.tds_deducted}
              onChange={e => setForm(f => ({ ...f, tds_deducted: e.target.checked }))}
              className="w-4 h-4 accent-blue-600" />
            <label htmlFor="tds_deducted" className="text-sm text-slate-700">
              TDS Deducted (track for compliance / Form 26Q)
            </label>
          </div>
          {form.tds_deducted && (
            <div className="grid grid-cols-2 gap-4 pl-7">
              <div>
                <label htmlFor="tds-amount" className="form-label">TDS Amount (₹)</label>
                <input id="tds-amount" type="number" min="0" step="0.01" className="form-input" placeholder="0.00"
                  value={form.tds_amount} onChange={e => setForm(f => ({ ...f, tds_amount: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="tds-section" className="form-label">TDS Section</label>
                <select id="tds-section" className="form-select" value={form.tds_section}
                  onChange={e => setForm(f => ({ ...f, tds_section: e.target.value }))}>
                  <option value="">Select…</option>
                  <option value="194C">194C — Contractor</option>
                  <option value="194J">194J — Professional</option>
                  <option value="194I">194I — Rent</option>
                  <option value="194H">194H — Commission</option>
                  <option value="194Q">194Q — Purchase of goods</option>
                </select>
              </div>
            </div>
          )}

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
