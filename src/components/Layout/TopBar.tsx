import { LogOut, User, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/authStore'
import { api } from '../../lib/api'
import { LanguageSwitcher } from './LanguageSwitcher'

export function TopBar() {
  const { t } = useTranslation()
  const { user, tenant, logout } = useAuthStore()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await api.post('/auth/logout')
    } catch {
      // ignore errors on logout
    } finally {
      logout()
      setLoggingOut(false)
    }
  }

  return (
    <header className="h-12 flex-shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-6">
      <div className="text-xs text-slate-400">
        {tenant?.name && <span className="font-medium text-slate-600">{tenant.name}</span>}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <User size={15} className="text-slate-400" />
          <span>{user?.name || user?.mobile}</span>
          {user?.roles?.[0] && (
            <span className="text-xs text-slate-400 capitalize">({user.roles[0].replace('_', ' ')})</span>
          )}
        </div>
        <LanguageSwitcher />
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-red transition-colors disabled:opacity-50"
          title={t('topBar.logout')}
        >
          {loggingOut ? <RefreshCw size={15} className="animate-spin" /> : <LogOut size={15} />}
          <span>{t('topBar.logout')}</span>
        </button>
      </div>
    </header>
  )
}
