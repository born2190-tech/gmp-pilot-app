import { createContext, useCallback, useContext, useRef, useState, type PropsWithChildren } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'

export type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastApi {
  /** Generic push. */
  push: (message: string, tone?: ToastTone) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const TONE_STYLE: Record<ToastTone, { ring: string; icon: typeof CheckCircle2; iconCls: string }> = {
  success: { ring: 'border-emerald-200', icon: CheckCircle2, iconCls: 'text-emerald-600' },
  error: { ring: 'border-rose-200', icon: XCircle, iconCls: 'text-rose-600' },
  info: { ring: 'border-slate-200', icon: Info, iconCls: 'text-slate-500' },
}

const AUTO_DISMISS_MS = 4500

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    if (!message) return
    seq.current += 1
    const id = seq.current
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
  }, [dismiss])

  const api = useRef<ToastApi>({
    push,
    success: (m: string) => push(m, 'success'),
    error: (m: string) => push(m, 'error'),
    info: (m: string) => push(m, 'info'),
  })
  // Keep closures fresh (push identity is stable via useCallback deps).
  api.current = {
    push,
    success: (m: string) => push(m, 'success'),
    error: (m: string) => push(m, 'error'),
    info: (m: string) => push(m, 'info'),
  }

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((toast) => {
          const style = TONE_STYLE[toast.tone]
          const Icon = style.icon
          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-white px-3.5 py-3 shadow-lg ring-1 ring-black/5 ${style.ring}`}
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${style.iconCls}`} />
              <p className="min-w-0 flex-1 break-words text-[13px] leading-snug text-slate-800">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-mr-1 -mt-1 shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}
