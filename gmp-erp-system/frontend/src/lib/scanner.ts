// Мост к локальному сканер-агенту B21 (см. scanner-agent/agent.py).
// Агент слушает http://127.0.0.1:8765. Если он не запущен — функции
// бросают/возвращают признак недоступности, и UI откатывается на загрузку файла.

const AGENT_BASE = 'http://127.0.0.1:8765'

export interface ScanResult {
  filename: string
  mime_type: string
  data_base64: string
  size: number
}

/** Проверка, что агент запущен (короткий таймаут, чтобы не подвешивать UI). */
export async function isScannerAgentAvailable(timeoutMs = 1200): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(`${AGENT_BASE}/status`, { signal: ctrl.signal })
    if (!resp.ok) return false
    const data = await resp.json().catch(() => null)
    return data?.agent === 'b21-scanner-agent'
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

/** Запускает сканирование одной страницы. Открывает окно WIA на станции. */
export async function scanDocument(): Promise<File> {
  const resp = await fetch(`${AGENT_BASE}/scan`, { method: 'POST' })
  if (!resp.ok) {
    const detail = await resp.json().catch(() => null)
    throw new Error(detail?.detail || `Сканер: HTTP ${resp.status}`)
  }
  const result: ScanResult = await resp.json()
  const bytes = base64ToBytes(result.data_base64)
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: result.mime_type || 'image/jpeg' })
  return new File([blob], result.filename || 'scan.jpg', { type: result.mime_type || 'image/jpeg' })
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
