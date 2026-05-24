// Шаблоны спецификаций (НД) для входного контроля субстанций.
// Каждый шаблон — полный перечень показателей качества с нормами и методами
// по нормативному документу конкретной субстанции. Подставляется в
// «Аналитический лист» по кнопке «Загрузить шаблон» (резолвинг по материалу).
//
// Источник: аналитические листы ДКК NOVUGEN (Ф-11, СОП-533).

export interface PcSeed {
  name: string
  spec: string
  method: string
  unit: string
}

export interface MicroSeed {
  name: string
  spec: string
}

export interface SpecTemplate {
  key: string
  /** Человекочитаемое название субстанции (для подсказки). */
  label: string
  /** Регэксп для сопоставления с наименованием/кодом материала партии. */
  match: RegExp
  /** Ссылка на нормативный документ (НД). */
  specRef: string
  microRequired: boolean
  microMethodRef: string
  pc: PcSeed[]
  micro: MicroSeed[]
}

// Общий микробиологический метод-референс для субстанций.
const MICRO_REF = 'ГФ РУз, ЕР-11 2.6.12, 2.6.13, 5.1.4'

const MICRO_AEROBES: MicroSeed = { name: 'Общее число аэробных бактерий', spec: 'Не более 10³ КОЕ/г' }
const MICRO_FUNGI: MicroSeed = { name: 'Общее число дрожжевых и плесневых грибов', spec: 'Не более 10² КОЕ/г' }
const MICRO_ECOLI: MicroSeed = { name: 'Escherichia coli (в 1 г)', spec: 'Отсутствие' }
const MICRO_SALMONELLA: MicroSeed = { name: 'Salmonella spp.', spec: 'Отсутствие' }
const MICRO_SAUREUS: MicroSeed = { name: 'Staphylococcus aureus', spec: 'Отсутствие' }
const MICRO_PSEUDOMONAS: MicroSeed = { name: 'Pseudomonas aeruginosa', spec: 'Отсутствие' }

export const SPEC_TEMPLATES: SpecTemplate[] = [
  // ─── Микрокристаллическая целлюлоза (вспомогательное вещество) ───
  {
    key: 'mcc',
    label: 'Микрокристаллическая целлюлоза',
    match: /микрокристалл|целлюлоз|mcc|рн-?102/i,
    specRef: 'НД-SPC/СУБ/009/23',
    microRequired: true,
    microMethodRef: MICRO_REF,
    pc: [
      { name: 'Описание', spec: 'Белый или почти белый мелкий, слегка гигроскопичный порошок', method: 'Визуально', unit: '—' },
      { name: 'Растворимость', spec: 'Практически не растворим в воде, ацетоне, безводном этаноле, толуоле, разбавленных кислотах и в 50 г/л растворе NaOH', method: 'ГФ РУз, ЕР-11 5.11', unit: '—' },
      { name: 'Подлинность', spec: 'ИК-спектр соответствует спектру РСО; с раствором йода — фиолетовое окрашивание', method: 'ГФ РУз, ЕР-11', unit: '—' },
      { name: 'pH', spec: 'От 5,0 до 7,0', method: 'ГФ РУз, ЕР-11 2.2.3', unit: '—' },
      { name: 'Удельная электропроводность', spec: 'Не более 75 мкСм·см⁻¹', method: 'ГФ РУз, ЕР-11 2.2.38', unit: 'мкСм·см⁻¹' },
      { name: 'Растворимые в воде вещества', spec: 'Разница не должна превышать 12,5 мг', method: 'ГФ РУз, ЕР-11', unit: 'мг' },
      { name: 'Потеря в массе при высушивании', spec: 'Не более 7,0 %', method: 'ГФ РУз, ЕР-11 2.2.32', unit: '%' },
      { name: 'Сульфатная зола', spec: 'Не более 0,1 %', method: 'ГФ РУз, ЕР-11 2.4.14', unit: '%' },
    ],
    micro: [MICRO_AEROBES, MICRO_FUNGI, MICRO_ECOLI, MICRO_SALMONELLA, MICRO_SAUREUS, MICRO_PSEUDOMONAS],
  },

  // ─── Клопидогрел (гидросульфат) ───
  {
    key: 'clopidogrel',
    label: 'Клопидогрел',
    match: /клопидогрел|clopidogrel/i,
    specRef: 'НД-SPC/СУБ/017/23',
    microRequired: true,
    microMethodRef: MICRO_REF,
    pc: [
      { name: 'Описание', spec: 'Белый или почти белый порошок', method: 'Визуально', unit: '—' },
      { name: 'Растворимость', spec: 'Легко растворим в воде; легко растворим в метаноле; практически не растворим в дихлорметане', method: 'ГФ РУз, ЕР-11 5.11', unit: '—' },
      { name: 'Подлинность', spec: 'ВЭЖХ: время удерживания совпадает с РСО; сульфаты — белый осадок; ИК-спектр совпадает с РСО', method: 'ГФ РУз, ЕР-11 2.2.29', unit: '—' },
      { name: 'Родственные примеси (∑)', spec: 'Не более 0,5 % (примесь A ≤ 0,2 %; примесь B ≤ 0,5 %)', method: 'ГФ РУз, ЕР-11 2.2.29', unit: '%' },
      { name: 'Вода', spec: 'Не более 0,5 %', method: 'ГФ РУз, ЕР-11 2.5.12', unit: '%' },
      { name: 'Сульфатная зола', spec: 'Не более 0,1 %', method: 'ГФ РУз, ЕР-11 2.4.14', unit: '%' },
      { name: 'Количественное содержание', spec: '99,0 — 101,0 % (на безводное вещество)', method: 'ГФ РУз, ЕР-11', unit: '%' },
    ],
    micro: [MICRO_AEROBES, MICRO_FUNGI],
  },

  // ─── Эторикоксиб ───
  {
    key: 'etoricoxib',
    label: 'Эторикоксиб',
    match: /эторикоксиб|etoricoxib/i,
    specRef: 'НД-SPC/СУБ/055/24',
    microRequired: true,
    microMethodRef: MICRO_REF,
    pc: [
      { name: 'Описание', spec: 'Порошок от белого до кремового цвета', method: 'Визуально', unit: '—' },
      { name: 'Растворимость', spec: 'Растворим в метаноле; свободно растворим в хлороформе; мало растворим в этаноле', method: 'ГФ РУз, ЕР-11 5.11', unit: '—' },
      { name: 'Подлинность', spec: 'ВЭЖХ: время удерживания совпадает с РСО; ИК-спектр соответствует спектру РСО', method: 'ГФ РУз, ЕР-11', unit: '—' },
      { name: 'Потеря в массе при высушивании', spec: 'Не более 0,5 %', method: 'ГФ РУз, ЕР-11 2.2.32', unit: '%' },
      { name: 'Абсорбция', spec: 'Не более 0,1 (при 430 нм)', method: 'ГФ РУз, ЕР-11', unit: 'ЕА' },
      { name: 'Сульфатная зола', spec: 'Не более 0,2 %', method: 'ГФ РУз, ЕР-11 2.4.14', unit: '%' },
      { name: 'Тяжёлые металлы', spec: 'Не более 20 ppm', method: 'ГФ РУз, ЕР-11 2.4.8', unit: 'ppm' },
      { name: 'Родственные примеси (∑)', spec: 'Не более 0,5 %', method: 'ГФ РУз, ЕР-11 2.2.29', unit: '%' },
      { name: 'Количественное содержание', spec: '98,0 — 102,0 % (на безводное вещество)', method: 'ГФ РУз, ЕР-11 2.2.29', unit: '%' },
    ],
    micro: [MICRO_AEROBES, MICRO_FUNGI, MICRO_ECOLI, MICRO_SALMONELLA, MICRO_SAUREUS, MICRO_PSEUDOMONAS],
  },

  // ─── Эзомепразол магния тригидрат ───
  {
    key: 'esomeprazole',
    label: 'Эзомепразол магния тригидрат',
    match: /эзомепразол|эзомепрозол|esomeprazol/i,
    specRef: 'НД-SPC/СУБ/040/23',
    microRequired: true,
    microMethodRef: MICRO_REF,
    pc: [
      { name: 'Описание', spec: 'Белые или почти белые гранулы сферической формы', method: 'Визуально', unit: '—' },
      { name: 'Подлинность', spec: 'ВЭЖХ: время удерживания совпадает с РСО; ИК-спектр совпадает с РСО', method: 'ГФ РУз, ЕР-11 5.11', unit: '—' },
      { name: 'Родственные примеси (∑)', spec: 'Не более 2,0 %', method: 'ГФ РУз, ЕР-11 2.2.29', unit: '%' },
      { name: 'Потеря в массе при высушивании', spec: 'Не более 1,5 %', method: 'ГФ РУз, ЕР-11 2.2.32', unit: '%' },
      { name: 'Растворение (кислая среда)', spec: 'Не более 10 %', method: 'ГФ РУз, ЕР-11', unit: '%' },
      { name: 'Растворение (буферный раствор)', spec: 'Не менее 80 %', method: 'ГФ РУз, ЕР-11', unit: '%' },
      { name: 'Количественное содержание', spec: '95,0 — 110,0 %', method: 'ГФ РУз, ЕР-11 2.2.25', unit: '%' },
    ],
    micro: [MICRO_AEROBES, MICRO_FUNGI, MICRO_ECOLI],
  },

  // ─── Тикагрелор ───
  {
    key: 'ticagrelor',
    label: 'Тикагрелор',
    match: /тикагрелор|ticagrelor/i,
    specRef: 'НД-ДПСК/S.024',
    microRequired: true,
    microMethodRef: MICRO_REF,
    pc: [
      { name: 'Описание', spec: 'Порошок от белого или почти белого до бледно-розового цвета', method: 'Визуально', unit: '—' },
      { name: 'Растворимость', spec: 'Практически не растворим в воде; легко растворим в безводном этаноле; растворим в метаноле; практически нерастворим в гептане', method: 'ГФ РУз, ЕР-11 5.11', unit: '—' },
      { name: 'Подлинность', spec: 'ВЭЖХ: время удерживания совпадает с РСО; ИК-спектр совпадает с РСО', method: 'ГФ РУз, ЕР-11 2.2.29, 2.2.24', unit: '—' },
      { name: 'Вода', spec: 'Не более 0,5 %', method: 'ГФ РУз, ЕР-11 2.5.12', unit: '%' },
      { name: 'Сульфатная зола', spec: 'Не более 0,6 %', method: 'ГФ РУз, ЕР-11 2.4.14', unit: '%' },
      { name: 'Родственные примеси (∑)', spec: 'Не более 1,0 %', method: 'ГФ РУз, ЕР-11 2.2.29', unit: '%' },
      { name: 'Количественное содержание', spec: '98,0 — 102,0 % (на безводное вещество)', method: 'ГФ РУз, ЕР-11', unit: '%' },
    ],
    micro: [MICRO_AEROBES, MICRO_FUNGI],
  },
]

/**
 * Подбирает шаблон спецификации по наименованию/коду материала партии.
 * Возвращает null, если по справочнику ничего не найдено (тогда используется
 * базовый шаблон 533/548).
 */
export function resolveSpecTemplate(materialName: string, materialCode?: string): SpecTemplate | null {
  const hay = `${materialName || ''} ${materialCode || ''}`
  for (const tpl of SPEC_TEMPLATES) {
    if (tpl.match.test(hay)) return tpl
  }
  return null
}
