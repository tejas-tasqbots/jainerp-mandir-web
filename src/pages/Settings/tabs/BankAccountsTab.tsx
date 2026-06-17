import { useEffect, useState } from 'react'
import { Plus, Save, X, Pencil } from 'lucide-react'
import { api, fmtPaise, parsePaise, currentFY } from '../../../lib/api'

interface Account {
  id: string
  name: string
  type: string
  account_no: string | null
  bank_name: string | null
  ifsc: string | null
  is_default_cash: boolean
  is_active: boolean
}
interface OpeningBalance { id: string; account_id: string; fy: string; opening_balance_paise: number }

const BLANK = { name: '', type: 'bank', account_no: '', bank_name: '', ifsc: '', is_default_cash: false }

export function BankAccountsTab() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [balances, setBalances] = useState<OpeningBalance[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fy = currentFY()

  useEffect(() => { load() }, [])

  function load() {
    api.get('/accounts', { params: { limit: 100 } }).then(r => setAccounts(r.data.data || [])).catch(() => {})
    api.get('/account-opening-balances', { params: { limit: 200 } }).then(r => setBalances(r.data.data || [])).catch(() => {})
  }

  function openAdd() { setEditing(null); setForm(BLANK); setError(''); setShowForm(true) }
  function openEdit(a: Account) {
    setEditing(a)
    setForm({
      name: a.name, type: a.type, account_no: a.account_no || '', bank_name: a.bank_name || '',
      ifsc: a.ifsc || '', is_default_cash: a.is_default_cash,
    })
    setError(''); setShowForm(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        name: form.name, type: form.type, is_default_cash: form.is_default_cash,
      }
      if (form.type === 'bank') {
        payload.account_no = form.account_no || null
        payload.bank_name = form.bank_name || null
        payload.ifsc = form.ifsc || null
      }
      if (editing) await api.patch(`/accounts/${editing.id}`, payload)
      else await api.post('/accounts', payload)
      setShowForm(false)
      load()
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e2.response?.data?.error?.message || 'Failed to save account')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(a: Account) {
    await api.patch(`/accounts/${a.id}`, { is_active: !a.is_active }).catch(() => {})
    load()
  }

  function getBalance(accountId: string): OpeningBalance | undefined {
    return balances.find(b => b.account_id === accountId && b.fy === fy)
  }

  async function saveBalance(accountId: string, value: string) {
    const paise = parsePaise(value || '0')
    const existing = getBalance(accountId)
    try {
      if (existing) await api.patch(`/account-opening-balances/${existing.id}`, { opening_balance_paise: paise })
      else await api.post('/account-opening-balances', { account_id: accountId, fy, opening_balance_paise: paise })
      load()
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Bank & Cash Accounts</h3>
            <p className="text-xs text-slate-400 mt-0.5">Accounts used across Cash Book, Bank Book and Ledger.</p>
          </div>
          {!showForm && <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> Add Account</button>}
        </div>
        <div className="card-body space-y-3">
          {showForm && (
            <form onSubmit={save} className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Account Name *</label>
                  <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. SBI Main Account" />
                </div>
                <div>
                  <label className="form-label">Type</label>
                  <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
              </div>
              {form.type === 'bank' && (
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="form-label">Account No.</label><input className="form-input" value={form.account_no} onChange={e => setForm(f => ({ ...f, account_no: e.target.value }))} /></div>
                  <div><label className="form-label">Bank Name</label><input className="form-input" value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} /></div>
                  <div><label className="form-label">IFSC</label><input className="form-input uppercase" value={form.ifsc} onChange={e => setForm(f => ({ ...f, ifsc: e.target.value.toUpperCase() }))} /></div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="w-4 h-4" checked={form.is_default_cash} onChange={e => setForm(f => ({ ...f, is_default_cash: e.target.checked }))} />
                Use as the default cash account
              </label>
              {error && <p className="text-sm text-brand-red">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="btn-primary btn-sm"><Save size={14} /> {editing ? 'Update' : 'Add'}</button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Type</th><th>Bank / A/c No.</th><th>Opening Balance ({fy})</th><th>Status</th><th className="text-right">Edit</th></tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-slate-400 py-6">No accounts yet.</td></tr>
                ) : accounts.map(a => (
                  <tr key={a.id} className={a.is_active ? '' : 'opacity-50'}>
                    <td className="font-medium">{a.name}{a.is_default_cash && <span className="badge-blue ml-2">Default Cash</span>}</td>
                    <td className="capitalize">{a.type}</td>
                    <td className="text-xs text-slate-500">{a.type === 'bank' ? `${a.bank_name || '—'} · ${a.account_no || '—'}` : '—'}</td>
                    <td>
                      <input
                        type="number" step="0.01" className="form-input w-32 text-sm"
                        defaultValue={getBalance(a.id) ? fmtPaise(getBalance(a.id)!.opening_balance_paise).replace(/,/g, '') : ''}
                        placeholder="0.00"
                        onBlur={e => saveBalance(a.id, e.target.value)}
                      />
                    </td>
                    <td>
                      <button onClick={() => toggleActive(a)} className={a.is_active ? 'badge-green cursor-pointer' : 'badge-gray cursor-pointer'}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="text-right"><button onClick={() => openEdit(a)} className="btn-icon"><Pencil size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">Opening balance is saved when you click away from the field. It applies to FY {fy}.</p>
        </div>
      </div>
    </div>
  )
}
