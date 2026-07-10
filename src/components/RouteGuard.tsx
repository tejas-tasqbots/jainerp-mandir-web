import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { canSee, ROLE_LABELS } from '../lib/rbac'

/**
 * Route-level RBAC gate. The sidebar hides modules a role can't access, but that
 * is cosmetic — without this guard a non-admin who reaches a restricted route by
 * URL/bookmark/stale link still renders the page and fires API calls that 403
 * (e.g. a cashier landing on /settings → `me` returns FORBIDDEN). This mirrors
 * the exact same `canSee` rbac map the sidebar uses, so UI visibility and route
 * access stay in one source of truth. The server still enforces its own guards.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const location = useLocation()
  const roles = useAuthStore(s => s.user?.roles)

  if (canSee(location.pathname, roles)) {
    return <>{children}</>
  }

  // Not authorized for this route. Send admins-less users back to the dashboard
  // (always allowed for every staff role) rather than showing a broken page.
  const roleLabel = (roles ?? [])
    .map(r => ROLE_LABELS[r] ?? r)
    .join(', ') || 'your role'

  return (
    <Navigate
      to="/dashboard"
      replace
      state={{ deniedPath: location.pathname, roleLabel }}
    />
  )
}
