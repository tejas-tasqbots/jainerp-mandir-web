import { useEffect, useState, useCallback } from 'react'
import { Link2, UserPlus, ShieldCheck, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { useConfirm } from '../../components/ConfirmDialog'

type LinkStatus = 'approved' | 'requested' | 'invited'

interface DevoteeLink {
  id: string
  devotee_id: string
  status: LinkStatus
  name: string
  mobile: string
  city?: string
  verified: boolean
  pan_masked?: string
  created_at: string
  responded_at?: string
}

interface InviteModalState { open: boolean; mobile: string; loading: boolean; error: string }

const TABS: { key: LinkStatus; label: string }[] = [
  { key: 'approved', label: 'Connected' },
  { key: 'requested', label: 'Pending Requests' },
  { key: 'invited', label: 'Pending Invites' },
]

export function ConnectedDevoteesPage() {
  const confirm = useConfirm()
  const [tab, setTab] = useState<LinkStatus>('approved')
  const [links, setLinks] = useState<DevoteeLink[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<InviteModalState>({ open: false, mobile: '', loading: false, error: '' })
  const [actionId, setActionId] = useState<string | null>(null)

  const fetchLinks = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/devotee-links', { params: { status: tab, limit: 100 } })
      setLinks(data.data || [])
    } catch {
      setLinks([])
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { fetchLinks() }, [fetchLinks])

  async function approve(id: string) {
    setActionId(id)
    try {
      await api.patch(`/devotee-links/${id}/approve`)
      await fetchLinks()
    } finally { setActionId(null) }
  }

  async function reject(id: string) {
    setActionId(id)
    try {
      await api.patch(`/devotee-links/${id}/reject`)
      await fetchLinks()
    } finally { setActionId(null) }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: 'Remove connection', message: 'Remove this devotee connection?', confirmLabel: 'Remove', danger: true }))) return
    setActionId(id)
    try {
      await api.delete(`/devotee-links/${id}`)
      await fetchLinks()
    } finally { setActionId(null) }
  }

  async function sendInvite() {
    if (!modal.mobile.match(/^\d{10}$/)) {
      setModal(m => ({ ...m, error: 'Enter a valid 10-digit mobile number' }))
      return
    }
    setModal(m => ({ ...m, loading: true, error: '' }))
    try {
      await api.post('/devotee-links/invite', { mobile: modal.mobile })
      setModal({ open: false, mobile: '', loading: false, error: '' })
      setTab('invited')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setModal(m => ({ ...m, loading: false, error: err.response?.data?.error?.message || 'Failed to send invite' }))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-navy-900">Connected Devotees</h1>
          <p className="text-sm text-slate-500 mt-0.5">Devotees linked to this temple — searchable from all forms</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchLinks} className="btn-secondary btn-sm" title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setModal({ open: true, mobile: '', loading: false, error: '' })} className="btn-primary btn-sm">
            <UserPlus size={14} /> Invite Devotee
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-brand-red text-brand-red'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Loading...</div>
        ) : links.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            {tab === 'approved' && 'No connected devotees yet. Invite a devotee or approve a pending request.'}
            {tab === 'requested' && 'No pending requests from devotees.'}
            {tab === 'invited' && 'No pending invites sent.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Mobile</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">City</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">PAN</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {links.map(link => (
                <tr key={link.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{link.name}</span>
                      {link.verified && (
                        <span title="OTP verified"><ShieldCheck size={14} className="text-green-600 flex-shrink-0" /></span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">{link.mobile}</td>
                  <td className="px-4 py-3 text-slate-500">{link.city || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{link.pan_masked || '—'}</td>
                  <td className="px-4 py-3">
                    {link.status === 'approved' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        <Link2 size={10} /> Connected
                      </span>
                    )}
                    {link.status === 'requested' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        Requested by devotee
                      </span>
                    )}
                    {link.status === 'invited' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        Invite sent
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {link.status === 'requested' && (
                        <>
                          <button
                            onClick={() => approve(link.id)}
                            disabled={actionId === link.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            <CheckCircle size={12} /> Approve
                          </button>
                          <button
                            onClick={() => reject(link.id)}
                            disabled={actionId === link.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                          >
                            <XCircle size={12} /> Reject
                          </button>
                        </>
                      )}
                      {(link.status === 'approved' || link.status === 'invited') && (
                        <button
                          onClick={() => remove(link.id)}
                          disabled={actionId === link.id}
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                          title={link.status === 'invited' ? 'Cancel invite' : 'Remove connection'}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-navy-900">Invite a Devotee</h2>
            <p className="text-sm text-slate-500">
              Enter the devotee's mobile number. They'll receive a notification to accept the temple connection in the JainERP Devotee app.
            </p>
            <div>
              <label className="form-label">Mobile Number *</label>
              <input
                type="tel"
                className="form-input"
                placeholder="10-digit mobile"
                maxLength={10}
                value={modal.mobile}
                onChange={e => setModal(m => ({ ...m, mobile: e.target.value.replace(/\D/g, '') }))}
                onKeyDown={e => e.key === 'Enter' && sendInvite()}
                autoFocus
              />
              {modal.error && <p className="text-red-600 text-xs mt-1">{modal.error}</p>}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setModal({ open: false, mobile: '', loading: false, error: '' })}
                className="btn-secondary"
                disabled={modal.loading}
              >
                Cancel
              </button>
              <button onClick={sendInvite} disabled={modal.loading} className="btn-primary">
                <UserPlus size={14} /> {modal.loading ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
