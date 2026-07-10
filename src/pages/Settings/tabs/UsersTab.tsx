import { useEffect, useState } from 'react'
import { Crown, Plus, ShieldCheck, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { PhoneInput } from '../../../components/PhoneInput'
import { ROLE_LABELS } from '../../../lib/rbac'
import { useAuthStore } from '../../../store/authStore'
import { useConfirm } from '../../../components/ConfirmDialog'

interface StaffUser {
  id: string
  name: string | null
  mobile: string
  email: string | null
  roles: string[]
  is_active: boolean
  joined_at?: string
}

// Plain-language description of what each role can do (reference card below the table).
const ROLE_PERMISSIONS: { role: string; desc: string; cls: string }[] = [
  { role: 'temple_admin', desc: 'Full access — can void donations, delete data, manage all settings', cls: 'badge-red' },
  { role: 'accountant', desc: 'Accounts, reports, fixed assets, loans, TDS entries', cls: 'badge-blue' },
  { role: 'cashier', desc: 'Donations, expenses, bookings, prasad, seva, bhojanshala', cls: 'badge-green' },
  { role: 'bhojanshala_cashier', desc: 'Bhojanshala only — record & redeem meal tokens', cls: 'badge-green' },
  { role: 'priest', desc: 'View seva bookings, mark them done', cls: 'badge-yellow' },
  { role: 'volunteer', desc: 'Event registrations, visitor count entries', cls: 'badge-gray' },
  { role: 'viewer', desc: 'Read-only access to all data (no create/edit)', cls: 'badge-gray' },
]

const ROLES = [
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

function apiMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } }
  return e.response?.data?.error?.message || fallback
}

export function UsersTab() {
  const me = useAuthStore(s => s.user)
  const confirm = useConfirm()
  const [users, setUsers] = useState<StaffUser[]>([])
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ name: '', mobile: '', role: 'cashier' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
      setError(apiMessage(err, 'Failed to add user'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(u: StaffUser) {
    setNotice('')
    try {
      await api.patch(`/users/${u.id}`, { is_active: !u.is_active })
    } catch (err) {
      alert(apiMessage(err, 'Could not change status'))
    }
    load()
  }

  async function changeRole(u: StaffUser, role: string) {
    setNotice('')
    try {
      await api.patch(`/users/${u.id}`, { roles: [role] })
    } catch (err) {
      alert(apiMessage(err, 'Could not change role'))
    }
    load()
  }

  async function transferAdmin(u: StaffUser) {
    if (!(await confirm({
      title: 'Transfer Temple Admin',
      message:
        `Transfer the Temple Admin role to ${u.name || u.mobile}?\n\n` +
        'They become the Temple Admin and you keep your other roles ' +
        '(or become Viewer). This takes effect from your next login.',
      confirmLabel: 'Transfer',
      danger: true,
    }))) return
    setNotice('')
    try {
      const { data } = await api.post(`/users/${u.id}/transfer-admin`)
      setNotice(data.data?.note || 'Temple Admin transferred.')
      load()
    } catch (err) {
      alert(apiMessage(err, 'Could not transfer Temple Admin'))
    }
  }

  const iAmAdmin = me?.roles?.includes('temple_admin') ?? false

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">User Management</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Staff who can log in to this mandir, and their roles. Every mandir always has exactly the
            Temple Admin role holder in charge — it can only be transferred, never removed.
          </p>
        </div>
        {!showInvite && <button onClick={() => setShowInvite(true)} className="btn-primary btn-sm"><Plus size={14} /> Add User</button>}
      </div>
      <div className="card-body space-y-3">
        {notice && (
          <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">{notice}</div>
        )}
        {showInvite && (
          <form onSubmit={invite} className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label className="form-label">Mobile *</label><PhoneInput value={form.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} required /></div>
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
            <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Status</th><th>Joined</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-slate-400 py-6">No users yet.</td></tr>
              ) : users.map(u => {
                const isSelf = u.id === me?.id
                const isAdminRow = u.roles?.includes('temple_admin')
                return (
                  <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                    <td className="font-medium">
                      {u.name || '—'}
                      {isSelf && <span className="badge-blue ml-2">You</span>}
                    </td>
                    <td className="text-sm text-slate-500">{u.mobile}</td>
                    <td>
                      {isAdminRow ? (
                        <span className="badge-gold inline-flex items-center gap-1">
                          <Crown size={11} /> Temple Admin
                        </span>
                      ) : (
                        <select
                          className="form-select text-sm py-1"
                          value={u.roles?.[0] || 'viewer'}
                          onChange={e => changeRole(u, e.target.value)}
                          disabled={!iAmAdmin}
                        >
                          {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      {isSelf || isAdminRow ? (
                        <span className={u.is_active ? 'badge-green' : 'badge-gray'}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      ) : (
                        <button onClick={() => toggleActive(u)} className={u.is_active ? 'badge-green cursor-pointer' : 'badge-gray cursor-pointer'}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </button>
                      )}
                    </td>
                    <td className="text-xs text-slate-400">
                      {u.joined_at ? new Date(u.joined_at).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="text-right">
                      {iAmAdmin && !isSelf && !isAdminRow && u.is_active && (
                        <button
                          onClick={() => transferAdmin(u)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 border border-amber-300 rounded-md px-2 py-1 hover:bg-amber-50"
                          title="Hand the Temple Admin role to this member"
                        >
                          <ShieldCheck size={12} /> Make Temple Admin
                        </button>
                      )}
                      {isSelf && isAdminRow && (
                        <span className="text-xs text-slate-400">Transfer the role to step down</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">
          {ROLE_LABELS.temple_admin} can manage everything. Other roles only see and use the modules
          that belong to their work — the sidebar adjusts automatically after they log in.
        </p>

        <div className="border-t border-slate-100 pt-4">
          <h4 className="font-semibold text-sm mb-3">Role Permissions Reference</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            {ROLE_PERMISSIONS.map(({ role, desc, cls }) => (
              <div key={role} className="flex gap-2">
                <span className={`${cls} mt-0.5 flex-shrink-0`}>{role}</span>
                <p className="text-slate-500 text-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
