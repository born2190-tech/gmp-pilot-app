// Печать blob (PDF/изображение) — сразу открывает системный диалог печати.
// Грузим документ в скрытый iframe и вызываем print() после загрузки.
export function printBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
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
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch {
      // Фолбэк: если печать из iframe не вышла — открываем во вкладке.
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    cleanup()
  }

  document.body.appendChild(iframe)
}
