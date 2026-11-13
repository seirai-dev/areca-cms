import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'
import { X } from '@phosphor-icons/react'

import { useRegisterOverlay } from '#/components/ui/overlay-registry'
import { useIsMobile } from '#/hooks/use-mobile'
import { FADE, SPRING_PANEL } from '#/lib/motion'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

const WIDTHS = {
  md: 'sm:w-[480px]',
  lg: 'sm:w-[560px]',
  xl: 'sm:w-[720px]',
} as const

/** Panel width plus its 8px inset, for keeping toasts clear of it. */
const FOOTPRINT = { md: 488, lg: 568, xl: 728 } as const

/**
 * Right slide-over panel (brief §2, §3.6, §3.7): 480px, inset 8px from the
 * viewport with a 20px outer radius, springs in from the right. Below 768px
 * it becomes a full-height bottom sheet. Traps focus and returns it on close
 * (Radix Dialog). The body scrolls; header and footer stay put.
 */
export function SlideOver({
  open,
  onOpenChange,
  title,
  description,
  headerStart,
  headerActions,
  footer,
  size = 'md',
  nested = false,
  className,
  bodyClassName,
  bodyRef,
  children,
  hideTitle = false,
  fit = false,
  wrapDescription = false,
  ...props
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** Rendered before the title (an icon tile, a back button). */
  headerStart?: React.ReactNode
  /** Rendered between the title and the close button. */
  headerActions?: React.ReactNode
  footer?: React.ReactNode
  size?: keyof typeof WIDTHS
  /** A panel opened from inside another panel: lighter scrim. */
  nested?: boolean
  className?: string
  bodyClassName?: string
  bodyRef?: React.Ref<HTMLDivElement>
  children?: React.ReactNode
  /** Keep the title for screen readers only. */
  hideTitle?: boolean
  /** As a phone bottom sheet, size to the content instead of full height. */
  fit?: boolean
  /** Let a long description wrap instead of truncating it to one line. */
  wrapDescription?: boolean
  'data-testid'?: string
}) {
  const mobile = useIsMobile()
  const reduce = useReducedMotion()
  useRegisterOverlay(
    open
      ? mobile
        ? { kind: 'sheet' }
        : { kind: 'panel', width: FOOTPRINT[size] }
      : null,
  )

  const hidden = reduce
    ? { opacity: 0 }
    : mobile
      ? { y: '100%' }
      : { x: 'calc(100% + 16px)' }
  const shown = reduce ? { opacity: 1 } : mobile ? { y: 0 } : { x: 0 }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className={cn(
                  'fixed inset-0 z-scrim',
                  nested ? 'bg-scrim/40' : 'bg-scrim',
                )}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={FADE}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                data-slot="slide-over"
                data-testid={props['data-testid']}
                className={cn(
                  'fixed z-overlay flex flex-col overflow-hidden text-text-primary outline-none surface-float',
                  mobile
                    ? cn(
                        'inset-x-0 bottom-0 rounded-t-panel pb-[env(safe-area-inset-bottom)]',
                        fit ? 'max-h-[calc(100dvh-0.75rem)]' : 'top-3',
                      )
                    : cn(
                        'top-2 right-2 bottom-2 w-[calc(100vw-1rem)] rounded-panel',
                        WIDTHS[size],
                      ),
                  className,
                )}
                initial={hidden}
                animate={shown}
                exit={hidden}
                transition={reduce ? FADE : SPRING_PANEL}
              >
                {mobile ? (
                  <span
                    aria-hidden="true"
                    className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong"
                  />
                ) : null}
                <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
                  {headerStart}
                  <div className="grid min-w-0 flex-1 gap-0.5 pt-0.5">
                    <DialogPrimitive.Title
                      className={cn(
                        'truncate text-title-2 text-text-primary',
                        hideTitle && 'sr-only',
                      )}
                    >
                      {title}
                    </DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description
                        className={cn(
                          'text-callout text-text-secondary',
                          !wrapDescription && 'truncate',
                        )}
                      >
                        {description}
                      </DialogPrimitive.Description>
                    ) : (
                      <DialogPrimitive.Description className="sr-only">
                        {typeof title === 'string' ? title : ''}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                  {headerActions}
                  <DialogPrimitive.Close
                    className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-background-subtle text-icon-muted transition-colors outline-none hover:bg-action-secondary-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    data-testid="slide-over-close"
                  >
                    <X weight="bold" className="size-3.5" />
                    <span className="sr-only">{m.ui_close()}</span>
                  </DialogPrimitive.Close>
                </div>
                <div
                  ref={bodyRef}
                  data-slot="slide-over-body"
                  className={cn(
                    'scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 pb-6',
                    bodyClassName,
                  )}
                >
                  {children}
                </div>
                {footer ? (
                  <div className="shrink-0 border-t border-border-default px-5 py-4">
                    {footer}
                  </div>
                ) : null}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
