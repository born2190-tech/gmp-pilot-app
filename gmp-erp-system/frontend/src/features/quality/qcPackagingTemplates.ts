// Методы входного контроля вторичных упаковочных материалов (ВУМ) по СОП-543.
// Для каждого типа ВУМ — перечень показателей с нормами (НД/ГОСТ), методами
// и видом оценки (числовой / описательный). Подставляется в рабочем месте ОКК
// для упаковочных партий (склад PACKAGING_WAREHOUSE) и в «Заключение на ВУМ» (Ф-2).
//
// Источник: СОП-543 «Входной контроль вторичных упаковочных материалов».

export type PackagingKind = 'numeric' | 'descriptive'

export interface PackagingParamSeed {
  name: string
  /** Норма / требование НД. */
  spec: string
  /** Метод / ссылка на НД (ГОСТ, ТУ, In House). */
  method: string
  unit: string
  /** numeric → авто-оценка по числовой норме; descriptive → ручной тумблер. */
  kind: PackagingKind
}

export type PackagingType = 'label' | 'carton' | 'corrugated_box' | 'leaflet' | 'foil'

export interface PackagingTemplate {
  key: PackagingType
  /** Человекочитаемое название типа ВУМ. */
  label: string
  /** Сводная ссылка на НД. */
  ndRef: string
  params: PackagingParamSeed[]
}

const DESCR_PRINT: PackagingParamSeed = {
  name: 'Качество печати',
  spec: 'Печать чёткая и контрастная; текст пропечатан без перекосов и пропусков, легко читаем',
  method: 'In House',
  unit: '—',
  kind: 'descriptive',
}

export const PACKAGING_TEMPLATES: Record<PackagingType, PackagingTemplate> = {
  // ─── 1. Самоклеящиеся этикетки ───────────────────────────────────────────
  label: {
    key: 'label',
    label: 'Самоклеящиеся этикетки',
    ndRef: 'ГОСТ 20477-86; ГОСТ 7625-86; ТУ 9570-001-52689689-2014',
    params: [
      { name: 'Внешний вид', spec: 'Лента без трещин, складок, разрывов, отверстий, пропусков клеевого слоя и посторонних включений; бумага без морщин, волнистости, залощенности, пятен, разрыва кромки и дырчатости', method: 'ГОСТ 7625-86 (стр.6); ГОСТ 20477-86 (стр.3)', unit: '—', kind: 'descriptive' },
      { name: 'Цвет, текст, дизайн', spec: 'Соответствует эталону образца', method: 'In House', unit: '—', kind: 'descriptive' },
      DESCR_PRINT,
      { name: 'Толщина клеевого слоя', spec: 'От 0,018 до 0,060 мм', method: 'ГОСТ 20477-86 (стр.6)', unit: 'мм', kind: 'numeric' },
      { name: 'Липкость', spec: 'От 500 до 650 сек', method: 'ГОСТ 20477-86 (стр.7)', unit: 'сек', kind: 'numeric' },
      { name: 'Устойчивость внешнего покрытия', spec: 'На вате нет следов краски (5-кратная протирка тампоном, смоченным в воде 30–40 °C)', method: 'ТУ 9570-001-52689689-2014 (стр.5)', unit: '—', kind: 'descriptive' },
    ],
  },
  // ─── 2. Пеналы (картонная потребительская тара) ──────────────────────────
  carton: {
    key: 'carton',
    label: 'Пеналы',
    ndRef: 'ГОСТ 7933-89; ГОСТ 33781-2016',
    params: [
      { name: 'Внешний вид', spec: 'Без повреждений, разрывов, жирных пятен, нечёткого тиснения', method: 'ГОСТ 7933-89; ГОСТ 33781-2016', unit: '—', kind: 'descriptive' },
      { name: 'Цвет, текст, дизайн', spec: 'Соответствует эталону образца', method: 'In House', unit: '—', kind: 'descriptive' },
      DESCR_PRINT,
      { name: 'Качество склейки', spec: 'Линия склейки равномерная', method: 'ГОСТ 33781-2016', unit: '—', kind: 'descriptive' },
      { name: 'Практическая пригодность', spec: 'Легко складывается, правильной прямоугольной формы, держит объёмную форму', method: 'In House', unit: '—', kind: 'descriptive' },
      { name: 'Устойчивость внешнего покрытия', spec: 'На вате нет следов краски или грязи (протирка влажным тампоном)', method: 'In House', unit: '—', kind: 'descriptive' },
    ],
  },
  // ─── 3. Короба из гофрокартона ───────────────────────────────────────────
  corrugated_box: {
    key: 'corrugated_box',
    label: 'Короба из гофрокартона',
    ndRef: 'ГОСТ 9142-2014',
    params: [
      { name: 'Внешний вид', spec: 'Поверхность ровная, без морщин, складок, разрывов и жирных пятен', method: 'ГОСТ 9142-2014', unit: '—', kind: 'descriptive' },
      { name: 'Дизайн', spec: 'Соответствует утверждённому макету', method: 'In House', unit: '—', kind: 'descriptive' },
      DESCR_PRINT,
      { name: 'Качество склейки', spec: 'По линии склейки проклеено равномерно', method: 'ГОСТ 9142-2014', unit: '—', kind: 'descriptive' },
      { name: 'Практическая пригодность', spec: 'Легко складывается, правильной прямоугольной формы, держит объёмную форму', method: 'In House', unit: '—', kind: 'descriptive' },
      { name: 'Испытания на перегиб', spec: 'Не менее 10 перегибов на 180° без разрушения (на 5 образцах)', method: 'ГОСТ 9142-2014', unit: 'перегибов', kind: 'numeric' },
    ],
  },
  // ─── 4. Инструкции по применению (листки-вкладыши) ───────────────────────
  leaflet: {
    key: 'leaflet',
    label: 'Инструкции по применению',
    ndRef: 'ГОСТ 18510-87; In House',
    params: [
      { name: 'Внешний вид', spec: 'Без волнистости, складок, морщин, залощенности, полос, пятен, разрыва кромки и дырчатости', method: 'ГОСТ 18510-87', unit: '—', kind: 'descriptive' },
      { name: 'Текст', spec: 'Соответствует эталону образца', method: 'In House', unit: '—', kind: 'descriptive' },
      DESCR_PRINT,
    ],
  },
  // ─── 5. Алюминиевая фольга (первичная упаковка, ПУМ) — СОП-561 ────────────
  // Параметры одинаковы для всей фольги; отличается только ширина (размер).
  foil: {
    key: 'foil',
    label: 'Алюминиевая фольга',
    ndRef: 'СОП-561; In House',
    params: [
      { name: 'Описание (внешний вид)', spec: 'Фольга без запаха; поверхность чистая, гладкая, ровная, без надрывов, заломов, коррозии и литья. Лакокрасочное покрытие нанесено равномерным слоем, без непрокрашенных мест; без изгибов, отклонений и трещин', method: 'СОП-561', unit: '—', kind: 'descriptive' },
      { name: 'Толщина фольги', spec: '0,15 мм ± 10 %', method: 'СОП-561', unit: 'мм', kind: 'numeric' },
      { name: 'Ширина фольги', spec: '____ мм ± 1 мм', method: 'СОП-561', unit: 'мм', kind: 'numeric' },
      { name: 'Определение запаха', spec: 'Запах отсутствует или присутствует лёгкий нормальный запах', method: 'СОП-561', unit: '—', kind: 'descriptive' },
      { name: 'Определение смачиваемости', spec: 'Смачиваемость удовлетворительная', method: 'СОП-561', unit: '—', kind: 'descriptive' },
      { name: 'Определение адгезии лакокрасочного покрытия', spec: 'Удовлетворительная адгезия (тип А, В или С)', method: 'СОП-561', unit: '—', kind: 'descriptive' },
    ],
  },
}

/** Номинальная ширина фольги из наименования материала («…215 мм») → норма
 * «215 мм ± 1 мм». Если размер не найден — оставляет шаблонный плейсхолдер. */
export function foilWidthSpec(materialName: string | null | undefined): string {
  const m = `${materialName || ''}`.match(/(\d{2,4})\s*мм|(\d{2,4})\s*mm/i)
  const w = m ? (m[1] || m[2]) : null
  return w ? `${w} мм ± 1 мм` : '____ мм ± 1 мм'
}

export const PACKAGING_TYPE_VALUES: PackagingType[] = ['label', 'carton', 'corrugated_box', 'leaflet', 'foil']

/** Эвристика типа ВУМ по наименованию материала (фолбэк, если поле не задано). */
export function inferPackagingType(materialName: string | null | undefined, materialCode?: string | null): PackagingType | null {
  const s = `${materialName || ''} ${materialCode || ''}`.toLowerCase()
  if (/фольг|foil|алюмин|alu\b/.test(s)) return 'foil'
  if (/этикет|стикер|label|sticker/.test(s)) return 'label'
  if (/гофр|короб|ящик|carton box|corrugat/.test(s)) return 'corrugated_box'
  if (/пенал|пачк|картон|carton|складн/.test(s)) return 'carton'
  if (/инструкц|вкладыш|листок|leaflet|insert|инстр/.test(s)) return 'leaflet'
  return null
}

/** Возвращает шаблон по явному типу ВУМ или по эвристике из наименования. */
export function resolvePackagingTemplate(
  packagingType: string | null | undefined,
  materialName?: string | null,
  materialCode?: string | null,
): PackagingTemplate | null {
  const explicit = (packagingType || '').trim() as PackagingType
  if (explicit && explicit in PACKAGING_TEMPLATES) return PACKAGING_TEMPLATES[explicit]
  const inferred = inferPackagingType(materialName, materialCode)
  return inferred ? PACKAGING_TEMPLATES[inferred] : null
}
