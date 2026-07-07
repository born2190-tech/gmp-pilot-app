// Временной барьер приёмки/отгрузки товара — СОП-209 Ф-16.
// Окна: отгрузка 09:00–11:00 и 14:00–16:00; приёмка 11:00–14:00 и 16:00–09:00.
// Барьер мягкий: не блокирует, а предупреждает (соблюдение — организационное).

export type BarrierKind = 'receive' | 'ship'

export function isOutsideBarrier(kind: BarrierKind, now: Date = new Date()): boolean {
  const h = now.getHours() + now.getMinutes() / 60
  const shipWindow = (h >= 9 && h < 11) || (h >= 14 && h < 16)
  const receiveWindow = (h >= 11 && h < 14) || h >= 16 || h < 9
  return kind === 'ship' ? !shipWindow : !receiveWindow
}
