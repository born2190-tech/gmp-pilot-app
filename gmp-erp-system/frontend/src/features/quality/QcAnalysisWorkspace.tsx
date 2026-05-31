import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileCheck,
  FileText,
  FlaskConical,
  KeyRound,
  Layers,
  Lock,
  Microscope,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  createQcReport,
  downloadQcReportDocx,
  downloadQcReportPdf,
  downloadQcReportScan,
  listEquipment,
  resolveLotSpecification,
  submitQcReport,
  uploadQcReportScan,
} from '../../lib/api'
import { CalibrationBadge } from './EquipmentAdminPage'
import { printBlob } from '../../lib/print'
import { ScanButton } from '../../components/ui/ScanButton'
import { resolveSpecTemplate } from './qcSpecTemplates'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { EquipmentItem, LotItem, QCParamCategory, QCReportItem } from '../../types/inventory'

type Translate = ReturnType<typeof useI18n>['t']

// Локальная строка параметра: complies может быть null (ещё не выбрано).
interface ParamRow {
  key: string
  category: QCParamCategory
  parameter_name: string
  specification: string
  result_value: string
  unit: string
  method_reference: string
  complies: boolean | null
  // true — соответствие определено системой автоматически (по норме + результату).
  auto?: boolean
  // Прибор, использованный для именно этого показателя (optional).
  equipment_id?: string | null
}

// ── Авто-оценка соответствия по норме (НД) и введённому результату ──────────────
// Возвращает true/false, либо null если норму нельзя оценить численно
// (описательные показатели — цвет, форма и т.п. — остаются на ручном переключателе).
const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
}

// Извлекает числовую величину из фрагмента: «0,47», «10³», «< 10²», «92», «1e3».
function parseMagnitude(fragment: string): number | null {
  const s = fragment.trim()
  const sup = s.match(/(\d+)\s*([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/)
  if (sup) {
    const base = Number(sup[1])
    const exp = Number(sup[2].split('').map((c) => SUPERSCRIPT[c] ?? '').join(''))
    if (!Number.isNaN(base) && !Number.isNaN(exp)) return base ** exp
  }
  const num = s.replace(',', '.').match(/-?\d+(?:\.\d+)?(?:[eE]-?\d+)?/)
  return num ? Number(num[0]) : null
}

export function evaluateCompliance(spec: string, result: string): boolean | null {
  const s = (spec || '').trim()
  const r = (result || '').trim()
  if (!s || !r) return null
  const sl = s.toLowerCase()
  const rl = r.toLowerCase()

  // 1. Качественно: «Отсутствие» (патогены).
  if (/отсутств|absent/.test(sl)) {
    if (/отсутств|не обнаруж|absent/.test(rl) || /^[<≤]/.test(r)) return true
    if (/обнаруж|присут|detected|present|\+/.test(rl)) return false
    return null
  }
  // 2. Качественно/описательно: норма без чисел («Соответствие РСО», «Белый порошок»).
  if (!/[0-9]/.test(s)) {
    if (/не\s*соответ|несоответ|fail/.test(rl)) return false
    if (/соответ|pass|годен/.test(rl)) return true
    return null // описание (цвет, форма) — оценивает аналитик
  }

  const rval = parseMagnitude(r)
  if (rval === null) return null
  const EPS = 1e-9

  // 3. Допуск «X ± p %» или «X ± a».
  const tol = s.match(/([\d.,]+)[^±]*?±\s*([\d.,]+)\s*(%?)/)
  if (tol) {
    const center = Number(tol[1].replace(',', '.'))
    const delta = Number(tol[2].replace(',', '.'))
    if (!Number.isNaN(center) && !Number.isNaN(delta)) {
      const span = tol[3] === '%' ? (center * delta) / 100 : delta
      return rval >= center - span - EPS && rval <= center + span + EPS
    }
  }

  // 4. Диапазон «a — b» / «от a до b».
  const range = s.match(/([\d.,]+)\s*(?:—|–|-|\bдо\b|\bto\b)\s*([\d.,]+)/)
  if (range) {
    const a = Number(range[1].replace(',', '.'))
    const b = Number(range[2].replace(',', '.'))
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      return rval >= lo - EPS && rval <= hi + EPS
    }
  }

  // 5. Верхняя граница (≤, <, «не более», max).
  if (/[≤<]|не\s*более|не\s*выше|не\s*должно\s*превыш|max|макс/.test(sl)) {
    const bound = parseMagnitude(s)
    if (bound !== null) return rval <= bound + EPS
  }
  // 6. Нижняя граница (≥, >, «не менее», min).
  if (/[≥>]|не\s*менее|не\s*ниже|min/.test(sl)) {
    const bound = parseMagnitude(s)
    if (bound !== null) return rval >= bound - EPS
  }

  return null
}

let keySeq = 0
const newKey = () => `p${++keySeq}`

/** Показывает blob в заранее открытой (синхронно) вкладке; если popup был
 * заблокирован (tab === null) — запасной путь через download-ссылку. Решает
 * проблему «просмотр скачивает файл / ничего не происходит» (в т.ч. Tailscale). */
function presentBlob(tab: Window | null, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  if (tab && !tab.closed) {
    tab.location.href = url
  } else {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function blankPc(): ParamRow {
  return { key: newKey(), category: 'physicochemical', parameter_name: '', specification: '', result_value: '', unit: '', method_reference: '', complies: null }
}
function blankMicro(): ParamRow {
  return { key: newKey(), category: 'microbiological', parameter_name: '', specification: '', result_value: '', unit: '', method_reference: '', complies: null }
}

// Шаблоны показателей — аналитик может загрузить и отредактировать.
const PC_TEMPLATE_533: Array<Partial<ParamRow>> = [
  { parameter_name: 'Описание', specification: 'Белый или почти белый кристаллический порошок', method_reference: 'Визуально, ФС', unit: '—' },
  { parameter_name: 'Растворимость', specification: 'Практически нерастворим в воде', method_reference: 'ОФС 1.2.1.0005', unit: '—' },
  { parameter_name: 'Подлинность (ИК-спектр)', specification: 'Соответствие спектру РСО', method_reference: 'ИК-спектрометрия', unit: '—' },
  { parameter_name: 'Родственные примеси (∑)', specification: '≤ 0,50', method_reference: 'ВЭЖХ, EP 2.2.29', unit: '%' },
  { parameter_name: 'Потеря в массе при высушивании', specification: '≤ 0,25', method_reference: 'Сушильный шкаф 105 °C', unit: '%' },
  { parameter_name: 'Сульфатная зола', specification: '≤ 0,10', method_reference: 'Гравиметрия', unit: '%' },
  { parameter_name: 'Количественное содержание', specification: '99,0 — 101,0 (на сухое вещество)', method_reference: 'ВЭЖХ', unit: '%' },
]
const PC_TEMPLATE_548: Array<Partial<ParamRow>> = [
  { parameter_name: 'Описание', specification: 'Таблетки, покрытые плёночной оболочкой', method_reference: 'Визуально', unit: '—' },
  { parameter_name: 'Средняя масса', specification: 'согласно НД ± 5 %', method_reference: 'Весы', unit: 'мг' },
  { parameter_name: 'Однородность массы', specification: 'Отклонение ≤ ±7,5 %', method_reference: 'ОФС 1.4.2.0009', unit: '%' },
  { parameter_name: 'Подлинность', specification: 'Соответствие РСО', method_reference: 'ВЭЖХ', unit: '—' },
  { parameter_name: 'Растворение (30 мин)', specification: '≥ 75 от номинала', method_reference: 'ОФС 1.4.2.0014', unit: '%' },
  { parameter_name: 'Родственные примеси (∑)', specification: '≤ 1,0', method_reference: 'ВЭЖХ', unit: '%' },
  { parameter_name: 'Количественное содержание', specification: '95,0 — 105,0', method_reference: 'ВЭЖХ', unit: '%' },
]
const MICRO_TEMPLATE: Array<Partial<ParamRow>> = [
  { parameter_name: 'Общее число аэробных бактерий', specification: '≤ 10³ КОЕ/г' },
  { parameter_name: 'Общее число дрожжевых и плесневых грибов', specification: '≤ 10² КОЕ/г' },
  { parameter_name: 'Escherichia coli (в 1 г)', specification: 'Отсутствие' },
  { parameter_name: 'Staphylococcus aureus (в 1 г)', specification: 'Отсутствие' },
  { parameter_name: 'Pseudomonas aeruginosa (в 1 г)', specification: 'Отсутствие' },
  { parameter_name: 'Salmonella spp. (в 10 г)', specification: 'Отсутствие' },
]

function fromTemplate(rows: Array<Partial<ParamRow>>, category: QCParamCategory): ParamRow[] {
  return rows.map((r) => ({
    key: newKey(),
    category,
    parameter_name: r.parameter_name ?? '',
    specification: r.specification ?? '',
    result_value: '',
    unit: r.unit ?? '—',
    method_reference: r.method_reference ?? '',
    complies: null,
  }))
}

type Verdict = 'pass' | 'fail' | 'partial'

interface Props {
  token: string
  user: CurrentUser
  lot: LotItem
  onSubmitted: () => void
}

export function QcAnalysisWorkspace({ token, user, lot, onSubmitted }: Props) {
  const { locale, t } = useI18n()
  const sopForm = lot.warehouse_type === 'FG_WAREHOUSE' ? '548' : '533'
  const isFg = sopForm === '548'

  const [reportNo, setReportNo] = useState(`QC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-001`)
  const [methodReference, setMethodReference] = useState('')
  const [equipment, setEquipment] = useState('')
  const [roomTemp, setRoomTemp] = useState('')
  const [humidity, setHumidity] = useState('')
  const [analysisStarted, setAnalysisStarted] = useState('')
  const [analysisFinished, setAnalysisFinished] = useState('')
  const [microStarted, setMicroStarted] = useState('')
  const [microFinished, setMicroFinished] = useState('')
  const [microMethodRef, setMicroMethodRef] = useState('ОФС.1.2.4.0002, СОП-514')
  const [microRequired, setMicroRequired] = useState(!isFg)

  // Реестр КИП (загружается единожды при монтировании).
  const [availableEquipment, setAvailableEquipment] = useState<EquipmentItem[]>([])
  const [equipmentIds, setEquipmentIds] = useState<string[]>([])
  useEffect(() => {
    void listEquipment(token, { active: true })
      .then((resp) => setAvailableEquipment(resp.equipment))
      .catch(() => setAvailableEquipment([]))
  }, [token])
  const equipmentById = useMemo(
    () => Object.fromEntries(availableEquipment.map((e) => [e.id, e])),
    [availableEquipment],
  )

  const [pcParams, setPcParams] = useState<ParamRow[]>([blankPc()])
  const [microParams, setMicroParams] = useState<ParamRow[]>(MICRO_TEMPLATE.map((r) => ({
    key: newKey(), category: 'microbiological', parameter_name: r.parameter_name ?? '', specification: r.specification ?? '', result_value: '', unit: '—', method_reference: '', complies: null,
  })))

  const [draft, setDraft] = useState<QCReportItem | null>(null)
  const [scanAttached, setScanAttached] = useState(false)
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState(t('quality.sampleReason'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const locked = draft !== null
  const signed = draft?.status === 'submitted'

  // ── Verdict ────────────────────────────────────────────────────────────────
  const verdict: Verdict = useMemo(() => {
    const pc = pcParams
    const micro = microRequired ? microParams : []
    const all = [...pc, ...micro]
    if (all.length === 0) return 'partial'
    if (all.some((p) => p.complies === false)) return 'fail'
    const allTouched = all.every((p) => p.complies !== null)
    const allPass = all.every((p) => p.complies === true)
    if (allTouched && allPass) return 'pass'
    return 'partial'
  }, [pcParams, microParams, microRequired])

  // ── Param mutators ───────────────────────────────────────────────────────
  function patchPc(key: string, patch: Partial<ParamRow>) {
    setPcParams((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }
  function patchMicro(key: string, patch: Partial<ParamRow>) {
    setMicroParams((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }

  // Авто-оценка при вводе результата.
  function resultPatch(spec: string, value: string): Partial<ParamRow> {
    if (!value.trim()) return { result_value: value, complies: null, auto: false }
    const auto = evaluateCompliance(spec, value)
    return auto === null ? { result_value: value } : { result_value: value, complies: auto, auto: true }
  }
  // Пересчёт при правке нормы (если результат уже введён).
  function specPatch(spec: string, result: string): Partial<ParamRow> {
    if (!result.trim()) return { specification: spec }
    const auto = evaluateCompliance(spec, result)
    return auto === null ? { specification: spec } : { specification: spec, complies: auto, auto: true }
  }

  // Шаблон спецификации по материалу партии (если есть в справочнике НД).
  const tpl = useMemo(() => resolveSpecTemplate(lot.material_name, lot.material_code), [lot.material_name, lot.material_code])

  // «Загрузить шаблон»: подставляет полный перечень показателей с нормами.
  // Источник истины — справочник НД в БД (по материалу партии); при отсутствии
  // спецификации используется встроенный реестр, затем базовый шаблон 533/548.
  function applyHardcoded() {
    if (tpl) {
      setPcParams(tpl.pc.map((s) => ({
        key: newKey(), category: 'physicochemical', parameter_name: s.name, specification: s.spec,
        result_value: '', unit: s.unit, method_reference: s.method, complies: null,
      })))
      setMicroParams(tpl.micro.map((s) => ({
        key: newKey(), category: 'microbiological', parameter_name: s.name, specification: s.spec,
        result_value: '', unit: '—', method_reference: '', complies: null,
      })))
      setMicroRequired(tpl.microRequired)
      setMicroMethodRef(tpl.microMethodRef)
      setMethodReference((prev) => prev || tpl.specRef)
    } else {
      setPcParams(fromTemplate(isFg ? PC_TEMPLATE_548 : PC_TEMPLATE_533, 'physicochemical'))
    }
  }

  async function loadTemplate() {
    setError(null)
    try {
      const spec = await resolveLotSpecification(token, lot.id)
      if (spec && spec.parameters.length > 0) {
        const pc = spec.parameters.filter((p) => p.category !== 'microbiological')
        const micro = spec.parameters.filter((p) => p.category === 'microbiological')
        setPcParams(pc.map((p) => ({
          key: newKey(), category: 'physicochemical', parameter_name: p.parameter_name, specification: p.specification,
          result_value: '', unit: p.unit || '—', method_reference: p.method_reference || '', complies: null,
        })))
        setMicroParams(micro.map((p) => ({
          key: newKey(), category: 'microbiological', parameter_name: p.parameter_name, specification: p.specification,
          result_value: '', unit: p.unit || '—', method_reference: p.method_reference || '', complies: null,
        })))
        setMicroRequired(spec.micro_required)
        if (spec.micro_method_ref) setMicroMethodRef(spec.micro_method_ref)
        setMethodReference((prev) => prev || `${spec.nd_code}${spec.revision ? ` ред.${spec.revision}` : ''}`)
        setSuccess(`${t('qcws.templateLoaded')}: ${spec.material_name} · ${spec.nd_code}`)
        return
      }
    } catch {
      /* падать не будем — используем встроенный реестр */
    }
    applyHardcoded()
  }

  function toIso(local: string): string | null {
    return local ? new Date(local).toISOString() : null
  }

  // ── Create draft protocol (persists params) ────────────────────────────────
  async function createDraft() {
    setError(null)
    setSuccess(null)
    const pc = pcParams.filter((p) => p.parameter_name.trim())
    const micro = microRequired ? microParams.filter((p) => p.parameter_name.trim()) : []
    const all = [...pc, ...micro]
    if (all.length === 0) {
      setError(t('qcws.errNoParams'))
      return
    }
    if (all.some((p) => p.complies === null)) {
      setError(t('qcws.errUntouched'))
      return
    }
    setBusy(true)
    try {
      const report = await createQcReport(token, {
        lot_id: lot.id,
        report_no: reportNo,
        analysis_started_at: toIso(analysisStarted),
        analysis_finished_at: toIso(analysisFinished),
        method_reference: methodReference || null,
        equipment: equipment || null,
        equipment_ids: equipmentIds,
        room_temp: roomTemp || null,
        humidity: humidity || null,
        micro_required: microRequired,
        micro_method_reference: microRequired ? microMethodRef || null : null,
        micro_started_at: microRequired ? toIso(microStarted) : null,
        micro_finished_at: microRequired ? toIso(microFinished) : null,
        parameters: all.map((p) => ({
          category: p.category,
          parameter_name: p.parameter_name,
          specification: p.specification,
          result_value: p.result_value || '—',
          unit: p.unit || null,
          method_reference: p.method_reference || methodReference || null,
          complies: p.complies === true,
          equipment_id: p.equipment_id || null,
        })),
      })
      setDraft(report)
      setSuccess(t('qcws.draftCreated'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quality.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function openPdf(print: boolean) {
    if (!draft) return
    setError(null)
    // Окно открываем СИНХРОННО (в обработчике клика), иначе после await
    // браузер блокирует popup или скачивает файл (в т.ч. через Tailscale).
    const tab = print ? null : window.open('', '_blank')
    try {
      const blob = await downloadQcReportPdf(token, draft.id)
      if (print) { printBlob(blob); return }
      presentBlob(tab, blob)
    } catch (err) {
      if (tab) tab.close()
      setError(err instanceof Error ? err.message : t('quality.actionFailed'))
    }
  }

  async function downloadWord() {
    if (!draft) return
    setError(null)
    try {
      const blob = await downloadQcReportDocx(token, draft.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `analytical-sheet-${draft.report_no || draft.id}.docx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quality.actionFailed'))
    }
  }

  async function uploadScan(file: File) {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await uploadQcReportScan(token, draft.id, file)
      setScanAttached(true)
      setSuccess(t('qcws.scanAttached'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quality.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function viewScan(print: boolean) {
    if (!draft) return
    const tab = print ? null : window.open('', '_blank')
    try {
      const blob = await downloadQcReportScan(token, draft.id).catch(async () => {
        // запасной путь: только что загруженный скан недоступен по lot-эндпоинту в этой сессии
        throw new Error(t('quality.actionFailed'))
      })
      if (print) { printBlob(blob); return }
      presentBlob(tab, blob)
    } catch (err) {
      if (tab) tab.close()
      setError(err instanceof Error ? err.message : t('quality.actionFailed'))
    }
  }

  async function signProtocol() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await submitQcReport(token, draft.id, {
        username: user.username,
        password,
        meaning: t('quality.resultMeaning'),
        reason: reason || t('quality.resultReason'),
      })
      setDraft((d) => (d ? { ...d, status: 'submitted' } : d))
      setSuccess(t('qcws.signed'))
      setPassword('')
      onSubmitted()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quality.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const status: 'draft' | 'awaiting' | 'signed' = signed ? 'signed' : scanAttached ? 'awaiting' : 'draft'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-1 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('quality.reportNo')}</span>
            <input
              value={reportNo}
              disabled={locked}
              onChange={(e) => setReportNo(e.target.value)}
              className="w-[170px] rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[13px] font-semibold tabular-nums text-slate-900 outline-none hover:border-slate-200 focus:border-slate-400 focus:bg-white disabled:opacity-70"
            />
          </div>
          <StatusChip status={status} t={t} />
          <FormTypeChip sopForm={sopForm} t={t} />

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <PillButton tone="quiet" icon={Eye} disabled={!draft} onClick={() => openPdf(false)}>
              {t('qcws.previewPdf')}
            </PillButton>
            <PillButton tone="neutral" icon={Printer} disabled={!draft} onClick={() => openPdf(true)}>
              {t('qcws.printF11')}
            </PillButton>
            <PillButton tone="neutral" icon={FileText} disabled={!draft} onClick={() => void downloadWord()}>
              {t('qcws.downloadWord')}
            </PillButton>
            <PillButton tone="confirm" icon={ShieldCheck} disabled={!draft || signed || !password} onClick={() => void signProtocol()}>
              {t('qcws.signProtocol')}
            </PillButton>
          </div>
        </div>
      </div>

      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      {/* Title */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('qcws.eyebrow')}</p>
        <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-slate-950">{t('qcws.title')}</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-slate-600">{t('qcws.subtitle')}</p>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 space-y-5 xl:col-span-9">
          {/* Lot info */}
          <Card>
            <div className="grid grid-cols-12 gap-6 p-5">
              <div className="col-span-12 lg:col-span-5">
                <MetaLabel>{isFg ? t('qcws.kindFg') : t('qcws.kindSubstance')}</MetaLabel>
                <h3 className="mt-1 text-[20px] font-semibold leading-tight tracking-tight text-slate-950">{lot.material_name}</h3>
                <p className="mt-2 font-mono text-[12px] tabular-nums text-slate-600">
                  <span className="text-slate-400">{t('lots.material')} · </span>{lot.material_code}
                  <span className="px-2 text-slate-300">·</span>
                  <span className="text-slate-400">{t('lots.internalSeries')} · </span>{lot.internal_lot}
                </p>
                <p className="mt-2 text-[12.5px] text-slate-700">
                  <span className="text-slate-500">{t('lots.manufacturer')} · </span>
                  <span className="font-medium text-slate-900">{lot.manufacturer_name}</span>
                </p>
                {lot.sampling_date && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-2.5 py-1 text-[12px] text-emerald-800">
                    <CheckCircle2 size={14} />
                    <span className="font-medium">{t('qcws.sampledOn')}</span>
                    <span className="font-mono">{formatDate(lot.sampling_date, locale)}</span>
                  </div>
                )}
              </div>
              <div className="col-span-12 grid grid-cols-2 gap-x-5 gap-y-4 lg:col-span-7 lg:grid-cols-3">
                <Field label={t('lots.expiry')} value={formatDate(lot.expiry_date, locale)} mono />
                <Field label={t('qcws.samplingDate')} value={formatDate(lot.sampling_date, locale)} mono />
                <Field label={t('qcws.quantity')} value={`${lot.quantity.toLocaleString(locale)} ${lot.unit}`} mono />
                <div className="col-span-2 lg:col-span-3">
                  <MetaLabel>{t('qcws.specification')}</MetaLabel>
                  <input
                    value={methodReference}
                    disabled={locked}
                    onChange={(e) => setMethodReference(e.target.value)}
                    placeholder={t('qcws.specPlaceholder')}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-900 outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:opacity-80"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Section 1 */}
          <SectionNumber n={1} title={t('qcws.resultsTitle')} hint={t('qcws.resultsHint')} />

          {/* PC card */}
          <Card>
            <SectionHead
              icon={FlaskConical}
              accent="cyan"
              eyebrow={`СОП-${sopForm} Ф-11 · ${t('qcws.sectionA')}`}
              title={t('qcws.pcTitle')}
              sub={tpl ? `${t('qcws.templateMatched')}: ${tpl.label} · ${tpl.specRef}` : undefined}
              right={
                locked ? (
                  <LockedChip t={t} />
                ) : (
                  <>
                    <PillButton tone="quiet" icon={Layers} onClick={() => void loadTemplate()}>
                      {tpl ? `${t('qcws.loadTemplateFor')}: ${tpl.label}` : t('qcws.loadTemplate')}
                    </PillButton>
                    <PillButton tone="neutral" icon={Plus} onClick={() => setPcParams((p) => [...p, blankPc()])}>
                      {t('quality.addParameter')}
                    </PillButton>
                  </>
                )
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-[12.5px]">
                <thead className="bg-slate-50/80">
                  <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <th className="w-10 px-3 py-2 text-center">№</th>
                    <th className="px-3 py-2">{t('qcws.colTest')}</th>
                    <th className="px-3 py-2">{t('qcws.colSpec')}</th>
                    <th className="px-3 py-2">{t('qcws.colMethod')}</th>
                    <th className="px-3 py-2">{t('qcws.colResult')}</th>
                    <th className="w-16 px-3 py-2">{t('qcws.colUnit')}</th>
                    <th className="w-40 px-3 py-2">Прибор</th>
                    <th className="w-28 px-3 py-2">{t('qcws.colCompliance')}</th>
                    {!locked && <th className="w-8 px-2 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {pcParams.map((p, i) => (
                    <tr key={p.key} className={`border-b border-slate-100 align-top ${p.complies === false ? 'bg-rose-50/30' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                      <td className="px-3 py-2.5 text-center font-mono text-[11.5px] text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        {locked ? <CellText strong>{p.parameter_name}</CellText>
                          : <GhostTextArea value={p.parameter_name} onChange={(v) => patchPc(p.key, { parameter_name: v })} placeholder={t('quality.parameterName')} />}
                      </td>
                      <td className="px-3 py-2.5">
                        {locked ? <CellText>{p.specification}</CellText>
                          : <GhostTextArea value={p.specification} onChange={(v) => patchPc(p.key, specPatch(v, p.result_value))} placeholder={t('quality.specification')} />}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {locked ? <CellText muted>{p.method_reference}</CellText>
                          : <GhostTextArea value={p.method_reference} onChange={(v) => patchPc(p.key, { method_reference: v })} placeholder={t('quality.methodReference')} />}
                      </td>
                      <td className="px-3 py-2.5">
                        {locked ? <CellText mono>{p.result_value}</CellText>
                          : <GhostTextArea value={p.result_value} onChange={(v) => patchPc(p.key, resultPatch(p.specification, v))} placeholder="—" mono bordered />}
                      </td>
                      <td className="px-3 py-2.5">
                        {locked ? <span className="font-mono text-[11.5px] text-slate-500">{p.unit}</span>
                          : <GhostInput value={p.unit} onChange={(v) => patchPc(p.key, { unit: v })} placeholder="—" mono />}
                      </td>
                      <td className="px-3 py-2.5">
                        <RowEquipmentSelect
                          available={availableEquipment}
                          value={p.equipment_id || null}
                          onChange={(v) => patchPc(p.key, { equipment_id: v })}
                          disabled={locked}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <ComplianceToggle value={p.complies} auto={p.auto} onChange={locked ? null : (v) => patchPc(p.key, { complies: v, auto: false })} t={t} />
                      </td>
                      {!locked && (
                        <td className="px-2 py-2.5">
                          <button type="button" onClick={() => setPcParams((prev) => prev.filter((x) => x.key !== p.key))}
                            className="rounded-md p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Conditions strip */}
            <div className="space-y-3 border-t border-slate-200 bg-slate-50/40 p-5">
              <EquipmentPicker
                available={availableEquipment}
                selectedIds={equipmentIds}
                onChange={setEquipmentIds}
                disabled={locked}
              />
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
                <CondField label={t('qcws.equipment')} value={equipment} onChange={setEquipment} disabled={locked} />
                <CondField label={t('qcws.roomTemp')} value={roomTemp} onChange={setRoomTemp} disabled={locked} mono />
                <CondField label={t('qcws.humidity')} value={humidity} onChange={setHumidity} disabled={locked} mono />
                <div className="grid grid-cols-2 gap-2">
                  <CondDate label={t('quality.analysisStarted')} value={analysisStarted} onChange={setAnalysisStarted} disabled={locked} />
                  <CondDate label={t('quality.analysisFinished')} value={analysisFinished} onChange={setAnalysisFinished} disabled={locked} />
                </div>
              </div>
            </div>
          </Card>

          {/* Micro card */}
          <Card>
            <SectionHead
              icon={Microscope}
              accent="violet"
              eyebrow={`СОП-514 · ${t('qcws.sectionB')}`}
              title={t('qcws.microTitle')}
              sub={microMethodRef}
              right={
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50">
                  <input type="checkbox" checked={!microRequired} disabled={locked} onChange={(e) => setMicroRequired(!e.target.checked)} className="h-3.5 w-3.5 accent-slate-900" />
                  {t('qcws.microNotRequired')}
                </label>
              }
            />
            {microRequired ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[12.5px]">
                    <thead className="bg-slate-50/80">
                      <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <th className="w-10 px-3 py-2 text-center">№</th>
                        <th className="px-3 py-2">{t('qcws.colIndicator')}</th>
                        <th className="px-3 py-2">{t('qcws.colNorm')}</th>
                        <th className="px-3 py-2">{t('qcws.colResult')}</th>
                        <th className="w-28 px-3 py-2">{t('qcws.colCompliance')}</th>
                        {!locked && <th className="w-8 px-2 py-2" />}
                      </tr>
                    </thead>
                    <tbody>
                      {microParams.map((p, i) => (
                        <tr key={p.key} className={`border-b border-slate-100 ${p.complies === false ? 'bg-rose-50/30' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                          <td className="px-3 py-2.5 text-center font-mono text-[11.5px] text-slate-500">{i + 1}</td>
                          <td className="px-3 py-2.5">
                            {locked ? <CellText strong italic>{p.parameter_name}</CellText>
                              : <GhostTextArea value={p.parameter_name} onChange={(v) => patchMicro(p.key, { parameter_name: v })} placeholder={t('qcws.colIndicator')} />}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            {locked ? <CellText>{p.specification}</CellText>
                              : <GhostTextArea value={p.specification} onChange={(v) => patchMicro(p.key, specPatch(v, p.result_value))} placeholder={t('qcws.colNorm')} />}
                          </td>
                          <td className="px-3 py-2.5">
                            {locked ? <CellText mono>{p.result_value}</CellText>
                              : <GhostTextArea value={p.result_value} onChange={(v) => patchMicro(p.key, resultPatch(p.specification, v))} placeholder="—" mono bordered />}
                          </td>
                          <td className="px-3 py-2.5">
                            <ComplianceToggle value={p.complies} auto={p.auto} onChange={locked ? null : (v) => patchMicro(p.key, { complies: v, auto: false })} t={t} />
                          </td>
                          {!locked && (
                            <td className="px-2 py-2.5">
                              <button type="button" onClick={() => setMicroParams((prev) => prev.filter((x) => x.key !== p.key))}
                                className="rounded-md p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600">
                                <Trash2 size={13} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-slate-200 bg-slate-50/40 px-5 py-4">
                  <CondField label={t('qcws.microMethodRef')} value={microMethodRef} onChange={setMicroMethodRef} disabled={locked} />
                  <CondDate label={t('quality.analysisStarted')} value={microStarted} onChange={setMicroStarted} disabled={locked} />
                  <CondDate label={t('quality.analysisFinished')} value={microFinished} onChange={setMicroFinished} disabled={locked} />
                  {!locked && (
                    <PillButton tone="neutral" icon={Plus} onClick={() => setMicroParams((p) => [...p, blankMicro()])}>
                      {t('quality.addParameter')}
                    </PillButton>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3 p-5 text-[12.5px] text-slate-500">
                <Lock size={14} />
                {t('qcws.microNotRequiredNote')}
              </div>
            )}
          </Card>

          {/* Verdict */}
          <SectionNumber n={2} title={t('qcws.verdictTitle')} hint={t('qcws.verdictHint')} />
          <VerdictBanner verdict={verdict} t={t} />

          {/* Hybrid loop */}
          <SectionNumber n={3} title={t('qcws.hybridTitle')} hint={t('qcws.hybridHint')} />

          {!draft ? (
            <Card>
              <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-slate-900">{t('qcws.createDraftTitle')}</p>
                  <p className="mt-0.5 text-[12px] text-slate-500">{t('qcws.createDraftHint')}</p>
                </div>
                <PillButton tone="primary" size="lg" icon={FileText} disabled={busy} onClick={() => void createDraft()}>
                  {t('qcws.createDraft')}
                </PillButton>
              </div>
            </Card>
          ) : (
            <>
              {/* Scan section */}
              {!scanAttached ? (
                <Card>
                  <SectionHead icon={ScanLine} accent="amber" eyebrow={t('qcws.step1')} title={t('qcws.scanTitle')} sub={t('qcws.scanSub')} />
                  <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
                    <div className="flex flex-col items-start gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/40 p-5">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-white"><ScanLine size={16} /></span>
                      <p className="text-[13px] font-semibold text-slate-900">{t('qcws.scanViaAgent')}</p>
                      <p className="text-[11.5px] text-slate-500">{t('qcws.scanViaAgentHint')}</p>
                      <ScanButton onScanned={(f) => void uploadScan(f)} onError={setError} disabled={busy} asPdf />
                    </div>
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="group flex flex-col items-start gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/40 p-5 text-left transition hover:border-slate-900 hover:bg-white">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-900 ring-1 ring-slate-200"><Upload size={16} /></span>
                      <p className="text-[13px] font-semibold text-slate-900">{t('qcws.uploadFile')}</p>
                      <p className="text-[11.5px] text-slate-500">{t('qcws.uploadFileHint')}</p>
                    </button>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadScan(f); e.target.value = '' }} />
                  </div>
                </Card>
              ) : (
                <Card>
                  <SectionHead icon={FileCheck} accent="emerald" eyebrow={`${t('qcws.step1')} · ${t('qcws.uploaded')}`} title={t('qcws.scanUploadedTitle')}
                    right={
                      <>
                        <PillButton tone="quiet" icon={Eye} onClick={() => void viewScan(false)}>{t('qc.reportsModal.download')}</PillButton>
                        <PillButton tone="quiet" icon={Printer} onClick={() => void viewScan(true)}>{t('registry.print')}</PillButton>
                        <PillButton tone="quiet" icon={RefreshCw} onClick={() => fileRef.current?.click()}>{t('qc.reportsModal.replace')}</PillButton>
                      </>
                    } />
                  <div className="flex items-center gap-3 p-5 text-[12.5px] text-emerald-800">
                    <CheckCircle2 size={16} /> {t('qcws.scanReady')}
                  </div>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadScan(f); e.target.value = '' }} />
                </Card>
              )}

              {/* Signing block */}
              {signed ? (
                <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white">
                  <div className="flex items-start gap-4 p-5">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"><ShieldCheck size={20} /></span>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">{t('qcws.step2')} · {t('qcws.protocolSigned')}</p>
                      <h3 className="mt-0.5 text-base font-semibold text-emerald-900">{t('qcws.sentToQa')}</h3>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card>
                  <SectionHead icon={KeyRound} accent="emerald" eyebrow={t('qcws.step2')} title={t('qcws.signTitle')} sub={t('qcws.signSub')} />
                  <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-3">
                    <div>
                      <MetaLabel>{t('common.reason')}</MetaLabel>
                      <input value={reason} onChange={(e) => setReason(e.target.value)}
                        className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-slate-400" />
                    </div>
                    <div>
                      <MetaLabel>{t('quality.signaturePassword')}</MetaLabel>
                      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                        className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-[13px] tracking-widest outline-none focus:border-slate-400" />
                    </div>
                    <div className="flex items-end">
                      <button type="button" disabled={busy || !password} onClick={() => void signProtocol()}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-[13.5px] font-semibold text-white shadow-sm transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
                        <ShieldCheck size={16} /> {t('qcws.signProtocol')}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50/40 px-5 py-3 text-[11.5px] text-slate-500">
                    <AlertTriangle size={13} className="text-amber-600" />
                    {t('qcws.signFooter')}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>

        {/* Right rail */}
        <aside className="col-span-12 xl:col-span-3">
          <div className="space-y-4 xl:sticky xl:top-[88px]">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('qcws.roleTitle')}</p>
              <p className="mt-2 text-[12px] text-slate-700"><span className="font-medium">{user.full_name || user.username}</span></p>
              <p className="mt-1 text-[11.5px] text-slate-500">{t('qcws.roleAnalyst')}</p>
              <div className="mt-3 border-t border-slate-100 pt-3 text-[11.5px] text-slate-500">
                {t('qcws.roleSignerNote')}
              </div>
            </div>
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('qcws.relatedDocs')}</p>
              <ul className="mt-2 space-y-1.5 text-[12px]">
                <li className="flex items-center gap-2"><FileText size={13} className="text-slate-400" /><span className="font-mono text-slate-700">{lot.internal_lot}</span><span className="text-slate-400">· {t('qcws.relatedSeries')}</span></li>
                {lot.qc_report_no && (
                  <li className="flex items-center gap-2"><FileText size={13} className="text-slate-400" /><span className="font-mono text-slate-700">{lot.qc_report_no}</span><span className="text-slate-400">· Ф-11</span></li>
                )}
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── Small atoms ───────────────────────────────────────────────────────────────

function formatDate(value: string | null, locale: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(value))
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</section>
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{children}</p>
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <MetaLabel>{label}</MetaLabel>
      <p className={`text-[13px] leading-snug text-slate-900 ${mono ? 'font-mono tabular-nums' : ''}`}>{value || '—'}</p>
    </div>
  )
}

function CondField({ label, value, onChange, disabled, mono }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; mono?: boolean }) {
  return (
    <div>
      <MetaLabel>{label}</MetaLabel>
      <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className={`mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[12.5px] text-slate-800 outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:opacity-80 ${mono ? 'font-mono tabular-nums' : ''}`} />
    </div>
  )
}

function CondDate({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <MetaLabel>{label}</MetaLabel>
      <input type="datetime-local" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-800 outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:opacity-80" />
    </div>
  )
}

function GhostInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={`w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] text-slate-800 outline-none transition hover:border-slate-200 hover:bg-white focus:border-slate-400 focus:bg-white ${mono ? 'font-mono tabular-nums' : ''}`} />
  )
}

function GhostTextArea({
  value,
  onChange,
  placeholder,
  mono,
  bordered,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  bordered?: boolean
}) {
  const rows = Math.min(5, Math.max(2, Math.ceil((value || placeholder || '').length / 38)))
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`min-h-9 w-full resize-y whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-[12.5px] leading-snug text-slate-800 outline-none transition placeholder:text-slate-400 ${
        bordered
          ? 'border border-slate-200 bg-white focus:border-slate-400'
          : 'border border-transparent bg-transparent hover:border-slate-200 hover:bg-white focus:border-slate-400 focus:bg-white'
      } ${mono ? 'font-mono tabular-nums' : ''}`}
    />
  )
}

function CellText({
  children,
  strong,
  muted,
  mono,
  italic,
}: {
  children: React.ReactNode
  strong?: boolean
  muted?: boolean
  mono?: boolean
  italic?: boolean
}) {
  return (
    <span
      className={`block whitespace-pre-wrap break-words leading-snug ${
        strong ? 'font-medium text-slate-900' : muted ? 'text-slate-600' : 'text-slate-700'
      } ${mono ? 'font-mono tabular-nums text-slate-900' : ''} ${italic ? 'italic' : ''}`}
    >
      {children || '—'}
    </span>
  )
}

function ComplianceToggle({ value, onChange, auto, t }: { value: boolean | null; onChange: ((v: boolean) => void) | null; auto?: boolean; t: Translate }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="inline-flex h-7 overflow-hidden rounded-md border border-slate-200 bg-white">
        <button type="button" onClick={() => onChange?.(true)}
          className={`flex h-full w-10 items-center justify-center text-[11.5px] font-semibold transition ${value === true ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'}`}>
          {t('qcws.yes')}
        </button>
        <div className="w-px bg-slate-200" />
        <button type="button" onClick={() => onChange?.(false)}
          className={`flex h-full w-10 items-center justify-center text-[11.5px] font-semibold transition ${value === false ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-rose-50 hover:text-rose-700'}`}>
          {t('qcws.no')}
        </button>
      </div>
      {auto && value !== null && (
        <span title={t('qcws.autoHint')} className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-slate-500">
          <Sparkles size={9} /> {t('qcws.auto')}
        </span>
      )}
    </div>
  )
}

function PillButton({ children, tone = 'neutral', icon: Ico, onClick, size = 'md', disabled }: {
  children: React.ReactNode
  tone?: 'neutral' | 'primary' | 'confirm' | 'quiet'
  icon?: typeof Eye
  onClick?: () => void
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
}) {
  const tones: Record<string, string> = {
    neutral: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    primary: 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800',
    confirm: 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-600',
    quiet: 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100',
  }
  const sizes: Record<string, string> = { sm: 'h-7 px-2 text-[11.5px]', md: 'h-8 px-3 text-[12.5px]', lg: 'h-10 px-4 text-sm' }
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${sizes[size]}`}>
      {Ico && <Ico size={size === 'lg' ? 16 : 13} />}
      {children}
    </button>
  )
}

function SectionNumber({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{n}</span>
      <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h3>
      <span className="font-mono text-[11px] text-slate-400">{hint}</span>
    </div>
  )
}

function SectionHead({ icon: Ico, eyebrow, title, accent = 'slate', right, sub }: {
  icon: typeof Eye
  eyebrow?: string
  title: string
  accent?: 'slate' | 'cyan' | 'violet' | 'emerald' | 'amber'
  right?: React.ReactNode
  sub?: string
}) {
  const accents: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    cyan: 'bg-cyan-50 text-cyan-700',
    violet: 'bg-violet-50 text-violet-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return (
    <div className="flex items-start gap-3 border-b border-slate-200 p-5">
      <span className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md ${accents[accent]}`}><Ico size={16} /></span>
      <div className="min-w-0 flex-1">
        {eyebrow && <MetaLabel>{eyebrow}</MetaLabel>}
        <h3 className="text-base font-semibold tracking-tight text-slate-900">{title}</h3>
        {sub && <p className="mt-0.5 text-[12.5px] text-slate-500">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}

function LockedChip({ t }: { t: Translate }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-500">
      <Lock size={11} /> {t('qcws.lockedAfterDraft')}
    </span>
  )
}

function StatusChip({ status, t }: { status: 'draft' | 'awaiting' | 'signed'; t: Translate }) {
  const map = {
    draft: { cls: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500', label: t('qcws.statusDraft') },
    awaiting: { cls: 'border-sky-200 bg-sky-50 text-sky-800', dot: 'bg-sky-500', label: t('qcws.statusAwaiting') },
    signed: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500', label: t('qcws.statusSigned') },
  }
  const s = map[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  )
}

function FormTypeChip({ sopForm, t }: { sopForm: string; t: Translate }) {
  if (sopForm === '548') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800">
        <Beaker size={12} /> {t('qcws.chipFg')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
      <FlaskConical size={12} /> {t('qcws.chipSubstance')}
    </span>
  )
}

function VerdictBanner({ verdict, t }: { verdict: Verdict; t: Translate }) {
  if (verdict === 'pass') {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-50/40 p-5">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-600 text-white"><ShieldCheck size={22} /></span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">{t('qcws.verdictLabel')}</p>
          <h3 className="mt-0.5 text-[19px] font-semibold leading-tight tracking-tight text-emerald-900">{t('qcws.verdictPass')}</h3>
          <p className="mt-1 text-[12.5px] text-emerald-800/80">{t('qcws.verdictPassHint')}</p>
        </div>
      </div>
    )
  }
  if (verdict === 'fail') {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-rose-50/40 p-5">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-rose-700 text-white"><AlertTriangle size={22} /></span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-700">{t('qcws.verdictLabel')}</p>
          <h3 className="mt-0.5 text-[19px] font-semibold leading-tight tracking-tight text-rose-900">{t('qcws.verdictFail')}</h3>
          <p className="mt-1 text-[12.5px] text-rose-800/80">{t('qcws.verdictFailHint')}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><ClipboardList size={22} /></span>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('qcws.verdictLabel')}</p>
        <h3 className="mt-0.5 text-[19px] font-semibold leading-tight tracking-tight text-slate-700">{t('qcws.verdictPartial')}</h3>
        <p className="mt-1 text-[12.5px] text-slate-500">{t('qcws.verdictPartialHint')}</p>
      </div>
    </div>
  )
}

function EquipmentPicker({
  available, selectedIds, onChange, disabled,
}: {
  available: EquipmentItem[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled: boolean
}) {
  const selected = available.filter((e) => selectedIds.includes(e.id))
  const expired = selected.filter((e) => e.calibration_status === 'expired' || e.calibration_status === 'missing')
  const expiring = selected.filter((e) => e.calibration_status === 'expiring')

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Приборы анализа (реестр КИП)
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">
        Выберите все приборы, использованные при анализе. Просроченная или отсутствующая
        калибровка блокирует сохранение протокола (GMP Annex 15).
      </p>
      {available.length === 0 ? (
        <p className="mt-2 text-[11.5px] text-slate-400">Справочник КИП пуст — добавьте приборы в разделе «Реестр КИП».</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {available.map((eq) => {
            const isOn = selectedIds.includes(eq.id)
            return (
              <button
                key={eq.id}
                type="button"
                disabled={disabled}
                onClick={() => toggle(eq.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                  isOn
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                } disabled:opacity-50`}
                title={`${eq.code} — ${eq.name}`}
              >
                <span className="font-mono text-[10.5px]">{eq.code}</span>
                <span>{eq.name}</span>
                <CalibrationBadge status={eq.calibration_status} validUntil={eq.calibration_valid_until} />
              </button>
            )
          })}
        </div>
      )}
      {expired.length > 0 && (
        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
          <strong>Просроченная калибровка:</strong> {expired.map((e) => e.code).join(', ')}. Сохранение протокола заблокировано.
        </p>
      )}
      {expiring.length > 0 && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          <strong>Скоро истекает:</strong> {expiring.map((e) => `${e.code} (до ${e.calibration_valid_until})`).join(', ')}.
        </p>
      )}
    </div>
  )
}

function RowEquipmentSelect({
  available, value, onChange, disabled,
}: {
  available: EquipmentItem[]
  value: string | null
  onChange: (v: string | null) => void
  disabled: boolean
}) {
  if (disabled) {
    const eq = available.find((e) => e.id === value)
    return <span className="text-[11.5px] text-slate-500">{eq ? eq.code : '—'}</span>
  }
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11.5px] outline-none focus:border-slate-400"
    >
      <option value="">—</option>
      {available.map((eq) => (
        <option key={eq.id} value={eq.id}>
          {eq.code} · {eq.name}
        </option>
      ))}
    </select>
  )
}
