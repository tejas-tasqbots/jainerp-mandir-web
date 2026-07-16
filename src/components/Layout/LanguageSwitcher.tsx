import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check, ChevronDown } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthStore, type Language } from '../../store/authStore'

const LANGS: { code: Language; native: string; short: string }[] = [
  { code: 'en', native: 'English', short: 'EN' },
  { code: 'hi', native: 'हिंदी', short: 'हिं' },
  { code: 'mr', native: 'मराठी', short: 'मरा' },
]

/**
 * Header language switcher. Persists the choice via PATCH /users/me/language and
 * updates authStore — the authStore subscription in lib/i18n.ts flips the UI
 * language (and mirrors it into the desktop config when running in Electron).
 */
export function LanguageSwitcher() {
  const { t } = useTranslation()
  const { language, setLanguage } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState<Language | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function choose(code: Language) {
    setOpen(false)
    if (code === language) return
    const previous = language
    setSaving(code)
    // Optimistic — flip the UI immediately, roll back if the save fails.
    setLanguage(code)
    try {
      await api.patch('/users/me/language', { language: code })
    } catch {
      setLanguage(previous)
    } finally {
      setSaving(null)
    }
  }

  const current = LANGS.find(l => l.code === language) ?? LANGS[0]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy-900 transition-colors"
        title={t('topBar.language')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Globe size={15} className="text-slate-400" />
        <span className="font-medium">{current.short}</span>
        <ChevronDown size={13} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1 z-50"
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {t('topBar.language')}
          </div>
          {LANGS.map(l => (
            <button
              key={l.code}
              role="menuitemradio"
              aria-checked={l.code === language}
              onClick={() => choose(l.code)}
              disabled={saving !== null}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors disabled:opacity-60 ${
                l.code === language ? 'text-brand-red font-medium bg-red-50' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{l.native}</span>
              {l.code === language && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
