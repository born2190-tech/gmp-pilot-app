import { useEffect, useState } from 'react'

/**
 * true, когда на планшете/телефоне открыта экранная клавиатура.
 *
 * Нужно для BMR: клавиатура съедает до 60% экрана, и закреплённые внизу
 * панели (Сохранить/PDF, «Следующее поле») отнимают последние пиксели —
 * заполняемое поле становится не видно. При открытой клавиатуре такие
 * панели прячем.
 *
 * Определяем через visualViewport: при появлении клавиатуры видимая часть
 * окна становится заметно ниже layout-окна.
 */
export function useVirtualKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => setOpen(window.innerHeight - vv.height > 150)
    sync()
    vv.addEventListener('resize', sync)
    return () => vv.removeEventListener('resize', sync)
  }, [])

  return open
}
