import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crown, KeyRound, Plus, ShieldCheck, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { PhoneInput } from '../../../components/PhoneInput'
import { useAuthStore } from '../../../store/authStore'
import { useConfirm } from '../../../components/ConfirmDialog'
import { useToast } from '../../../components/kit/Toast'
import { primaryRole } from '../../../lib/roleLabel'
import { offlineBridge } from '../../../lib/offlineDesktop'
import { OfflinePinDialog } from '../../../components/OfflinePinDialog'

interface StaffUser {
  id: string
  name: string | null
  mobile: string
  email: string | null
  roles: string[]
  is_active: boolean
  joined_at?: string
}

const ROLE_IDS = ['temple_admin', 'accountant', 'cashier', 'bhojanshala_cashier', 'priest', 'volunteer', 'viewer'] as const
const ROLE_BADGE_CLS: Record<string, string> = {
  temple_admin: 'badge-red', accountant: 'badge-blue', cashier: 'badge-green',
  bhojanshala_cashier: 'badge-green', priest: 'badge-yellow', volunteer: 'badge-gray', viewer: 'badge-gray',
}
const ASSIGNABLE_ROLE_IDS = ['accountant', 'cashier', 'bhojanshala_cashier', 'priest', 'volunteer', 'viewer'] as const

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
  const toast = useToast()
  const { t } = useTranslation()
  const me = useAuthStore(s => s.user)
  const confirm = useConfirm()
  const [users, setUsers] = useState<StaffUser[]>([])
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ name: '', mobile: '', role: 'cashier' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // JainERP Offline: each user signs in on this computer with a PIN.
  const offline = offlineBridge()
  const [hasPin, setHasPin] = useState<Record<string, boolean>>({})
  const [pinFor, setPinFor] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => { load() }, [])

  function load() {
    api.get('/users').then(r => setUsers(r.data.data || [])).catch(() => {})
    if (offline) {
      offline.users().then(r => {
        if (r.success) setHasPin(Object.fromEntries(r.users.map(u => [u.id, u.hasPin])))
      }).catch(() => {})
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError(t('settings.users.nameRequired')); return }
    setSaving(true)
    setError('')
    try {
      const { data } = await api.post('/users/invite', {
        name: form.name,
        mobile: toE164(form.mobile),
        roles: [form.role],
      })
      // Offline there is no OTP to sign in with: straight on to their PIN.
      const newId = data?.data?.user_id
      if (offline && newId) setPinFor({ id: newId, name: form.name })
      setForm({ name: '', mobile: '', role: 'cashier' })
      setShowInvite(false)
      load()
    } catch (err: unknown) {
      setError(apiMessage(err, t('settings.users.inviteFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(u: StaffUser) {
    setNotice('')
    try {
      await api.patch(`/users/${u.id}`, { is_active: !u.is_active })
    } catch (err) {
      toast.error(apiMessage(err, t('settings.users.statusChangeFailed')))
    }
    load()
  }

  async function changeRole(u: StaffUser, role: string) {
    setNotice('')
    try {
      await api.patch(`/users/${u.id}`, { roles: [role] })
    } catch (err) {
      toast.error(apiMessage(err, t('settings.users.roleChangeFailed')))
    }
    load()
  }

  async function transferAdmin(u: StaffUser) {
    if (!(await confirm({
      title: t('settings.users.transferTitle'),
      message: t('settings.users.transferMessage', { name: u.name || u.mobile }),
      confirmLabel: t('settings.users.transferConfirm'),
      danger: true,
    }))) return
    setNotice('')
    try {
      const { data } = await api.post(`/users/${u.id}/transfer-admin`)
      setNotice(data.data?.note || t('settings.users.transferredDefault'))
      load()
    } catch (err) {
      toast.error(apiMessage(err, t('settings.users.transferFailed')))
    }
  }

  const iAmAdmin = me?.roles?.includes('temple_admin') ?? false

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">{t('settings.users.heading')}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {t('settings.users.subheading')}
          </p>
        </div>
        {!showInvite && <button onClick={() => setShowInvite(true)} className="btn-primary btn-sm"><Plus size={14} /> {t('settings.users.addUser')}</button>}
      </div>
      <div className="card-body space-y-3">
        {notice && (
          <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">{notice}</div>
        )}
        {offline && (
          <div className="bg-blue-50 border border-blue-200 rounded-md px-4 py-2 text-sm text-blue-800 flex items-start gap-2">
            <KeyRound size={15} className="mt-0.5 flex-shrink-0" />
            <span>{t('offline.users.howSignIn', 'On this computer people sign in by choosing their name and entering their own PIN — no OTP. After adding someone, set their PIN and tell it to them in person. The mobile number is just for records here.')}</span>
          </div>
        )}
        {pinFor && (
          <OfflinePinDialog mode="set" userId={pinFor.id} userName={pinFor.name}
            onClose={() => setPinFor(null)}
            onDone={() => { setPinFor(null); toast.success(t('offline.pin.saved', 'PIN saved.')); load() }} />
        )}
        {showInvite && (
          <form onSubmit={invite} className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="form-label">{t('common.name')} *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label className="form-label">{t('common.mobile')} *</label><PhoneInput value={form.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} required /></div>
              <div>
                <label className="form-label" htmlFor="users-tab-role">{t('settings.users.roleCol')}</label>
                <select id="users-tab-role" className="form-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {ASSIGNABLE_ROLE_IDS.map(r => <option key={r} value={r}>{t(`settings.users.roleLabels.${r}`)}</option>)}
                </select>
              </div>
            </div>
            {error && <p className="text-sm text-brand-red">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="btn-primary btn-sm">{saving ? t('settings.users.adding') : t('settings.users.addUser')}</button>
              <button type="button" onClick={() => { setShowInvite(false); setError('') }} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('settings.users.nameCol')}</th><th>{t('settings.users.mobileCol')}</th><th>{t('settings.users.roleCol')}</th><th>{t('settings.users.statusCol')}</th><th>{t('settings.users.joinedCol')}</th>{offline && <th>{t('offline.users.pinCol', 'Sign-in PIN')}</th>}<th className="text-right">{t('settings.users.actionsCol')}</th></tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={offline ? 7 : 6} className="text-center text-slate-400 py-6">{t('settings.users.noUsers')}</td></tr>
              ) : users.map(u => {
                const isSelf = u.id === me?.id
                const isAdminRow = u.roles?.includes('temple_admin')
                return (
                  <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                    <td className="font-medium">
                      {u.name || '—'}
                      {isSelf && <span className="badge-blue ml-2">{t('settings.users.you')}</span>}
                    </td>
                    <td className="text-sm text-slate-500">{u.mobile}</td>
                    <td>
                      {isAdminRow ? (
                        <span className="badge-yellow inline-flex items-center gap-1">
                          <Crown size={11} /> {t('settings.users.templeAdmin')}
                        </span>
                      ) : (
                        <select
                          className="form-select text-sm py-1"
                          value={primaryRole(u.roles) || 'viewer'}
                          onChange={e => changeRole(u, e.target.value)}
                          disabled={!iAmAdmin}
                        >
                          {ASSIGNABLE_ROLE_IDS.map(r => <option key={r} value={r}>{t(`settings.users.roleLabels.${r}`)}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      {isSelf || isAdminRow ? (
                        <span className={u.is_active ? 'badge-green' : 'badge-gray'}>
                          {u.is_active ? t('common.active') : t('common.inactive')}
                        </span>
                      ) : (
                        <button onClick={() => toggleActive(u)} className={u.is_active ? 'badge-green cursor-pointer' : 'badge-gray cursor-pointer'}>
                          {u.is_active ? t('common.active') : t('common.inactive')}
                        </button>
                      )}
                    </td>
                    <td className="text-xs text-slate-400">
                      {u.joined_at ? new Date(u.joined_at).toLocaleDateString('en-IN') : '—'}
                    </td>
                    {offline && (
                      <td>
                        <div className="flex items-center gap-2">
                          <span className={hasPin[u.id] ? 'badge-green' : 'badge-yellow'}>
                            {hasPin[u.id] ? t('offline.users.pinSet', 'Set') : t('offline.users.noPin', 'No PIN')}
                          </span>
                          {iAmAdmin && u.is_active && !isSelf && (
                            <button onClick={() => setPinFor({ id: u.id, name: u.name || u.mobile })}
                              className="text-xs font-medium text-navy-700 underline hover:text-navy-900">
                              {hasPin[u.id] ? t('offline.users.resetPin', 'Reset PIN') : t('offline.users.setPin', 'Set PIN')}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="text-right">
                      {iAmAdmin && !isSelf && !isAdminRow && u.is_active && (
                        <button
                          onClick={() => transferAdmin(u)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 border border-amber-300 rounded-md px-2 py-1 hover:bg-amber-50"
                          title={t('settings.users.makeTempleAdminTitle') as string}
                        >
                          <ShieldCheck size={12} /> {t('settings.users.makeTempleAdmin')}
                        </button>
                      )}
                      {isSelf && isAdminRow && (
                        <span className="text-xs text-slate-400">{t('settings.users.transferToStepDown')}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">
          {t('settings.users.footerNote', { admin: t('settings.users.templeAdmin') })}
        </p>

        <div className="border-t border-slate-100 pt-4">
          <h4 className="font-semibold text-sm mb-3">{t('settings.users.permissionsRefHeading')}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            {ROLE_IDS.map(role => (
              <div key={role} className="flex gap-2">
                <span className={`${ROLE_BADGE_CLS[role]} mt-0.5 flex-shrink-0`}>{role}</span>
                <p className="text-slate-500 text-xs">{t(`settings.users.roles.${role}`)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
