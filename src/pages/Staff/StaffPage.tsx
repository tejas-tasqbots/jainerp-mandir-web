import { useEffect, useState } from 'react'
import { UserPlus, Shield, ShieldCheck, CheckCircle, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { PhoneInput } from '../../components/PhoneInput'
import { useAuthStore } from '../../store/authStore'

interface StaffMember {
  id: string
  membership_id: string
  name: string
  mobile: string
  email?: string
  roles: string[]
  is_active: boolean
  joined_at: string
}

// temple_admin is intentionally NOT assignable here — it is held by exactly
// one person and can only be handed over via "Make Temple Admin" (transfer).
const ROLES = ['cashier', 'bhojanshala_cashier', 'accountant', 'priest', 'volunteer', 'viewer']
const ROLE_LABELS: Record<string, string> = {
  temple_admin: 'Admin', accountant: 'Accountant', cashier: 'Cashier',
  bhojanshala_cashier: 'Bhojanshala Cashier', priest: 'Priest', volunteer: 'Volunteer', viewer: 'Viewer',
}
const roleBadge = (role: string) => {
  const map: Record<string, string> = {
    temple_admin: 'badge-red', accountant: 'badge-blue', cashier: 'badge-green',
    bhojanshala_cashier: 'badge-green', priest: 'badge-yellow', volunteer: 'badge-gray', viewer: 'badge-gray',
  }
  return map[role] || 'badge-gray'
}

export function StaffPage() {
  const me = useAuthStore(s => s.user)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteForm, setInviteForm] = useState({ mobile: '', name: '', role: 'cashier' })
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const [editMember, setEditMember] = useState<StaffMember | null>(null)
  const [editRole, setEditRole] = useState('cashier')
  const [editActive, setEditActive] = useState(true)
  const [updating, setUpdating] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/users')
      setStaff(data.data || data || [])
    } catch {
      setStaff([])
    } finally {
      setLoading(false)
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteMsg('')
    try {
      await api.post('/users/invite', {
        mobile: inviteForm.mobile,
        name: inviteForm.name || undefined,
        roles: [inviteForm.role],
      })
      setInviteMsg('Invitation sent successfully!')
      setInviteForm({ mobile: '', name: '', role: 'cashier' })
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setInviteMsg(e.response?.data?.error?.message || 'Failed to send invite')
    } finally {
      setInviting(false)
      setTimeout(() => setInviteMsg(''), 5000)
    }
  }

  function openEdit(m: StaffMember) {
    setEditMember(m)
    setEditRole(m.roles[0] || 'cashier')
    setEditActive(m.is_active)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editMember) return
    setUpdating(true)
    try {
      await api.patch(`/users/${editMember.id}`, {
        roles: [editRole],
        is_active: editActive,
      })
      setEditMember(null)
      load()
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e2.response?.data?.error?.message || 'Could not update this member')
    } finally {
      setUpdating(false)
    }
  }

  async function transferAdmin(m: StaffMember) {
    if (!window.confirm(
      `Transfer the Temple Admin role to ${m.name || m.mobile}?\n\n` +
      'They become the Temple Admin and you keep your other roles ' +
      '(or become Viewer). Applies from your next login.',
    )) return
    try {
      const { data } = await api.post(`/users/${m.id}/transfer-admin`)
      setInviteMsg(data.data?.note || 'Temple Admin transferred successfully')
      load()
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e2.response?.data?.error?.message || 'Could not transfer Temple Admin')
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-xl font-bold text-navy-900">Staff & User Management</h1>

      {/* Invite form */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm flex items-center gap-2"><UserPlus size={14} /> Invite New Staff Member</h3>
        </div>
        <div className="card-body">
          {inviteMsg && (
            <div className={`mb-4 px-4 py-2 rounded-md text-sm ${inviteMsg.includes('success') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {inviteMsg}
            </div>
          )}
          <form onSubmit={invite} className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="form-label">Mobile *</label>
              <div style={{ minWidth: '230px' }}>
                <PhoneInput value={inviteForm.mobile} onChange={v => setInviteForm(f => ({ ...f, mobile: v }))} required />
              </div>
            </div>
            <div>
              <label className="form-label">Name (optional)</label>
              <input className="form-input" style={{ width: '160px' }} placeholder="Staff name"
                value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Role</label>
              <select className="form-select" value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
              </select>
            </div>
            <button type="submit" disabled={inviting || inviteForm.mobile.length !== 10} className="btn-primary">
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
          </form>
          <p className="text-xs text-slate-400 mt-3">Staff member will receive an OTP to log in. You can update their role anytime.</p>
        </div>
      </div>

      {/* Staff table */}
      <div className="card overflow-hidden">
        <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><Shield size={14} /> Current Team</h3></div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Mobile</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : staff.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">No staff members found</td></tr>
              ) : staff.map(m => {
                const isSelf = m.id === me?.id
                const isAdminRow = (m.roles || []).includes('temple_admin')
                return (
                  <tr key={m.id}>
                    <td>
                      <p className="font-medium">
                        {m.name || '—'}
                        {isSelf && <span className="badge-blue ml-2">You</span>}
                      </p>
                      {m.email && <p className="text-xs text-slate-400">{m.email}</p>}
                    </td>
                    <td className="font-mono text-sm">{m.mobile}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(m.roles || []).map(r => <span key={r} className={roleBadge(r)}>{r}</span>)}
                      </div>
                    </td>
                    <td>
                      {m.is_active
                        ? <span className="flex items-center gap-1 text-green-700 text-xs"><CheckCircle size={12} /> Active</span>
                        : <span className="flex items-center gap-1 text-slate-400 text-xs"><XCircle size={12} /> Inactive</span>}
                    </td>
                    <td className="text-xs text-slate-400">{new Date(m.joined_at).toLocaleDateString('en-IN')}</td>
                    <td>
                      {isAdminRow ? (
                        <span className="text-xs text-slate-400" title="The Temple Admin role can only be transferred, never edited away">
                          {isSelf ? 'Use "Make Temple Admin" on another member to step down' : 'Temple Admin'}
                        </span>
                      ) : (
                        <div className="flex gap-2 justify-start">
                          <button onClick={() => openEdit(m)} className="btn-secondary btn-sm">Edit</button>
                          {m.is_active && me?.roles?.includes('temple_admin') && (
                            <button
                              onClick={() => transferAdmin(m)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 border border-amber-300 rounded-md px-2 py-1 hover:bg-amber-50"
                              title="Hand the Temple Admin role to this member"
                            >
                              <ShieldCheck size={12} /> Make Temple Admin
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role description */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Role Permissions Reference</h3></div>
        <div className="card-body">
          <div className="grid grid-cols-3 gap-4 text-sm">
            {[
              { role: 'temple_admin', desc: 'Full access — can void donations, delete data, manage all settings', cls: 'badge-red' },
              { role: 'accountant', desc: 'Accounts, reports, fixed assets, loans, TDS entries', cls: 'badge-blue' },
              { role: 'cashier', desc: 'Donations, expenses, bookings, prasad, seva, bhojanshala', cls: 'badge-green' },
              { role: 'bhojanshala_cashier', desc: 'Bhojanshala only — record & redeem meal tokens', cls: 'badge-green' },
              { role: 'priest', desc: 'View seva bookings, mark them done', cls: 'badge-yellow' },
              { role: 'volunteer', desc: 'Event registrations, visitor count entries', cls: 'badge-gray' },
              { role: 'viewer', desc: 'Read-only access to all data (no create/edit)', cls: 'badge-gray' },
            ].map(({ role, desc, cls }) => (
              <div key={role} className="flex gap-2">
                <span className={`${cls} mt-0.5 flex-shrink-0`}>{role}</span>
                <p className="text-slate-500 text-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {editMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-4">Edit Staff: {editMember.name || editMember.mobile}</h3>
            <form onSubmit={saveEdit} className="space-y-4">
              <div>
                <label className="form-label">Role</label>
                <select className="form-select" value={editRole} onChange={e => setEditRole(e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="active" checked={editActive} onChange={e => setEditActive(e.target.checked)} className="w-4 h-4" />
                <label htmlFor="active" className="text-sm">Active (can log in)</label>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditMember(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={updating} className="btn-primary">{updating ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
