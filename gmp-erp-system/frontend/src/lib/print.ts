// Печать blob (PDF/изображение) — сразу открывает системный диалог печати.
// PDF-viewer Chrome иногда печатает пустой лист, если iframe имеет 0x0.
// Поэтому держим iframe отрисованным вне экрана и даём viewer короткую паузу.
export function printBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '1024px'
  iframe.style.height = '1448px'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  iframe.style.pointerEvents = 'none'
  iframe.src = url

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    window.setTimeout(() => {
      try {
        document.body.removeChild(iframe)
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url)
    }, 60_000)
  }

  iframe.onload = () => {
    window.setTimeout(() => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } catch {
        // Фолбэк: если печать из iframe не вышла — открываем во вкладке.
        window.open(url, '_blank', 'noopener,noreferrer')
      }
      cleanup()
    }, blob.type === 'application/pdf' ? 700 : 100)
  }

  document.body.appendChild(iframe)
}
