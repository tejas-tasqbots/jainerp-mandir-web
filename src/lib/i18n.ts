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
  if (state.language !== prev.language) i18n.changeLanguage(state.language)
})

export default i18n
