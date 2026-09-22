import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

/**
 * GET a URL and keep the answer, keyed by the URL it answers.
 *
 * `loading` is DERIVED — "the answer I hold is not for the URL I want" — rather
 * than a flag set at the top of an effect, which is what
 * react-hooks/set-state-in-effect flags (a synchronous setState in an effect
 * renders twice for nothing). The previous answer stays in `data` while the
 * next one loads, so a table does not flash empty between pages.
 *
 * `url = null` means "nothing to fetch yet". `refresh()` fetches the same URL
 * again (after a delete or a restore changed what it would return).
 */
export function useApiGet<T>(url: string | null): {
  data: T | null
  loading: boolean
  failed: boolean
  error: unknown
  refresh: () => void
} {
  const [nonce, setNonce] = useState(0)
  const key = url ? `${nonce}|${url}` : null
  const [result, setResult] = useState<{ key: string; data: T | null; error: unknown } | null>(null)

  useEffect(() => {
    if (!url || !key) return
    let cancelled = false
    api.get(url)
      .then(r => { if (!cancelled) setResult({ key, data: r.data as T, error: null }) })
      .catch(e => { if (!cancelled) setResult({ key, data: null, error: e ?? new Error('request failed') }) })
    return () => { cancelled = true }
  }, [url, key])

  const refresh = useCallback(() => setNonce(n => n + 1), [])
  const fresh = !!key && result?.key === key
  return {
    data: result?.data ?? null,
    loading: !!key && !fresh,
    failed: fresh && !!result?.error,
    error: fresh ? result?.error ?? null : null,
    refresh,
  }
}
