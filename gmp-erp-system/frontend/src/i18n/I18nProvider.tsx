import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react'
import { languageLocale, languages, translations, type LanguageCode, type TranslationKey } from './translations'

interface I18nContextValue {
  language: LanguageCode
  locale: string
  setLanguage: (language: LanguageCode) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const STORAGE_KEY = 'gmp_erp_language'

const I18nContext = createContext<I18nContextValue | null>(null)

function getInitialLanguage(): LanguageCode {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return languages.some((item) => item.code === stored) ? (stored as LanguageCode) : 'ru'
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<LanguageCode>(getInitialLanguage)

  function setLanguage(nextLanguage: LanguageCode) {
    window.localStorage.setItem(STORAGE_KEY, nextLanguage)
    setLanguageState(nextLanguage)
  }

  const value = useMemo<I18nContextValue>(() => {
    function t(key: TranslationKey, params?: Record<string, string | number>) {
      const dictionary = translations[language] as Partial<Record<TranslationKey, string>>
      let text = dictionary[key] ?? translations.ru[key] ?? key
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replaceAll(`{${name}}`, String(value))
        }
      }
      return text
    }

    return { language, locale: languageLocale[language], setLanguage, t }
  }, [language])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
