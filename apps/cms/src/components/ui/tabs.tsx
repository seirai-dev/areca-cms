import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'

import { SPRING_SMALL } from '#/lib/motion'
import { cn } from '#/lib/utils'

/**
 * Horizontal underline tabs (brief §3.10, §3.11): real `role=tab` triggers
 * (Radix), a 2px ink indicator that slides between triggers (`layoutId`).
 * The `segmented` variant is kept for old call sites; new code uses
 * `SegmentedControl`.
 */

const TabsVariantContext = React.createContext<'line' | 'segmented'>('line')
const TabsIdContext = React.createContext<string>('tabs')
/** The selected value, so only the active trigger mounts the indicator (a
 *  shared `layoutId` on every trigger left the visible one at opacity 0). */
const TabsValueContext = React.createContext<string | undefined>(undefined)

function Tabs({
  className,
  orientation = 'horizontal',
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const id = React.useId()
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue)
  const current = value ?? uncontrolled
  return (
    <TabsIdContext.Provider value={id}>
      <TabsValueContext.Provider value={current}>
        <LayoutGroup id={id}>
          <TabsPrimitive.Root
            data-slot="tabs"
            data-orientation={orientation}
            orientation={orientation}
            className={cn(
              'group/tabs flex min-w-0 gap-2 data-[orientation=horizontal]:flex-col',
              className,
            )}
            value={value}
            defaultValue={defaultValue}
            onValueChange={(next) => {
              setUncontrolled(next)
              onValueChange?.(next)
            }}
            {...props}
          />
        </LayoutGroup>
      </TabsValueContext.Provider>
    </TabsIdContext.Provider>
  )
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col',
  {
    variants: {
      variant: {
        // The hairline is an inset shadow so the indicator can sit on it inside
        // the scroll box (a border would push it outside and clip it).
        line: 'no-scrollbar relative h-11 max-w-full gap-6 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border-default)]',
        segmented:
          'h-9 gap-0.5 rounded-control bg-segment-track p-[2px] text-text-secondary',
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
  const selected = React.useContext(TabsValueContext) === props.value
  const reduceMotion = useReducedMotion()

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'group/trigger relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
        'font-sans text-[14px] leading-5 font-medium text-text-secondary',
        'transition-colors duration-150 ease-(--ease-standard)',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        'hover:text-text-primary disabled:pointer-events-none disabled:text-text-disabled',
        'data-[state=active]:text-text-primary',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variant === 'line'
          ? 'h-11 px-0.5'
          : cn(
              'z-0 h-full flex-1 rounded-[8px] px-3',
              'data-[state=active]:bg-segment-thumb data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.1),0_0_0_0.5px_var(--color-segment-edge)]',
            ),
        className,
      )}
      {...props}
    >
      {children}
      {variant === 'line' && selected ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
        >
          {reduceMotion ? (
            <span className="block h-full w-full rounded-full bg-text-primary" />
          ) : (
            <motion.span
              layoutId={`${groupId}-tabs-indicator`}
              transition={SPRING_SMALL}
              className="block h-full w-full rounded-full bg-text-primary"
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
      className={cn('min-w-0 flex-1 outline-none', className)}
      {...props}
    />
  )
}

/** Mount on first visit, then retain draft state while the panel is hidden. */
function PersistentTabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  const active = React.useContext(TabsValueContext) === props.value
  const [visited, setVisited] = React.useState(active)
  React.useEffect(() => {
    if (active) setVisited(true)
  }, [active])
  if (!active && !visited) return null
  return (
    <TabsContent
      {...props}
      forceMount
      hidden={!active}
      className={cn('data-[state=inactive]:hidden', className)}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, PersistentTabsContent }
