import type { TranslationKey } from '../i18n/translations'

export function translatedLocation(code: string | null | undefined, t: (key: TranslationKey) => string) {
  if (!code) return '—'
  const key = `location.${code}` as TranslationKey
  const label = t(key)
  return label === key ? code : `${code} · ${label}`
}
