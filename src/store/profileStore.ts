import { create } from 'zustand'
import { api } from '../lib/api'

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
      set({ profile: data.data })
    } catch {
      // ignore
    } finally {
      set({ loading: false })
    }
  },
}))
