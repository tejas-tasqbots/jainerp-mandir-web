import { useEffect } from 'react'
import axios from 'axios'
import { api } from './api'
import { useAuthStore } from '../store/authStore'

const MIN_GAP_MS = 60_000

const sameRoles = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) =>
  JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort())

/**
 * Brings the signed-in user's roles and name up to date when the app opens
 * and when its window comes back into focus, at most once a minute.
 *
 * Roles travel inside the access token (it lives up to an hour) and the top
 * bar read them once, at sign-in: a role changed by another admin showed only
 * after signing out and in (2026-10-12, a Temple Admin labelled "(Viewer)").
 * /auth/me now says both what the token carries and what is stored
 * (`current_roles`); only when they differ is the token renewed - the refresh
 * re-reads the roles - so the label, the sidebar and what the API allows move
 * together. /auth/me is outside the sign-in rate limit; the refresh is not,
 * which is why it is asked only on a real change. Offline (the desktop app) or
 * refused, it keeps what it has: a dead session is still ended by the next
 * real request, as before.
 */
export function useSessionRefresh(): void {
  useEffect(() => {
    let last = 0
    const refresh = async () => {
      if (Date.now() - last < MIN_GAP_MS || !useAuthStore.getState().accessToken) return
      last = Date.now()
      try {
        const r = await api.get('/auth/me')
        const me = r.data?.data ?? r.data
        if (!me?.user) return
        const stored: string[] | null = Array.isArray(me.current_roles) ? me.current_roles : null
        const { refreshToken, deviceId, setTokens } = useAuthStore.getState()
        if (stored && !sameRoles(stored, me.user.roles) && refreshToken) {
          const { data } = await axios.post(`${api.defaults.baseURL}/auth/refresh`, { refresh_token: refreshToken, device_id: deviceId })
          const token = data?.data?.access_token
          if (token) setTokens(token, refreshToken)
        }
        const { user, tenant, setUser } = useAuthStore.getState()
        if (!tenant) return
        const next = {
          id: me.user.id ?? user?.id ?? '',
          mobile: me.user.mobile ?? user?.mobile ?? '',
          name: me.user.name ?? user?.name ?? null,
          roles: stored ?? me.user.roles ?? user?.roles ?? [],
        }
        const was = { id: user?.id, mobile: user?.mobile, name: user?.name, roles: user?.roles }
        if (JSON.stringify(next) !== JSON.stringify(was)) {
          setUser(next, me.tenant?.id ? { id: me.tenant.id, slug: me.tenant.slug ?? tenant.slug, name: me.tenant.name ?? tenant.name } : tenant)
        }
      } catch {
        /* offline, or the refresh was refused: keep what we have */
      }
    }
    void refresh()
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}
