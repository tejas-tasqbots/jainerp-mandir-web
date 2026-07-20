import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, X } from 'lucide-react'
import { api, parsePaise } from '../../lib/api'
import { useAccounts, usePaymentModes, useResourceNames, autoSelectAccount } from '../../lib/useDropdownOptions'

export function AddExpense() {
  const { t } = useTranslation()
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
    is_recurring: false,
    cheque_number: '',
    cheque_bank: '',
    cheque_date: new Date().toISOString().slice(0, 10),
  })

  const accounts = useAccounts()
  useEffect(() => {
    const id = autoSelectAccount(accounts, form.payment_mode)
    if (id) setForm(f => ({ ...f, payment_account_id: id }))
  }, [form.payment_mode, accounts])

  // Vendors master → autocomplete the Vendor/Payee field so an expense links to
  // an existing vendor (vendor_id) instead of silently creating a duplicate on
  // every typo. Typing a new name still works (backend find-or-creates).
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    api.get('/vendors?limit=500').then(r => setVendors(r.data.data || [])).catch(() => {})
  }, [])

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
        is_recurring: form.is_recurring,
        recurrence_rule: form.is_recurring ? 'monthly' : undefined,
      }
      if (form.vendor_name) {
        payload.vendor_name = form.vendor_name
        // Link to the existing vendor when the name matches the master, so we
        // don't create a duplicate vendor row for the same supplier.
        const matched = vendors.find(v => v.name.toLowerCase() === form.vendor_name.trim().toLowerCase())
        if (matched) payload.vendor_id = matched.id
      }
      if (form.category) payload.category = form.category
      if (form.bill_number) payload.bill_number = form.bill_number
      if (form.utr_number) payload.utr_number = form.utr_number
      if (form.payment_mode === 'cheque') {
        if (form.cheque_number) payload.cheque_number = form.cheque_number
        if (form.cheque_bank) payload.cheque_bank = form.cheque_bank
        payload.cheque_date = form.cheque_date
      }
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
        <h1 className="text-xl font-bold text-navy-900">{t('expenses.newExpenseTitle')}</h1>
        <button onClick={() => navigate('/expenses')} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('expenses.vendorPayee')}</label>
              <input className="form-input" placeholder={t('expenses.vendorPlaceholder')} value={form.vendor_name}
                list="vendor-options" autoComplete="off"
                onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} />
              <datalist id="vendor-options">
                {vendors.map(v => <option key={v.id} value={v.name} />)}
              </datalist>
            </div>
            <div>
              <label className="form-label">{t('expenses.category')}</label>
              <select className="form-select" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="">{t('expenses.selectCategory')}</option>
                {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">{t('expenses.descriptionRequired')}</label>
            <input className="form-input" placeholder={t('expenses.descriptionRequiredPlaceholder')} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('expenses.amountLabel')}</label>
              <input type="number" min="1" step="0.01" className="form-input" placeholder="0.00"
                value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('expenses.gstAmount')}</label>
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
                  <label className="form-label">{t('expenses.paymentMode')}</label>
                  <select className="form-select" value={form.payment_mode}
                    onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value, payment_account_id: '' }))}
                    disabled={form.is_on_credit}>
                    {paymentModes.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">{t('expenses.billDate')}</label>
                  <input type="date" className="form-input" value={form.bill_date}
                    onChange={e => setForm(f => ({ ...f, bill_date: e.target.value }))} />
                </div>
                {!form.is_on_credit && relevantAccounts.length > 0 && (
                  <div className="col-span-2">
                    <label className="form-label">{t('expenses.paidFromAccount')}</label>
                    <select className="form-select" value={form.payment_account_id}
                      onChange={e => setForm(f => ({ ...f, payment_account_id: e.target.value }))}>
                      <option value="">{t('expenses.selectAccount')}</option>
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
              <label className="form-label">{t('expenses.billInvoiceNumber')}</label>
              <input className="form-input" placeholder={t('expenses.billNoPlaceholder')} value={form.bill_number}
                onChange={e => setForm(f => ({ ...f, bill_number: e.target.value }))} />
            </div>
            {(form.payment_mode !== 'cash' && form.payment_mode !== 'cheque') && (
              <div>
                <label className="form-label">{t('expenses.utrReference')}</label>
                <input className="form-input" placeholder={t('expenses.utrPlaceholder')} value={form.utr_number}
                  onChange={e => setForm(f => ({ ...f, utr_number: e.target.value }))} />
              </div>
            )}
          </div>

          {form.payment_mode === 'cheque' && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="form-label">{t('cheques.chequeNo')}</label>
                <input className="form-input" value={form.cheque_number}
                  onChange={e => setForm(f => ({ ...f, cheque_number: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">{t('cheques.bank')}</label>
                <input className="form-input" value={form.cheque_bank}
                  onChange={e => setForm(f => ({ ...f, cheque_bank: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">{t('cheques.chequeDate')}</label>
                <input type="date" className="form-input" value={form.cheque_date}
                  onChange={e => setForm(f => ({ ...f, cheque_date: e.target.value }))} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <input type="checkbox" id="on_credit" checked={form.is_on_credit}
              onChange={e => setForm(f => ({ ...f, is_on_credit: e.target.checked }))}
              className="w-4 h-4 accent-orange-600" />
            <label htmlFor="on_credit" className="text-sm text-slate-700">
              {t('expenses.onCreditLabel')}
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="is_recurring" checked={form.is_recurring}
              onChange={e => setForm(f => ({ ...f, is_recurring: e.target.checked }))}
              className="w-4 h-4 accent-brand-blue" />
            <label htmlFor="is_recurring" className="text-sm text-slate-700">
              {t('expenses.recurringLabel')}
            </label>
          </div>

          {/* TDS */}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="tds_deducted" checked={form.tds_deducted}
              onChange={e => setForm(f => ({ ...f, tds_deducted: e.target.checked }))}
              className="w-4 h-4 accent-blue-600" />
            <label htmlFor="tds_deducted" className="text-sm text-slate-700">
              {t('expenses.tdsDeducted')}
            </label>
          </div>
          {form.tds_deducted && (
            <div className="grid grid-cols-2 gap-4 pl-7">
              <div>
                <label htmlFor="tds-amount" className="form-label">{t('expenses.tdsAmount')}</label>
                <input id="tds-amount" type="number" min="0" step="0.01" className="form-input" placeholder="0.00"
                  value={form.tds_amount} onChange={e => setForm(f => ({ ...f, tds_amount: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="tds-section" className="form-label">{t('expenses.tdsSection')}</label>
                <select id="tds-section" className="form-select" value={form.tds_section}
                  onChange={e => setForm(f => ({ ...f, tds_section: e.target.value }))}>
                  <option value="">{t('expenses.selectEllipsis')}</option>
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
          <button type="button" onClick={() => navigate('/expenses')} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? t('common.saving') : t('expenses.saveExpense')}
          </button>
        </div>
      </form>
    </div>
  )
}
