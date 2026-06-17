import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Search, Pencil, Trash2 } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import type { Expense } from '../../types'

export function ExpensesList() {
  const navigate = useNavigate()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [editModal, setEditModal] = useState<Expense | null>(null)
  const [editForm, setEditForm] = useState({ description: '', amount_paise: '', bill_number: '' })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  useEffect(() => { load() }, [page, search])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('q', search)
      const { data } = await api.get(`/expenses?${params}`)
      setExpenses(data.data || [])
      setTotal(data.meta?.total || 0)
    } catch {
      setExpenses([])
    } finally {
      setLoading(false)
    }
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
    if (!window.confirm('Delete this expense? This cannot be undone.')) return
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
        <h1 className="text-xl font-bold text-navy-900">Expenses</h1>
        <div className="flex gap-2">
          <button onClick={() => navigate('/expenses/add')} className="btn-primary btn-sm">
            <Plus size={14} /> New Expense
          </button>
          <button className="btn-secondary btn-sm"><Download size={14} /> Export</button>
        </div>
      </div>

      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder="Search vendor, description..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Vendor</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Mode</th>
                <th>Bill No</th>
                <th>Date</th>
                <th>Credit</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : expenses.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">No expenses found</td></tr>
              ) : expenses.map(e => (
                <tr key={e.id}>
                  <td className="font-medium">{e.description}</td>
                  <td className="text-slate-600">{e.vendor_name || '—'}</td>
                  <td className="text-slate-500">{e.category_name || '—'}</td>
                  <td className="font-semibold">₹{fmtPaise(e.amount_paise)}</td>
                  <td><span className="badge-gray">{e.payment_mode}</span></td>
                  <td className="text-xs text-slate-400 font-mono">{e.bill_number || '—'}</td>
                  <td className="text-slate-500 text-xs">{new Date(e.created_at).toLocaleDateString('en-IN')}</td>
                  <td>{e.is_on_credit ? <span className="badge-red">Credit</span> : <span className="badge-green">Paid</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(e)} className="p-1 text-slate-400 hover:text-brand-blue rounded" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteExpense(e.id)}
                        disabled={deleteId === e.id}
                        className="p-1 text-slate-400 hover:text-brand-red rounded"
                        title="Delete"
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
          <span>Showing {((page-1)*20)+1}–{Math.min(page*20, total)} of {total}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="btn-secondary btn-sm">Prev</button>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p+1)} className="btn-secondary btn-sm">Next</button>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-4">Edit Expense</h3>
            <form onSubmit={saveEdit} className="space-y-4">
              <div>
                <label className="form-label">Description *</label>
                <input className="form-input" value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Amount (₹) *</label>
                <input type="number" step="0.01" min="0" className="form-input" value={editForm.amount_paise}
                  onChange={e => setEditForm(f => ({ ...f, amount_paise: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Bill / Receipt No</label>
                <input className="form-input" value={editForm.bill_number}
                  onChange={e => setEditForm(f => ({ ...f, bill_number: e.target.value }))} />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditModal(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
