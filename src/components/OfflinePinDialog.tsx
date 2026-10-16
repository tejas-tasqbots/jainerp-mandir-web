import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, X } from 'lucide-react'
import { offlineBridge, errText } from '../lib/offlineDesktop'

/**
 * Set a user's PIN (Temple Admin, from Settings → Users), or change your own
 * (My Account). JainERP Offline only — see lib/offlineDesktop.ts.
 *
 * The PIN never touches the web app's state or the API: it goes straight to
 * the desktop, which stores only a scrypt hash.
 */
export function OfflinePinDialog({
  mode, userId, userName, onClose, onDone,
}: {
  mode: 'set' | 'change'
  userId?: string
  userName: string
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const bridge = offlineBridge()
    if (!bridge) return
    setError('')
    const fmt = await bridge.checkPinFormat(pin)
    if (fmt.error) { setError(fmt.error); return }
    if (pin !== pin2) { setError(t('offline.pin.mismatch', 'The two PINs do not match.')); return }
    setSaving(true)
    const r = mode === 'set' && userId
      ? await bridge.setUserPin(userId, pin)
      : await bridge.changeMyPin(current, pin)
    setSaving(false)
    if (!r.success) { setError(errText(r, t('offline.pin.failed', 'Could not save the PIN.'))); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" role="dialog" aria-modal="true"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <form onSubmit={save} className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-navy-900 flex items-center gap-2">
            <KeyRound size={16} />
            {mode === 'set' ? t('offline.pin.setTitle', 'Set PIN for {{name}}', { name: userName }) : t('offline.pin.changeTitle', 'Change your PIN')}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={t('common.cancel') as string}><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-500">
          {mode === 'set'
            ? t('offline.pin.setHelp', '{{name}} signs in on this computer by choosing their name and entering this PIN. Tell them the PIN in person; they can change it later in Settings → My Account.', { name: userName })
            : t('offline.pin.changeHelp', 'You sign in on this computer with this PIN.')}
        </p>
        {mode === 'change' && (
          <div>
            <label className="form-label" htmlFor="offline-pin-current">{t('offline.pin.current', 'Current PIN')}</label>
            <input id="offline-pin-current" className="form-input tracking-[0.4em] font-mono" type="password" inputMode="numeric" autoComplete="off"
              value={current} onChange={e => setCurrent(digits(e.target.value))} autoFocus />
          </div>
        )}
        <div>
          <label className="form-label" htmlFor="offline-pin-new">{t('offline.pin.new', 'New PIN (4 to 8 digits)')}</label>
          <input id="offline-pin-new" className="form-input tracking-[0.4em] font-mono" type="password" inputMode="numeric" autoComplete="off"
            value={pin} onChange={e => setPin(digits(e.target.value))} autoFocus={mode === 'set'} />
        </div>
        <div>
          <label className="form-label" htmlFor="offline-pin-repeat">{t('offline.pin.repeat', 'Repeat the new PIN')}</label>
          <input id="offline-pin-repeat" className="form-input tracking-[0.4em] font-mono" type="password" inputMode="numeric" autoComplete="off"
            value={pin2} onChange={e => setPin2(digits(e.target.value))} />
        </div>
        {error && <p className="text-sm text-brand-red">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">{t('common.cancel')}</button>
          <button type="submit" disabled={saving || !pin || !pin2 || (mode === 'change' && !current)} className="btn-primary btn-sm">
            {saving ? t('settings.saving') : t('offline.pin.save', 'Save PIN')}
          </button>
        </div>
      </form>
    </div>
  )
}
