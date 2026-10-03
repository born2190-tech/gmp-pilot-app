import { useEffect, useState } from 'react'

/**
 * true, когда на планшете/телефоне открыта экранная клавиатура.
 *
 * Сравниваем visualViewport (видимая область) с layout-вьюпортом
 * (documentElement.clientHeight): клавиатура уменьшает только первый, а
 * изменение размера окна — оба. Поэтому ресайз окна на десктопе не даёт
 * ложного срабатывания.
 */
export function useVirtualKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const sync = () => {
      const layoutHeight = document.documentElement.clientHeight
      setOpen(layoutHeight - vv.height > 150)
    }

    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [])

  return open
}
