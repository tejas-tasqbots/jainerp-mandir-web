import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { OfflineBanner } from '../OfflineBanner'
import { RouteGuard } from '../RouteGuard'

export function Layout() {
  return (
    <>
      <OfflineBanner />
      <div className="flex h-screen overflow-hidden bg-slate-50">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-y-auto p-6">
            <RouteGuard>
              <Outlet />
            </RouteGuard>
          </main>
        </div>
      </div>
    </>
  )
}
