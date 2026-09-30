import * as React from 'react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import { X } from '@phosphor-icons/react'

import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * Radix-driven drawer with CSS keyframes. New screens use `SlideOver`
 * (spring, bottom sheet on mobile); `Sheet` stays for the schema editor,
 * pickers and screens that are not rewritten yet. Same look: inset panel,
 * 20px outer radius, hairline, float shadow.
 */
function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-scrim bg-scrim',
        'data-[state=open]:animate-dialog-scrim-in data-[state=closed]:animate-dialog-scrim-out',
        className,
      )}
      {...props}
    />
  )
}

const SHEET_SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-[480px]',
  lg: 'sm:max-w-[640px]',
  xl: 'sm:max-w-3xl',
  full: 'sm:max-w-none',
} as const

/** Shared close control for sheets, panels and dialogs. */
function PanelCloseButton({ className }: { className?: string }) {
  return (
    <SheetPrimitive.Close
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-background-subtle text-icon-muted transition-colors outline-none hover:bg-action-secondary-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        className,
      )}
    >
      <X weight="bold" className="size-3.5" />
      <span className="sr-only">{m.ui_close()}</span>
    </SheetPrimitive.Close>
  )
}

/**
 * `anchor` is kept for API compatibility; the shell has no top navbar on
 * desktop, so side drawers always use the full viewport height (inset 8px).
 */
function SheetContent({
  className,
  children,
  side = 'right',
  size = 'md',
  anchor: _anchor = 'navbar',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  size?: keyof typeof SHEET_SIZES
  anchor?: 'navbar' | 'viewport'
  showCloseButton?: boolean
}) {
  const vertical = side === 'right' || side === 'left'

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-overlay flex flex-col overflow-hidden text-text-primary outline-none surface-float',
          'motion-reduce:animate-none',
          vertical &&
            'inset-y-0 h-dvh w-full sm:inset-y-2 sm:h-[calc(100dvh-1rem)]',
          side === 'right' &&
            cn(
              'right-0 sm:right-2 sm:rounded-panel',
              SHEET_SIZES[size],
              'data-[state=open]:animate-drawer-right-in data-[state=closed]:animate-drawer-right-out',
            ),
          side === 'left' &&
            cn(
              'left-0 sm:left-2 sm:rounded-panel',
              SHEET_SIZES[size],
              'data-[state=open]:animate-drawer-left-in data-[state=closed]:animate-drawer-left-out',
            ),
          side === 'top' &&
            'inset-x-0 top-0 h-auto rounded-b-panel data-[state=open]:animate-drawer-bottom-in data-[state=closed]:animate-drawer-bottom-out',
          side === 'bottom' &&
            'inset-x-0 bottom-0 h-auto max-h-[92dvh] rounded-t-panel pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-drawer-bottom-in data-[state=closed]:animate-drawer-bottom-out',
          className,
        )}
        {...props}
      >
        {side === 'bottom' ? (
          <span
            aria-hidden="true"
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong"
          />
        ) : null}
        {children}
        {showCloseButton ? (
          <PanelCloseButton className="absolute top-4 right-4" />
        ) : null}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

/** Scrollable middle region of a drawer, between header and footer. */
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        'scroll-quiet min-h-0 flex-1 overflow-y-auto p-5',
        className,
      )}
      {...props}
    />
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        'flex shrink-0 flex-col gap-1 border-b border-border-default px-5 pt-5 pb-4 pr-14',
        className,
      )}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-title-2 text-text-primary', className)}
      {...props}
    />
  )
}

export { Sheet, SheetContent, SheetBody, SheetHeader, SheetTitle }
