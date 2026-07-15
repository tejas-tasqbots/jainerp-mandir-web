import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en/common.json'
import hi from '../locales/hi/common.json'
import mr from '../locales/mr/common.json'
import { useAuthStore } from '../store/authStore'

i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    hi: { common: hi },
    mr: { common: mr },
  },
  lng: useAuthStore.getState().language,
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

// Keep i18next in sync whenever authStore's language changes (login, or the
// user saving a new choice in Settings → My Account).
useAuthStore.subscribe((state, prev) => {
  if (state.language !== prev.language) {
    i18n.changeLanguage(state.language)
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
