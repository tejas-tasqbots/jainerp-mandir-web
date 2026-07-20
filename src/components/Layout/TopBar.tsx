import { LogOut, User, RefreshCw, Search, Keyboard } from 'lucide-react'
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
      <div className="flex items-center gap-3 min-w-0">
        {tenant?.name && <span className="text-xs font-medium text-slate-600 truncate">{tenant.name}</span>}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          className="flex items-center gap-2 pl-2.5 pr-2 py-1 rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-500 transition-colors"
          title={t('palette.openTitle')}
        >
          <Search size={13} />
          <span className="text-xs">{t('palette.searchEllipsis')}</span>
          <kbd className="text-[10px] font-sans px-1 py-0.5 rounded bg-slate-100 text-slate-400">Ctrl K</kbd>
        </button>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <User size={15} className="text-slate-400" />
          <span>{user?.name || user?.mobile}</span>
          {user?.roles?.[0] && (
            <span className="text-xs text-slate-400 capitalize">({user.roles[0].replace('_', ' ')})</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-shortcuts-sheet'))}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          title={t('shortcuts.title')}
          aria-label={t('shortcuts.title')}
        >
          <Keyboard size={16} />
        </button>
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
