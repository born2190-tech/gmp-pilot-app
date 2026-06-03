import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, FileSignature, Inbox, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { approveBmrTemplate, issueProductionBmr, listBmrQueue, listBmrTemplates } from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type { BmrQueueItem, BmrTemplateListItem } from '../../types/inventory'

interface BmrIssuancePageProps {
  token: string
  user: CurrentUser
}

const copy = {
  ru: {
    kicker: 'ДОК / СОП-11',
    title: 'Выдача ЗПС/BMR',
    subtitle: 'ДОК проверяет реквизиты серии и выдаёт ЗПС/BMR по запросу производства.',
    refresh: 'Обновить',
    queue: 'Очередь',
    waiting: 'Ожидают выдачи',
    batchNo: 'Номер серии',
    product: 'ЛС',
    batchSize: 'Размер серии',
    dates: 'Даты',
    requested: 'Запросил',
    open: 'Открыть',
    empty: 'Нет серий, ожидающих выдачи ЗПС.',
    loadFailed: 'Не удалось загрузить очередь ЗПС/BMR',
    actionFailed: 'Не удалось выдать ЗПС/BMR',
    issued: 'ЗПС/BMR выдана. Серия убрана из очереди.',
    modalTitle: 'Выдача ЗПС/BMR',
    review: 'Проверка реквизитов',
    check: 'Номер серии и реквизиты проверены (СОП-11 п.5.1.4-5.1.5)',
    bmrNo: 'Номер ЗПС/BMR',
    password: 'Пароль электронной подписи ДОК',
    submit: 'Выдать ЗПС/BMR',
    close: 'Закрыть',
    productionDate: 'Дата производства',
    expiryDate: 'Срок годности',
    requestedBy: 'Кто запросил',
    requestedAt: 'Когда запросил',
    sopHint: 'Подписывая, ДОК подтверждает корректность номера серии и реквизитов документа.',
    meaning: 'Выдача ЗПС/BMR по запросу производства',
    reason: 'Реквизиты серии проверены ДОК по СОП-11',
    codePrefix: 'код',
    draftTemplates: 'Черновики BMR на утверждение',
    pendingTemplates: 'Ожидают утверждения',
    templateEmpty: 'Нет черновиков BMR, ожидающих утверждения.',
    approveTemplate: 'Утвердить шаблон',
    templateApproved: 'Шаблон BMR утверждён. Предыдущая утверждённая версия по этому ЛС переведена в архив.',
    sections: 'секций',
  },
  uz: {
    kicker: 'SKA / SOP-11',
    title: 'ZPS/BMR berish',
    subtitle: 'SKA seriya rekvizitlarini tekshiradi va ishlab chiqarish so‘rovi bo‘yicha ZPS/BMR beradi.',
    refresh: 'Yangilash',
    queue: 'Navbat',
    waiting: 'Berishni kutmoqda',
    batchNo: 'Seriya raqami',
    product: 'Dori vositasi',
    batchSize: 'Seriya hajmi',
    dates: 'Sanalar',
    requested: 'So‘ragan',
    open: 'Ochish',
    empty: 'ZPS berilishini kutayotgan seriyalar yo‘q.',
    loadFailed: 'ZPS/BMR navbatini yuklab bo‘lmadi',
    actionFailed: 'ZPS/BMR berib bo‘lmadi',
    issued: 'ZPS/BMR berildi. Seriya navbatdan olib tashlandi.',
    modalTitle: 'ZPS/BMR berish',
    review: 'Rekvizitlarni tekshirish',
    check: 'Seriya raqami va rekvizitlar tekshirildi (SOP-11 p.5.1.4-5.1.5)',
    bmrNo: 'ZPS/BMR raqami',
    password: 'SKA elektron imzo paroli',
    submit: 'ZPS/BMR berish',
    close: 'Yopish',
    productionDate: 'Ishlab chiqarilgan sana',
    expiryDate: 'Yaroqlilik muddati',
    requestedBy: 'Kim so‘radi',
    requestedAt: 'Qachon so‘radi',
    sopHint: 'Imzolash orqali SKA seriya raqami va hujjat rekvizitlari to‘g‘riligini tasdiqlaydi.',
    meaning: 'ZPS/BMR ishlab chiqarish so‘rovi bo‘yicha berish',
    reason: 'Seriya rekvizitlari SKA tomonidan SOP-11 bo‘yicha tekshirildi',
    codePrefix: 'kod',
    draftTemplates: 'Tasdiqlash uchun BMR qoralamalari',
    pendingTemplates: 'Tasdiqlash kutilmoqda',
    templateEmpty: 'Tasdiqlashni kutayotgan BMR qoralamalari yo‘q.',
    approveTemplate: 'Shablonni tasdiqlash',
    templateApproved: 'BMR shabloni tasdiqlandi. Shu dori vositasi bo‘yicha oldingi tasdiqlangan versiya arxivga o‘tkazildi.',
    sections: 'bo‘lim',
  },
  en: {
    kicker: 'QA / SOP-11',
    title: 'ZPS/BMR issue',
    subtitle: 'QA verifies the series details and issues the ZPS/BMR upon production request.',
    refresh: 'Refresh',
    queue: 'Queue',
    waiting: 'Awaiting issue',
    batchNo: 'Series number',
    product: 'Drug product',
    batchSize: 'Series size',
    dates: 'Dates',
    requested: 'Requested by',
    open: 'Open',
    empty: 'No series awaiting ZPS issue.',
    loadFailed: 'Failed to load the ZPS/BMR queue',
    actionFailed: 'Failed to issue the ZPS/BMR',
    issued: 'ZPS/BMR issued. The series is removed from the queue.',
    modalTitle: 'ZPS/BMR issue',
    review: 'Details review',
    check: 'Series number and details verified (SOP-11 §5.1.4-5.1.5)',
    bmrNo: 'ZPS/BMR number',
    password: 'QA electronic signature password',
    submit: 'Issue ZPS/BMR',
    close: 'Close',
    productionDate: 'Production date',
    expiryDate: 'Expiry date',
    requestedBy: 'Requested by',
    requestedAt: 'Requested at',
    sopHint: 'By signing, QA confirms the correctness of the series number and document details.',
    meaning: 'ZPS/BMR issue upon production request',
    reason: 'Series details verified by QA per SOP-11',
    codePrefix: 'code',
    draftTemplates: 'Draft BMR templates for approval',
    pendingTemplates: 'Awaiting approval',
    templateEmpty: 'No draft BMR templates awaiting approval.',
    approveTemplate: 'Approve template',
    templateApproved: 'BMR template approved. The previous approved version for this product was archived.',
    sections: 'sections',
  },
} as const

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function BmrIssuancePage({ token, user }: BmrIssuancePageProps) {
  const { locale } = useI18n()
  const lang = locale === 'uz' ? 'uz' : locale === 'en' ? 'en' : 'ru'
  const text = copy[lang]
  const [items, setItems] = useState<BmrQueueItem[]>([])
  const [draftTemplates, setDraftTemplates] = useState<BmrTemplateListItem[]>([])
  const [active, setActive] = useState<BmrQueueItem | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [bmrNo, setBmrNo] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [queueResponse, templatesResponse] = await Promise.all([
        listBmrQueue(token),
        listBmrTemplates(token),
      ])
      setItems(queueResponse.items)
      setDraftTemplates(templatesResponse.templates.filter((tpl) => tpl.status === 'draft'))
    } catch (err) {
      setError(err instanceof Error ? err.message : text.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [text.loadFailed, token])

  useEffect(() => {
    void reload()
  }, [reload])

  const oldest = useMemo(() => items[0]?.bmr_requested_at ?? null, [items])

  async function approveTemplate(template: BmrTemplateListItem) {
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await approveBmrTemplate(token, template.id, null)
      setSuccess(text.templateApproved)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось утвердить шаблон BMR')
    } finally {
      setSubmitting(false)
    }
  }

  function openModal(item: BmrQueueItem) {
    setActive(item)
    setReviewed(false)
    setPassword('')
    setBmrNo(`BMR-${item.batch_no}`)
    setError(null)
    setSuccess(null)
  }

  function closeModal() {
    setActive(null)
    setReviewed(false)
    setPassword('')
    setBmrNo('')
  }

  async function submit() {
    if (!active || !reviewed || !password) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await issueProductionBmr(token, active.id, {
        username: user.username,
        password,
        meaning: 'Выдача ЗПС/BMR по запросу производства',
        reason: 'Реквизиты серии проверены ДОК по СОП-11',
        bmr_no: bmrNo || null,
      })
      closeModal()
      setSuccess(text.issued)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : text.actionFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{text.kicker}</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-slate-950">{text.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{text.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={15} />
          {text.refresh}
        </button>
      </div>

      {error && <Notice tone="error" text={error} />}
      {success && <Notice tone="success" text={success} />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <KpiCard icon={Inbox} label={text.waiting} value={items.length} />
        <KpiCard icon={FileSignature} label={text.queue} value={oldest ? formatDateTime(oldest, locale) : '-'} />
        <KpiCard icon={ShieldCheck} label={text.pendingTemplates} value={draftTemplates.length} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-[18px] font-semibold text-slate-950">{text.draftTemplates}</h2>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">{draftTemplates.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-4 py-3">{text.product}</th>
                <th className="px-4 py-3">BMR / ЗПС</th>
                <th className="px-4 py-3">Версия</th>
                <th className="px-4 py-3">Структура</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {draftTemplates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">{loading ? '...' : text.templateEmpty}</td>
                </tr>
              ) : (
                draftTemplates.map((template) => (
                  <tr key={template.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{template.product_name || '-'}</div>
                      <div className="font-mono text-xs text-slate-500">{template.product_code || '-'} · {template.market_code || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{template.title}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Черновик v{template.version}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{template.sections_count} {text.sections}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={submitting || template.sections_count === 0}
                        onClick={() => void approveTemplate(template)}
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ShieldCheck size={15} />
                        {text.approveTemplate}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-[18px] font-semibold text-slate-950">{text.queue}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1040px] w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-4 py-3">{text.batchNo}</th>
                <th className="px-4 py-3">{text.product}</th>
                <th className="px-4 py-3">{text.batchSize}</th>
                <th className="px-4 py-3">{text.dates}</th>
                <th className="px-4 py-3">{text.requested}</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <Inbox size={22} />
                    </div>
                    <div className="mt-3 text-sm text-slate-500">{loading ? '...' : text.empty}</div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold text-slate-950">{item.batch_no}</div>
                      <div className="text-xs text-slate-500">код {item.product_code}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{item.product_name}</div>
                      <div className="text-xs text-slate-500">{item.dosage_form || '-'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{item.batch_size} {item.batch_size_unit}</td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-slate-700">{formatDate(item.production_date, locale)}</div>
                      <div className="text-xs text-slate-500">{formatDate(item.expiry_date, locale)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-900">{item.requested_by_name || '-'}</div>
                      <div className="font-mono text-xs text-slate-500">{formatDateTime(item.bmr_requested_at, locale)}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openModal(item)}
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800"
                      >
                        <FileSignature size={15} />
                        {text.open}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{text.review}</p>
                <h2 className="mt-1 text-[20px] font-semibold text-slate-950">{text.modalTitle}</h2>
              </div>
              <button type="button" onClick={closeModal} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                <Info label={text.batchNo} value={active.batch_no} mono />
                <Info label={text.product} value={`${active.product_name}${active.dosage_form ? ` · ${active.dosage_form}` : ''}`} />
                <Info label={text.batchSize} value={`${active.batch_size} ${active.batch_size_unit}`} mono />
                <Info label={text.productionDate} value={formatDate(active.production_date, locale)} mono />
                <Info label={text.expiryDate} value={formatDate(active.expiry_date, locale)} mono />
                <Info label={text.requestedAt} value={formatDateTime(active.bmr_requested_at, locale)} mono />
                <Info label={text.requestedBy} value={active.requested_by_name || '-'} />
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="block font-medium text-slate-900">{text.check}</span>
                  <span className="block text-xs text-slate-500">{text.sopHint}</span>
                </span>
              </label>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={text.bmrNo}>
                  <input className="input font-mono" value={bmrNo} onChange={(event) => setBmrNo(event.target.value)} />
                </Field>
                <Field label={text.password}>
                  <input type="password" className="input" value={password} onChange={(event) => setPassword(event.target.value)} />
                </Field>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={closeModal} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {text.close}
              </button>
              <button
                type="button"
                disabled={!reviewed || !password || submitting}
                onClick={() => void submit()}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck size={16} />
                {text.submit}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Notice({ tone, text }: { tone: 'success' | 'error'; text: string }) {
  const isError = tone === 'error'
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
      isError ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
    }`}>
      {isError ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
      <span>{text}</span>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value }: { icon: typeof Inbox; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Icon size={18} />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
          <div className="mt-1 text-[22px] font-semibold text-slate-950">{value}</div>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-medium text-slate-950 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}
