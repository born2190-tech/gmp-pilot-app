import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowDown, ArrowRight, ArrowUp, Beaker, BookMarked,
  CheckCircle2, Copy, Eye, FileText, Filter, FlaskConical, GitBranch, Info, Inbox, Layers, Lock,
  Microscope, Package, Pencil, Pill, Plus, Printer, Save, Search, ShieldAlert, Trash2, Unlock, X,
} from 'lucide-react'
import {
  createSpecification,
  deleteSpecification,
  getSpecification,
  listSpecifications,
  updateSpecification,
} from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type {
  MaterialSpecificationInput,
  MaterialSpecificationItem,
  MaterialSpecificationListItem,
  QCParamCategory,
} from '../../types/inventory'

type IconType = ComponentType<{ size?: number; className?: string }>
type Status = 'active' | 'archived'
type Group = 'SUB' | 'PKG' | 'FG'
type Mode = 'view' | 'edit' | 'create'

interface UiParam { name: string; spec: string; method: string; unit: string }
interface UiSpec {
  id: string
  nd_code: string
  revision: string
  material_name: string
  material_id: string
  match_keywords: string
  sop_form: string
  micro_required: boolean
  micro_method_ref: string
  is_active: boolean
  effective_date: string | null
  notes: string
  pc: UiParam[]
  micro: UiParam[]
}

// ── i18n dictionary (ru / uz) ────────────────────────────────────────────────
const STR: Record<string, Record<string, string>> = {
  ru: {
    eyebrow: 'ДКК · Контроль качества', h1: 'Спецификации (НД)',
    lede: 'Реестр нормативной документации на сырьё, упаковку и готовую продукцию. Каждая НД — эталон, по которому при входном контроле собирается аналитический лист Ф-11.',
    reg_title: 'Реестр НД', search_ph: 'Поиск: наименование, код НД, ключевые слова…',
    f_status_lbl: 'Статус', f_form: 'Форма СОП',
    all: 'Все', active: 'Действующие', archived: 'Архивные',
    micro_yes: 'С микро', micro_no: 'Без микро',
    grp_SUB: 'Сырьё / субстанции', grp_PKG: 'Упаковочные материалы', grp_FG: 'Готовая продукция',
    kpi_total: 'Всего НД', kpi_active: 'Действующих', kpi_arch: 'Архивных', kpi_micro: 'С микробиологией',
    params_short: 'парам.', revision: 'рев.', new_nd: 'Новая НД', empty_reg_title: 'Реестр пуст',
    empty_reg_sub: 'Ещё не создано ни одной спецификации. Начните с первой НД.',
    no_results: 'Ничего не найдено', no_results_sub: 'Измените запрос или сбросьте фильтры.',
    reset_filters: 'Сбросить фильтры',
    ph_title: 'Выберите НД из реестра', ph_sub: 'Слева — реестр спецификаций. Откройте запись для просмотра параметров или создайте новую НД.',
    sec_header: 'Шапка НД', sec_pc: 'Физико-химические параметры', sec_micro: 'Микробиологические параметры',
    sec_f11: 'Связь с формой Ф-11', f_nd_code: 'Код НД', f_revision: 'Ревизия',
    f_material: 'Наименование материала', f_material_id: 'Материал (код)',
    f_keywords: 'Ключевые слова (авто-подбор)', f_sop: 'Форма СОП', f_micro_req: 'Микробиология (СОП-514)',
    f_micro_ref: 'Метод-ссылка (микро)', f_status: 'Статус', f_eff_date: 'Дата ввода в действие',
    f_notes: 'Примечания', f_free_text: 'свободный текст',
    th_ord: '№', th_test: 'Тест', th_spec: 'Норма / требование НД', th_method: 'Метод-ссылка', th_unit: 'Ед.',
    add_param: 'Добавить параметр', no_params: 'Параметры не заданы',
    no_micro: 'Микробиология для этой НД не требуется', micro_off_hint: 'Включите «Микробиология» в шапке, чтобы добавить параметры.',
    edit: 'Редактировать', save: 'Сохранить', cancel: 'Отмена',
    archive: 'Архивировать', restore: 'Вернуть в действующие', delete: 'Удалить', duplicate: 'Дублировать',
    print_f11: 'Печать Ф-11', view_f11: 'Предпросмотр Ф-11', readonly: 'Только чтение',
    editing: 'Режим редактирования', creating: 'Новая спецификация',
    locked_title: 'Действующая НД защищена от правок',
    locked_sub: 'Эта спецификация используется в протоколах входного контроля. Прямое редактирование закрыто.',
    unlock_edit: 'Редактировать НД', unlock_warn_title: 'Редактировать действующую НД?',
    unlock_warn_body: 'НД используется как эталон в аналитических листах Ф-11. Изменение параметров повлияет на оценку соответствия будущих серий. Действие фиксируется в журнале аудита (ALCOA+).',
    unlock_confirm: 'Да, редактировать', reason_label: 'Причина изменения (обязательно)',
    reason_ph: 'Напр.: актуализация по EP 11.0, исправление опечатки в норме…',
    val_title: 'Проверьте поля', val_nd_code: 'Код НД обязателен и должен быть уникален',
    val_material: 'Наименование материала обязательно', val_micro_ref: 'Укажите метод-ссылку для микробиологии',
    saved_ok: 'Спецификация сохранена',
    archived_ok: 'НД перенесена в архив', restored_ok: 'НД возвращена в действующие',
    deleted_ok: 'НД удалена',
    f11_eyebrow: 'Предпросмотр аналитического листа', f11_title: 'Так параметры лягут в форму Ф-11',
    f11_sub: 'Каждая строка спецификации становится строкой аналитического листа. Колонка «Результат» заполняется оператором ДКК при входном контроле.',
    f11_col_test: 'Наименование показателя', f11_col_spec: 'Норма по НД', f11_col_method: 'Метод',
    f11_col_unit: 'Ед.', f11_col_result: 'Результат', f11_col_verdict: 'Откл.',
    f11_pc: 'Раздел 1. Физико-химические показатели', f11_micro: 'Раздел 2. Микробиологические показатели',
    f11_to_fill: 'заполняется при анализе', f11_form: 'Форма', f11_source: 'Источник: НД',
    yes: 'Да', no: 'Нет',
    micro_badge: 'микро', count_nd: 'НД', dup_suffix: '-копия',
    nd_code_ph: 'НД-SPC/СУБ/000/00', micro_ref_ph: 'ОФС.1.2.4.0002, СОП-514',
    target_fg: 'ГП · Ф-11', target_sub: 'Субстанция / упак. · Ф-11',
    f11_doc_fg: 'АНАЛИТИЧЕСКИЙ ПАСПОРТ НА ГОТОВЫЙ ПРОДУКТ', f11_doc_sub: 'АНАЛИТИЧЕСКИЙ ЛИСТ ВХОДНОГО КОНТРОЛЯ',
    f11_company: 'ИП ООО «NOVUGEN PHARMA» · ДКК',
    f11_material_lbl: 'Материал: ', f11_batch_lbl: 'Серия / лот: ',
    f11_fill_note: 'Поля «Результат» и «Откл.» заполняются оператором ДКК при анализе.',
    sig_chemist: 'Исполнитель (химик)', sig_micro: 'Микробиолог', sig_approver: 'Утвердил (нач. ДКК)', sig_date: 'Дата',
    badge_pc: 'ФХ', sop514: 'СОП-514', sop533: 'СОП-533', sop548: 'СОП-548', f11_code: 'Ф-11',
  },
  uz: {
    eyebrow: 'DKK · Sifat nazorati', h1: 'Spetsifikatsiyalar (ND)',
    lede: 'Xom ashyo, qadoqlash va tayyor mahsulot bo‘yicha normativ hujjatlar reestri. Har bir ND — kirish nazoratida F-11 tahlil varaqasi yig‘iladigan etalon.',
    reg_title: 'ND reestri', search_ph: 'Qidiruv: nomi, ND kodi, kalit so‘zlar…',
    f_status_lbl: 'Holat', f_form: 'SOP shakli',
    all: 'Hammasi', active: 'Amaldagi', archived: 'Arxiv',
    micro_yes: 'Mikro bilan', micro_no: 'Mikrosiz',
    grp_SUB: 'Xom ashyo / substansiyalar', grp_PKG: 'Qadoqlash materiallari', grp_FG: 'Tayyor mahsulot',
    kpi_total: 'Jami ND', kpi_active: 'Amaldagi', kpi_arch: 'Arxiv', kpi_micro: 'Mikrobiologiya bilan',
    params_short: 'param.', revision: 'rev.', new_nd: 'Yangi ND', empty_reg_title: 'Reestr bo‘sh',
    empty_reg_sub: 'Hali birorta spetsifikatsiya yaratilmagan. Birinchi ND bilan boshlang.',
    no_results: 'Hech narsa topilmadi', no_results_sub: 'So‘rovni o‘zgartiring yoki filtrlarni tozalang.',
    reset_filters: 'Filtrlarni tozalash',
    ph_title: 'Reestrdan ND tanlang', ph_sub: 'Chapda — spetsifikatsiyalar reestri. Parametrlarni ko‘rish uchun yozuvni oching yoki yangi ND yarating.',
    sec_header: 'ND sarlavhasi', sec_pc: 'Fizik-kimyoviy parametrlar', sec_micro: 'Mikrobiologik parametrlar',
    sec_f11: 'F-11 shakli bilan bog‘liqlik', f_nd_code: 'ND kodi', f_revision: 'Reviziya',
    f_material: 'Material nomi', f_material_id: 'Material (kod)',
    f_keywords: 'Kalit so‘zlar (avto-tanlash)', f_sop: 'SOP shakli', f_micro_req: 'Mikrobiologiya (SOP-514)',
    f_micro_ref: 'Metod-havola (mikro)', f_status: 'Holat', f_eff_date: 'Kuchga kirish sanasi',
    f_notes: 'Izohlar', f_free_text: 'erkin matn',
    th_ord: '№', th_test: 'Test', th_spec: 'Norma / ND talabi', th_method: 'Metod-havola', th_unit: 'Birlik',
    add_param: 'Parametr qo‘shish', no_params: 'Parametrlar belgilanmagan',
    no_micro: 'Bu ND uchun mikrobiologiya talab qilinmaydi', micro_off_hint: 'Parametr qo‘shish uchun sarlavhada «Mikrobiologiya»ni yoqing.',
    edit: 'Tahrirlash', save: 'Saqlash', cancel: 'Bekor qilish',
    archive: 'Arxivlash', restore: 'Amaldagiga qaytarish', delete: 'O‘chirish', duplicate: 'Nusxalash',
    print_f11: 'F-11 chop etish', view_f11: 'F-11 ko‘rish', readonly: 'Faqat o‘qish',
    editing: 'Tahrirlash rejimi', creating: 'Yangi spetsifikatsiya',
    locked_title: 'Amaldagi ND tahrirdan himoyalangan',
    locked_sub: 'Bu spetsifikatsiya kirish nazorati protokollarida ishlatiladi. To‘g‘ridan-to‘g‘ri tahrirlash yopiq.',
    unlock_edit: 'NDni tahrirlash', unlock_warn_title: 'Amaldagi NDni tahrirlaysizmi?',
    unlock_warn_body: 'ND F-11 tahlil varaqalarida etalon sifatida ishlatiladi. Parametrlarni o‘zgartirish kelajakdagi seriyalar baholanishiga ta’sir qiladi. Amal audit jurnalida qayd etiladi (ALCOA+).',
    unlock_confirm: 'Ha, tahrirlash', reason_label: 'O‘zgartirish sababi (majburiy)',
    reason_ph: 'Masalan: EP 11.0 bo‘yicha yangilash, normadagi xatoni tuzatish…',
    val_title: 'Maydonlarni tekshiring', val_nd_code: 'ND kodi majburiy va noyob bo‘lishi kerak',
    val_material: 'Material nomi majburiy', val_micro_ref: 'Mikrobiologiya uchun metod-havolani ko‘rsating',
    saved_ok: 'Spetsifikatsiya saqlandi',
    archived_ok: 'ND arxivga ko‘chirildi', restored_ok: 'ND amaldagiga qaytarildi',
    deleted_ok: 'ND o‘chirildi',
    f11_eyebrow: 'Tahlil varaqasi ko‘rinishi', f11_title: 'Parametrlar F-11 shakliga shunday tushadi',
    f11_sub: 'Spetsifikatsiyaning har bir qatori tahlil varaqasi qatoriga aylanadi. «Natija» ustuni kirish nazoratida OKK operatori tomonidan to‘ldiriladi.',
    f11_col_test: 'Ko‘rsatkich nomi', f11_col_spec: 'ND bo‘yicha norma', f11_col_method: 'Metod',
    f11_col_unit: 'Birlik', f11_col_result: 'Natija', f11_col_verdict: 'Ogʻ.',
    f11_pc: '1-bo‘lim. Fizik-kimyoviy ko‘rsatkichlar', f11_micro: '2-bo‘lim. Mikrobiologik ko‘rsatkichlar',
    f11_to_fill: 'tahlilda to‘ldiriladi', f11_form: 'Shakl', f11_source: 'Manba: ND',
    yes: 'Ha', no: 'Yo‘q',
    micro_badge: 'mikro', count_nd: 'ND', dup_suffix: '-nusxa',
    nd_code_ph: 'ND-SPC/SUB/000/00', micro_ref_ph: 'OFS.1.2.4.0002, SOP-514',
    target_fg: 'TM · F-11', target_sub: 'Substansiya / qadoq · F-11',
    f11_doc_fg: 'TAYYOR MAHSULOT ANALITIK PASPORTI', f11_doc_sub: 'KIRISH NAZORATI TAHLIL VARAQASI',
    f11_company: 'NOVUGEN PHARMA MChJ · DKK',
    f11_material_lbl: 'Material: ', f11_batch_lbl: 'Seriya / lot: ',
    f11_fill_note: '«Natija» va «Ogʻ.» maydonlari OKK operatori tomonidan tahlilda to‘ldiriladi.',
    sig_chemist: 'Ijrochi (kimyogar)', sig_micro: 'Mikrobiolog', sig_approver: 'Tasdiqladi (DKK boshlig‘i)', sig_date: 'Sana',
    badge_pc: 'FK', sop514: 'SOP-514', sop533: 'SOP-533', sop548: 'SOP-548', f11_code: 'F-11',
  },
  en: {
    eyebrow: 'QC · Quality control', h1: 'Specifications (ND)',
    lede: 'Register of normative documentation for raw materials, packaging and finished products. Each ND is the reference against which the F-11 analytical sheet is assembled during incoming control.',
    reg_title: 'ND register', search_ph: 'Search: name, ND code, keywords…',
    f_status_lbl: 'Status', f_form: 'SOP form',
    all: 'All', active: 'Active', archived: 'Archived',
    micro_yes: 'With micro', micro_no: 'No micro',
    grp_SUB: 'Raw materials / substances', grp_PKG: 'Packaging materials', grp_FG: 'Finished products',
    kpi_total: 'Total ND', kpi_active: 'Active', kpi_arch: 'Archived', kpi_micro: 'With microbiology',
    params_short: 'param.', revision: 'rev.', new_nd: 'New ND', empty_reg_title: 'Register is empty',
    empty_reg_sub: 'No specifications created yet. Start with the first ND.',
    no_results: 'Nothing found', no_results_sub: 'Change the query or reset the filters.',
    reset_filters: 'Reset filters',
    ph_title: 'Select an ND from the register', ph_sub: 'On the left is the specifications register. Open a record to view parameters or create a new ND.',
    sec_header: 'ND header', sec_pc: 'Physicochemical parameters', sec_micro: 'Microbiological parameters',
    sec_f11: 'Link to form F-11', f_nd_code: 'ND code', f_revision: 'Revision',
    f_material: 'Material name', f_material_id: 'Material (code)',
    f_keywords: 'Keywords (auto-match)', f_sop: 'SOP form', f_micro_req: 'Microbiology (SOP-514)',
    f_micro_ref: 'Method reference (micro)', f_status: 'Status', f_eff_date: 'Effective date',
    f_notes: 'Notes', f_free_text: 'free text',
    th_ord: '№', th_test: 'Test', th_spec: 'Limit / ND requirement', th_method: 'Method reference', th_unit: 'Unit',
    add_param: 'Add parameter', no_params: 'No parameters defined',
    no_micro: 'Microbiology is not required for this ND', micro_off_hint: 'Enable "Microbiology" in the header to add parameters.',
    edit: 'Edit', save: 'Save', cancel: 'Cancel',
    archive: 'Archive', restore: 'Restore to active', delete: 'Delete', duplicate: 'Duplicate',
    print_f11: 'Print F-11', view_f11: 'Preview F-11', readonly: 'Read-only',
    editing: 'Edit mode', creating: 'New specification',
    locked_title: 'Active ND is protected from edits',
    locked_sub: 'This specification is used in incoming-control protocols. Direct editing is locked.',
    unlock_edit: 'Edit ND', unlock_warn_title: 'Edit the active ND?',
    unlock_warn_body: 'The ND is used as a reference in F-11 analytical sheets. Changing parameters will affect the compliance assessment of future series. The action is recorded in the audit log (ALCOA+).',
    unlock_confirm: 'Yes, edit', reason_label: 'Reason for change (required)',
    reason_ph: 'e.g.: update per EP 11.0, fix a typo in the limit…',
    val_title: 'Check the fields', val_nd_code: 'ND code is required and must be unique',
    val_material: 'Material name is required', val_micro_ref: 'Specify the method reference for microbiology',
    saved_ok: 'Specification saved',
    archived_ok: 'ND moved to archive', restored_ok: 'ND restored to active',
    deleted_ok: 'ND deleted',
    f11_eyebrow: 'Analytical sheet preview', f11_title: 'How parameters map into form F-11',
    f11_sub: 'Each specification row becomes an analytical-sheet row. The "Result" column is filled by the QC operator during incoming control.',
    f11_col_test: 'Parameter name', f11_col_spec: 'Limit per ND', f11_col_method: 'Method',
    f11_col_unit: 'Unit', f11_col_result: 'Result', f11_col_verdict: 'Dev.',
    f11_pc: 'Section 1. Physicochemical parameters', f11_micro: 'Section 2. Microbiological parameters',
    f11_to_fill: 'filled during analysis', f11_form: 'Form', f11_source: 'Source: ND',
    yes: 'Yes', no: 'No',
    micro_badge: 'micro', count_nd: 'ND', dup_suffix: '-copy',
    nd_code_ph: 'ND-SPC/SUB/000/00', micro_ref_ph: 'OFS.1.2.4.0002, SOP-514',
    target_fg: 'FG · F-11', target_sub: 'Substance / packaging · F-11',
    f11_doc_fg: 'FINISHED PRODUCT ANALYTICAL PASSPORT', f11_doc_sub: 'INCOMING CONTROL ANALYTICAL SHEET',
    f11_company: 'NOVUGEN PHARMA LLC · QC',
    f11_material_lbl: 'Material: ', f11_batch_lbl: 'Series / lot: ',
    f11_fill_note: 'The "Result" and "Dev." fields are filled by the QC operator during analysis.',
    sig_chemist: 'Performer (chemist)', sig_micro: 'Microbiologist', sig_approver: 'Approved (head of QC)', sig_date: 'Date',
    badge_pc: 'PC', sop514: 'SOP-514', sop533: 'SOP-533', sop548: 'SOP-548', f11_code: 'F-11',
  },
}
type Dict = Record<string, string>

// ── helpers ──────────────────────────────────────────────────────────────────
const GROUP_ORDER: Group[] = ['SUB', 'PKG', 'FG']
function groupOf(ndCode: string, sopForm: string): Group {
  const c = (ndCode || '').toUpperCase()
  if (sopForm === '548' || c.includes('ГП') || c.includes('/GP')) return 'FG'
  if (c.includes('УП') || c.includes('/UP') || c.includes('PKG')) return 'PKG'
  return 'SUB'
}
const statusOf = (s: { is_active: boolean }): Status => (s.is_active ? 'active' : 'archived')
function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

function buildUiFromItem(item: MaterialSpecificationItem): UiSpec {
  const pc: UiParam[] = []
  const micro: UiParam[] = []
  for (const p of item.parameters) {
    const row: UiParam = { name: p.parameter_name, spec: p.specification, method: p.method_reference || '', unit: p.unit || '' }
    if (p.category === 'microbiological') micro.push(row)
    else pc.push(row)
  }
  return {
    id: item.id, nd_code: item.nd_code, revision: item.revision || '',
    material_name: item.material_name, material_id: item.material_id || '',
    match_keywords: item.match_keywords || '', sop_form: item.sop_form,
    micro_required: item.micro_required, micro_method_ref: item.micro_method_ref || '',
    is_active: item.is_active, effective_date: item.effective_date || null,
    notes: item.notes || '', pc, micro,
  }
}

function buildPayload(d: UiSpec): MaterialSpecificationInput {
  const params: { category: QCParamCategory; name: string; spec: string; method: string; unit: string }[] = [
    ...d.pc.map((p) => ({ category: 'physicochemical' as QCParamCategory, ...p })),
    ...(d.micro_required ? d.micro.map((p) => ({ category: 'microbiological' as QCParamCategory, ...p })) : []),
  ]
  return {
    nd_code: d.nd_code.trim(),
    revision: d.revision.trim() || null,
    material_name: d.material_name.trim(),
    material_id: d.material_id.trim() || null,
    match_keywords: d.match_keywords.trim() || null,
    sop_form: d.sop_form,
    micro_required: d.micro_required,
    micro_method_ref: d.micro_method_ref.trim() || null,
    is_active: d.is_active,
    effective_date: d.effective_date || null,
    notes: d.notes.trim() || null,
    parameters: params
      .filter((p) => p.name.trim() && p.spec.trim())
      .map((p) => ({
        category: p.category,
        parameter_name: p.name.trim(),
        specification: p.spec.trim(),
        method_reference: p.method.trim() || null,
        unit: p.unit.trim() || null,
      })),
  }
}

function blankDraft(): UiSpec {
  return {
    id: 'new', nd_code: '', revision: '', material_name: '', material_id: '',
    match_keywords: '', sop_form: '533', micro_required: false, micro_method_ref: '',
    is_active: true, effective_date: null, notes: '', pc: [], micro: [],
  }
}

interface Props { token: string; user: CurrentUser }

export function SpecificationsAdminPage({ token, user }: Props) {
  const { language } = useI18n()
  const t: Dict = STR[language] || STR.ru
  const canManage = user.permissions.includes('MANAGE_SPECIFICATIONS')

  const [list, setList] = useState<MaterialSpecificationListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<UiSpec | null>(null)
  const [mode, setMode] = useState<Mode>('view')
  const [draft, setDraft] = useState<UiSpec | null>(null)
  const [errors, setErrors] = useState<Record<string, boolean>>({})

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [formFilter, setFormFilter] = useState<'all' | '533' | '548'>('all')
  const [microFilter, setMicroFilter] = useState<'all' | 'yes' | 'no'>('all')

  const [confirm, setConfirm] = useState<{ type: 'unlock' | 'archive' | 'delete' } | null>(null)
  const [reason, setReason] = useState('')
  const [f11Open, setF11Open] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'info' } | null>(null)
  const [busy, setBusy] = useState(false)

  const showToast = useCallback((msg: string, tone: 'success' | 'info' = 'success') => {
    setToast({ msg, tone })
    window.setTimeout(() => setToast(null), 2600)
  }, [])

  const reload = useCallback(async () => {
    try {
      const resp = await listSpecifications(token)
      setList(resp.specifications)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'load failed', 'info')
    }
  }, [token, showToast])

  useEffect(() => { void reload() }, [reload])

  const loadDetail = useCallback(async (id: string): Promise<UiSpec | null> => {
    try {
      const item = await getSpecification(token, id)
      return buildUiFromItem(item)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'load failed', 'info')
      return null
    }
  }, [token, showToast])

  const onSelect = useCallback(async (id: string) => {
    if (mode !== 'view') return
    setSelectedId(id)
    setDraft(null)
    setErrors({})
    const ui = await loadDetail(id)
    setDetail(ui)
  }, [mode, loadDetail])

  // ── param row handlers (operate on draft) ──
  const paramHandlers = useMemo(() => ({
    change: (kind: 'pc' | 'micro', i: number, field: keyof UiParam, val: string) =>
      setDraft((d) => { if (!d) return d; const a = [...d[kind]]; a[i] = { ...a[i], [field]: val }; return { ...d, [kind]: a } }),
    add: (kind: 'pc' | 'micro') =>
      setDraft((d) => (d ? { ...d, [kind]: [...d[kind], { name: '', spec: '', method: '', unit: kind === 'micro' ? '—' : '' }] } : d)),
    remove: (kind: 'pc' | 'micro', i: number) =>
      setDraft((d) => (d ? { ...d, [kind]: d[kind].filter((_, x) => x !== i) } : d)),
    move: (kind: 'pc' | 'micro', i: number, dir: number) =>
      setDraft((d) => { if (!d) return d; const a = [...d[kind]]; const j = i + dir; if (j < 0 || j >= a.length) return d; [a[i], a[j]] = [a[j], a[i]]; return { ...d, [kind]: a } }),
  }), [])

  const onField = useCallback(<K extends keyof UiSpec>(f: K, v: UiSpec[K]) =>
    setDraft((d) => (d ? { ...d, [f]: v } : d)), [])

  // ── edit / create flow ──
  const startCreate = useCallback(() => {
    setMode('create'); setSelectedId(null); setDetail(null); setDraft(blankDraft()); setErrors({})
  }, [])

  const requestEdit = useCallback(() => {
    if (!detail) return
    if (statusOf(detail) === 'archived') {
      setDraft(JSON.parse(JSON.stringify(detail))); setMode('edit'); return
    }
    setReason(''); setConfirm({ type: 'unlock' })
  }, [detail])

  const confirmUnlock = useCallback(() => {
    if (!detail) return
    setDraft(JSON.parse(JSON.stringify(detail))); setMode('edit'); setConfirm(null)
  }, [detail])

  const validate = useCallback((d: UiSpec): Record<string, boolean> => {
    const e: Record<string, boolean> = {}
    if (!d.nd_code.trim()) e.nd_code = true
    if (list.some((s) => s.id !== d.id && s.nd_code.trim().toLowerCase() === d.nd_code.trim().toLowerCase() && d.nd_code.trim())) e.nd_code = true
    if (!d.material_name.trim()) e.material_name = true
    if (d.micro_required && !d.micro_method_ref.trim()) e.micro_ref = true
    ;(['pc', 'micro'] as const).forEach((k) => {
      if (k === 'micro' && !d.micro_required) return
      d[k].forEach((r, i) => { if (!r.name.trim() || !r.spec.trim()) e[`${k}_${i}`] = true })
    })
    return e
  }, [list])

  const onSave = useCallback(async () => {
    if (!draft) return
    const e = validate(draft)
    setErrors(e)
    if (Object.keys(e).length) { showToast(t.val_title, 'info'); return }
    setBusy(true)
    try {
      const payload = buildPayload(draft)
      if (mode === 'create') {
        const created = await createSpecification(token, payload)
        await reload()
        setSelectedId(created.id); setDetail(buildUiFromItem(created))
      } else if (selectedId) {
        const updated = await updateSpecification(token, selectedId, payload)
        await reload()
        setDetail(buildUiFromItem(updated))
      }
      setMode('view'); setDraft(null); setErrors({})
      showToast(t.saved_ok, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'save failed', 'info')
    } finally {
      setBusy(false)
    }
  }, [draft, mode, selectedId, validate, token, reload, showToast, t])

  const onCancel = useCallback(() => { setMode('view'); setDraft(null); setErrors({}) }, [])

  // ── lifecycle ──
  const setActive = useCallback(async (active: boolean, okMsg: string) => {
    if (!detail || !selectedId) return
    setBusy(true)
    try {
      const updated = await updateSpecification(token, selectedId, buildPayload({ ...detail, is_active: active }))
      await reload(); setDetail(buildUiFromItem(updated)); setConfirm(null)
      showToast(okMsg, active ? 'success' : 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'failed', 'info')
    } finally {
      setBusy(false)
    }
  }, [detail, selectedId, token, reload, showToast])

  const doDelete = useCallback(async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await deleteSpecification(token, selectedId)
      setSelectedId(null); setDetail(null); setMode('view'); setConfirm(null)
      await reload(); showToast(t.deleted_ok, 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'delete failed', 'info')
    } finally {
      setBusy(false)
    }
  }, [selectedId, token, reload, showToast, t])

  const doDuplicate = useCallback(() => {
    if (!detail) return
    const copy: UiSpec = { ...JSON.parse(JSON.stringify(detail)), id: 'new', nd_code: `${detail.nd_code}${t.dup_suffix}`, revision: '', is_active: false }
    setSelectedId(null); setDetail(null); setDraft(copy); setMode('create'); showToast(t.duplicate, 'info')
  }, [detail, showToast, t])

  const isEmptyRegistry = list.length === 0
  const showEditor = mode === 'create' || mode === 'edit' || detail != null

  return (
    <div className="pt-1">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-3">
        <div className="min-w-0">
          <MetaLabel>{t.eyebrow}</MetaLabel>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-slate-900">{t.h1}</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-500">{t.lede}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4 xl:col-span-3">
          <Registry
            list={list} t={t} canManage={canManage}
            selectedId={selectedId} onSelect={(id) => void onSelect(id)} onNew={startCreate}
            query={query} setQuery={setQuery}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            formFilter={formFilter} setFormFilter={setFormFilter}
            microFilter={microFilter} setMicroFilter={setMicroFilter}
            isEmptyRegistry={isEmptyRegistry}
          />
        </div>
        <div className="lg:col-span-8 xl:col-span-9">
          {showEditor ? (
            <Editor
              spec={detail} draft={draft} mode={mode} t={t} canManage={canManage} errors={errors} busy={busy}
              paramHandlers={paramHandlers} onField={onField}
              onEdit={requestEdit} onSave={() => void onSave()} onCancel={onCancel}
              onArchive={() => setConfirm({ type: 'archive' })} onRestore={() => void setActive(true, t.restored_ok)}
              onDelete={() => setConfirm({ type: 'delete' })} onDuplicate={doDuplicate}
              onOpenF11={() => setF11Open(true)}
            />
          ) : (
            <Card className="flex min-h-[560px] items-center justify-center">
              <EmptyState icon={BookMarked} title={t.ph_title} sub={t.ph_sub}
                action={canManage ? <PillButton tone="primary" icon={Plus} onClick={startCreate}>{t.new_nd}</PillButton> : null} />
            </Card>
          )}
        </div>
      </div>

      <F11Modal open={f11Open} d={draft || detail} t={t} onClose={() => setF11Open(false)} onPrint={() => showToast(t.print_f11, 'info')} />

      <ConfirmDialog open={confirm?.type === 'unlock'} icon={ShieldAlert} tone="warn"
        title={t.unlock_warn_title} body={t.unlock_warn_body}
        cancelLabel={t.cancel} confirmLabel={t.unlock_confirm} confirmDisabled={!reason.trim()}
        onCancel={() => setConfirm(null)} onConfirm={confirmUnlock}>
        <div className="mb-3 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11.5px] text-sky-800">
          <GitBranch size={14} className="mt-0.5 shrink-0" /><span>{t.unlock_warn_body}</span>
        </div>
        <LabeledInput label={t.reason_label} value={reason} onChange={setReason} placeholder={t.reason_ph} required />
      </ConfirmDialog>

      <ConfirmDialog open={confirm?.type === 'archive'} icon={Archive} tone="primary"
        title={`${t.archive} · ${detail?.nd_code || ''}`} body={t.locked_sub}
        cancelLabel={t.cancel} confirmLabel={t.archive} confirmDisabled={busy}
        onCancel={() => setConfirm(null)} onConfirm={() => void setActive(false, t.archived_ok)} />

      <ConfirmDialog open={confirm?.type === 'delete'} icon={Trash2} tone="danger"
        title={`${t.delete} · ${detail?.nd_code || ''}`} body={t.locked_sub}
        cancelLabel={t.cancel} confirmLabel={t.delete} confirmDisabled={busy}
        onCancel={() => setConfirm(null)} onConfirm={() => void doDelete()} />

      <Toast toast={toast} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Atoms
// ─────────────────────────────────────────────────────────────────────────────
function MetaLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500 ${className}`}>{children}</p>
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</section>
}

function StatusPill({ status, t, size = 'md' }: { status: Status; t: Dict; size?: 'sm' | 'md' }) {
  const map = {
    active: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500', label: t.active },
    archived: { cls: 'border-slate-200 bg-slate-100 text-slate-600', dot: 'bg-slate-400', label: t.archived },
  } as const
  const s = map[status]
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[10.5px]' : 'px-2.5 py-0.5 text-[11.5px]'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${pad} ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  )
}

function FormPill({ form, size = 'md' }: { form: string; size?: 'sm' | 'md' }) {
  const { language } = useI18n()
  const s = STR[language] || STR.ru
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
  if (form === '548') return <span className={`inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 font-medium text-violet-700 ${pad}`}><Beaker size={11} />{s.sop548}</span>
  return <span className={`inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 font-medium text-sky-700 ${pad}`}><FlaskConical size={11} />{s.sop533}</span>
}

function MicroPill({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { language } = useI18n()
  const s = STR[language] || STR.ru
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
  return <span className={`inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 font-medium text-cyan-700 ${pad}`}><Microscope size={11} />{s.micro_badge}</span>
}

function GroupIcon({ group, size = 16 }: { group: Group; size?: number }) {
  if (group === 'PKG') return <Package size={size} />
  if (group === 'FG') return <Pill size={size} />
  return <FlaskConical size={size} />
}

function KpiTile({ label, value, icon: Ico, tone, active, onClick }: { label: string; value: number; icon: IconType; tone: 'slate' | 'emerald' | 'amber' | 'cyan'; active: boolean; onClick: () => void }) {
  const tones = {
    slate: 'text-slate-700 bg-slate-100', emerald: 'text-emerald-700 bg-emerald-50',
    amber: 'text-amber-700 bg-amber-50', cyan: 'text-cyan-700 bg-cyan-50',
  }
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg border bg-white px-3 py-2 text-left transition ${active ? 'border-slate-900 ring-1 ring-slate-900/10' : 'border-slate-200 hover:border-slate-300'}`}>
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}><Ico size={15} /></span>
      <span className="min-w-0">
        <span className="block font-mono text-[17px] font-semibold leading-none tabular-nums text-slate-900">{value}</span>
        <span className="mt-0.5 block truncate text-[10.5px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      </span>
    </button>
  )
}

interface SegOption { value: string; label: string }
function Segmented({ options, value, onChange, size = 'md' }: { options: SegOption[]; value: string; onChange: (v: string) => void; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 'h-7' : 'h-8'
  const tx = size === 'sm' ? 'text-[11px]' : 'text-[12px]'
  return (
    <div className={`inline-flex ${h} items-center rounded-md border border-slate-200 bg-slate-50 p-0.5`}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`flex h-full items-center gap-1 rounded px-2.5 font-medium transition ${tx} ${value === o.value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

type Tone = 'neutral' | 'primary' | 'confirm' | 'danger' | 'dangerGhost' | 'quiet'
function PillButton({ children, tone = 'neutral', icon: Ico, onClick, size = 'md', disabled, title }: { children: React.ReactNode; tone?: Tone; icon?: IconType; onClick?: () => void; size?: 'sm' | 'md' | 'lg'; disabled?: boolean; title?: string }) {
  const tones: Record<Tone, string> = {
    neutral: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    primary: 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800',
    confirm: 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-600',
    danger: 'border-rose-700 bg-rose-700 text-white hover:bg-rose-600',
    dangerGhost: 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50',
    quiet: 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100',
  }
  const sizes = { sm: 'h-7 px-2 text-[11.5px]', md: 'h-8 px-3 text-[12.5px]', lg: 'h-9 px-3.5 text-[13px]' }
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${sizes[size]}`}>
      {Ico && <Ico size={size === 'lg' ? 15 : 13} />}{children}
    </button>
  )
}

function Field({ label, value, mono, sub, accent, className = '' }: { label: string; value: React.ReactNode; mono?: boolean; sub?: string | null; accent?: 'muted'; className?: string }) {
  return (
    <div className={`min-w-0 space-y-1 ${className}`}>
      <MetaLabel>{label}</MetaLabel>
      <p className={`text-[13px] leading-snug ${mono ? 'font-mono tabular-nums' : ''} ${accent === 'muted' ? 'text-slate-500' : 'text-slate-900'}`}>{value !== '' && value != null ? value : '—'}</p>
      {sub && <p className="text-[10.5px] text-slate-400">{sub}</p>}
    </div>
  )
}

function LabeledInput({ label, value, onChange, placeholder, mono, required, error, sub, type = 'text', className = '' }: { label: string; value: string; onChange?: (v: string) => void; placeholder?: string; mono?: boolean; required?: boolean; error?: string | false; sub?: string; type?: string; className?: string }) {
  return (
    <div className={`min-w-0 space-y-1 ${className}`}>
      <div className="flex items-center gap-1.5">
        <MetaLabel>{label}</MetaLabel>
        {required && <span className="text-rose-500">*</span>}
      </div>
      <input type={type} value={value || ''} onChange={(e) => onChange && onChange(e.target.value)} placeholder={placeholder}
        className={`w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 ${mono ? 'font-mono tabular-nums' : ''} ${error ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-200/60'}`} />
      {error && <p className="flex items-center gap-1 text-[10.5px] text-rose-600"><AlertTriangle size={11} />{error}</p>}
      {!error && sub && <p className="text-[10.5px] text-slate-400">{sub}</p>}
    </div>
  )
}

function CellInput({ value, onChange, placeholder, mono, error, align = 'left' }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; error?: boolean; align?: 'left' | 'center' }) {
  return (
    <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={`w-full rounded border bg-transparent px-1.5 py-1 text-[12px] text-slate-800 outline-none transition placeholder:text-slate-300 focus:bg-white ${mono ? 'font-mono tabular-nums' : ''} text-${align} ${error ? 'border-rose-300 bg-rose-50/40' : 'border-transparent hover:border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200/50'}`} />
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${checked ? 'bg-slate-900' : 'bg-slate-300'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

function ConfirmDialog({ open, icon: Ico, tone = 'primary', title, body, children, confirmLabel, cancelLabel, onConfirm, onCancel, confirmDisabled }: { open: boolean; icon?: IconType; tone?: 'primary' | 'danger' | 'warn'; title: string; body?: string; children?: React.ReactNode; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void; confirmDisabled?: boolean }) {
  if (!open) return null
  const ring = { primary: 'bg-slate-100 text-slate-700', danger: 'bg-rose-50 text-rose-700', warn: 'bg-amber-50 text-amber-700' }[tone]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 p-5">
          {Ico && <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ring}`}><Ico size={18} /></span>}
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h3>
            {body && <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{body}</p>}
            {children && <div className="mt-3">{children}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <PillButton tone="neutral" onClick={onCancel}>{cancelLabel}</PillButton>
          <PillButton tone={tone === 'danger' ? 'danger' : 'primary'} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</PillButton>
        </div>
      </div>
    </div>
  )
}

function Toast({ toast }: { toast: { msg: string; tone: 'success' | 'info' } | null }) {
  if (!toast) return null
  const tones = { success: 'border-emerald-200 bg-emerald-600 text-white', info: 'border-slate-700 bg-slate-900 text-white' }
  const Ico = toast.tone === 'success' ? CheckCircle2 : Info
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-medium shadow-lg ${tones[toast.tone]}`}>
        <Ico size={16} />{toast.msg}
      </div>
    </div>
  )
}

function EmptyState({ icon: Ico, title, sub, action }: { icon: IconType; title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Ico size={26} /></span>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-slate-700">{title}</h3>
      <p className="mt-1 max-w-xs text-[12.5px] leading-relaxed text-slate-500">{sub}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function SectionHead({ icon: Ico, eyebrow, title, accent = 'slate', count }: { icon?: IconType; eyebrow?: string | null; title: string; accent?: 'slate' | 'cyan'; count?: number | null }) {
  const accents = { slate: 'bg-slate-100 text-slate-700', cyan: 'bg-cyan-50 text-cyan-700' }
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
      {Ico && <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${accents[accent]}`}><Ico size={15} /></span>}
      <div className="min-w-0 flex-1">
        {eyebrow && <MetaLabel>{eyebrow}</MetaLabel>}
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold tracking-tight text-slate-900">{title}</h2>
          {count != null && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-slate-600">{count}</span>}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Registry (left column)
// ─────────────────────────────────────────────────────────────────────────────
interface RegItem extends MaterialSpecificationListItem { group: Group }

function Registry({ list, t, canManage, selectedId, onSelect, onNew, query, setQuery, statusFilter, setStatusFilter, formFilter, setFormFilter, microFilter, setMicroFilter, isEmptyRegistry }: {
  list: MaterialSpecificationListItem[]; t: Dict; canManage: boolean
  selectedId: string | null; onSelect: (id: string) => void; onNew: () => void
  query: string; setQuery: (v: string) => void
  statusFilter: 'all' | Status; setStatusFilter: (v: 'all' | Status) => void
  formFilter: 'all' | '533' | '548'; setFormFilter: (v: 'all' | '533' | '548') => void
  microFilter: 'all' | 'yes' | 'no'; setMicroFilter: (v: 'all' | 'yes' | 'no') => void
  isEmptyRegistry: boolean
}) {
  const items: RegItem[] = useMemo(() => list.map((s) => ({ ...s, group: groupOf(s.nd_code, s.sop_form) })), [list])

  const kpi = useMemo(() => ({
    total: items.length,
    active: items.filter((s) => statusOf(s) === 'active').length,
    archived: items.filter((s) => statusOf(s) === 'archived').length,
    micro: items.filter((s) => s.micro_required).length,
  }), [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((s) => {
      if (q) {
        const hay = `${s.material_name} ${s.nd_code} ${s.material_id || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (statusFilter !== 'all' && statusOf(s) !== statusFilter) return false
      if (formFilter !== 'all' && s.sop_form !== formFilter) return false
      if (microFilter === 'yes' && !s.micro_required) return false
      if (microFilter === 'no' && s.micro_required) return false
      return true
    })
  }, [items, query, statusFilter, formFilter, microFilter])

  const groups = useMemo(() => {
    const g: Record<Group, RegItem[]> = { SUB: [], PKG: [], FG: [] }
    filtered.forEach((s) => g[s.group].push(s))
    return g
  }, [filtered])

  const hasFilters = query || statusFilter !== 'all' || formFilter !== 'all' || microFilter !== 'all'
  const resetAll = () => { setQuery(''); setStatusFilter('all'); setFormFilter('all'); setMicroFilter('all') }

  return (
    <Card className="flex h-[calc(100vh-200px)] min-h-[560px] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-700"><BookMarked size={15} /></span>
        <div className="min-w-0 flex-1">
          <MetaLabel>{t.eyebrow}</MetaLabel>
          <h2 className="text-[14px] font-semibold tracking-tight text-slate-900">{t.reg_title}</h2>
        </div>
        {canManage && <PillButton tone="primary" icon={Plus} size="sm" onClick={onNew}>{t.new_nd}</PillButton>}
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-slate-200 px-3 py-3">
        <KpiTile label={t.kpi_total} value={kpi.total} icon={Layers} tone="slate" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <KpiTile label={t.kpi_active} value={kpi.active} icon={CheckCircle2} tone="emerald" active={statusFilter === 'active'} onClick={() => setStatusFilter('active')} />
        <KpiTile label={t.kpi_arch} value={kpi.archived} icon={Archive} tone="amber" active={statusFilter === 'archived'} onClick={() => setStatusFilter('archived')} />
        <KpiTile label={t.kpi_micro} value={kpi.micro} icon={Microscope} tone="cyan" active={microFilter === 'yes'} onClick={() => setMicroFilter(microFilter === 'yes' ? 'all' : 'yes')} />
      </div>

      <div className="space-y-2.5 border-b border-slate-200 px-3 py-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search_ph}
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-8 text-[12.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60" />
          {query && <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={14} /></button>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"><Filter size={11} />{t.f_form}</span>
          <Segmented size="sm" value={formFilter} onChange={(v) => setFormFilter(v as 'all' | '533' | '548')} options={[{ value: 'all', label: t.all }, { value: '533', label: '533' }, { value: '548', label: '548' }]} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t.f_status_lbl}</span>
          <Segmented size="sm" value={statusFilter} onChange={(v) => setStatusFilter(v as 'all' | Status)} options={[{ value: 'all', label: t.all }, { value: 'active', label: t.active }, { value: 'archived', label: t.archived }]} />
          {hasFilters && <button onClick={resetAll} className="ml-auto text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">{t.reset_filters}</button>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isEmptyRegistry ? (
          <EmptyState icon={Inbox} title={t.empty_reg_title} sub={t.empty_reg_sub}
            action={canManage ? <PillButton tone="primary" icon={Plus} onClick={onNew}>{t.new_nd}</PillButton> : null} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title={t.no_results} sub={t.no_results_sub}
            action={<PillButton tone="neutral" onClick={resetAll}>{t.reset_filters}</PillButton>} />
        ) : (
          GROUP_ORDER.map((g) => groups[g].length > 0 && (
            <div key={g} className="mb-3">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="text-slate-400"><GroupIcon group={g} size={13} /></span>
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t[`grp_${g}`]}</span>
                <span className="font-mono text-[10.5px] tabular-nums text-slate-400">{groups[g].length}</span>
                <span className="ml-1 h-px flex-1 bg-slate-100" />
              </div>
              <div className="space-y-1">
                {groups[g].map((s) => <RegistryRow key={s.id} s={s} t={t} selected={s.id === selectedId} onClick={() => onSelect(s.id)} />)}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
        <span>{filtered.length} / {items.length} {t.count_nd}</span>
        {microFilter !== 'all' && <button onClick={() => setMicroFilter('all')} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"><Microscope size={11} />{microFilter === 'yes' ? t.micro_yes : t.micro_no}<X size={11} /></button>}
      </div>
    </Card>
  )
}

function RegistryRow({ s, t, selected, onClick }: { s: RegItem; t: Dict; selected: boolean; onClick: () => void }) {
  const status = statusOf(s)
  const archived = status === 'archived'
  return (
    <button type="button" onClick={onClick}
      className={`group block w-full rounded-lg border px-2.5 py-2 text-left transition ${selected ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900/10' : 'border-transparent hover:border-slate-200 hover:bg-slate-50/70'}`}>
      <div className="flex items-center gap-2">
        <span className={`font-mono text-[11px] tabular-nums ${archived ? 'text-slate-400' : 'text-slate-500'}`}>{s.nd_code}</span>
        {s.revision && <span className="font-mono text-[10px] text-slate-400">{t.revision}{s.revision}</span>}
        <span className="ml-auto"><StatusPill status={status} t={t} size="sm" /></span>
      </div>
      <p className={`mt-1 line-clamp-2 text-[13px] font-medium leading-snug ${archived ? 'text-slate-500' : 'text-slate-900'}`}>{s.material_name}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <FormPill form={s.sop_form} size="sm" />
        {s.micro_required && <MicroPill size="sm" />}
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-slate-600">{s.parameters_count} {t.params_short}</span>
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Editor (variant 1 «Стек»)
// ─────────────────────────────────────────────────────────────────────────────
interface ParamHandlers {
  change: (kind: 'pc' | 'micro', i: number, field: keyof UiParam, val: string) => void
  add: (kind: 'pc' | 'micro') => void
  remove: (kind: 'pc' | 'micro', i: number) => void
  move: (kind: 'pc' | 'micro', i: number, dir: number) => void
}

function ParamTable({ rows, kind, editable, t, errors, onChange, onAdd, onRemove, onMove }: {
  rows: UiParam[]; kind: 'pc' | 'micro'; editable: boolean; t: Dict; errors: Record<string, boolean>
  onChange: (i: number, f: keyof UiParam, v: string) => void; onAdd: () => void; onRemove: (i: number) => void; onMove: (i: number, dir: number) => void
}) {
  if (!editable && rows.length === 0) return <div className="px-4 py-6 text-center text-[12px] text-slate-400">{t.no_params}</div>
  return (
    <div className="overflow-hidden">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="w-9 px-2 py-2 text-center font-semibold">{t.th_ord}</th>
            <th className="px-2 py-2 font-semibold">{t.th_test}</th>
            <th className="px-2 py-2 font-semibold">{t.th_spec}</th>
            <th className="px-2 py-2 font-semibold">{t.th_method}</th>
            <th className="w-16 px-2 py-2 font-semibold">{t.th_unit}</th>
            {editable && <th className="w-20 px-2 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const rowErr = errors[`${kind}_${i}`]
            return (
              <tr key={i} className={`align-top ${rowErr ? 'bg-rose-50/40' : 'hover:bg-slate-50/60'}`}>
                <td className="px-2 py-1.5 text-center">
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[11px] tabular-nums ${kind === 'micro' ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>
                </td>
                {editable ? (
                  <>
                    <td className="px-1 py-1.5"><CellInput value={r.name} onChange={(v) => onChange(i, 'name', v)} placeholder={t.th_test} error={rowErr} /></td>
                    <td className="px-1 py-1.5"><CellInput value={r.spec} onChange={(v) => onChange(i, 'spec', v)} placeholder={t.th_spec} mono error={rowErr} /></td>
                    <td className="px-1 py-1.5"><CellInput value={r.method} onChange={(v) => onChange(i, 'method', v)} placeholder={t.th_method} /></td>
                    <td className="px-1 py-1.5"><CellInput value={r.unit} onChange={(v) => onChange(i, 'unit', v)} placeholder="—" align="center" /></td>
                    <td className="px-1 py-1.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <button type="button" disabled={i === 0} onClick={() => onMove(i, -1)} className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowUp size={13} /></button>
                        <button type="button" disabled={i === rows.length - 1} onClick={() => onMove(i, 1)} className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowDown size={13} /></button>
                        <button type="button" onClick={() => onRemove(i)} title={t.delete} className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-2 py-1.5 text-[12.5px] font-medium text-slate-900">{r.name}</td>
                    <td className="px-2 py-1.5 font-mono text-[12px] tabular-nums text-slate-700">{r.spec}</td>
                    <td className="px-2 py-1.5 text-[11.5px] text-slate-500">{r.method}</td>
                    <td className="px-2 py-1.5 text-center text-[11.5px] text-slate-500">{r.unit}</td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {editable && (
        <div className="border-t border-slate-100 px-2 py-2">
          <PillButton tone="quiet" icon={Plus} size="sm" onClick={onAdd}>{t.add_param}</PillButton>
        </div>
      )}
    </div>
  )
}

function ParamSection({ kind, d, editing, t, errors, on, accent, icon }: {
  kind: 'pc' | 'micro'; d: UiSpec; editing: boolean; t: Dict; errors: Record<string, boolean>
  on: ParamHandlers; accent: 'slate' | 'cyan'; icon: IconType
}) {
  const rows = kind === 'micro' ? d.micro : d.pc
  if (kind === 'micro' && !d.micro_required) {
    return (
      <Card>
        <SectionHead icon={Microscope} eyebrow={t.sop514} title={t.sec_micro} accent="cyan" />
        <div className="flex items-center gap-3 px-4 py-5 text-slate-400">
          <Lock size={15} />
          <div>
            <p className="text-[12.5px] font-medium text-slate-500">{t.no_micro}</p>
            {editing && <p className="text-[11px] text-slate-400">{t.micro_off_hint}</p>}
          </div>
        </div>
      </Card>
    )
  }
  return (
    <Card>
      <SectionHead icon={icon} eyebrow={kind === 'micro' ? t.sop514 : null} title={kind === 'micro' ? t.sec_micro : t.sec_pc} accent={accent} count={rows.length} />
      <ParamTable rows={rows} kind={kind} editable={editing} t={t} errors={errors}
        onChange={(i, f, v) => on.change(kind, i, f, v)} onAdd={() => on.add(kind)} onRemove={(i) => on.remove(kind, i)} onMove={(i, dir) => on.move(kind, i, dir)} />
    </Card>
  )
}

function HeaderBlock({ spec, draft, editing, t, errors, onField }: {
  spec: UiSpec | null; draft: UiSpec | null; editing: boolean; t: Dict
  errors: Record<string, boolean>; onField: <K extends keyof UiSpec>(f: K, v: UiSpec[K]) => void
}) {
  if (editing && draft) {
    const d = draft
    return (
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
          <LabeledInput className="sm:col-span-5" label={t.f_nd_code} value={d.nd_code} mono required
            error={errors.nd_code && t.val_nd_code} placeholder={t.nd_code_ph} onChange={(v) => onField('nd_code', v)} />
          <LabeledInput className="sm:col-span-2" label={t.f_revision} value={d.revision} mono placeholder="01" onChange={(v) => onField('revision', v)} />
          <div className="space-y-1 sm:col-span-5">
            <MetaLabel>{t.f_status}</MetaLabel>
            <div className="flex h-[34px] items-center gap-2">
              <Toggle checked={d.is_active} onChange={(v) => onField('is_active', v)} />
              <StatusPill status={statusOf(d)} t={t} />
            </div>
          </div>
          <LabeledInput className="sm:col-span-8" label={t.f_material} value={d.material_name} required
            error={errors.material_name && t.val_material} onChange={(v) => onField('material_name', v)} />
          <LabeledInput className="sm:col-span-4" label={t.f_material_id} value={d.material_id} mono
            sub={t.f_free_text} placeholder="API-/EXC-/PKG-…" onChange={(v) => onField('material_id', v)} />
          <LabeledInput className="sm:col-span-12" label={t.f_keywords} value={d.match_keywords} mono onChange={(v) => onField('match_keywords', v)} />
          <div className="space-y-1 sm:col-span-3">
            <MetaLabel>{t.f_sop}</MetaLabel>
            <Segmented value={d.sop_form} onChange={(v) => onField('sop_form', v)} options={[{ value: '533', label: '533' }, { value: '548', label: '548' }]} />
            <p className="text-[10.5px] text-slate-400">{d.sop_form === '548' ? t.target_fg : t.target_sub}</p>
          </div>
          <div className="space-y-1 sm:col-span-3">
            <MetaLabel>{t.f_micro_req}</MetaLabel>
            <div className="flex h-[34px] items-center gap-2">
              <Toggle checked={d.micro_required} onChange={(v) => onField('micro_required', v)} />
              <span className="text-[12.5px] text-slate-600">{d.micro_required ? t.yes : t.no}</span>
            </div>
          </div>
          <LabeledInput className="sm:col-span-6" label={t.f_micro_ref} value={d.micro_method_ref}
            required={d.micro_required} error={d.micro_required && errors.micro_ref && t.val_micro_ref}
            placeholder={t.micro_ref_ph} onChange={(v) => onField('micro_method_ref', v)} />
          <LabeledInput className="sm:col-span-4" label={t.f_eff_date} type="date" value={d.effective_date || ''} mono onChange={(v) => onField('effective_date', v || null)} />
          <LabeledInput className="sm:col-span-8" label={t.f_notes} value={d.notes} onChange={(v) => onField('notes', v)} />
        </div>
      </div>
    )
  }
  if (!spec) return null
  const d = spec
  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-4">
        <Field label={t.f_nd_code} value={d.nd_code} mono />
        <Field label={t.f_revision} value={d.revision || '—'} mono />
        <Field label={t.f_material} value={d.material_name} className="col-span-2" />
        <Field label={t.f_material_id} value={d.material_id} mono accent={d.material_id ? undefined : 'muted'} />
        <Field label={t.f_eff_date} value={fmtDate(d.effective_date)} mono />
        <Field label={t.f_micro_ref} value={d.micro_required ? d.micro_method_ref : '—'} accent={d.micro_required ? undefined : 'muted'} className="col-span-2" />
        <Field label={t.f_keywords} value={d.match_keywords} mono className="col-span-2 sm:col-span-4" />
        {d.notes && <Field label={t.f_notes} value={d.notes} className="col-span-2 sm:col-span-4" />}
      </div>
    </div>
  )
}

function EditorBar({ d, mode, canManage, busy, t, onEdit, onSave, onCancel, onArchive, onRestore, onDelete, onDuplicate, onOpenF11 }: {
  d: UiSpec; mode: Mode; canManage: boolean; busy: boolean; t: Dict
  onEdit: () => void; onSave: () => void; onCancel: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void; onDuplicate: () => void; onOpenF11: () => void
}) {
  const status = statusOf(d)
  const editing = mode === 'edit' || mode === 'create'
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-slate-50/60 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-[12.5px] tabular-nums text-slate-700">{mode === 'create' ? `— · ${t.creating}` : d.nd_code}</span>
        {mode !== 'create' && <StatusPill status={status} t={t} size="sm" />}
        {!editing && !canManage && <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-slate-500"><Lock size={10} />{t.readonly}</span>}
        {mode === 'edit' && <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700"><Unlock size={10} />{t.editing}</span>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {!editing && <PillButton tone="neutral" icon={Eye} size="sm" onClick={onOpenF11}>{t.view_f11}</PillButton>}
        {!editing && canManage && status !== 'archived' && <PillButton tone="neutral" icon={Copy} size="sm" onClick={onDuplicate}>{t.duplicate}</PillButton>}
        {!editing && canManage && status === 'active' && <PillButton tone="neutral" icon={Archive} size="sm" onClick={onArchive}>{t.archive}</PillButton>}
        {!editing && canManage && status === 'archived' && <PillButton tone="neutral" icon={ArchiveRestore} size="sm" onClick={onRestore}>{t.restore}</PillButton>}
        {!editing && canManage && status === 'archived' && <PillButton tone="dangerGhost" icon={Trash2} size="sm" onClick={onDelete}>{t.delete}</PillButton>}
        {!editing && canManage && status === 'active' && <PillButton tone="primary" icon={Lock} size="sm" onClick={onEdit}>{t.edit}</PillButton>}
        {!editing && canManage && status === 'archived' && <PillButton tone="primary" icon={Pencil} size="sm" onClick={onEdit}>{t.edit}</PillButton>}
        {editing && <PillButton tone="neutral" size="sm" onClick={onCancel}>{t.cancel}</PillButton>}
        {editing && <PillButton tone="confirm" icon={Save} size="sm" disabled={busy} onClick={onSave}>{t.save}</PillButton>}
      </div>
    </div>
  )
}

function LockBanner({ t, onUnlock }: { t: Dict; onUnlock: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50/70 px-4 py-3">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700"><ShieldAlert size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-amber-900">{t.locked_title}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-amber-800/80">{t.locked_sub}</p>
      </div>
      <PillButton tone="neutral" icon={Unlock} size="sm" onClick={onUnlock}>{t.unlock_edit}</PillButton>
    </div>
  )
}

function Editor({ spec, draft, mode, t, canManage, errors, busy, paramHandlers, onField, onEdit, onSave, onCancel, onArchive, onRestore, onDelete, onDuplicate, onOpenF11 }: {
  spec: UiSpec | null; draft: UiSpec | null; mode: Mode; t: Dict; canManage: boolean
  errors: Record<string, boolean>; busy: boolean; paramHandlers: ParamHandlers
  onField: <K extends keyof UiSpec>(f: K, v: UiSpec[K]) => void
  onEdit: () => void; onSave: () => void; onCancel: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void; onDuplicate: () => void; onOpenF11: () => void
}) {
  const editing = mode === 'edit' || mode === 'create'
  const d = editing ? draft : spec
  if (!d) return null
  const status = statusOf(d)
  const showLock = !editing && canManage && status === 'active'
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <EditorBar d={d} mode={mode} canManage={canManage} busy={busy} t={t}
          onEdit={onEdit} onSave={onSave} onCancel={onCancel} onArchive={onArchive}
          onRestore={onRestore} onDelete={onDelete} onDuplicate={onDuplicate} onOpenF11={onOpenF11} />
        {showLock && <LockBanner t={t} onUnlock={onEdit} />}
        <SectionHead icon={BookMarked} title={t.sec_header} eyebrow={mode === 'create' ? t.creating : null} />
        <HeaderBlock spec={spec} draft={draft} editing={editing} t={t} errors={errors} onField={onField} />
      </Card>
      <ParamSection kind="pc" d={d} editing={editing} t={t} errors={errors} on={paramHandlers} accent="slate" icon={FlaskConical} />
      <ParamSection kind="micro" d={d} editing={editing} t={t} errors={errors} on={paramHandlers} accent="cyan" icon={Microscope} />
      {!editing && <F11LinkCard d={d} t={t} onOpen={onOpenF11} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ф-11 preview
// ─────────────────────────────────────────────────────────────────────────────
function F11Sheet({ d, t }: { d: UiSpec; t: Dict }) {
  const formMark = `${d.sop_form === '548' ? t.sop548 : t.sop533} ${t.f11_code}`
  const formTitle = d.sop_form === '548' ? t.f11_doc_fg : t.f11_doc_sub

  const Section = ({ titleKey, rows, kind }: { titleKey: string; rows: UiParam[]; kind: 'pc' | 'micro' }) => (
    <div className="mt-4 first:mt-0">
      <div className={`flex items-center gap-2 rounded-t-md border border-b-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${kind === 'micro' ? 'border-cyan-200 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-slate-100 text-slate-700'}`}>
        {kind === 'micro' ? <Microscope size={13} /> : <FlaskConical size={13} />}{t[titleKey]}
      </div>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border border-slate-300 bg-white text-[9.5px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="w-8 border-r border-slate-200 px-2 py-1.5 text-center">№</th>
            <th className="border-r border-slate-200 px-2 py-1.5">{t.f11_col_test}</th>
            <th className="border-r border-slate-200 px-2 py-1.5">{t.f11_col_spec}</th>
            <th className="border-r border-slate-200 px-2 py-1.5">{t.f11_col_method}</th>
            <th className="w-12 border-r border-slate-200 px-2 py-1.5 text-center">{t.f11_col_unit}</th>
            <th className="w-28 border-r border-slate-200 bg-amber-50/60 px-2 py-1.5 text-center text-amber-700">{t.f11_col_result}</th>
            <th className="w-12 bg-amber-50/60 px-2 py-1.5 text-center text-amber-700">{t.f11_col_verdict}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-x border-b border-slate-200 last:border-b-slate-300">
              <td className="border-r border-slate-100 px-2 py-1.5 text-center font-mono text-[11px] tabular-nums text-slate-500">{i + 1}</td>
              <td className="border-r border-slate-100 px-2 py-1.5 text-[11.5px] font-medium text-slate-800">{r.name}</td>
              <td className="border-r border-slate-100 px-2 py-1.5 font-mono text-[11px] tabular-nums text-slate-600">{r.spec}</td>
              <td className="border-r border-slate-100 px-2 py-1.5 text-[10.5px] text-slate-500">{r.method}</td>
              <td className="border-r border-slate-100 px-2 py-1.5 text-center text-[10.5px] text-slate-500">{r.unit}</td>
              <td className="border-r border-slate-100 bg-amber-50/30 px-2 py-1.5"><span className="block h-3.5 rounded-sm border border-dashed border-amber-300/70 bg-white" /></td>
              <td className="bg-amber-50/30 px-2 py-1.5"><span className="mx-auto block h-3.5 w-3.5 rounded-sm border border-dashed border-amber-300/70 bg-white" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t.f11_company}</p>
          <h3 className="mt-1 text-[14px] font-bold uppercase leading-tight tracking-tight text-slate-900">{formTitle}</h3>
        </div>
        <div className="shrink-0 rounded border border-slate-300 px-2.5 py-1 text-center">
          <p className="text-[8.5px] font-semibold uppercase tracking-wide text-slate-400">{t.f11_form}</p>
          <p className="font-mono text-[11.5px] font-semibold text-slate-800">{formMark}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] sm:grid-cols-3">
        <div><span className="text-slate-400">{t.f11_material_lbl}</span><span className="font-medium text-slate-800">{d.material_name}</span></div>
        <div><span className="text-slate-400">{t.f11_source}: </span><span className="font-mono text-slate-700">{d.nd_code}{d.revision ? ` · ${t.revision}${d.revision}` : ''}</span></div>
        <div><span className="text-slate-400">{t.f11_batch_lbl}</span><span className="font-mono text-slate-400">______________</span></div>
      </div>
      <div className="mt-4">
        <Section titleKey="f11_pc" rows={d.pc} kind="pc" />
        {d.micro_required && d.micro.length > 0 && <Section titleKey="f11_micro" rows={d.micro} kind="micro" />}
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800">
        <Info size={13} /><span>{t.f11_fill_note}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-6 border-t border-slate-200 pt-3 text-[10.5px] sm:grid-cols-3">
        {[
          t.sig_chemist,
          ...(d.micro_required ? [t.sig_micro] : []),
          t.sig_approver,
          t.sig_date,
        ].map((s) => (
          <div key={s}><p className="text-slate-400">{s}</p><p className="mt-3 border-b border-dotted border-slate-300" /></div>
        ))}
      </div>
    </div>
  )
}

function F11LinkCard({ d, t, onOpen }: { d: UiSpec; t: Dict; onOpen: () => void }) {
  const pcN = d.pc.length
  const microN = d.micro_required ? d.micro.length : 0
  return (
    <button type="button" onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white"><FileText size={20} /></span>
      <div className="min-w-0 flex-1">
        <MetaLabel>{t.f11_eyebrow}</MetaLabel>
        <p className="mt-0.5 text-[13.5px] font-semibold tracking-tight text-slate-900">{t.f11_title}</p>
        <p className="mt-0.5 text-[11.5px] text-slate-500">{t.f11_sub}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-slate-600"><FlaskConical size={11} />{pcN} {t.badge_pc}</span>
          {microN > 0 && <span className="inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-cyan-700"><Microscope size={11} />{microN} {t.micro_badge}</span>}
          <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-600 group-hover:text-slate-900">{t.view_f11}<ArrowRight size={13} /></span>
        </div>
      </div>
    </button>
  )
}

function F11Modal({ open, d, t, onClose, onPrint }: { open: boolean; d: UiSpec | null; t: Dict; onClose: () => void; onPrint: () => void }) {
  if (!open || !d) return null
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-slate-100 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white"><FileText size={15} /></span>
          <div className="min-w-0 flex-1">
            <MetaLabel>{t.f11_eyebrow}</MetaLabel>
            <h2 className="truncate text-[14px] font-semibold tracking-tight text-slate-900">{d.material_name}</h2>
          </div>
          <PillButton tone="neutral" icon={Printer} size="sm" onClick={onPrint}>{t.print_f11}</PillButton>
          <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={17} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <F11Sheet d={d} t={t} />
        </div>
      </div>
    </div>
  )
}
