import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { listFgQuarantineLots, moveFgToStorage, releaseFgLot } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { FGQuarantineLotItem } from '../../types/inventory'
import type { CurrentUser } from '../../types/auth'

interface FGQuarantinePageProps {
  token: string
  user: CurrentUser
}

function formatDate(value: string | null, locale: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

export function FGQuarantinePage({ token, user }: FGQuarantinePageProps) {
  const { locale, t } = useI18n()
  const canRelease = user.permissions.includes('QA_DECISION')
  const canMove = user.permissions.includes('RECEIVE_FINISHED_GOODS')

  const [lots, setLots] = useState<FGQuarantineLotItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await listFgQuarantineLots(token)
      setLots(response.lots)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgQuarantine.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleRelease(lot: FGQuarantineLotItem) {
    const passport = window.prompt(t('fgQuarantine.passportPrompt'))
    if (!passport) return
    const password = window.prompt(t('fgQuarantine.passwordPrompt'))
    if (!password) return
    setError(null)
    setSuccess(null)
    try {
      const response = await releaseFgLot(token, lot.lot_id, {
        analytical_passport_no: passport,
        username: user.username,
        password,
        meaning: t('fgQuarantine.releaseMeaning'),
        reason: t('fgQuarantine.releaseMeaning'),
      })
      setLots(response.lots)
      setSuccess(t('fgQuarantine.released'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgQuarantine.actionFailed'))
    }
  }

  async function handleMove(lot: FGQuarantineLotItem) {
    const password = window.prompt(t('fgQuarantine.passwordPrompt'))
    if (!password) return
    setError(null)
    setSuccess(null)
    try {
      const response = await moveFgToStorage(token, lot.lot_id, {
        username: user.username,
        password,
        meaning: t('fgQuarantine.moveMeaning'),
        reason: t('fgQuarantine.moveMeaning'),
      })
      setLots(response.lots)
      setSuccess(t('fgQuarantine.moved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgQuarantine.actionFailed'))
    }
  }

  const columns = useMemo<ColumnDef<FGQuarantineLotItem>[]>(
    () => [
      {
        accessorKey: 'released',
        header: t('fgQuarantine.status'),
        cell: ({ row }) => {
          const released = row.original.released
          const tone = released ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          return (
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${tone}`}>
              {released ? t('fgQuarantine.statusReleased') : t('fgQuarantine.statusQuarantine')}
            </span>
          )
        },
      },
      { accessorKey: 'product_name', header: t('fgQuarantine.product') },
      { accessorKey: 'internal_lot', header: t('fgQuarantine.batch') },
      { accessorKey: 'quantity', header: t('fgQuarantine.quantity'), cell: ({ row }) => `${row.original.quantity} ${row.original.unit}` },
      { accessorKey: 'expiry_date', header: t('fgQuarantine.expiry'), cell: ({ row }) => formatDate(row.original.expiry_date, locale) },
      { accessorKey: 'analytical_passport_no', header: t('fgQuarantine.passport'), cell: ({ row }) => row.original.analytical_passport_no ?? '—' },
      {
        id: 'actions',
        header: t('fgQuarantine.actions'),
        cell: ({ row }) => {
          const lot = row.original
          return (
            <div className="flex gap-2">
              {canRelease && !lot.released && (
                <button className="btn-primary px-2 py-1 text-[12px]" onClick={() => handleRelease(lot)} type="button">
                  {t('fgQuarantine.release')}
                </button>
              )}
              {canMove && lot.released && (
                <button className="btn-primary px-2 py-1 text-[12px]" onClick={() => handleMove(lot)} type="button">
                  {t('fgQuarantine.move')}
                </button>
              )}
              {(!canRelease && !lot.released) || (!canMove && lot.released) ? <span className="text-slate-400">—</span> : null}
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, t, canRelease, canMove],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('fgQuarantine.trace')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('fgQuarantine.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('fgQuarantine.subtitle')}</p>
        </div>
        <button className="btn-secondary" onClick={loadData} type="button">
          {t('common.refresh')}
        </button>
      </div>

      {(error || success) && <div className={error ? 'alert-error' : 'alert-success'}>{error || success}</div>}

      <div className="flex justify-end">
        <input autoComplete="off" className="input w-80" onChange={(event) => setFilter(event.target.value)} placeholder={t('movements.search')} value={filter} />
      </div>
      <DataTable columns={columns} data={lots} emptyLabel={t('fgQuarantine.empty')} globalFilter={filter} isLoading={isLoading} />
    </div>
  )
}
