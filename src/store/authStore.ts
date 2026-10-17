import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Language = 'en' | 'hi' | 'mr' | 'gu'

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
  /**
   * Set when the user picks a language on the LOGIN screen, where there is no
   * session to save it against. Sign-in must then keep that fresh choice rather
   * than letting the server's stored preference overwrite it; the login flow
   * pushes it up and clears the pin.
   */
  languagePinned: boolean
  isLoggedIn: boolean
  setTokens: (access: string, refresh: string) => void
  setUser: (user: AuthedUser, tenant: TenantInfo) => void
  /** The trust's current name, from its profile — see profileStore. */
  setTenantName: (name: string) => void
  setModules: (modules: string[] | null) => void
  setLanguage: (language: Language) => void
  pinLanguage: () => void
  clearLanguagePin: () => void
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
    (set) => ({
      accessToken: null,
      refreshToken: null,
      deviceId: genDeviceId(),
      user: null,
      tenant: null,
      modules: null,
      language: 'en',
      languagePinned: false,
      isLoggedIn: false,
      setTokens: (access, refresh) =>
        set({ accessToken: access, refreshToken: refresh, isLoggedIn: true }),
      setUser: (user, tenant) => set({ user, tenant }),
      setTenantName: name =>
        set(state => (state.tenant && state.tenant.name !== name ? { tenant: { ...state.tenant, name } } : {})),
      setModules: modules => set({ modules }),
      setLanguage: language => set({ language }),
      pinLanguage: () => set({ languagePinned: true }),
      clearLanguagePin: () => set({ languagePinned: false }),
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
        languagePinned: state.languagePinned,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
)
