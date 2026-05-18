import type { ComponentType } from 'react'
import type { LanguageCode } from '../../i18n/translations'
import { languages } from '../../i18n/translations'
import { useI18n } from '../../i18n/I18nProvider'
import { FlagRU, FlagUZ } from './flags'

// Pill-переключатель языков с чёткими SVG-флагами вместо emoji.
// SVG нарисованы вручную в нативных пропорциях (RU 2:3, UZ 1:2) и
// остаются резкими при любом DPI/масштабе.
type FlagComponent = ComponentType<{ size?: number; className?: string }>

const FLAG_BY_LANG: Record<LanguageCode, FlagComponent> = {
  ru: FlagRU,
  uz: FlagUZ,
}

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n()

  return (
    <div
      role="radiogroup"
      aria-label={t('common.language')}
      className="inline-flex items-center rounded-full bg-slate-100 p-0.5"
    >
      {languages.map((item) => {
        const Flag = FLAG_BY_LANG[item.code]
        const active = item.code === language
        return (
          <button
            key={item.code}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setLanguage(item.code)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
              active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Flag size={16} />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
