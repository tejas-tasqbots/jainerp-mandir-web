import { useEffect, useState } from 'react'

/**
 * Desktop-aware connectivity hook.
 *
 * In the browser/PWA admin this always reports online (the page itself came
 * from the network). Inside the Electron desktop app it tracks the main
 * process's connectivity checks, so online-only pages (e.g. Donation Requests,
 * which live on the central server) can gate to a "needs internet" state
 * instead of surfacing failed fetches at the offline counter.
 *
 * Returns `null` while the first desktop check is in flight.
 */
export function useIsOnline(): boolean | null {
  const isDesktop = typeof window !== 'undefined' && (window.__JAINERP_DESKTOP__ || window.electronAPI?.isElectron)
  const [online, setOnline] = useState<boolean | null>(isDesktop ? null : true)

  useEffect(() => {
    if (!isDesktop || !window.electronAPI) return
    window.electronAPI.checkConnectivity().then(setOnline).catch(() => setOnline(false))
    const unsubscribe = window.electronAPI.onConnectivityChange((isOnline) => setOnline(isOnline))
    return () => { unsubscribe() }
  }, [isDesktop])

  return online
}
