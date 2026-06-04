import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ClipboardList, Eye, FileCheck, KeyRound, Layers,
  Lock, Package, Printer, RefreshCw, ScanLine, ShieldCheck, Sparkles, Upload,
} from 'lucide-react'
import {
  createQcReport, downloadQcReportPdf, downloadQcReportScan, submitQcReport, uploadQcReportScan,
} from '../../lib/api'
import { printBlob } from '../../lib/print'
import { ScanButton } from '../../components/ui/ScanButton'
import { useToast } from '../../components/ui/ToastProvider'
import { useI18n } from '../../i18n/I18nProvider'
import {
  PACKAGING_TEMPLATES, PACKAGING_TYPE_VALUES, foilWidthSpec, resolvePackagingTemplate, type PackagingType,
} from './qcPackagingTemplates'
import type { CurrentUser } from '../../types/auth'
import type { LotItem } from '../../types/inventory'

// Локализация (паттерн STR[language] как в SpecificationsAdminPage).
const STR = {
  ru: {
    eyebrow: 'Входной контроль · СОП-543', title: 'Заключение на вторичный упаковочный материал',
    subtitle: 'Методы входного контроля ВУМ по типу материала. Результат фиксируется в «Заключении» (Ф-2 к СОП-543).',
    reportNo: '№ протокола', vum: 'ВУМ · СОП-543', type: 'Тип ВУМ', loadMethods: 'Загрузить методы',
    previewF2: 'Предпросмотр Ф-2', printF2: 'Печать Ф-2',
    colTest: 'Показатель', colSpec: 'Требование НД (норма)', colMethod: 'Метод / НД', colResult: 'Результат',
    colUnit: 'Ед.', colCompliance: 'Соответствие', yes: 'Да', no: 'Нет', auto: 'авто',
    verdictTitle: 'Вердикт', pass: 'Соответствует НД', fail: 'Не соответствует НД', partial: 'Заполните все показатели',
    createTitle: 'Сформировать заключение', createHint: 'Зафиксирует показатели и создаст черновик Ф-2.', create: 'Сформировать',
    scanTitle: 'Скан подписанного Ф-2', scanSub: 'Распечатайте, подпишите и приложите скан — ДОК увидит подписанный документ.',
    scanRequired: 'обязательно', scanReady: 'Скан приложен и зафиксирован.', scanUploaded: 'Скан загружен',
    scanAgent: 'Сканировать через агент', scanAgentHint: 'Документ-сканер рабочего места', uploadFile: 'Загрузить файл', uploadHint: 'PDF, JPG или PNG',
    download: 'Открыть', print: 'Печать', replace: 'Заменить',
    signTitle: 'Электронная подпись заключения', signSub: 'После подписи результат передаётся в ДОК.',
    signLocked: 'Подпись недоступна: сначала приложите скан подписанного Ф-2.', reason: 'Основание', password: 'Пароль э-подписи',
    sign: 'Подписать заключение', signedTitle: 'ЗАКЛЮЧЕНИЕ ПОДПИСАНО', sentToQa: 'Передано в ДОК для решения по серии',
    signFooter: 'Все действия записываются в журнал аудита GMP (Annex 11 §9).',
    errNoParams: 'Добавьте хотя бы один показатель.', errUntouched: 'Оцените соответствие по всем показателям.',
    errNoPassword: 'Введите пароль электронной подписи.', errScanRequired: 'Приложите скан подписанного Ф-2.',
    created: 'Черновик заключения создан.', signed: 'Заключение подписано и передано в ДОК.', failed: 'Действие не выполнено.',
    noType: 'Тип ВУМ не определён — выберите вручную.',
    types: { label: 'Самоклеящиеся этикетки', carton: 'Пеналы', corrugated_box: 'Короба из гофрокартона', leaflet: 'Инструкции по применению', foil: 'Алюминиевая фольга' },
  },
  uz: {
    eyebrow: 'Kirish nazorati · SOP-543', title: 'Ikkilamchi qadoqlash materialiga xulosa',
    subtitle: 'QM kirish nazorati usullari material turi bo‘yicha. Natija «Xulosa»da qayd etiladi (SOP-543 F-2).',
    reportNo: 'Bayonnoma №', vum: 'QM · SOP-543', type: 'QM turi', loadMethods: 'Usullarni yuklash',
    previewF2: 'F-2 ko‘rib chiqish', printF2: 'F-2 chop etish',
    colTest: 'Ko‘rsatkich', colSpec: 'ND talabi (norma)', colMethod: 'Usul / ND', colResult: 'Natija',
    colUnit: 'Birlik', colCompliance: 'Muvofiqlik', yes: 'Ha', no: 'Yo‘q', auto: 'avto',
    verdictTitle: 'Hukm', pass: 'ND ga mos', fail: 'ND ga mos emas', partial: 'Barcha ko‘rsatkichlarni to‘ldiring',
    createTitle: 'Xulosani shakllantirish', createHint: 'Ko‘rsatkichlarni qayd etadi va F-2 qoralamasini yaratadi.', create: 'Shakllantirish',
    scanTitle: 'Imzolangan F-2 skani', scanSub: 'Chop eting, imzolang va skanini ilova qiling — SKA imzolangan hujjatni ko‘radi.',
    scanRequired: 'majburiy', scanReady: 'Skan ilova qilindi.', scanUploaded: 'Skan yuklandi',
    scanAgent: 'Agent orqali skanlash', scanAgentHint: 'Ish joyi skaneri', uploadFile: 'Fayl yuklash', uploadHint: 'PDF, JPG yoki PNG',
    download: 'Ochish', print: 'Chop etish', replace: 'Almashtirish',
    signTitle: 'Xulosaning elektron imzosi', signSub: 'Imzodan so‘ng natija SKA ga uzatiladi.',
    signLocked: 'Imzo mavjud emas: avval imzolangan F-2 skanini ilova qiling.', reason: 'Asos', password: 'E-imzo paroli',
    sign: 'Xulosani imzolash', signedTitle: 'XULOSA IMZOLANDI', sentToQa: 'Seriya bo‘yicha qaror uchun SKA ga uzatildi',
    signFooter: 'Barcha amallar GMP audit jurnalida qayd etiladi (Annex 11 §9).',
    errNoParams: 'Kamida bitta ko‘rsatkich qo‘shing.', errUntouched: 'Barcha ko‘rsatkichlar muvofiqligini baholang.',
    errNoPassword: 'Elektron imzo parolini kiriting.', errScanRequired: 'Imzolangan F-2 skanini ilova qiling.',
    created: 'Xulosa qoralamasi yaratildi.', signed: 'Xulosa imzolandi va SKA ga uzatildi.', failed: 'Amal bajarilmadi.',
    noType: 'QM turi aniqlanmadi — qo‘lda tanlang.',
    types: { label: 'Yopishqoq etiketkalar', carton: 'Penallar', corrugated_box: 'Gofrokarton qutilar', leaflet: 'Qo‘llash yo‘riqnomalari', foil: 'Alyumin folga' },
  },
  en: {
    eyebrow: 'Incoming control · SOP-543', title: 'Conclusion on secondary packaging material',
    subtitle: 'Incoming-control methods per packaging type. The result is recorded in the conclusion (F-2 to SOP-543).',
    reportNo: 'Protocol No.', vum: 'Packaging · SOP-543', type: 'Packaging type', loadMethods: 'Load methods',
    previewF2: 'Preview F-2', printF2: 'Print F-2',
    colTest: 'Parameter', colSpec: 'Requirement (norm)', colMethod: 'Method / ND', colResult: 'Result',
    colUnit: 'Unit', colCompliance: 'Compliance', yes: 'Yes', no: 'No', auto: 'auto',
    verdictTitle: 'Verdict', pass: 'Complies', fail: 'Does not comply', partial: 'Fill in all parameters',
    createTitle: 'Form the conclusion', createHint: 'Locks the parameters and creates an F-2 draft.', create: 'Form',
    scanTitle: 'Scan of the signed F-2', scanSub: 'Print, sign and attach the scan — QA will see the signed document.',
    scanRequired: 'required', scanReady: 'Scan attached.', scanUploaded: 'Scan uploaded',
    scanAgent: 'Scan via agent', scanAgentHint: 'Workstation document scanner', uploadFile: 'Upload file', uploadHint: 'PDF, JPG or PNG',
    download: 'Open', print: 'Print', replace: 'Replace',
    signTitle: 'Electronic signature of the conclusion', signSub: 'After signing, the result is passed to QA.',
    signLocked: 'Signing is locked: attach the scan of the signed F-2 first.', reason: 'Reason', password: 'E-signature password',
    sign: 'Sign conclusion', signedTitle: 'CONCLUSION SIGNED', sentToQa: 'Sent to QA for a decision on the batch',
    signFooter: 'All actions are recorded in the GMP audit log (Annex 11 §9).',
    errNoParams: 'Add at least one parameter.', errUntouched: 'Evaluate compliance for all parameters.',
    errNoPassword: 'Enter your electronic signature password.', errScanRequired: 'Attach the scan of the signed F-2.',
    created: 'Conclusion draft created.', signed: 'Conclusion signed and passed to QA.', failed: 'Action failed.',
    noType: 'Packaging type not detected — pick it manually.',
    types: { label: 'Self-adhesive labels', carton: 'Folding cartons', corrugated_box: 'Corrugated boxes', leaflet: 'Leaflets', foil: 'Aluminium foil' },
  },
} as const

// Авто-оценка числовых норм: «от a до b», «не менее N», «не более N».
function evalNumeric(spec: string, value: string): boolean | null {
  const r = Number(value.replace(',', '.'))
  if (!value.trim() || Number.isNaN(r)) return null
  const s = spec.toLowerCase().replace(/,/g, '.')
  // Допуск «X ± p %» или «X ± a».
  const tol = s.match(/(\d+(?:\.\d+)?)\s*(?:мм|mm|сек|s)?\s*[±]\s*(\d+(?:\.\d+)?)\s*(%?)/)
  if (tol) {
    const center = Number(tol[1]); const delta = Number(tol[2])
    const span = tol[3] === '%' ? (center * delta) / 100 : delta
    return r >= center - span - 1e-9 && r <= center + span + 1e-9
  }
  const range = s.match(/(\d+(?:\.\d+)?)\s*(?:до|—|–|-|to)\s*(\d+(?:\.\d+)?)/)
  if (range) {
    const a = Number(range[1]); const b = Number(range[2])
    return r >= Math.min(a, b) - 1e-9 && r <= Math.max(a, b) + 1e-9
  }
  if (/не\s*менее|≥|>=|\bmin\b|не\s*ниже/.test(s)) {
    const m = s.match(/(\d+(?:\.\d+)?)/); if (m) return r >= Number(m[1]) - 1e-9
  }
  if (/не\s*более|≤|<=|\bmax\b|не\s*выше/.test(s)) {
    const m = s.match(/(\d+(?:\.\d+)?)/); if (m) return r <= Number(m[1]) + 1e-9
  }
  return null
}

let keySeq = 0
interface Row {
  key: string; name: string; spec: string; method: string; unit: string
  kind: 'numeric' | 'descriptive'; result: string; complies: boolean | null; auto?: boolean
}

interface Props {
  token: string
  user: CurrentUser
  lot: LotItem
  onSubmitted: () => void
}

export function QcPackagingWorkspace({ token, user, lot, onSubmitted }: Props) {
  const { language } = useI18n()
  const tr = STR[language as keyof typeof STR] || STR.ru
  const toast = useToast()

  const inferred = useMemo(
    () => resolvePackagingTemplate(lot.packaging_type, lot.material_name, lot.material_code)?.key ?? null,
    [lot.packaging_type, lot.material_name, lot.material_code],
  )
  const [type, setType] = useState<PackagingType>(inferred ?? 'leaflet')
  const [reportNo, setReportNo] = useState(`VUM-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-001`)
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState<{ id: string; status: string } | null>(null)
  const [scanAttached, setScanAttached] = useState(false)
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('Входной контроль ВУМ (СОП-543)')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const locked = draft !== null
  const signed = draft?.status === 'submitted'
  const template = PACKAGING_TEMPLATES[type]

  const verdict: 'pass' | 'fail' | 'partial' = useMemo(() => {
    if (rows.length === 0) return 'partial'
    if (rows.some((r) => r.complies === false)) return 'fail'
    if (rows.every((r) => r.complies === true)) return 'pass'
    return 'partial'
  }, [rows])

  function loadMethods() {
    setRows(template.params.map((p) => ({
      key: `p${++keySeq}`, name: p.name,
      // Для фольги норму ширины подставляем из номинала в наименовании партии.
      spec: type === 'foil' && /ширин/i.test(p.name) ? foilWidthSpec(lot.material_name) : p.spec,
      method: p.method, unit: p.unit, kind: p.kind, result: '', complies: null,
    })))
    setError(null)
  }

  function patch(key: string, patchObj: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patchObj } : r)))
  }
  function onResult(row: Row, value: string) {
    if (row.kind === 'numeric') {
      const auto = evalNumeric(row.spec, value)
      patch(row.key, auto === null ? { result: value } : { result: value, complies: auto, auto: true })
    } else {
      patch(row.key, { result: value })
    }
  }

  async function createDraft() {
    setError(null); setSuccess(null)
    const valid = rows.filter((r) => r.name.trim())
    if (valid.length === 0) { setError(tr.errNoParams); return }
    if (valid.some((r) => r.complies === null)) { setError(tr.errUntouched); return }
    setBusy(true)
    try {
      const report = await createQcReport(token, {
        lot_id: lot.id,
        report_no: reportNo,
        analysis_started_at: null,
        analysis_finished_at: null,
        method_reference: template.ndRef,
        micro_required: false,
        parameters: valid.map((r) => ({
          category: 'packaging' as const,
          parameter_name: r.name,
          specification: r.spec,
          result_value: r.result || '—',
          unit: r.unit || null,
          method_reference: r.method || null,
          complies: r.complies === true,
        })),
      })
      setDraft({ id: report.id, status: report.status })
      setSuccess(tr.created)
      toast.success(tr.created)
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr.failed
      setError(msg); toast.error(msg)
    } finally { setBusy(false) }
  }

  async function uploadScan(file: File) {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      await uploadQcReportScan(token, draft.id, file)
      setScanAttached(true); setSuccess(tr.scanReady); toast.success(tr.scanReady)
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr.failed
      setError(msg); toast.error(msg)
    } finally { setBusy(false) }
  }

  async function openPdf(print: boolean) {
    if (!draft) return
    const tab = print ? null : window.open('', '_blank')
    try {
      const blob = await downloadQcReportPdf(token, draft.id)
      if (print) { printBlob(blob); return }
      const url = URL.createObjectURL(blob)
      if (tab && !tab.closed) tab.location.href = url
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      if (tab) tab.close()
      setError(err instanceof Error ? err.message : tr.failed)
    }
  }

  async function viewScan(print: boolean) {
    if (!draft) return
    const tab = print ? null : window.open('', '_blank')
    try {
      const blob = await downloadQcReportScan(token, draft.id)
      if (print) { printBlob(blob); return }
      const url = URL.createObjectURL(blob)
      if (tab && !tab.closed) tab.location.href = url
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      if (tab) tab.close()
      setError(err instanceof Error ? err.message : tr.failed)
    }
  }

  async function signProtocol() {
    if (!draft) return
    if (!scanAttached) { setError(tr.errScanRequired); toast.error(tr.errScanRequired); return }
    if (!password.trim()) { setError(tr.errNoPassword); return }
    setBusy(true); setError(null)
    try {
      await submitQcReport(token, draft.id, {
        username: user.username, password,
        meaning: 'Заключение по входному контролю ВУМ', reason: reason || 'Входной контроль ВУМ',
      })
      setDraft((d) => (d ? { ...d, status: 'submitted' } : d))
      setSuccess(tr.signed); toast.success(tr.signed); setPassword('')
      onSubmitted()
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr.failed
      setError(msg); toast.error(msg)
    } finally { setBusy(false) }
  }

  const statusLabel = signed ? tr.signedTitle : scanAttached ? tr.scanUploaded : tr.createTitle

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-1 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{tr.reportNo}</span>
            <input value={reportNo} disabled={locked} onChange={(e) => setReportNo(e.target.value)}
              className="w-[170px] rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[13px] font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-slate-400 focus:bg-white disabled:opacity-70" />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800">
            <Package size={12} /> {tr.vum}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{tr.type}</span>
            <select value={type} disabled={locked} onChange={(e) => setType(e.target.value as PackagingType)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12.5px] outline-none focus:border-slate-400 disabled:opacity-70">
              {PACKAGING_TYPE_VALUES.map((v) => <option key={v} value={v}>{tr.types[v]}</option>)}
            </select>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button type="button" disabled={!draft} onClick={() => void openPdf(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Eye size={13} /> {tr.previewF2}
            </button>
            <button type="button" disabled={!draft} onClick={() => void openPdf(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Printer size={13} /> {tr.printF2}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{tr.eyebrow}</p>
        <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-slate-950">{tr.title}</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-slate-600">{tr.subtitle}</p>
      </div>

      {/* Lot info */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-[18px] font-semibold tracking-tight text-slate-950">{lot.material_name}</h3>
        <p className="mt-1 font-mono text-[12px] text-slate-600">
          {lot.material_code} · {lot.internal_lot} · {lot.manufacturer_name}
        </p>
        {!inferred && <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] text-amber-800"><AlertTriangle size={13} /> {tr.noType}</p>}
      </div>

      {/* Methods table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{template.ndRef}</p>
            <h3 className="text-base font-semibold tracking-tight text-slate-900">{tr.types[type]}</h3>
          </div>
          {!locked && (
            <button type="button" onClick={loadMethods}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50">
              <Layers size={13} /> {tr.loadMethods}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[12.5px]">
            <thead className="bg-slate-50/80">
              <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <th className="w-10 px-3 py-2 text-center">№</th>
                <th className="px-3 py-2">{tr.colTest}</th>
                <th className="px-3 py-2">{tr.colSpec}</th>
                <th className="px-3 py-2">{tr.colMethod}</th>
                <th className="px-3 py-2">{tr.colResult}</th>
                <th className="w-16 px-3 py-2">{tr.colUnit}</th>
                <th className="w-28 px-3 py-2">{tr.colCompliance}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-[12.5px] text-slate-400">{tr.loadMethods} →</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.key} className={`border-b border-slate-100 align-top ${r.complies === false ? 'bg-rose-50/30' : i % 2 ? 'bg-slate-50/30' : 'bg-white'}`}>
                  <td className="px-3 py-2.5 text-center font-mono text-[11.5px] text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-900">{r.name}</td>
                  <td className="px-3 py-2.5 text-slate-700">{r.spec}</td>
                  <td className="px-3 py-2.5 text-slate-500">{r.method}</td>
                  <td className="px-3 py-2.5">
                    {locked ? <span className="font-mono text-slate-900">{r.result}</span>
                      : <input value={r.result} onChange={(e) => onResult(r, e.target.value)} placeholder="—"
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[12.5px] outline-none focus:border-slate-400" />}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11.5px] text-slate-500">{r.unit}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="inline-flex h-7 overflow-hidden rounded-md border border-slate-200 bg-white">
                        <button type="button" disabled={locked} onClick={() => patch(r.key, { complies: true, auto: false })}
                          className={`flex h-full w-10 items-center justify-center text-[11.5px] font-semibold transition ${r.complies === true ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-emerald-50'} disabled:opacity-60`}>{tr.yes}</button>
                        <div className="w-px bg-slate-200" />
                        <button type="button" disabled={locked} onClick={() => patch(r.key, { complies: false, auto: false })}
                          className={`flex h-full w-10 items-center justify-center text-[11.5px] font-semibold transition ${r.complies === false ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-rose-50'} disabled:opacity-60`}>{tr.no}</button>
                      </div>
                      {r.auto && r.complies !== null && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 py-0.5 text-[9.5px] font-semibold uppercase text-slate-500"><Sparkles size={9} /> {tr.auto}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Verdict */}
      <div className={`flex items-center gap-4 rounded-xl border p-4 ${verdict === 'pass' ? 'border-emerald-200 bg-emerald-50/60' : verdict === 'fail' ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-white'}`}>
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-white ${verdict === 'pass' ? 'bg-emerald-600' : verdict === 'fail' ? 'bg-rose-700' : 'bg-slate-300'}`}>
          {verdict === 'fail' ? <AlertTriangle size={20} /> : verdict === 'pass' ? <ShieldCheck size={20} /> : <ClipboardList size={20} />}
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{tr.verdictTitle}</p>
          <h3 className="text-[17px] font-semibold tracking-tight text-slate-900">{verdict === 'pass' ? tr.pass : verdict === 'fail' ? tr.fail : tr.partial}</h3>
        </div>
      </div>

      {/* Create → scan → sign */}
      {!draft ? (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] font-semibold text-slate-900">{tr.createTitle}</p>
            <p className="mt-0.5 text-[12px] text-slate-500">{tr.createHint}</p>
          </div>
          <button type="button" disabled={busy || rows.length === 0} onClick={() => void createDraft()}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            <FileCheck size={16} /> {tr.create}
          </button>
        </div>
      ) : (
        <>
          {/* Scan (mandatory) */}
          {!scanAttached ? (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-start gap-3 border-b border-slate-200 p-4">
                <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-700"><ScanLine size={16} /></span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{tr.scanRequired}</p>
                  <h3 className="text-base font-semibold text-slate-900">{tr.scanTitle}</h3>
                  <p className="mt-0.5 text-[12.5px] text-slate-500">{tr.scanSub}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
                <div className="flex flex-col items-start gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/40 p-5">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-white"><ScanLine size={16} /></span>
                  <p className="text-[13px] font-semibold text-slate-900">{tr.scanAgent}</p>
                  <p className="text-[11.5px] text-slate-500">{tr.scanAgentHint}</p>
                  <ScanButton onScanned={(f) => void uploadScan(f)} onError={setError} disabled={busy} asPdf />
                </div>
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex flex-col items-start gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/40 p-5 text-left transition hover:border-slate-900 hover:bg-white">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-900 ring-1 ring-slate-200"><Upload size={16} /></span>
                  <p className="text-[13px] font-semibold text-slate-900">{tr.uploadFile}</p>
                  <p className="text-[11.5px] text-slate-500">{tr.uploadHint}</p>
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadScan(f); e.target.value = '' }} />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <div className="flex items-center gap-2 text-[12.5px] text-emerald-800"><CheckCircle2 size={16} /> {tr.scanReady}</div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => void viewScan(false)} className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] text-slate-600 hover:bg-slate-100"><Eye size={13} /> {tr.download}</button>
                  <button type="button" onClick={() => void viewScan(true)} className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] text-slate-600 hover:bg-slate-100"><Printer size={13} /> {tr.print}</button>
                  <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] text-slate-600 hover:bg-slate-100"><RefreshCw size={13} /> {tr.replace}</button>
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadScan(f); e.target.value = '' }} />
            </div>
          )}

          {/* Sign */}
          {signed ? (
            <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white p-5">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"><ShieldCheck size={20} /></span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">{tr.signedTitle}</p>
                  <h3 className="mt-0.5 text-base font-semibold text-emerald-900">{tr.sentToQa}</h3>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-start gap-3 border-b border-slate-200 p-4">
                <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><KeyRound size={16} /></span>
                <div><h3 className="text-base font-semibold text-slate-900">{tr.signTitle}</h3><p className="mt-0.5 text-[12.5px] text-slate-500">{tr.signSub}</p></div>
              </div>
              {!scanAttached && (
                <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50/60 px-5 py-2.5 text-[12px] text-amber-800"><Lock size={13} /> {tr.signLocked}</div>
              )}
              <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{tr.reason}</p>
                  <input value={reason} disabled={!scanAttached} onChange={(e) => setReason(e.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:opacity-70" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{tr.password}</p>
                  <input type="password" value={password} disabled={!scanAttached} onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-[13px] tracking-widest outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:opacity-70" />
                </div>
                <div className="flex items-end">
                  <button type="button" disabled={busy || !scanAttached || !password} onClick={() => void signProtocol()}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-[13.5px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                    <ShieldCheck size={16} /> {tr.sign}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50/40 px-5 py-3 text-[11.5px] text-slate-500">
                <AlertTriangle size={13} className="text-amber-600" /> {tr.signFooter}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
