import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ar from './ar.json'
import en from './en.json'

export type Lang = 'ar' | 'en'
const STORAGE_KEY = 'ardna.lang'

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'en' || v === 'ar') return v
  } catch {
    /* storage unavailable */
  }
  return 'ar'
}

export function applyDir(lang: Lang) {
  const el = document.documentElement
  el.lang = lang
  el.dir = lang === 'ar' ? 'rtl' : 'ltr'
}

i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: initialLang(),
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
})

applyDir(i18n.language as Lang)
i18n.on('languageChanged', (lng) => {
  applyDir(lng as Lang)
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* ignore */
  }
})

/** Pick the right language from a backend {ar, en} object. */
export function loc(text: { ar?: string; en?: string } | undefined | null, lang?: string): string {
  if (!text) return ''
  const l = (lang || i18n.language) as Lang
  return (l === 'en' ? text.en : text.ar) || text.ar || text.en || ''
}

export default i18n
