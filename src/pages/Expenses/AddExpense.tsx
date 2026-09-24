import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, X, Paperclip, Trash2 } from 'lucide-react'
import { api, parsePaise, todayIst, fmtPaise } from '../../lib/api'
import { useAccounts, usePaymentModes, useResourceNames, autoSelectAccount } from '../../lib/useDropdownOptions'
import { compressImage } from '../../lib/imageCompress'
import { ExpenseItemsEditor } from '../../components/Expenses/ExpenseItemsEditor'
import { VendorPicker, type VendorRef } from '../../components/Expenses/VendorPicker'

/** The category dropdown's "Other…": type a category the trust has not set up yet. */
const OTHER = '__other__'
import { itemsPayload, itemsTotals, newItemRow, type ItemRow, type VendorItem } from '../../components/Expenses/expenseItems'

export function AddExpense() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [funds, setFunds] = useState<{ id: string; name: string }[]>([])
  // The vendor, picked from Vendors / Suppliers or added on the spot.
  const [vendor, setVendor] = useState<VendorRef | null>(null)
  const [form, setForm] = useState({
    vendor_name: '',
    category: '',
    other_category: '',
    description: '',
    amount: '',
    payment_mode: 'cash',
    payment_account_id: '',
    fund_id: '',
    bill_number: '',
    bill_date: todayIst(),
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
    cheque_date: todayIst(),
  })

  const accounts = useAccounts()
  useEffect(() => {
    const id = autoSelectAccount(accounts, form.payment_mode)
    if (id) setForm(f => ({ ...f, payment_account_id: id }))
  }, [form.payment_mode, accounts])

  // Vendors master → autocomplete the Vendor/Payee field so an expense links to
  // an existing vendor (vendor_id) instead of silently creating a duplicate on
  // every typo. Typing a new name still works (backend find-or-creates).
  // Scanned bill (plan §05) — compressed client-side, stored inline.
  const [billPhoto, setBillPhoto] = useState<string>('')
  const [billName, setBillName] = useState('')
  useEffect(() => {
    api.get('/funds', { params: { is_active: 'true', limit: '100' } })
    .then(r => setFunds(r.data.data ?? [])).catch(() => setFunds([]))
}, [])

  const expenseCategories = useResourceNames('expense-categories', [
    'Electricity', 'Water', 'Salary', 'Maintenance', 'Food & Supplies',
    'Decoration', 'Pooja Material', 'Printing', 'Transport', 'Other',
  ])
  const paymentModes = usePaymentModes()

  // An itemised bill (tenant migration 057): several products from one
  // vendor, each qty x rate with its own GST. The amount and GST boxes then
  // show the items' sums instead of being typed.
  const [itemised, setItemised] = useState(false)
  const [items, setItems] = useState<ItemRow[]>(() => [newItemRow()])
  const [products, setProducts] = useState<VendorItem[]>([])
  useEffect(() => {
    if (!vendor) { setProducts([]); return }
    api.get(`/vendors/${vendor.id}/items`).then(r => setProducts(r.data.data ?? [])).catch(() => setProducts([]))
  }, [vendor?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const billCategory = form.category === OTHER ? form.other_category.trim() : form.category
  // Every product on the vendor's list brings its own category, so the bill's
  // category is asked only when something has none: a one-amount bill, an
  // "Other…" item, or a product with no head of its own.
  const needsBillCategory = !itemised || items.some(r => r.other || (!!r.vendor_item_id && !r.category))
  const totals = itemsTotals(items)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.category === OTHER && !form.other_category.trim()) { setError(t('expenses.selectCategory')); return }
    const itemList = itemised ? itemsPayload(items, billCategory) : []
    if (itemised) {
      if (!itemList.length || totals.total <= 0) { setError(t('expenseItems.needOne')); return }
      const bad = itemList.findIndex(it => !it.description || it.rate_paise <= 0)
      if (bad >= 0) { setError(t('expenseItems.incomplete', { n: bad + 1 })); return }
    } else {
      if (!form.description) { setError('Enter expense description'); return }
      if (!form.amount || parseFloat(form.amount) <= 0) { setError('Enter valid amount'); return }
    }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        // An itemised bill's description defaults to its items, summarised by
        // the API ("Ghee 5 kg, Cement 2 bag ...").
        ...(form.description ? { description: form.description } : {}),
        ...(itemised ? { items: itemList, amount_paise: totals.total } : { amount_paise: parsePaise(form.amount) }),
        payment_mode: form.payment_mode,
        payment_account_id: form.payment_account_id || undefined,
        is_on_credit: form.is_on_credit,
        bill_date: form.bill_date,
        is_recurring: form.is_recurring,
        recurrence_rule: form.is_recurring ? 'monthly' : undefined,
      }
      if (vendor) {
        payload.vendor_id = vendor.id
        payload.vendor_name = vendor.name
      }
      // "Other…" sends the typed name; the API files it under that category,
      // creating it the first time.
      if (billCategory) payload.category = billCategory
      // Which fund paid for this. Without it the fund utilisation report
      // can only ever show what a fund received (tenant-migration 036).
      if (form.fund_id) payload.fund_id = form.fund_id
      if (form.bill_number) payload.bill_number = form.bill_number
      if (form.utr_number) payload.utr_number = form.utr_number
      if (form.payment_mode === 'cheque') {
        if (form.cheque_number) payload.cheque_number = form.cheque_number
        if (form.cheque_bank) payload.cheque_bank = form.cheque_bank
        payload.cheque_date = form.cheque_date
      }
      if (form.gst_amount && !itemised) payload.gst_paid_paise = parsePaise(form.gst_amount)
      if (form.tds_deducted) {
        payload.tds_deducted = true
        if (form.tds_amount) payload.tds_amount_paise = parsePaise(form.tds_amount)
        if (form.tds_section) payload.tds_section = form.tds_section
      }
      if (form.note) payload.notes = form.note
      if (billPhoto) payload.bill_photo_base64 = billPhoto

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <VendorPicker label={t('expenses.vendorPayee')} value={vendor} onChange={setVendor} />
            {needsBillCategory && <div>
              {/* With an itemised bill each product brings its own head; this
                  one is for anything typed under "Other…". */}
              <label className="form-label" htmlFor="expense-category">
                {itemised ? t('expenseItems.billCategory') : t('expenses.category')}
              </label>
              <select id="expense-category" className="form-select" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="">{t('expenses.selectCategory')}</option>
                {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                <option value={OTHER}>{t('expenseItems.otherCategory')}</option>
              </select>
              {form.category === OTHER && (
                <input className="form-input mt-1.5" autoFocus maxLength={100} data-testid="other-expense-category"
                  placeholder={t('expenseItems.newCategoryName')} aria-label={t('expenseItems.newCategoryName')}
                  value={form.other_category} onChange={e => setForm(f => ({ ...f, other_category: e.target.value }))} />
              )}
            </div>}

            <div>
              <label className="form-label" htmlFor="expense-fund">{t('expenses.fund')}</label>
              <select
                id="expense-fund" className="form-select" value={form.fund_id}
                onChange={e => setForm(f => ({ ...f, fund_id: e.target.value }))}
              >
                <option value="">{t('expenses.fundNone')}</option>
                {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <p className="text-xs text-slate-500 mt-1">{t('expenses.fundHint')}</p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={itemised} onChange={e => setItemised(e.target.checked)}
              className="w-4 h-4 accent-brand-blue" data-testid="itemised-toggle" />
            {t('expenseItems.toggle')}
            {vendor && products.length > 0 && (
              <span className="text-xs text-slate-500">· {t('expenseItems.vendorHas', { count: products.length })}</span>
            )}
          </label>

          {itemised && (
            <ExpenseItemsEditor rows={items} onChange={setItems} products={products} />
          )}

          <div>
            <label className="form-label">{itemised ? t('expenseItems.descriptionOptional') : t('expenses.descriptionRequired')}</label>
            <input className="form-input" placeholder={t('expenses.descriptionRequiredPlaceholder')} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          {itemised ? (
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-3 text-sm" data-testid="items-totals">
              <div><span className="text-slate-500">{t('expenses.amountLabel')}</span><p className="font-semibold text-navy-900 text-base">₹{fmtPaise(totals.total)}</p></div>
              <div><span className="text-slate-500">{t('expenses.gstAmount')}</span><p className="font-semibold">₹{fmtPaise(totals.gst)}</p></div>
            </div>
          ) : (
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
          )}

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

          <div>
            <label className="form-label">{t('expenses.billAttachment')}</label>
            {billPhoto ? (
              <div className="flex items-center gap-3">
                {billPhoto.startsWith('data:application/pdf')
                  ? <span className="badge-gray">PDF</span>
                  : <img src={billPhoto} alt={t('expenses.billAttachment')} className="h-16 w-16 object-cover rounded border border-slate-200" />}
                <span className="text-xs text-slate-500 flex-1 truncate">{billName}</span>
                <button type="button" onClick={() => { setBillPhoto(''); setBillName('') }}
                  className="p-1 text-slate-400 hover:text-red-600 rounded" aria-label={t('common.delete')}>
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <label className="btn-secondary btn-sm cursor-pointer inline-flex">
                <Paperclip size={14} /> {t('expenses.attachBill')}
                <input type="file" accept="image/*,application/pdf" className="hidden"
                  onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return
                    try {
                      const out = await compressImage(f)
                      if (out.length * 0.75 > 1_000_000) { setError(t('expenses.billTooLarge')); return }
                      setBillPhoto(out); setBillName(f.name); setError('')
                    } catch { setError(t('expenses.billReadFailed')) }
                  }} />
              </label>
            )}
            <p className="text-xs text-slate-400 mt-1">{t('expenses.billAttachmentHint')}</p>
          </div>

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
