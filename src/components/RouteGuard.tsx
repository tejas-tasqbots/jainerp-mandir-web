import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { canSee, moduleForPath, ROLE_LABELS } from '../lib/rbac'

/**
 * Route-level gate for BOTH questions: may this role do it, and did this trust
 * buy it? The sidebar hides what fails either test, but that is cosmetic —
 * without this guard a URL/bookmark/stale link still renders the page and fires
 * API calls that 403 (a cashier landing on /settings, or any user landing on
 * /rooms at a trust with no Dharamshala module). It reads the same `canSee` map
 * the sidebar does, so visibility and route access stay one source of truth. The
 * server enforces its own @Roles / @RequiresModule guards regardless.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const location = useLocation()
  const roles = useAuthStore(s => s.user?.roles)
  const modules = useAuthStore(s => s.modules)

  if (canSee(location.pathname, roles, modules)) {
    return <>{children}</>
  }

  // A module the trust never bought is not a permission problem. Saying "your
  // role cannot do this" would send the user to their temple admin for
  // something no admin can fix, so the reason is passed through and the
  // dashboard renders the right message.
  const missingModule = moduleForPath(location.pathname)
  const isModuleGate = !!missingModule && !!modules && !modules.includes(missingModule)

  const roleLabel = (roles ?? [])
    .map(r => ROLE_LABELS[r] ?? r)
    .join(', ') || 'your role'

  return (
    <Navigate
      to="/dashboard"
      replace
      state={
        isModuleGate
          ? { deniedPath: location.pathname, deniedReason: 'module', deniedModule: missingModule }
          : { deniedPath: location.pathname, deniedReason: 'role', roleLabel }
      }
    />
  )
}
