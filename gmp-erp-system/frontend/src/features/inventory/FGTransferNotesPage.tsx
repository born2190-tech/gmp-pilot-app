import { useEffect, useMemo, useState } from 'react'
import { BellRing } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import {
  cancelFgTransferNote,
  createFgTransferNote,
  listCompletedBatchesForTransfer,
  listFgTransferNotes,
  receiveFgTransferNote,
} from '../../lib/api'
import { isOutsideBarrier } from '../../lib/timeBarrier'
import { useI18n } from '../../i18n/I18nProvider'
import type { CompletedBatchItem, FGTransferNoteItem, FGTransferNoteLineCreate } from '../../types/inventory'
import type { CurrentUser } from '../../types/auth'

interface FGTransferNotesPageProps {
  token: string
  user: CurrentUser
}

function formatDate(value: string | null, locale: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function FGTransferNotesPage({ token, user }: FGTransferNotesPageProps) {
  const { locale, t } = useI18n()
  const canIssue = user.permissions.includes('MANAGE_PRODUCTION')
  const canReceive = user.permissions.includes('RECEIVE_FINISHED_GOODS')

  const [notes, setNotes] = useState<FGTransferNoteItem[]>([])
  const [batches, setBatches] = useState<CompletedBatchItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [noteNo, setNoteNo] = useState('')
  const [fromWorkshop, setFromWorkshop] = useState('')
  const [corrugatedBoxes, setCorrugatedBoxes] = useState('')
  const [issueNotes, setIssueNotes] = useState('')
  const [lines, setLines] = useState<FGTransferNoteLineCreate[]>([{ description: '', quantity: 0, unit: 'упак' }])
  const [issuePassword, setIssuePassword] = useState('')

  const pendingCount = notes.filter((note) => note.status === 'issued').length

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const notesResponse = await listFgTransferNotes(token)
      setNotes(notesResponse.notes)
      if (canIssue) {
        const batchesResponse = await listCompletedBatchesForTransfer(token)
        const open = batchesResponse.batches.filter((b) => !b.has_note)
        setBatches(open)
        setSelectedBatchId((current) => current || open[0]?.id || '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgTransfer.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const selectedBatch = batches.find((b) => b.id === selectedBatchId)

  // Предзаполняем первую строку описанием продукта выбранной серии.
  useEffect(() => {
    if (!selectedBatch) return
    setLines((current) => {
      if (current.length === 1 && !current[0].description) {
        const label = [selectedBatch.product_name, selectedBatch.dosage_form].filter(Boolean).join(', ')
        return [{ ...current[0], description: label }]
      }
      return current
    })
  }, [selectedBatchId])

  function updateLine(index: number, patch: Partial<FGTransferNoteLineCreate>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  function addLine() {
    setLines((current) => [...current, { description: '', quantity: 0, unit: 'упак' }])
  }

  function removeLine(index: number) {
    setLines((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current))
  }

  const issueReady =
    !!selectedBatch &&
    issuePassword.length > 0 &&
    lines.every((line) => line.description.trim().length > 0 && line.quantity > 0)

  async function submitIssue() {
    if (!selectedBatch || !issueReady) return
    setError(null)
    setSuccess(null)
    try {
      await createFgTransferNote(token, {
        production_batch_id: selectedBatch.id,
        note_no: noteNo.trim() || undefined,
        from_workshop: fromWorkshop.trim() || undefined,
        corrugated_boxes: corrugatedBoxes.trim() ? Number(corrugatedBoxes) : undefined,
        notes: issueNotes.trim() || undefined,
        lines: lines.map((line) => ({ description: line.description.trim(), quantity: Number(line.quantity), unit: line.unit || 'упак' })),
        username: user.username,
        password: issuePassword,
        meaning: t('fgTransfer.signatureMeaning'),
        reason: issueNotes.trim() || t('fgTransfer.signatureMeaning'),
      })
      setSuccess(t('fgTransfer.issued'))
      setNoteNo('')
      setFromWorkshop('')
      setCorrugatedBoxes('')
      setIssueNotes('')
      setLines([{ description: '', quantity: 0, unit: 'упак' }])
      setIssuePassword('')
      setSelectedBatchId('')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgTransfer.actionFailed'))
    }
  }

  async function handleReceive(note: FGTransferNoteItem) {
    const password = window.prompt(t('fgTransfer.passwordPrompt'))
    if (!password) return
    setError(null)
    setSuccess(null)
    try {
      await receiveFgTransferNote(token, note.id, {
        username: user.username,
        password,
        meaning: t('fgTransfer.receiveMeaning'),
        reason: t('fgTransfer.receiveMeaning'),
      })
      setSuccess(t('fgTransfer.received'))
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgTransfer.actionFailed'))
    }
  }

  async function handleCancel(note: FGTransferNoteItem) {
    const password = window.prompt(t('fgTransfer.passwordPrompt'))
    if (!password) return
    setError(null)
    setSuccess(null)
    try {
      await cancelFgTransferNote(token, note.id, {
        username: user.username,
        password,
        meaning: t('fgTransfer.cancelMeaning'),
        reason: t('fgTransfer.cancelMeaning'),
      })
      setSuccess(t('fgTransfer.cancelled'))
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgTransfer.actionFailed'))
    }
  }

  function statusLabel(status: string) {
    if (status === 'issued') return t('fgTransfer.statusIssued')
    if (status === 'received') return t('fgTransfer.statusReceived')
    if (status === 'cancelled') return t('fgTransfer.statusCancelled')
    return status
  }

  const columns = useMemo<ColumnDef<FGTransferNoteItem>[]>(
    () => [
      {
        accessorKey: 'status',
        header: t('fgTransfer.colStatus'),
        cell: ({ row }) => {
          const s = row.original.status
          const tone = s === 'received' ? 'bg-emerald-50 text-emerald-700' : s === 'cancelled' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'
          return <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${tone}`}>{statusLabel(s)}</span>
        },
      },
      { accessorKey: 'note_no', header: t('fgTransfer.colNoteNo') },
      { accessorKey: 'product_name', header: t('fgTransfer.colProduct') },
      { accessorKey: 'batch_no', header: t('fgTransfer.colBatch') },
      { accessorKey: 'expiry_date', header: t('fgTransfer.colExpiry'), cell: ({ row }) => formatDate(row.original.expiry_date, locale) },
      { accessorKey: 'from_workshop', header: t('fgTransfer.colWorkshop') },
      { accessorKey: 'corrugated_boxes', header: t('fgTransfer.colBoxes'), cell: ({ row }) => row.original.corrugated_boxes ?? '—' },
      { accessorKey: 'issued_at', header: t('fgTransfer.colIssuedAt'), cell: ({ row }) => formatDateTime(row.original.issued_at, locale) },
      {
        id: 'lines',
        header: t('fgTransfer.colLines'),
        cell: ({ row }) => row.original.lines.map((line) => `${line.description}: ${line.quantity} ${line.unit}`).join('; '),
      },
      {
        id: 'actions',
        header: t('fgTransfer.colActions'),
        cell: ({ row }) => {
          const note = row.original
          if (note.status !== 'issued') return <span className="text-slate-400">—</span>
          return (
            <div className="flex gap-2">
              {canReceive && (
                <button className="btn-primary px-2 py-1 text-[12px]" onClick={() => handleReceive(note)} type="button">
                  {t('fgTransfer.receive')}
                </button>
              )}
              {canIssue && (
                <button className="btn-secondary px-2 py-1 text-[12px]" onClick={() => handleCancel(note)} type="button">
                  {t('fgTransfer.cancel')}
                </button>
              )}
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, t, canReceive, canIssue],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('fgTransfer.trace')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('fgTransfer.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('fgTransfer.subtitle')}</p>
        </div>
        <button className="btn-secondary" onClick={loadData} type="button">
          {t('common.refresh')}
        </button>
      </div>

      {(error || success) && <div className={error ? 'alert-error' : 'alert-success'}>{error || success}</div>}

      {canReceive && isOutsideBarrier('receive') && (
        <div className="rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-[13px] text-amber-800">
          {t('fgBarrier.receive')}
        </div>
      )}

      {canReceive && pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          <BellRing size={18} className="flex-shrink-0" />
          {t('fgTransfer.pendingBanner', { count: pendingCount })}
        </div>
      )}

      {canIssue && (
        <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">{t('fgTransfer.issueSection')}</h2>
          <div className="grid gap-3 xl:grid-cols-3">
            <label className="label xl:col-span-2">
              {t('fgTransfer.selectBatch')}
              <select className="input" onChange={(event) => setSelectedBatchId(event.target.value)} value={selectedBatchId}>
                <option value="">—</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batch_no} · {b.product_name} · {formatDate(b.production_date, locale)}
                  </option>
                ))}
              </select>
              {batches.length === 0 && <span className="mt-1 text-[12px] text-slate-500">{t('fgTransfer.noBatches')}</span>}
            </label>
            <label className="label">
              {t('fgTransfer.noteNo')}
              <input autoComplete="off" className="input" onChange={(event) => setNoteNo(event.target.value)} placeholder={t('fgTransfer.noteNoAuto')} value={noteNo} />
            </label>
            <label className="label">
              {t('fgTransfer.fromWorkshop')}
              <input autoComplete="off" className="input" onChange={(event) => setFromWorkshop(event.target.value)} value={fromWorkshop} />
            </label>
            <label className="label">
              {t('fgTransfer.corrugatedBoxes')}
              <input autoComplete="off" className="input" min="0" onChange={(event) => setCorrugatedBoxes(event.target.value)} type="number" value={corrugatedBoxes} />
            </label>
            <label className="label xl:col-span-2">
              {t('fgTransfer.notes')}
              <input autoComplete="off" className="input" onChange={(event) => setIssueNotes(event.target.value)} value={issueNotes} />
            </label>
          </div>

          <div className="space-y-2">
            {lines.map((line, index) => (
              <div className="grid gap-2 md:grid-cols-[1fr_140px_120px_90px]" key={index}>
                <input autoComplete="off" className="input" onChange={(event) => updateLine(index, { description: event.target.value })} placeholder={t('fgTransfer.lineDescription')} value={line.description} />
                <input autoComplete="off" className="input" min="0" onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} placeholder={t('fgTransfer.lineQty')} type="number" value={line.quantity || ''} />
                <input autoComplete="off" className="input" onChange={(event) => updateLine(index, { unit: event.target.value })} placeholder={t('fgTransfer.lineUnit')} value={line.unit} />
                <button className="btn-secondary" disabled={lines.length <= 1} onClick={() => removeLine(index)} type="button">
                  {t('fgTransfer.removeLine')}
                </button>
              </div>
            ))}
            <button className="btn-secondary" onClick={addLine} type="button">
              {t('fgTransfer.addLine')}
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="label md:max-w-xs">
              {t('common.password')}
              <input autoComplete="off" className="input" onChange={(event) => setIssuePassword(event.target.value)} type="password" value={issuePassword} />
            </label>
            <button className="btn-primary" disabled={!issueReady} onClick={submitIssue} type="button">
              {t('fgTransfer.issue')}
            </button>
          </div>
        </section>
      )}

      <div className="flex justify-end">
        <input autoComplete="off" className="input w-80" onChange={(event) => setFilter(event.target.value)} placeholder={t('movements.search')} value={filter} />
      </div>
      <DataTable columns={columns} data={notes} emptyLabel={t('fgTransfer.empty')} globalFilter={filter} isLoading={isLoading} />
    </div>
  )
}
