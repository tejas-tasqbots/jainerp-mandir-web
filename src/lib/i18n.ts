import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en/common.json'
import hi from '../locales/hi/common.json'
import mr from '../locales/mr/common.json'
import gu from '../locales/gu/common.json'
import { useAuthStore } from '../store/authStore'

const initial = useAuthStore.getState().language

i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    hi: { common: hi },
    mr: { common: mr },
    gu: { common: gu },
  },
  lng: initial,
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

// Reflect the restored language on <html lang> at boot — screen readers and
// browser translation prompts read this, and it was never being set.
document.documentElement.setAttribute('lang', initial)

// Keep i18next in sync whenever authStore's language changes (the login screen,
// the header switcher, or Settings → My Account).
useAuthStore.subscribe((state, prev) => {
  if (state.language !== prev.language) {
    i18n.changeLanguage(state.language)
    document.documentElement.setAttribute('lang', state.language)
    // In the desktop (Electron) build, mirror the choice into the native config
    // so the login/license/sync screens, window titles and tray menu match.
    const electronAPI = (window as unknown as {
      electronAPI?: { setLanguage?: (lang: string) => Promise<unknown> }
    }).electronAPI
    if (electronAPI?.setLanguage) {
      electronAPI.setLanguage(state.language).catch(() => { /* best-effort */ })
    }
  }
})

export default i18n

/**
 * English, whatever the screen's language - for text drawn into a jsPDF PDF.
 * Its built-in Helvetica has no Devanagari, so a Hindi screen's export printed
 * its title and "All dates" as garbage (UI audit, 2026-09-25). The PDFs'
 * column headings were already English; now their titles are too.
 */
export const tPdf = i18n.getFixedT('en')
