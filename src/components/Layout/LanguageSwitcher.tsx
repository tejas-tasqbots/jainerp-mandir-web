import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check, ChevronDown, Languages } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthStore, type Language } from '../../store/authStore'

const LANGS: { code: Language; native: string; short: string }[] = [
  { code: 'en', native: 'English', short: 'EN' },
  { code: 'hi', native: 'हिंदी', short: 'हिं' },
  { code: 'mr', native: 'मराठी', short: 'मरा' },
  { code: 'gu', native: 'ગુજરાતી', short: 'ગુ' },
]

// Roughly the rendered menu height (heading + 4 rows). Used only to decide
// whether there is room below the button, so an estimate is fine.
const MENU_HEIGHT = 200

/**
 * Language switcher. Persists the choice via PATCH /users/me/language and
 * updates authStore — the authStore subscription in lib/i18n.ts flips the UI
 * language (and mirrors it into the desktop config when running in Electron).
 *
 * Mounted in the header AND on the login screen. On the login screen there is
 * no session yet, so the server call is skipped and the choice is kept in the
 * persisted authStore and pinned; the login flow pushes it up once signed in.
 * Without that guard the PATCH 401'd and the optimistic update rolled straight
 * back, which looked like the picker was ignoring clicks.
 */
/**
 * `variant` exists so the three portal logins can look identical without
 * disturbing this component's other home, the post-login TopBar.
 *  - `bar`  (default) — the understated globe + code used in the TopBar.
 *  - `pill` — the bordered pill showing the language in its own script, which
 *    devotee-web and sant-web already use on their login cards.
 */
export function LanguageSwitcher({ variant = 'bar' }: { variant?: 'bar' | 'pill' } = {}) {
  const { t } = useTranslation()
  const { language, setLanguage, isLoggedIn, pinLanguage } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [drop, setDrop] = useState<'down' | 'up'>('down')
  const [cursor, setCursor] = useState(0)
  const [saving, setSaving] = useState<Language | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Flip above the button when the viewport has no room below it.
  useLayoutEffect(() => {
    if (!open) return
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    const roomBelow = window.innerHeight - rect.bottom
    setDrop(roomBelow < MENU_HEIGHT && rect.top > roomBelow ? 'up' : 'down')
  }, [open])

  useEffect(() => {
    if (open) itemRefs.current[cursor]?.focus()
  }, [open, cursor])

  const currentIndex = Math.max(0, LANGS.findIndex(l => l.code === language))
  const current = LANGS[currentIndex]

  function openMenu() {
    setCursor(currentIndex)
    setOpen(true)
  }

  async function choose(code: Language) {
    setOpen(false)
    btnRef.current?.focus()
    if (code === language) return
    const previous = language
    // Optimistic — flip the UI immediately, roll back if the save fails.
    setLanguage(code)
    // No session on the login screen: the persisted store is the only place to
    // keep this, and there is nothing to roll back to. Pin it so sign-in does
    // not replace it with whatever language the account was last saved with.
    if (!isLoggedIn) {
      pinLanguage()
      return
    }
    setSaving(code)
    try {
      await api.patch('/users/me/language', { language: code })
    } catch {
      setLanguage(previous)
    } finally {
      setSaving(null)
    }
  }

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => (c + 1) % LANGS.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => (c - 1 + LANGS.length) % LANGS.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setCursor(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setCursor(LANGS.length - 1)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            openMenu()
          }
        }}
        className={
          variant === 'pill'
            ? 'flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-1'
            : 'flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-1 rounded'
        }
        title={t('topBar.language')}
        aria-label={t('topBar.language')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {variant === 'pill' ? (
          <>
            <Languages size={13} aria-hidden="true" />
            {current.native}
          </>
        ) : (
          <>
            <Globe size={15} className="text-slate-400" aria-hidden="true" />
            <span className="font-medium">{current.short}</span>
            <ChevronDown size={13} aria-hidden="true" className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('topBar.language')}
          onKeyDown={onMenuKey}
          className={`absolute right-0 w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1 z-50
            ${drop === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {t('topBar.language')}
          </div>
          {LANGS.map((l, i) => (
            <button
              key={l.code}
              ref={el => { itemRefs.current[i] = el }}
              type="button"
              role="menuitemradio"
              aria-checked={l.code === language}
              tabIndex={i === cursor ? 0 : -1}
              onClick={() => choose(l.code)}
              disabled={saving !== null}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors disabled:opacity-60 focus:outline-none focus:bg-slate-100 ${
                l.code === language ? 'text-brand-red font-medium bg-red-50' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{l.native}</span>
              {l.code === language && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
