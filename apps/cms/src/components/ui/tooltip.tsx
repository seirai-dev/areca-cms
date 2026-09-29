import * as React from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'

function TooltipProvider({
  delayDuration = 300,
  skipDelayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-above-overlay w-fit max-w-72 origin-(--radix-tooltip-content-transform-origin) rounded-[8px] bg-background-inverse px-2.5 py-1.5 text-[12.5px] leading-[17px] font-medium text-balance text-text-inverse shadow-float',
          'animate-in fade-in-0 zoom-in-[0.97] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97]',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/**
 * Tooltip for one trigger in one line. When `label` is empty the child renders
 * bare. Works on disabled buttons too: a disabled element fires no pointer
 * events, so it is wrapped in a focusable span that carries the tooltip (this
 * is how "visible but disabled, with the reason" is done, brief §1.3).
 */
function Hint({
  label,
  side = 'top',
  align,
  children,
  wrapDisabled,
  className,
}: {
  label: React.ReactNode
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>['side']
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>['align']
  children: React.ReactElement
  /** Wrap the child in a focusable span (for disabled triggers). */
  wrapDisabled?: boolean
  className?: string
}) {
  if (!label) return children
  const childProps = (children.props ?? {}) as { disabled?: boolean }
  const needsWrap = wrapDisabled ?? Boolean(childProps.disabled)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {needsWrap ? (
          <span
            tabIndex={0}
            data-slot="hint-wrap"
            className={cn(
              'inline-flex rounded-control outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
              className,
            )}
          >
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Hint }
