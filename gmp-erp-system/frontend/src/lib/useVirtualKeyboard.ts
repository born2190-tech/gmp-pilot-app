import { useEffect, useState } from 'react'

const FIELD_TAGS = /^(INPUT|TEXTAREA|SELECT)$/

function isField(el: Element | null): boolean {
  return !!el && FIELD_TAGS.test(el.tagName)
}

/**
 * true, когда на сенсорном устройстве открыта (или вот-вот откроется)
 * экранная клавиатура.
 *
 * Основной сигнал — фокус на поле ввода: клавиатура появляется ровно в этот
 * момент, и это обычное DOM-событие, работающее на любом Android. Замер
 * visualViewport оставлен как дополнительный сигнал, но полагаться только на
 * него нельзя: в части браузеров высота окна сжимается вместе с клавиатурой,
 * и разница всегда нулевая.
 *
 * На десктопе (мышь) всегда false — там прятать панели не нужно.
 */
export function useVirtualKeyboardOpen(): boolean {
  const [focused, setFocused] = useState(false)
  const [shrunk, setShrunk] = useState(false)

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (isField(e.target as Element)) setFocused(true)
    }
    const onFocusOut = () => {
      // Переход между полями идёт как focusout → focusin, поэтому решение
      // принимаем после того, как фокус устоялся.
      window.setTimeout(() => setFocused(isField(document.activeElement)), 80)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    const vv = window.visualViewport
    const sync = () => {
      if (vv) setShrunk(document.documentElement.clientHeight - vv.height > 150)
    }
    sync()
    vv?.addEventListener('resize', sync)

    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      vv?.removeEventListener('resize', sync)
    }
  }, [])

  // maxTouchPoints надёжнее media-запроса pointer:coarse: он есть во всех
  // Android-браузерах, тогда как media-признак иногда не выставляется.
  const touch =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  return (touch && focused) || shrunk
}
