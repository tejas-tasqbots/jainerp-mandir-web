import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crown, Plus, ShieldCheck, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { PhoneInput } from '../../../components/PhoneInput'
import { useAuthStore } from '../../../store/authStore'
import { useConfirm } from '../../../components/ConfirmDialog'
import { useToast } from '../../../components/kit/Toast'

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

  useEffect(() => { load() }, [])

  function load() {
    api.get('/users').then(r => setUsers(r.data.data || [])).catch(() => {})
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError(t('settings.users.nameRequired')); return }
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
        {showInvite && (
          <form onSubmit={invite} className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="form-label">{t('common.name')} *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label className="form-label">{t('common.mobile')} *</label><PhoneInput value={form.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} required /></div>
              <div>
                <label className="form-label">{t('settings.users.roleCol')}</label>
                <select className="form-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
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
            <thead><tr><th>{t('settings.users.nameCol')}</th><th>{t('settings.users.mobileCol')}</th><th>{t('settings.users.roleCol')}</th><th>{t('settings.users.statusCol')}</th><th>{t('settings.users.joinedCol')}</th><th className="text-right">{t('settings.users.actionsCol')}</th></tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-slate-400 py-6">{t('settings.users.noUsers')}</td></tr>
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
                        <span className="badge-gold inline-flex items-center gap-1">
                          <Crown size={11} /> {t('settings.users.templeAdmin')}
                        </span>
                      ) : (
                        <select
                          className="form-select text-sm py-1"
                          value={u.roles?.[0] || 'viewer'}
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
