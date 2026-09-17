import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { OfflineBanner } from '../OfflineBanner'
import { RouteGuard } from '../RouteGuard'
import { CommandPalette } from '../kit/CommandPalette'
import { KeyboardShortcuts } from '../kit/KeyboardShortcuts'

/**
 * The app shell.
 *
 * Below `lg` (1024 px) the sidebar is a drawer behind the top bar's menu
 * button. It used to be a permanent 240 px column at every width, so on a
 * 390 px phone every page was squeezed into the 150 px left beside it — tables,
 * forms and totals in a strip no one could use. Nothing scrolled sideways, so
 * an overflow check could not see it; a screenshot could. The desktop app's
 * window is at least 1200 px wide and always gets the static sidebar.
 */
export function Layout() {
  const { t } = useTranslation()
  const location = useLocation()
  // The drawer is open FOR the route it was opened on. A tap on a menu item
  // navigates, and the drawer is then closed by construction — no effect
  // resetting state after every navigation.
  const here = location.pathname + location.search
  const [openOn, setOpenOn] = useState<string | null>(null)
  const navOpen = openOn === here
  const setNavOpen = (open: boolean) => setOpenOn(open ? here : null)

  // Escape closes the drawer, as it closes every other overlay here.
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenOn(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <>
      <div className="no-print"><OfflineBanner /></div>
      <div className="flex h-screen overflow-hidden bg-slate-50 app-shell">
        <div className="no-print hidden lg:block"><Sidebar /></div>
        {navOpen && (
          <div className="no-print fixed inset-0 z-40 lg:hidden" data-testid="nav-drawer">
            <button
              type="button"
              aria-label={t('topBar.closeMenu', { defaultValue: 'Close menu' })}
              className="absolute inset-0 bg-slate-900/40"
              onClick={() => setNavOpen(false)}
            />
            <div className="relative h-full w-60 max-w-[85vw] shadow-xl">
              <Sidebar />
            </div>
          </div>
        )}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="no-print"><TopBar onMenu={() => setNavOpen(true)} /></div>
          <main className="flex-1 overflow-y-auto p-3 sm:p-6 app-main">
            <RouteGuard>
              <Outlet />
            </RouteGuard>
          </main>
        </div>
      </div>
      <CommandPalette />
      <KeyboardShortcuts />
    </>
  )
}
