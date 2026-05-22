import { useEffect, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { isScannerAgentAvailable, scanDocument, scanDocumentPdf } from '../../lib/scanner'
import { useI18n } from '../../i18n/I18nProvider'

interface ScanButtonProps {
  onScanned: (file: File) => void
  disabled?: boolean
  /** true — многостраничное сканирование в один PDF; иначе одна страница JPEG. */
  asPdf?: boolean
  /** Колбэк для показа ошибки сканера в UI вызывающей панели. */
  onError?: (message: string) => void
}

/**
 * Кнопка «Сканировать». Появляется активной только если на станции запущен
 * локальный сканер-агент B21. Иначе показывается неактивной с подсказкой —
 * оператор пользуется загрузкой файла рядом.
 */
export function ScanButton({ onScanned, disabled, asPdf, onError }: ScanButtonProps) {
  const { t } = useI18n()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void isScannerAgentAvailable().then((ok) => {
      if (active) setAvailable(ok)
    })
    return () => {
      active = false
    }
  }, [])

  if (available === null) return null // ещё проверяем — ничего не мигаем

  if (!available) {
    return (
      <button
        type="button"
        disabled
        title={t('scan.agentOffline')}
        className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 text-[13px] font-medium text-slate-400"
      >
        <ScanLine size={15} /> {t('scan.button')}
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true)
        try {
          const file = asPdf ? await scanDocumentPdf() : await scanDocument()
          onScanned(file)
        } catch (err) {
          onError?.(err instanceof Error ? err.message : t('scan.failed'))
        } finally {
          setBusy(false)
        }
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-cyan-300 bg-cyan-50 px-3 text-[13px] font-medium text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <ScanLine size={15} /> {busy ? t('scan.scanning') : t('scan.button')}
    </button>
  )
}
