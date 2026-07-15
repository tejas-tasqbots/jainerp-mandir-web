import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Save } from 'lucide-react'
import { api } from '../../../lib/api'
import { useAuthStore, type Language } from '../../../store/authStore'

const LANGUAGES: { code: Language; nativeLabel: string }[] = [
  { code: 'en', nativeLabel: 'English' },
  { code: 'hi', nativeLabel: 'हिंदी (Hindi)' },
  { code: 'mr', nativeLabel: 'मराठी (Marathi)' },
]

export function MyAccountTab() {
  const { t } = useTranslation()
  const { user, tenant, language, setLanguage } = useAuthStore()
  const [selected, setSelected] = useState<Language>(language)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.patch('/users/me/language', { language: selected })
      setLanguage(selected)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      const e2 = e as { response?: { data?: { error?: { message?: string } } } }
      setError(e2.response?.data?.error?.message || 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">{user?.name || user?.mobile}</h3></div>
        <div className="card-body space-y-1 text-sm text-slate-500">
          <p>{user?.mobile}</p>
          <p>{tenant?.name}</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.language')}</h3></div>
        <div className="card-body space-y-4">
          <p className="text-sm text-slate-500">{t('settings.languageHelp')}</p>
          {error && <p className="text-sm text-brand-red">{error}</p>}
          <div className="grid grid-cols-3 gap-3">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                type="button"
                onClick={() => setSelected(l.code)}
                className={`relative px-4 py-3 rounded-md border text-sm font-medium text-left transition-colors ${
                  selected === l.code
                    ? 'border-brand-red bg-red-50 text-brand-red'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {l.nativeLabel}
                {selected === l.code && <Check size={14} className="absolute top-2 right-2" />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || selected === language}
              className="btn-primary"
            >
              <Save size={16} /> {saving ? t('settings.saving') : t('settings.save')}
            </button>
            {saved && <span className="text-sm text-green-600">{t('settings.saved')}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
