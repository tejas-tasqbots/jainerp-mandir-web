import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Augment the window type to include Electron desktop globals.
declare global {
  interface Window {
    __JAINERP_DESKTOP__?: boolean
    electronAPI?: {
      isElectron: true
      checkConnectivity: () => Promise<boolean>
      onConnectivityChange: (cb: (online: boolean) => void) => () => void
      getVersion: () => Promise<string>
      getLicenseInfo: () => Promise<{
        valid: boolean
        grace: boolean
        expiry: Date | null
        temple: string
        edition: string
      } | null>
      [key: string]: unknown
    }
  }
}

/**
 * OfflineBanner — only rendered when running inside the Electron desktop app.
 *
 * - Shows a red banner at the top when the API server is unreachable.
 * - Subscribes to the `connectivity:changed` IPC event for real-time updates.
 * - Shows a small "Desktop Mode" badge in the header area.
 */
export function OfflineBanner() {
  const { t } = useTranslation()
  const isDesktop = typeof window !== 'undefined' && (window.__JAINERP_DESKTOP__ || window.electronAPI?.isElectron)
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isDesktop || !window.electronAPI) return

    // Initial check
    window.electronAPI.checkConnectivity().then(setOnline).catch(() => setOnline(false))

    // Subscribe to real-time updates from the main process
    const unsubscribe = window.electronAPI.onConnectivityChange((isOnline) => {
      setOnline(isOnline)
    })

    return () => {
      unsubscribe()
    }
  }, [isDesktop])

  if (!isDesktop) return null

  return (
    <>
      {/* Offline banner — shown only when connectivity is lost */}
      {online === false && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            backgroundColor: '#dc2626',
            color: '#fff',
            textAlign: 'center',
            fontSize: '12px',
            padding: '5px 16px',
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >{t('ui.offlineApi')}</div>
      )}
    </>
  )
}

/**
 * DesktopBadge — small pill shown in the header when running as desktop app.
 * Import and place this inside your TopBar/header component.
 */
export function DesktopBadge() {
  const { t } = useTranslation()
  const isDesktop = typeof window !== 'undefined' && (window.__JAINERP_DESKTOP__ || window.electronAPI?.isElectron)

  if (!isDesktop) return null

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '11px',
        fontWeight: 600,
        backgroundColor: '#0f172a',
        color: '#94a3b8',
        letterSpacing: '0.02em',
      }}
    >{t('ui.desktopMode')}</span>
  )
}
