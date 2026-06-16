import { useEffect, useState } from 'react'
import { Plus, Pencil, X } from 'lucide-react'
import { api, parsePaise } from '../../lib/api'

interface Account { id: string; name: string; type: string; account_no: string | null; bank_name: string | null; ifsc: string | null; is_default_cash: boolean; is_active: boolean }
interface OpeningBalance { id: string; account_id: string; fy: string; opening_balance_paise: number }

const BLANK = { name: '', type: 'cash', account_no: '', bank_name: '', ifsc: '' }
const FYS = Array.from({ length: 5 }, (_, i) => {
  const y = new Date().getFullYear() - i + (new Date().getMonth() >= 3 ? 1 : 0)
  return `${y - 1}-${String(y).slice(-2)}`
})

export function BankAccountsSettings() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [balances, setBalances] = useState<OpeningBalance[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  function load() {
    api.get('/accounts?limit=100').then(r => setAccounts(r.data.data || [])).catch(() => {})
    api.get('/account-opening-balances?limit=200').then(r => setBalances(r.data.data || [])).catch(() => {})
  }

  function openAdd() { setEditing(null); setForm(BLANK); setShowForm(true) }
  function openEdit(a: Account) {
    setEditing(a)
    setForm({ name: a.name, type: a.type, account_no: a.account_no || '', bank_name: a.bank_name || '', ifsc: a.ifsc || '' })
    setShowForm(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) await api.patch(`/accounts/${editing.id}`, form)
      else await api.post('/accounts', form)
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  function getBalance(accountId: string, fy: string) {
    return balances.find(b => b.account_id === accountId && b.fy === fy)
  }

  async function saveBalance(accountId: string, fy: string, value: string) {
    const paise = parsePaise(value || '0')
    const existing = getBalance(accountId, fy)
    if (existing) {
      await api.patch(`/account-opening-balances/${existing.id}`, { opening_balance_paise: paise }).catch(() => {})
    } else {
      await api.post('/account-opening-balances', { account_id: accountId, fy, opening_balance_paise: paise }).catch(() => {})
    }
    load()
  }

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Bank & Cash Accounts</h1>
        <button className="btn-primary btn-sm" onClick={openAdd}><Plus size={14} /> Add Account</button>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>NAME</th><th>TYPE</th><th>BANK / DETAILS</th><th>ACCOUNT NO.</th><th>IFSC</th><th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.id}>
                <td className="font-medium">
                  {a.name}
                  {a.is_default_cash && <span className="ml-2 badge-green">Default Cash</span>}
                </td>
                <td className="capitalize text-sm text-slate-500">{a.type}</td>
                <td className="text-sm text-slate-500">{a.bank_name || '—'}</td>
                <td className="text-sm font-mono">{a.account_no || '—'}</td>
                <td className="text-sm text-slate-500">{a.ifsc || '—'}</td>
                <td>
                  {!a.is_default_cash && (
                    <button onClick={() => openEdit(a)} className="text-slate-400 hover:text-navy-900 p-1">
                      <Pencil size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-6">No accounts</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Opening Balances */}
      {accounts.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header">
            <h3 className="font-semibold text-sm">Opening Balances by Financial Year</h3>
            <p className="text-xs text-slate-400">Values save automatically when you click away</p>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ACCOUNT</th>
                  {FYS.map(fy => <th key={fy}>FY {fy}</th>)}
                </tr>
              </thead>
              <tbody>
                {accounts.map(a => (
                  <tr key={a.id}>
                    <td className="font-medium text-sm">{a.name} <span className="text-slate-400 text-xs">({a.type})</span></td>
                    {FYS.map(fy => {
                      const bal = getBalance(a.id, fy)
                      return (
                        <td key={fy}>
                          <input
                            type="number"
                            step="0.01"
                            defaultValue={bal ? (bal.opening_balance_paise / 100).toFixed(2) : '0.00'}
                            className="w-28 text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-navy-900"
                            onBlur={e => saveBalance(a.id, fy, e.target.value)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy-900">{editing ? 'Edit Account' : 'Add Account'}</h3>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <form onSubmit={save} className="space-y-3">
              <div>
                <label className="form-label">Name *</label>
                <input className="form-input" required value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Type</label>
                <select className="form-select" value={form.type} onChange={e => set('type', e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                </select>
              </div>
              {form.type === 'bank' && (
                <>
                  <div>
                    <label className="form-label">Bank Name</label>
                    <input className="form-input" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Account No.</label>
                      <input className="form-input" value={form.account_no} onChange={e => set('account_no', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">IFSC</label>
                      <input className="form-input uppercase" value={form.ifsc} onChange={e => set('ifsc', e.target.value.toUpperCase())} />
                    </div>
                  </div>
                </>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
