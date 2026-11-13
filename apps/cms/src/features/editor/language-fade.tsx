import type { ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'

import { EASE_STANDARD } from '#/lib/motion'

/**
 * Cross-fades the field area when the language changes (opacity only, about
 * 140ms). Keyed by language, so each switch remounts the fields. Under
 * reduced motion the new content simply appears.
 */
export function LanguageFade({
  locale,
  enabled = true,
  children,
}: {
  locale: string
  /** False renders the children untouched (single-language sites). */
  enabled?: boolean
  children: ReactNode
}) {
  const reduce = useReducedMotion()
  if (!enabled) return <>{children}</>
  return (
    <motion.div
      key={locale}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14, ease: EASE_STANDARD }}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)]"
    >
      {children}
    </motion.div>
  )
}
