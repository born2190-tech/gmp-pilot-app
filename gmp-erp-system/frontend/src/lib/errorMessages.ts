// Локализация системных сообщений (ошибок) API под выбранный язык интерфейса.
// Бэкенд возвращает detail на смешанных языках — здесь приводим к языку UI
// (ru/uz/en). Неизвестные сообщения возвращаем как есть (фолбэк).
//
// Как расширять: добавьте запись в STATIC (точное совпадение) или DYNAMIC
// (по предикату/regex с подстановкой групп).

type Lang = 'ru' | 'uz' | 'en'
type Tri = { ru: string; uz: string; en: string }

const STORAGE_KEY = 'gmp_erp_language'

function activeLang(): Lang {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'uz' || v === 'en' || v === 'ru') return v
  } catch {
    /* ignore */
  }
  return 'ru'
}

// Точные совпадения (ключ — исходный текст detail с бэкенда, как есть).
const STATIC: Record<string, Tri> = {
  'Certificate file missing on disk': {
    ru: 'Файл сертификата отсутствует на диске — загрузите CoA заново.',
    uz: 'Sertifikat fayli diskda yo‘q — CoA ni qayta yuklang.',
    en: 'Certificate file is missing on disk — please re-upload the CoA.',
  },
  'Certificate integrity check failed (sha256 mismatch)': {
    ru: 'Нарушена целостность файла сертификата (несовпадение sha256).',
    uz: 'Sertifikat fayli yaxlitligi buzilgan (sha256 mos emas).',
    en: 'Certificate integrity check failed (sha256 mismatch).',
  },
  'Certificate not found': {
    ru: 'Сертификат не найден.', uz: 'Sertifikat topilmadi.', en: 'Certificate not found.',
  },
  'Receipt not found': { ru: 'Приход не найден.', uz: 'Kelib tushish topilmadi.', en: 'Receipt not found.' },
  'Receipt has no lines': { ru: 'В приходе нет строк.', uz: 'Kelib tushishda qatorlar yo‘q.', en: 'Receipt has no lines.' },
  'Receipt line not found': { ru: 'Строка прихода не найдена.', uz: 'Kelib tushish qatori topilmadi.', en: 'Receipt line not found.' },
  'Only posted receipts can be notified to QC': {
    ru: 'Извещение можно создать только по проведённому приходу.',
    uz: 'Xabarnoma faqat o‘tkazilgan kelib tushish bo‘yicha yaratiladi.',
    en: 'Only a posted receipt can be sent to QC.',
  },
  'Notification number already exists': {
    ru: 'Извещение с таким номером уже существует.',
    uz: 'Bunday raqamli xabarnoma allaqachon mavjud.',
    en: 'A notification with this number already exists.',
  },
  'QC report not found': { ru: 'Аналитический протокол не найден.', uz: 'Tahliliy bayonnoma topilmadi.', en: 'QC report not found.' },
  'Only draft QC report can be submitted': {
    ru: 'Подписать можно только черновик протокола.',
    uz: 'Faqat qoralama bayonnomani imzolash mumkin.',
    en: 'Only a draft QC report can be submitted.',
  },
  'QC report must contain parameters': {
    ru: 'Протокол должен содержать показатели.',
    uz: 'Bayonnomada ko‘rsatkichlar bo‘lishi shart.',
    en: 'The QC report must contain parameters.',
  },
  'Specification not found': { ru: 'Спецификация не найдена.', uz: 'Spetsifikatsiya topilmadi.', en: 'Specification not found.' },
  'Material not found': { ru: 'Материал не найден.', uz: 'Material topilmadi.', en: 'Material not found.' },
  'Material code already exists': {
    ru: 'Материал с таким кодом уже существует.',
    uz: 'Bunday kodli material allaqachon mavjud.',
    en: 'A material with this code already exists.',
  },
  'Internal Server Error': { ru: 'Внутренняя ошибка сервера.', uz: 'Server ichki xatosi.', en: 'Internal server error.' },
}

// Динамические сообщения: regex по исходному тексту + шаблон с группами $1,$2.
const DYNAMIC: Array<{ re: RegExp; ru: string; uz: string; en: string }> = [
  {
    re: /^Permission (.+) is required$/i,
    ru: 'Недостаточно прав (требуется: $1).',
    uz: 'Ruxsat yetarli emas (kerak: $1).',
    en: 'Permission required: $1.',
  },
  {
    re: /^One of permissions (.+) is required$/i,
    ru: 'Недостаточно прав (требуется одно из: $1).',
    uz: 'Ruxsat yetarli emas (quyidagilardan biri kerak: $1).',
    en: 'One of the permissions is required: $1.',
  },
  {
    re: /^Lot (.+) is (?:no longer |not )released$/i,
    ru: 'Партия $1 не разрешена к выдаче.',
    uz: '$1 partiyasi chiqarishga ruxsat etilmagan.',
    en: 'Lot $1 is not released.',
  },
  {
    re: /^HTTP (\d{3})$/,
    ru: 'Ошибка сервера (HTTP $1).',
    uz: 'Server xatosi (HTTP $1).',
    en: 'Server error (HTTP $1).',
  },
]

export function localizeApiError(detail: string): string {
  if (!detail) return detail
  const lang = activeLang()
  const exact = STATIC[detail.trim()]
  if (exact) return exact[lang]
  for (const d of DYNAMIC) {
    const m = detail.trim().match(d.re)
    if (m) {
      return d[lang].replace(/\$(\d+)/g, (_, g) => m[Number(g)] ?? '')
    }
  }
  return detail
}
