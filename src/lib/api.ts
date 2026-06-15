import axios from 'axios'
import { useAuthStore } from '../store/authStore'

// Support configurable API URL when running inside Electron desktop app.
// The Electron main process injects window.__JAINERP_API_URL__ before the
// page finishes loading, so we can read it here at module initialisation time.
const BASE_URL = (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__JAINERP_API_URL__)
  ? `${(window as unknown as Record<string, unknown>).__JAINERP_API_URL__ as string}/api/v1`
  : '/api/v1'

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        const { refreshToken, deviceId, setTokens, logout } = useAuthStore.getState()
        if (!refreshToken) { logout(); return Promise.reject(err) }
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
          device_id: deviceId,
        })
        const newToken = data.data?.access_token
        if (newToken) {
          setTokens(newToken, refreshToken)
          original.headers.Authorization = `Bearer ${newToken}`
          return api(original)
        }
      } catch {
        useAuthStore.getState().logout()
      }
    }
    return Promise.reject(err)
  }
)

export function fmtPaise(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function parsePaise(rupees: string | number): number {
  return Math.round(Number(rupees) * 100)
}

export function currentFY(): string {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-${String(year + 1).slice(-2)}`
}
