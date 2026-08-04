import { create } from 'zustand'
import { api } from '../lib/api'
import { useAuthStore } from './authStore'

export interface TempleProfile {
  id: string
  name: string
  temple_type: string
  slug: string
  address?: string
  city?: string
  state?: string
  phone?: string
  email?: string
  website?: string
  logo_url?: string
  plan_id?: string
  global_sync_enabled?: boolean
  /** 80G registration number — a temple without one cannot issue 80G receipts */
  reg_80g_number?: string | null
  /** Modules this trust bought (migration 031) — drives the whole nav. */
  effective_modules?: string[]
  /** The same list with display names, for anything that labels a module. */
  modules?: { key: string; display_name: string; is_core: boolean; sort_order: number }[]
}

interface ProfileState {
  profile: TempleProfile | null
  loading: boolean
  fetchProfile: () => Promise<void>
}

export const useProfileStore = create<ProfileState>(set => ({
  profile: null,
  loading: false,
  fetchProfile: async () => {
    set({ loading: true })
    try {
      const { data } = await api.get('/tenants/me')
      const profile: TempleProfile = data.data
      set({ profile })
      // Mirror the entitlements into the auth store, which is persisted — the
      // sidebar reads them from there so a desktop launch with no network still
      // renders the right nav from the last known list.
      if (Array.isArray(profile?.effective_modules)) {
        useAuthStore.getState().setModules(profile.effective_modules)
      }
    } catch {
      // ignore
    } finally {
      set({ loading: false })
    }
  },
}))
