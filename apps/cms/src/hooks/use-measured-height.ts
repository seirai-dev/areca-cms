import { useEffect, useState } from 'react'

/**
 * Tracks an element's rendered height (0 until it exists). Pass the element
 * from a callback ref / state so late-mounting elements are observed too.
 */
export function useMeasuredHeight(element: HTMLElement | null) {
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (!element) {
      setHeight(0)
      return
    }
    const update = () => setHeight(element.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return height
}
