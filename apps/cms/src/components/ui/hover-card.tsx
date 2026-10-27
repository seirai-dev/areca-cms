import * as React from 'react'
import { HoverCard as HoverCardPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'

/**
 * Extra detail on hover or keyboard focus, for pointer devices. Same surface
 * as `PopoverContent`. Never put the only way to reach something in here:
 * touch screens do not hover.
 */
function HoverCard({
  openDelay = 450,
  closeDelay = 120,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return (
    <HoverCardPrimitive.Root
      data-slot="hover-card"
      openDelay={openDelay}
      closeDelay={closeDelay}
      {...props}
    />
  )
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  )
}

function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-overlay w-64 max-w-[calc(100vw-1rem)] origin-(--radix-hover-card-content-transform-origin) rounded-card p-3 text-text-primary outline-hidden surface-float',
          'data-[state=open]:animate-pop-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98]',
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
