import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { OfflineBanner } from '../OfflineBanner'
import { RouteGuard } from '../RouteGuard'
import { CommandPalette } from '../kit/CommandPalette'
import { KeyboardShortcuts } from '../kit/KeyboardShortcuts'

export function Layout() {
  return (
    <>
      <div className="no-print"><OfflineBanner /></div>
      <div className="flex h-screen overflow-hidden bg-slate-50 app-shell">
        <div className="no-print"><Sidebar /></div>
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="no-print"><TopBar /></div>
          <main className="flex-1 overflow-y-auto p-6 app-main">
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
