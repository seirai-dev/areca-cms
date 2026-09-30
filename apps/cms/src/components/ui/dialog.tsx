import * as React from 'react'
import { cn } from '#/lib/utils'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { m } from '#/paraglide/messages'
import { X } from '@phosphor-icons/react'

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-scrim bg-scrim',
        'data-[state=open]:animate-dialog-scrim-in data-[state=closed]:animate-dialog-scrim-out',
        className,
      )}
      {...props}
    />
  )
}

const DIALOG_SIZES = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
} as const

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = 'md',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  size?: keyof typeof DIALOG_SIZES
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-[50%] left-[50%] z-overlay grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] overflow-y-auto',
          'translate-x-[-50%] translate-y-[-50%] gap-5 p-6 outline-none',
          'rounded-panel text-text-primary surface-float',
          'data-[state=open]:animate-dialog-panel-in data-[state=closed]:animate-dialog-panel-out motion-reduce:animate-none',
          DIALOG_SIZES[size],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 inline-flex size-7 items-center justify-center rounded-full bg-background-subtle text-icon-muted transition-colors outline-none hover:bg-action-secondary-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
          >
            <X weight="bold" />
            <span className="sr-only">{m.ui_close()}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1 pr-8 text-left', className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-title-2 text-text-primary', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-body text-text-secondary', className)}
      {...props}
    />
  )
}

export { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle }
