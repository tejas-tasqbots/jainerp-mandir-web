import { useEffect, useState } from 'react'
import { Plus, Lock, Shield } from 'lucide-react'
import { api } from '../../lib/api'

interface StaffUser {
  membership_id: string
  id: string
  name: string
  mobile: string
  email: string | null
  roles: string[]
  is_active: boolean
  joined_at: string
}

const ROLES = ['cashier', 'accountant', 'temple_admin', 'priest', 'volunteer', 'viewer']
const ROLE_LABELS: Record<string, string> = {
  temple_admin: 'Admin', cashier: 'Cashier', accountant: 'Accountant',
  priest: 'Priest', volunteer: 'Volunteer', viewer: 'Viewer',
}
const ROLE_COLORS: Record<string, string> = {
  temple_admin: 'badge-red', cashier: 'badge-blue', accountant: 'badge-green',
  priest: 'badge-yellow', volunteer: 'badge-yellow', viewer: 'bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded font-medium',
}

export function UsersSettings() {
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
    setSaving(true)
    setError('')
    try {
      await api.post('/users/invite', {
        name: form.name,
        mobile: form.mobile.startsWith('+') ? form.mobile : `+91${form.mobile}`,
        roles: [form.role],
      })
      setForm({ name: '', mobile: '', role: 'cashier' })
      setShowInvite(false)
      load()
    } catch (e: any) {
      setError(e.response?.data?.error?.message || 'Failed to add user')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(u: StaffUser) {
    await api.patch(`/users/${u.id}`, { is_active: !u.is_active })
    load()
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">User Management</h1>
        <button className="btn-primary btn-sm" onClick={() => setShowInvite(true)}>
          <Plus size={14} /> Add User
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>NAME</th>
              <th>MOBILE</th>
              <th>ROLE</th>
              <th>STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="font-medium">{u.name || '—'}</td>
                <td className="text-sm text-slate-500">{u.mobile}</td>
                <td>
                  {u.roles.map(r => (
                    <span key={r} className={ROLE_COLORS[r] || 'badge-yellow'}>{ROLE_LABELS[r] || r}</span>
                  ))}
                </td>
                <td>
                  <span className={u.is_active ? 'badge-green' : 'badge-red'}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button title={u.is_active ? 'Deactivate' : 'Activate'}
                    onClick={() => toggleActive(u)}
                    className="text-slate-400 hover:text-navy-900 p-1">
                    <Lock size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-6">No users yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card card-body bg-blue-50 border border-blue-100 text-sm text-blue-800 flex items-start gap-2">
        <Shield size={15} className="mt-0.5 flex-shrink-0" />
        <span>Each user selects their name on the login screen and enters their PIN. Roles control what each user can access.</span>
      </div>

      {showInvite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowInvite(false)}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-navy-900 mb-4">Add User</h3>
            <form onSubmit={invite} className="space-y-3">
              <div>
                <label className="form-label">Name</label>
                <input className="form-input" required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Mobile (10 digits or E.164)</label>
                <input className="form-input" required placeholder="9876543210"
                  value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Role</label>
                <select className="form-select" value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                </select>
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowInvite(false)}>Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Adding...' : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
