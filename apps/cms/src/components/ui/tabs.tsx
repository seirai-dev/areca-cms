import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '#/lib/utils'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { motion, useReducedMotion } from 'motion/react'

/**
 * Two variants. `line` (the default) is the underline row used for section
 * navigation: 40px, label-md, a 2px green indicator that slides between
 * triggers. `segmented` is the in-page switch: a track on `background-subtle`
 * with a pill thumb.
 */

const TabsVariantContext = React.createContext<'line' | 'segmented'>('line')
const TabsIdContext = React.createContext<string>('tabs')

function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const id = React.useId()
  return (
    <TabsIdContext.Provider value={id}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        orientation={orientation}
        className={cn(
          'group/tabs flex gap-2 data-[orientation=horizontal]:flex-col',
          className,
        )}
        {...props}
      />
    </TabsIdContext.Provider>
  )
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col',
  {
    variants: {
      variant: {
        line: 'relative h-10 gap-6 border-b border-border-subtle',
        segmented:
          'h-9 gap-1 rounded-control border border-border-subtle bg-background-subtle p-[3px] text-text-secondary',
        /** Legacy alias of `segmented`, kept so old call sites compile. */
        default:
          'h-9 gap-1 rounded-control border border-border-subtle bg-background-subtle p-[3px] text-text-secondary',
      },
    },
    defaultVariants: {
      variant: 'line',
    },
  },
)

function TabsList({
  className,
  variant = 'line',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsVariantContext.Provider
      value={variant === 'line' ? 'line' : 'segmented'}
    >
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext)
  const groupId = React.useContext(TabsIdContext)
  const reduceMotion = useReducedMotion()

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'group/trigger relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
        'font-sans text-sm leading-[17px] font-medium text-text-secondary',
        'transition-colors duration-[120ms] ease-(--motion-ease-standard)',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
        'hover:text-text-primary disabled:pointer-events-none disabled:text-text-disabled',
        'data-[state=active]:text-text-primary',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variant === 'line'
          ? 'h-10 px-0.5'
          : cn(
              'h-full flex-1 rounded-[6px] px-3',
              'data-[state=active]:bg-background-default data-[state=active]:shadow-xs',
              'data-[state=active]:ring-1 data-[state=active]:ring-border-default data-[state=active]:font-semibold',
            ),
        className,
      )}
      {...props}
    >
      {children}
      {variant === 'line' ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 group-data-[state=inactive]/trigger:hidden"
        >
          {reduceMotion ? (
            <span className="block h-full w-full bg-action-primary" />
          ) : (
            <motion.span
              layoutId={`${groupId}-tabs-indicator`}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="block h-full w-full bg-action-primary"
            />
          )}
        </span>
      ) : null}
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
