import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * Looping art only runs while it is on screen, and never when the visitor
 * prefers reduced motion. `still` tells the art to show its final frame.
 */
export function useActive<T extends Element>() {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  const reduced = useReducedMotion() ?? false
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      {
        rootMargin: '0px 0px -10% 0px',
      },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { ref, active: visible && !reduced, visible, still: reduced }
}

/** A step counter that advances every `ms` while `active`. */
export function useTicker(active: boolean, steps: number, ms: number) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setStep((s) => (s + 1) % steps), ms)
    return () => clearInterval(id)
  }, [active, steps, ms])
  return step
}
