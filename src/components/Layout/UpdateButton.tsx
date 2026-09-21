import { Download, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The desktop app's Update button, in the top bar.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The desktop ships this UI inside its installer, so a fix reaches a desktop
 * trust only when a new installer is downloaded and installed. The updater
 * downloads quietly and then asks once, in a dialog, "Restart now / Later".
 * A clerk mid-donation rightly says Later — and from then on nothing on screen
 * said an update was waiting. The only other door was Help → Check for
 * updates, a menu nobody at a temple counter opens.
 *
 * So once an update is on disk it stays VISIBLE here until it is installed.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 * It never installs on click. The click goes to the same main-process function
 * as the menu item, which asks "Restart now / Later" first: installing closes
 * the app, and a stray click on a busy counter must not lose an entry.
 *
 * In a browser there is no bridge, so this renders nothing — a web deploy
 * reaches the browser directly and has nothing to install.
 */

/** Mirrors UpdateState in mandiradmin-desktop/electron/updater.ts. */
export type DesktopUpdateState =
  | { status: 'idle' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }

export function UpdateButton() {
  const { t } = useTranslation()
  const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined
  const [state, setState] = useState<DesktopUpdateState>({ status: 'idle' })

  useEffect(() => {
    // An installer older than this button has no update bridge at all.
    if (!bridge?.getUpdateState || !bridge.onUpdateState) return
    let live = true
    // Ask first, then listen: the update may have finished downloading long
    // before this page mounted (a reload, a language change, a re-login).
    bridge.getUpdateState().then((s) => { if (live) setState(s) }).catch(() => { /* stays idle */ })
    const off = bridge.onUpdateState((s) => setState(s))
    return () => { live = false; off() }
  }, [bridge])

  if (state.status === 'downloading') {
    // A note, not a button: there is nothing to do yet, and the counter is
    // busy with something else.
    return (
      <span
        data-testid="update-downloading"
        className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap"
        title={t('topBar.updateDownloadingTitle', { version: state.version })}
      >
        <RefreshCw size={13} className="animate-spin" />
        {t('topBar.updateDownloading', { percent: state.percent })}
      </span>
    )
  }

  if (state.status !== 'ready') return null

  return (
    <button
      type="button"
      data-testid="update-ready"
      onClick={() => { void bridge?.checkForUpdates?.() }}
      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors whitespace-nowrap"
      title={t('topBar.updateReadyTitle', { version: state.version })}
      aria-label={t('topBar.updateReadyTitle', { version: state.version })}
    >
      <Download size={14} />
      <span className="hidden sm:inline">{t('topBar.updateReady')}</span>
    </button>
  )
}
