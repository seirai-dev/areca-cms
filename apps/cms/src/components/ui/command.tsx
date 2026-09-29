import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { MagnifyingGlass } from '@phosphor-icons/react'

import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-card bg-background-elevated text-text-primary',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Spotlight-style dialog (brief §3.12): centred, 640px, large input, grouped
 * results. Positioned in the upper third so results grow downward.
 */
function CommandDialog({
  title = m.ui_command_palette(),
  description = m.ui_command_search(),
  children,
  className,
  commandProps,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  title?: string
  description?: string
  className?: string
  /** Props for the inner cmdk root (filter, shouldFilter, loop…). */
  commandProps?: React.ComponentProps<typeof CommandPrimitive>
  showCloseButton?: boolean
}) {
  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-scrim bg-scrim data-[state=closed]:animate-dialog-scrim-out data-[state=open]:animate-dialog-scrim-in" />
        <DialogPrimitive.Content
          data-slot="command-dialog"
          className={cn(
            'fixed top-[12vh] left-1/2 z-overlay w-[calc(100vw-1.5rem)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-panel outline-none surface-float',
            'data-[state=closed]:animate-dialog-panel-out data-[state=open]:animate-dialog-panel-in',
            'max-sm:top-3',
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
          <Command
            loop
            className="rounded-panel bg-transparent"
            {...commandProps}
          >
            {children}
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function CommandInput({
  className,
  size = 'md',
  trailing,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive.Input>, 'size'> & {
  size?: 'md' | 'lg'
  trailing?: React.ReactNode
}) {
  return (
    <div
      data-slot="command-input-wrapper"
      className={cn(
        'flex items-center gap-3 border-b border-border-default',
        size === 'lg' ? 'h-14 px-5' : 'h-11 px-3',
      )}
    >
      <MagnifyingGlass
        className={cn(
          'shrink-0 text-icon-muted',
          size === 'lg' ? 'size-5' : 'size-4',
        )}
      />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'flex w-full bg-transparent outline-hidden placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50',
          size === 'lg' ? 'h-14 text-[17px] tracking-[-0.01em]' : 'h-11 text-[14px]',
          className,
        )}
        {...props}
      />
      {trailing}
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'scroll-quiet max-h-[min(60vh,440px)] scroll-py-2 overflow-x-hidden overflow-y-auto p-1.5',
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('py-10 text-center text-body text-text-muted', className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden text-text-primary [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-overline [&_[cmdk-group-heading]]:text-text-muted',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('-mx-1.5 my-1.5 h-px bg-border-default', className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex min-h-10 cursor-default items-center gap-3 rounded-[10px] px-2.5 py-2 text-[14px] outline-hidden select-none',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-contrast',
        'data-[selected=true]:[&_[data-slot=command-meta]]:text-accent-contrast/75',
        'data-[selected=true]:[&_svg]:text-accent-contrast!',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px] [&_svg:not([class*='text-'])]:text-icon-default",
        className,
      )}
      {...props}
    />
  )
}

/** Right-aligned quiet text in an item (collection name, shortcut). */
function CommandMeta({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-meta"
      className={cn('ml-auto shrink-0 truncate text-callout text-text-muted', className)}
      {...props}
    />
  )
}

function CommandShortcut(props: React.ComponentProps<'span'>) {
  return <CommandMeta {...props} />
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandMeta,
  CommandShortcut,
  CommandSeparator,
}
