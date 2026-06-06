// Рендер PDF в canvas через PDF.js — полностью в странице, не зависит от
// встроенного просмотрщика браузера и менеджеров загрузок (которые
// перехватывают PDF). Используется для предпросмотра сканов (извещение Ф-14,
// аналит. лист, акт отбора и т.п.).
import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export function PdfView({ url, className }: { url: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    setError(null)
    setLoading(true)

    const task = pdfjs.getDocument({ url })
    task.promise
      .then(async (doc) => {
        for (let i = 1; i <= doc.numPages; i += 1) {
          if (cancelled) return
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = 'mx-auto mb-2 max-w-full bg-white shadow'
          container.appendChild(canvas)
          const ctx = canvas.getContext('2d')
          if (ctx) await page.render({ canvas, canvasContext: ctx, viewport }).promise
        }
        if (!cancelled) setLoading(false)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'PDF render error')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      task.destroy?.()
    }
  }, [url])

  if (error) {
    return <div className="flex h-full items-center justify-center p-4 text-center text-sm text-rose-700">{error}</div>
  }
  return (
    <div className={className}>
      {loading && <div className="p-4 text-center text-sm text-slate-500">…</div>}
      <div ref={containerRef} />
    </div>
  )
}
