import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { api } from '../../../lib/api'

interface StaffUser {
  id: string
  name: string | null
  mobile: string
  email: string | null
  roles: string[]
  is_active: boolean
}

const ROLES = [
  { id: 'temple_admin', label: 'Temple Admin' },
  { id: 'accountant', label: 'Accountant' },
  { id: 'cashier', label: 'Cashier' },
  { id: 'bhojanshala_cashier', label: 'Bhojanshala Cashier' },
  { id: 'priest', label: 'Priest' },
  { id: 'volunteer', label: 'Volunteer' },
  { id: 'viewer', label: 'Viewer (read-only)' },
]

function toE164(m: string): string {
  const digits = m.replace(/\D/g, '')
  if (m.startsWith('+')) return '+' + digits
  if (digits.length === 10) return '+91' + digits
  return '+' + digits
}

export function UsersTab() {
  const [users, setUsers] = useState<StaffUser[]>([])
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ name: '', mobile: '', role: 'cashier' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  function load() {
    api.get('/users').then(r => setUsers(r.data.data || [])).catch(() => {})
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/users/invite', {
        name: form.name,
        mobile: toE164(form.mobile),
        roles: [form.role],
      })
      setForm({ name: '', mobile: '', role: 'cashier' })
      setShowInvite(false)
      load()
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e2.response?.data?.error?.message || 'Failed to add user')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(u: StaffUser) {
    await api.patch(`/users/${u.id}`, { is_active: !u.is_active }).catch(() => {})
    load()
  }

  async function changeRole(u: StaffUser, role: string) {
    await api.patch(`/users/${u.id}`, { roles: [role] }).catch(() => {})
    load()
  }

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">User Management</h3>
          <p className="text-xs text-slate-400 mt-0.5">Staff who can log in to this mandir, and their roles.</p>
        </div>
        {!showInvite && <button onClick={() => setShowInvite(true)} className="btn-primary btn-sm"><Plus size={14} /> Add User</button>}
      </div>
      <div className="card-body space-y-3">
        {showInvite && (
          <form onSubmit={invite} className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label className="form-label">Mobile *</label><input className="form-input" placeholder="9876543210" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} required /></div>
              <div>
                <label className="form-label">Role</label>
                <select className="form-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
            </div>
            {error && <p className="text-sm text-brand-red">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="btn-primary btn-sm">{saving ? 'Adding…' : 'Add User'}</button>
              <button type="button" onClick={() => { setShowInvite(false); setError('') }} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-slate-400 py-6">No users yet.</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                  <td className="font-medium">{u.name || '—'}</td>
                  <td className="text-sm text-slate-500">{u.mobile}</td>
                  <td>
                    <select className="form-select text-sm py-1" value={u.roles?.[0] || 'viewer'} onChange={e => changeRole(u, e.target.value)}>
                      {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <button onClick={() => toggleActive(u)} className={u.is_active ? 'badge-green cursor-pointer' : 'badge-gray cursor-pointer'}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
