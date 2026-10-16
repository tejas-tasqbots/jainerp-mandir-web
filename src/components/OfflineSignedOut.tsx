import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { offlineBridge } from '../lib/offlineDesktop'

/**
 * JainERP Offline, signed out: hand back to the desktop's PIN screen.
 *
 * The OTP login screen can never work offline (no SMS, no WhatsApp), so the
 * offline app must never show it — whatever signed the web out: Logout, a
 * session that could not be refreshed, a role change. The desktop also watches
 * for this; rendering here is the guarantee, not the hope.
 */
export function OfflineSignedOut() {
  const { t } = useTranslation()
  useEffect(() => { void offlineBridge()?.returnToPin() }, [])
  return (
    <div className="flex items-center justify-center h-screen bg-slate-50">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-cta border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600 text-sm">{t('offline.signedOut', 'Returning to the sign-in screen…')}</p>
      </div>
    </div>
  )
}
