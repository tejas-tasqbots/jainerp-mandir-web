import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Language = 'en' | 'hi' | 'mr'

export interface AuthedUser {
  id: string
  mobile: string
  name: string | null
  roles: string[]
}

export interface TenantInfo {
  id: string
  slug: string
  name: string
}

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  deviceId: string
  user: AuthedUser | null
  tenant: TenantInfo | null
  /**
   * Modules this trust bought (migration 031) — what the sidebar, the route
   * guard and the command palette render from.
   *
   * PERSISTED deliberately: the desktop edition loads this same bundle and can
   * be launched with no network, where it cannot fetch the profile. Without a
   * cached list its sidebar would come up empty, which reads as "the app is
   * broken" rather than "you are offline". `null` means "not known yet" and is
   * treated as "show everything" — never blank the nav on a guess.
   */
  modules: string[] | null
  language: Language
  isLoggedIn: boolean
  setTokens: (access: string, refresh: string) => void
  setUser: (user: AuthedUser, tenant: TenantInfo) => void
  setModules: (modules: string[] | null) => void
  setLanguage: (language: Language) => void
  logout: () => void
}

function genDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      deviceId: genDeviceId(),
      user: null,
      tenant: null,
      modules: null,
      language: 'en',
      isLoggedIn: false,
      setTokens: (access, refresh) =>
        set({ accessToken: access, refreshToken: refresh, isLoggedIn: true }),
      setUser: (user, tenant) => set({ user, tenant }),
      setModules: modules => set({ modules }),
      setLanguage: language => set({ language }),
      logout: () =>
        set({ accessToken: null, refreshToken: null, user: null, tenant: null, modules: null, isLoggedIn: false }),
    }),
    {
      name: 'jainerp-auth',
      partialize: state => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        deviceId: state.deviceId,
        user: state.user,
        tenant: state.tenant,
        modules: state.modules,
        language: state.language,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
)
