import { LogOut, User, RefreshCw, Search, Keyboard, Compass, Menu, MonitorSmartphone } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/authStore'
import { api } from '../../lib/api'
import { LanguageSwitcher } from './LanguageSwitcher'
import { UpdateButton } from './UpdateButton'
import { resetTour } from '../Walkthrough'
import { primaryRole, roleLabel } from '../../lib/roleLabel'

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const { t } = useTranslation()
  const { user, tenant, logout } = useAuthStore()
  const navigate = useNavigate()
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
    <header className="h-12 flex-shrink-0 bg-white border-b border-slate-200 flex items-center justify-between gap-2 px-3 sm:px-6">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* The sidebar is a drawer below lg — see Layout. */}
        {onMenu && (
          <button type="button" onClick={onMenu} data-testid="open-nav"
            className="lg:hidden -ml-1 p-1.5 rounded-md text-slate-600 hover:bg-slate-100"
            aria-label={t('topBar.menu', { defaultValue: 'Menu' })}>
            <Menu size={18} />
          </button>
        )}
        {tenant?.name && <span className="text-xs font-medium text-slate-600 truncate">{tenant.name}</span>}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          className="flex flex-shrink-0 items-center gap-2 pl-2.5 pr-2 py-1 rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-500 transition-colors"
          title={t('palette.openTitle')}
        >
          <Search size={13} />
          <span className="hidden sm:inline text-xs">{t('palette.searchEllipsis')}</span>
          <kbd className="hidden md:inline text-[10px] font-sans px-1 py-0.5 rounded bg-slate-100 text-slate-400">Ctrl K</kbd>
        </button>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3 sm:gap-4">
        {/* Desktop only: shows once an update is downloaded, and stays until it
            is installed. Renders nothing in a browser. */}
        <UpdateButton />
        {/* Who is signed in: from md up. Below that it pushed into the search
            box (it did at 711 px) and the tenant name above says enough. */}
        {/* Opens My Account - their own language and offline PIN - for every role. */}
        <button
          type="button"
          onClick={() => navigate('/my-account')}
          title={t('settings.myAccount')}
          className="hidden md:flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap hover:text-navy-900 transition-colors"
        >
          <User size={15} className="text-slate-400" />
          <span>{user?.name || user?.mobile}</span>
          {/* The highest role held, not the first stored (lib/roleLabel). */}
          {primaryRole(user?.roles) && (
            <span className="text-xs text-slate-400" data-testid="topbar-role">({roleLabel(t, primaryRole(user?.roles)!, true)})</span>
          )}
        </button>
        {/* Where this account is signed in. A sign-in used to be invisible:
            nothing said how many devices held a live session, or where. */}
        <button
          type="button"
          onClick={() => navigate('/my-devices')}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          title={t('devices.title')}
          aria-label={t('devices.title')}
        >
          <MonitorSmartphone size={16} />
        </button>
        {/* Replay the tour. The single most useful moment for a walkthrough is
            after somebody has skipped it, so it must be reachable on demand. */}
        <button
          type="button"
          onClick={() => {
            if (user?.id && tenant?.id) resetTour('mandir', user.id, tenant.id)
            navigate('/')
            // The Dashboard owns the tour; give it a tick to mount before
            // asking it to start, so this works from any page.
            setTimeout(() => window.dispatchEvent(new Event('jainerp:replay-tour')), 250)
          }}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          title={t('tour.replay')}
          aria-label={t('tour.replay')}
        >
          <Compass size={16} />
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-shortcuts-sheet'))}
          className="hidden sm:inline-flex text-slate-400 hover:text-slate-600 transition-colors"
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
          <span className="hidden sm:inline">{t('topBar.logout')}</span>
        </button>
      </div>
    </header>
  )
}
