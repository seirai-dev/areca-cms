import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'

import { EASE_STANDARD } from '#/lib/motion'

/**
 * Staggered reveal for lists and grids (brief §4.5): opacity plus 6px rise,
 * 30ms per item, capped at 10 items (the rest appear with the 10th). Reduced
 * motion: no animation.
 *
 *   <Stagger as="ul" className="grid …">
 *     {items.map((item) => <StaggerItem as="li" key={item.id}>…</StaggerItem>)}
 *   </Stagger>
 */
const StaggerIndex = React.createContext<{ register: () => number } | null>(
  null,
)

export function Stagger({
  as = 'div',
  className,
  children,
  ...props
}: {
  as?: 'div' | 'ul' | 'ol' | 'section'
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'children'>) {
  const counter = React.useRef(0)
  counter.current = 0
  const value = React.useMemo(() => ({ register: () => counter.current++ }), [])
  const Comp = as
  return (
    <StaggerIndex.Provider value={value}>
      <Comp className={className} {...props}>
        {children}
      </Comp>
    </StaggerIndex.Provider>
  )
}

const ITEM_TAGS = { div: motion.div, li: motion.li, article: motion.article }

export function StaggerItem({
  as = 'div',
  className,
  children,
  index,
  ...props
}: {
  as?: 'div' | 'li' | 'article'
  className?: string
  children: React.ReactNode
  /** Explicit position; otherwise render order is used. */
  index?: number
} & Omit<
  React.HTMLAttributes<HTMLElement>,
  'children' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'
>) {
  const reduce = useReducedMotion()
  const ctx = React.useContext(StaggerIndex)
  const [position] = React.useState(() => index ?? ctx?.register() ?? 0)
  const Comp = ITEM_TAGS[as]
  if (reduce) {
    const Plain = as
    return (
      <Plain className={className} {...props}>
        {children}
      </Plain>
    )
  }
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        ease: EASE_STANDARD,
        delay: Math.min(position, 9) * 0.03,
      }}
      {...props}
    >
      {children}
    </Comp>
  )
}
