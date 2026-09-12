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
  // Without this, axios waits forever. On the desktop edition the API host comes
  // from the user's own server config, so an unreachable or mistyped host left
  // every request hanging with no error — the app sat on its splash screen
  // permanently with no way out. Fail instead, so callers can show something.
  timeout: 30000,
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
    // The mandir was suspended / deactivated / deleted while this session was
    // live. Every request now 403s, so end the session and carry the platform's
    // message (which names who to contact) to the login screen.
    if (err.response?.status === 403 && err.response?.data?.error?.code === 'TENANT_INACTIVE') {
      try {
        sessionStorage.setItem(
          'jainerp_blocked_message',
          err.response.data.error.message ??
            'This mandir is not available. Please contact your temple admin or email contact@jainerp.org.',
        )
      } catch { /* private mode — the login screen still shows its default */ }
      useAuthStore.getState().logout()
    }
    return Promise.reject(err)
  }
)

/**
 * The message to show the user when an API call fails.
 *
 * Prefers the API's own `{ code, message }` error, which is written to be read
 * ("Booker / contact is required."), and falls back to the caller's wording
 * when the request never reached the API or carried no message.
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const ex = e as { response?: { data?: { error?: { message?: string }; message?: string } } }
  return ex?.response?.data?.error?.message || ex?.response?.data?.message || fallback
}

export function fmtPaise(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function parsePaise(rupees: string | number): number {
  return Math.round(Number(rupees) * 100)
}

/**
 * The IST calendar date (YYYY-MM-DD) an API date value falls on.
 *
 * A Postgres `date` comes back as local midnight and serialises to UTC, so
 * 2026-08-07 in IST arrives as "2026-08-06T18:30:00.000Z" — slicing that string
 * gives the day before, and comparing it to a locally-built date never matches.
 * The trust's books are kept in IST (FY is April–March), so pin the zone rather
 * than trusting whatever the browser is set to.
 */
export function istDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** Today's date in IST as YYYY-MM-DD — what the register should be keyed on. */
export function todayIst(): string {
  return istDate(new Date())
}

export function currentFY(): string {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-${String(year + 1).slice(-2)}`
}

/** Format an India FY label (April–March) from its starting calendar year, e.g. 2026 → "2026-27". */
export function fyLabel(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(-2)}`
}

/**
 * A list of selectable financial years for the FY dropdowns — `back` years before
 * the current FY through `forward` years after (newest first). `ensure` guarantees
 * a specific FY (e.g. a value already in state) is present even if outside the window.
 */
export function fyOptions({ back = 6, forward = 1, ensure }: { back?: number; forward?: number; ensure?: string } = {}): string[] {
  const now = new Date()
  const curStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const years: string[] = []
  for (let y = curStart + forward; y >= curStart - back; y--) years.push(fyLabel(y))
  if (ensure && !years.includes(ensure)) {
    years.push(ensure)
    // Keep newest-first by the starting year.
    years.sort((a, b) => Number(b.slice(0, 4)) - Number(a.slice(0, 4)))
  }
  return years
}
