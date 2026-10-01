/**
 * Motion presets (brief §4.5). Nothing exceeds ~250ms perceived; every use
 * checks `useReducedMotion()` and collapses to an instant change or a fade.
 */
export const SPRING_PANEL = {
  type: 'spring',
  stiffness: 420,
  damping: 36,
  mass: 0.9,
} as const

export const SPRING_SMALL = {
  type: 'spring',
  stiffness: 520,
  damping: 40,
} as const

export const EASE_STANDARD = [0.2, 0.8, 0.2, 1] as const

export const FADE = { duration: 0.15, ease: EASE_STANDARD } as const
