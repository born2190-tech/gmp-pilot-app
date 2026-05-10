import { languages } from '../../i18n/translations'
import { useI18n } from '../../i18n/I18nProvider'

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n()

  return (
    <label className="flex items-center gap-2 text-xs font-medium uppercase text-slate-500">
      {t('common.language')}
      <select
        aria-label={t('common.language')}
        className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm font-medium uppercase text-slate-800 outline-none focus:border-blue-700"
        onChange={(event) => setLanguage(event.target.value as typeof language)}
        value={language}
      >
        {languages.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  )
}
