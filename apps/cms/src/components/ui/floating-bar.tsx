import * as React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { useRegisterOverlay } from '#/components/ui/overlay-registry'
import { FADE, SPRING_PANEL } from '#/lib/motion'
import { cn } from '#/lib/utils'

/**
 * Bottom-centre floating bar that springs up from below (brief §2.2, §3.4):
 * the settings save pill ("Unsaved changes · Discard · Save") and the
 * selection bar ("3 selected · …"). Fixed to the viewport, centred over the
 * content column (offset by the sidebar on desktop), above the mobile tab bar.
 */
export function FloatingBar({
  open,
  children,
  className,
  label,
  fullWidthOnMobile = false,
  ...props
}: {
  open: boolean
  children: React.ReactNode
  className?: string
  /** Below md, span the gutters instead of floating as a centred pill. */
  fullWidthOnMobile?: boolean
  /** Accessible name for the toolbar region. */
  label?: string
  'data-testid'?: string
}) {
  const reduce = useReducedMotion()
  useRegisterOverlay(open ? { kind: 'bar' } : null)
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="floating-bar"
          role="toolbar"
          aria-label={label}
          data-slot="floating-bar"
          data-testid={props['data-testid']}
          className={cn(
            // Centring uses the translate property, so the spring's transform
            // on this element does not undo it.
            'fixed bottom-[calc(1rem+var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom))] left-1/2 z-floating flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1.5 rounded-full py-1.5 pr-1.5 pl-4 surface-float',
            'md:left-[calc(50%+var(--shell-sidebar-offset,0px)/2)]',
            fullWidthOnMobile &&
              'max-md:right-4 max-md:left-4 max-md:max-w-none max-md:translate-x-0 max-md:flex-wrap max-md:rounded-panel',
            className,
          )}
          initial={reduce ? { opacity: 0 } : { y: 24, opacity: 0, scale: 0.96 }}
          animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { y: 24, opacity: 0, scale: 0.96 }}
          transition={reduce ? FADE : SPRING_PANEL}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** Text on the left of a floating bar ("Unsaved changes", "3 selected"). */
export function FloatingBarLabel({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'mr-2 truncate text-[13.5px] leading-5 font-medium text-text-primary tnum',
        className,
      )}
      {...props}
    />
  )
}

/** Hairline between groups of actions in a floating bar. */
export function FloatingBarDivider({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('mx-1 h-5 w-px bg-border-default', className)}
    />
  )
}
