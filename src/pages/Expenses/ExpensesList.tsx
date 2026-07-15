import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Download, FileDown, Search, Pencil, Trash2, XCircle } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { rsFmt } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'
import type { Expense } from '../../types'
import { useConfirm } from '../../components/ConfirmDialog'

export function ExpensesList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)
  const [editModal, setEditModal] = useState<Expense | null>(null)
  const [editForm, setEditForm] = useState({ description: '', amount_paise: '', bill_number: '' })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const confirm = useConfirm()

  // Filters
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fCredit, setFCredit] = useState('')

  useEffect(() => { load() }, [page, search, fFrom, fTo, fCredit])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('q', search)
      if (fFrom) params.set('from', fFrom)
      if (fTo) params.set('to', fTo)
      const { data } = await api.get(`/expenses?${params}`)
      let rows: Expense[] = data.data || []
      // Credit filter is client-side
      if (fCredit === 'credit') rows = rows.filter(e => e.is_on_credit)
      else if (fCredit === 'paid') rows = rows.filter(e => !e.is_on_credit)
      setExpenses(rows)
      setTotal(data.meta?.total || 0)
      setTotalAmount(data.meta?.total_amount_paise || 0)
    } catch {
      setExpenses([])
    } finally {
      setLoading(false)
    }
  }

  function exportCsv() {
    const params = new URLSearchParams({ limit: '1000' })
    if (search) params.set('q', search)
    if (fFrom) params.set('from', fFrom)
    if (fTo) params.set('to', fTo)
    api.get(`/expenses?${params}`).then(r => {
      const rows: Expense[] = r.data.data || []
      if (!rows.length) { alert('No expenses to export'); return }
      const headers = ['Date', 'Description', 'Vendor', 'Category', 'Amount', 'GST', 'Mode', 'Bill No', 'TDS', 'Credit']
      const csv = [headers.join(',')].concat(
        rows.map(e => [
          e.bill_date || e.created_at, `"${(e.description || '').replace(/"/g, '""')}"`, e.vendor_name ?? '',
          e.category ?? '', e.amount_paise / 100, (e.gst_paid_paise ?? 0) / 100, e.payment_mode,
          e.bill_number ?? '', e.tds_deducted ? (e.tds_amount_paise ?? 0) / 100 : '', e.is_on_credit ? 'Yes' : 'No',
        ].join(','))
      ).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'expenses.csv'; a.click()
      URL.revokeObjectURL(url)
    }).catch(() => alert('Export failed'))
  }

  function exportPdf() {
    const params = new URLSearchParams({ limit: '1000' })
    if (search) params.set('q', search)
    if (fFrom) params.set('from', fFrom)
    if (fTo) params.set('to', fTo)
    api.get(`/expenses?${params}`).then(r => {
      const rows: Expense[] = r.data.data || []
      const total = rows.reduce((s, e) => s + e.amount_paise, 0)
      downloadRowsPdf('expenses.pdf', 'Expense Register',
        ['Date', 'Description', 'Vendor', 'Category', 'Amount', 'GST', 'Mode', 'Bill No', 'TDS', 'Credit'],
        rows.map(e => [
          (e.bill_date || e.created_at || '').slice(0, 10), e.description ?? '', e.vendor_name ?? '',
          e.category ?? '', rsFmt(e.amount_paise), rsFmt(e.gst_paid_paise ?? 0), e.payment_mode,
          e.bill_number ?? '', e.tds_deducted ? rsFmt(e.tds_amount_paise ?? 0) : '', e.is_on_credit ? 'Yes' : 'No',
        ]),
        {
          subtitle: fFrom || fTo ? `${fFrom || '…'} to ${fTo || '…'}` : 'All dates',
          landscape: true,
          totals: ['Total', '', '', '', rsFmt(total), '', '', '', '', ''],
        })
    }).catch(() => alert('Export failed'))
  }

  function openEdit(e: Expense) {
    setEditModal(e)
    setEditForm({
      description: e.description || '',
      amount_paise: String(e.amount_paise / 100),
      bill_number: e.bill_number || '',
    })
  }

  async function saveEdit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!editModal) return
    setSaving(true)
    try {
      await api.patch(`/expenses/${editModal.id}`, {
        description: editForm.description,
        amount_paise: parsePaise(editForm.amount_paise),
        bill_number: editForm.bill_number || undefined,
      })
      setEditModal(null)
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e.response?.data?.error?.message || 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteExpense(id: string) {
    if (!(await confirm({ title: 'Delete expense', message: 'Delete this expense? This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return
    setDeleteId(id)
    try {
      await api.delete(`/expenses/${id}`)
      load()
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('expenses.title')}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => navigate('/expenses/add')} className="btn-primary btn-sm">
            <Plus size={14} /> {t('expenses.newExpense')}
          </button>
          <button type="button" onClick={exportPdf} className="btn-secondary btn-sm"><FileDown size={14} /> {t('expenses.exportPdf')}</button>
          <button type="button" onClick={exportCsv} className="btn-secondary btn-sm"><Download size={14} /> {t('expenses.exportCsv')}</button>
        </div>
      </div>

      {total > 0 && (
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div className="card p-3"><p className="text-xs text-slate-400">{t('expenses.totalExpenses')}</p><p className="text-lg font-bold text-navy-900">{total}</p></div>
          <div className="card p-3"><p className="text-xs text-slate-400">{t('expenses.totalAmount')}</p><p className="text-lg font-bold text-red-600">₹{fmtPaise(totalAmount)}</p></div>
        </div>
      )}

      <div className="flex items-end gap-3 flex-wrap">
        <div className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="form-input pl-9" placeholder={t('expenses.searchPlaceholder')}
            value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
          {search && (
            <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <XCircle size={14} />
            </button>
          )}
        </div>
        <div>
          <label htmlFor="exp-from" className="form-label text-xs">{t('donations.from')}</label>
          <input id="exp-from" type="date" title="From date" className="form-input" value={fFrom} onChange={e => { setFFrom(e.target.value); setPage(1) }} />
        </div>
        <div>
          <label htmlFor="exp-to" className="form-label text-xs">{t('donations.to')}</label>
          <input id="exp-to" type="date" title="To date" className="form-input" value={fTo} onChange={e => { setFTo(e.target.value); setPage(1) }} />
        </div>
        <div>
          <label htmlFor="exp-credit" className="form-label text-xs">{t('expenses.type')}</label>
          <select id="exp-credit" className="form-select" value={fCredit} onChange={e => { setFCredit(e.target.value); setPage(1) }}>
            <option value="">{t('common.all')}</option>
            <option value="paid">{t('expenses.paid')}</option>
            <option value="credit">{t('expenses.onCredit')}</option>
          </select>
        </div>
        {(fFrom || fTo || fCredit) && (
          <button type="button" onClick={() => { setFFrom(''); setFTo(''); setFCredit(''); setPage(1) }}
            className="text-xs text-slate-400 hover:text-red-500 pb-2">{t('expenses.clearFilters')}</button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('expenses.description')}</th>
                <th>{t('expenses.vendor')}</th>
                <th>{t('expenses.category')}</th>
                <th>{t('common.amount')}</th>
                <th>{t('expenses.mode')}</th>
                <th>{t('expenses.billNo')}</th>
                <th>{t('expenses.tds')}</th>
                <th>{t('common.date')}</th>
                <th>{t('expenses.type')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : expenses.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-10 text-slate-400">{t('expenses.noExpensesFound')}</td></tr>
              ) : expenses.map(e => (
                <tr key={e.id}>
                  <td className="font-medium">{e.description}</td>
                  <td className="text-slate-600">{e.vendor_name || '—'}</td>
                  <td className="text-slate-500">{e.category || '—'}</td>
                  <td className="font-semibold">
                    ₹{fmtPaise(e.amount_paise)}
                    {!!e.gst_paid_paise && <span className="block text-xs text-slate-400 font-normal">+GST ₹{fmtPaise(e.gst_paid_paise)}</span>}
                  </td>
                  <td><span className="badge-gray">{e.payment_mode}</span></td>
                  <td className="text-xs text-slate-400 font-mono">{e.bill_number || '—'}</td>
                  <td>{e.tds_deducted ? <span className="badge-blue">₹{fmtPaise(e.tds_amount_paise ?? 0)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="text-slate-500 text-xs">{new Date(e.bill_date || e.created_at).toLocaleDateString('en-IN')}</td>
                  <td>{e.is_on_credit ? <span className="badge-red">{t('expenses.credit')}</span> : <span className="badge-green">{t('expenses.paid')}</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openEdit(e)} className="p-1 text-slate-400 hover:text-brand-blue rounded" title={t('expenses.edit')} aria-label="Edit expense">
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteExpense(e.id)}
                        disabled={deleteId === e.id}
                        className="p-1 text-slate-400 hover:text-brand-red rounded"
                        title={t('expenses.delete')}
                        aria-label="Delete expense"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {total > 20 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{t('expenses.showing', { from: ((page-1)*20)+1, to: Math.min(page*20, total), total })}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="btn-secondary btn-sm">{t('common.prev')}</button>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p+1)} className="btn-secondary btn-sm">{t('common.next')}</button>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-4">{t('expenses.editExpense')}</h3>
            <form onSubmit={saveEdit} className="space-y-4">
              <div>
                <label className="form-label">{t('expenses.descriptionRequired')}</label>
                <input className="form-input" value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('expenses.amountLabel')}</label>
                <input type="number" step="0.01" min="0" className="form-input" value={editForm.amount_paise}
                  onChange={e => setEditForm(f => ({ ...f, amount_paise: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('expenses.billReceiptNo')}</label>
                <input className="form-input" value={editForm.bill_number}
                  onChange={e => setEditForm(f => ({ ...f, bill_number: e.target.value }))} />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
