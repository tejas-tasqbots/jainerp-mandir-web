import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, UserPlus, ShieldCheck, CheckCircle, XCircle, Trash2, RefreshCw, Search, FileSpreadsheet } from 'lucide-react'
import { api, apiErrorMessage } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { useToast } from '../../components/kit/Toast'
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

const TABS: { key: LinkStatus; labelKey: string }[] = [
  { key: 'approved', labelKey: 'devoteesPage.tabConnected' },
  { key: 'requested', labelKey: 'devoteesPage.tabPendingRequests' },
  { key: 'invited', labelKey: 'devoteesPage.tabPendingInvites' },
]

export function ConnectedDevoteesPage() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()
  const [tab, setTab] = useState<LinkStatus>('approved')
  const [links, setLinks] = useState<DevoteeLink[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<InviteModalState>({ open: false, mobile: '', loading: false, error: '' })
  const [actionId, setActionId] = useState<string | null>(null)

  const visible = search
    ? links.filter(l =>
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        l.mobile.includes(search) ||
        (l.city ?? '').toLowerCase().includes(search.toLowerCase()))
    : links

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('devoteesPage.title'),
        subtitle: t(TABS.find(x => x.key === tab)?.labelKey ?? ''),
        filename: `devotees-${tab}`,
        columns: [
          { header: t('devoteesPage.name'), width: 26 },
          { header: t('devoteesPage.mobile'), width: 16 },
          { header: t('devoteesPage.city'), width: 18 },
          { header: t('devoteesPage.pan'), width: 13 },
          { header: t('common.status'), width: 14 },
        ],
        rows: visible.map(l => [l.name, l.mobile, l.city ?? '', l.pan_masked ?? '', l.status]),
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

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
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally { setActionId(null) }
  }

  async function reject(id: string) {
    setActionId(id)
    try {
      await api.patch(`/devotee-links/${id}/reject`)
      await fetchLinks()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally { setActionId(null) }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: t('devoteesPage.removeConnectionTitle'), message: t('devoteesPage.removeConnectionMessage'), confirmLabel: t('devoteesPage.remove'), danger: true }))) return
    setActionId(id)
    try {
      await api.delete(`/devotee-links/${id}`)
      await fetchLinks()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally { setActionId(null) }
  }

  async function sendInvite() {
    if (!modal.mobile.match(/^\d{10}$/)) {
      setModal(m => ({ ...m, error: t('devoteesPage.invalidMobile') }))
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
          <h1 className="text-xl font-bold text-navy-900">{t('devoteesPage.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('devoteesPage.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchLinks} className="btn-secondary btn-sm" title={t('ui.refresh')}>
            <RefreshCw size={14} />
          </button>
          <button onClick={exportExcel} className="btn-icon !text-green-700 hover:!bg-green-50" title={t('kit.exportExcel')} aria-label={t('kit.exportExcel')}>
            <FileSpreadsheet size={16} />
          </button>
          <button onClick={() => setModal({ open: true, mobile: '', loading: false, error: '' })} className="btn-primary btn-sm">
            <UserPlus size={14} /> {t('devoteesPage.inviteDevotee')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative w-64">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder={t('devoteesPage.searchPlaceholder')}
          value={search} onChange={e => setSearch(e.target.value)} />
        {search && (
          <button type="button" title={t('kit.clearSearch')} aria-label={t('kit.clearSearch')} onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <XCircle size={14} />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(tabItem => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === tabItem.key
                ? 'border-brand-red text-brand-red'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t(tabItem.labelKey)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">{t('common.loading')}</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            {tab === 'approved' && t('devoteesPage.noConnectedYet')}
            {tab === 'requested' && t('devoteesPage.noPendingRequests')}
            {tab === 'invited' && t('devoteesPage.noPendingInvites')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('devoteesPage.name')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('devoteesPage.mobile')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('devoteesPage.city')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('devoteesPage.pan')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('common.status')}</th>
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
                        <span title={t('ui.otpVerified')}><ShieldCheck size={14} className="text-green-600 flex-shrink-0" /></span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">{link.mobile}</td>
                  <td className="px-4 py-3 text-slate-500">{link.city || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{link.pan_masked || '—'}</td>
                  <td className="px-4 py-3">
                    {link.status === 'approved' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        <Link2 size={10} /> {t('devoteesPage.connected')}
                      </span>
                    )}
                    {link.status === 'requested' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        {t('devoteesPage.requestedByDevotee')}
                      </span>
                    )}
                    {link.status === 'invited' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {t('devoteesPage.inviteSent')}
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
                            <CheckCircle size={12} /> {t('devoteesPage.approve')}
                          </button>
                          <button
                            onClick={() => reject(link.id)}
                            disabled={actionId === link.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                          >
                            <XCircle size={12} /> {t('devoteesPage.reject')}
                          </button>
                        </>
                      )}
                      {(link.status === 'approved' || link.status === 'invited') && (
                        <button
                          onClick={() => remove(link.id)}
                          disabled={actionId === link.id}
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                          title={link.status === 'invited' ? t('devoteesPage.cancelInvite') : t('devoteesPage.removeConnection')}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-navy-900">{t('devoteesPage.inviteADevotee')}</h2>
            <p className="text-sm text-slate-500">
              {t('devoteesPage.inviteHint')}
            </p>
            <div>
              <label className="form-label">{t('devoteesPage.mobileNumber')}</label>
              <input
                type="tel"
                className="form-input"
                placeholder={t('devoteesPage.mobilePlaceholder')}
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
                {t('common.cancel')}
              </button>
              <button onClick={sendInvite} disabled={modal.loading} className="btn-primary">
                <UserPlus size={14} /> {modal.loading ? t('common.saving') : t('devoteesPage.sendInvite')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
