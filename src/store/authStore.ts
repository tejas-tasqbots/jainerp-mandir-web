import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  isLoggedIn: boolean
  setTokens: (access: string, refresh: string) => void
  setUser: (user: AuthedUser, tenant: TenantInfo) => void
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
      isLoggedIn: false,
      setTokens: (access, refresh) =>
        set({ accessToken: access, refreshToken: refresh, isLoggedIn: true }),
      setUser: (user, tenant) => set({ user, tenant }),
      logout: () =>
        set({ accessToken: null, refreshToken: null, user: null, tenant: null, isLoggedIn: false }),
    }),
    {
      name: 'jainerp-auth',
      partialize: state => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        deviceId: state.deviceId,
        user: state.user,
        tenant: state.tenant,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
)
