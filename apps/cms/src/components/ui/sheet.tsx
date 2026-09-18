import * as React from 'react'
import { cn } from '#/lib/utils'
import { Dialog as SheetPrimitive } from 'radix-ui'

import { m } from '#/paraglide/messages'
import { X } from '@phosphor-icons/react'

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
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
        'fixed inset-0 z-scrim bg-scrim backdrop-blur-[2px]',
        'data-[state=open]:animate-dialog-scrim-in data-[state=closed]:animate-dialog-scrim-out',
        className,
      )}
      {...props}
    />
  )
}

const SHEET_SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-xl',
  xl: 'sm:max-w-3xl',
  full: 'sm:max-w-none',
} as const

/**
 * `anchor="navbar"` keeps a side drawer below the sticky navbar (reading
 * `--navbar-height`, 58px by default); `anchor="viewport"` covers the full
 * height. Top and bottom drawers ignore the anchor.
 */
function SheetContent({
  className,
  children,
  side = 'right',
  size = 'md',
  anchor = 'navbar',
  showCloseButton = true,
  style,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  size?: keyof typeof SHEET_SIZES
  anchor?: 'navbar' | 'viewport'
  showCloseButton?: boolean
}) {
  const vertical = side === 'right' || side === 'left'
  const anchored = vertical && anchor === 'navbar'

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        data-anchor={anchor}
        style={
          anchored
            ? {
                top: 'var(--navbar-height, 58px)',
                height: 'calc(100dvh - var(--navbar-height, 58px))',
                ...style,
              }
            : style
        }
        className={cn(
          'fixed z-overlay flex flex-col bg-background-elevated text-text-primary shadow-2xl',
          'motion-reduce:animate-none',
          vertical && 'w-full',
          side === 'right' &&
            cn(
              'right-0 border-l border-border-default',
              !anchored && 'inset-y-0 h-full',
              SHEET_SIZES[size],
              'data-[state=open]:animate-drawer-right-in data-[state=closed]:animate-drawer-right-out',
            ),
          side === 'left' &&
            cn(
              'left-0 border-r border-border-default',
              !anchored && 'inset-y-0 h-full',
              SHEET_SIZES[size],
              'data-[state=open]:animate-drawer-left-in data-[state=closed]:animate-drawer-left-out',
            ),
          side === 'top' &&
            'inset-x-0 top-0 h-auto rounded-b-surface border-b border-border-default data-[state=open]:animate-drawer-bottom-in data-[state=closed]:animate-drawer-bottom-out',
          side === 'bottom' &&
            'inset-x-0 bottom-0 h-auto rounded-t-surface border-t border-border-default data-[state=open]:animate-drawer-bottom-in data-[state=closed]:animate-drawer-bottom-out',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="absolute top-4 right-4 inline-flex size-7 items-center justify-center rounded-control text-icon-muted transition-colors outline-none hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong disabled:pointer-events-none">
            <X className="size-4" />
            <span className="sr-only">{m.ui_close()}</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

/** Scrollable middle region of a drawer, between header and footer. */
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn('min-h-0 flex-1 overflow-y-auto p-5', className)}
      {...props}
    />
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        'flex shrink-0 flex-col gap-1.5 border-b border-border-subtle p-5',
        className,
      )}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'mt-auto flex shrink-0 flex-col gap-2 border-t border-border-subtle p-5',
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
      className={cn('text-ds-heading-5 text-text-primary', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-ds-body-sm text-text-secondary', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetBody,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
