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

/** Width of the fade shown at a scrolling strip's edge that has more tabs. */
const EDGE_FADE = '24px'

function edgeMask({ start, end }: { start: boolean; end: boolean }) {
  if (!start && !end) return undefined
  const left = start ? `transparent, #000 ${EDGE_FADE}` : '#000 0'
  const right = end
    ? `#000 calc(100% - ${EDGE_FADE}), transparent`
    : '#000 100%'
  return `linear-gradient(to right, ${left}, ${right})`
}

function TabsList({
  className,
  variant = 'line',
  ref,
  style,
  onScroll,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const value = React.useContext(TabsValueContext)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = React.useState({ start: false, end: false })

  const measure = React.useCallback(() => {
    const list = listRef.current
    if (!list) return
    const start = list.scrollLeft > 1
    const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 1
    setEdges((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    )
  }, [])

  // Keep the selected tab on screen (keyboard and deep links can select one
  // that is scrolled out of view), then re-measure as the strip resizes.
  React.useEffect(() => {
    const list = listRef.current
    if (!list || variant !== 'line') return
    const active = list.querySelector<HTMLElement>(
      '[role="tab"][data-state="active"]',
    )
    if (active) {
      list.scrollTo({
        left: active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2,
        behavior: 'smooth',
      })
    }
    measure()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(list)
    return () => observer?.disconnect()
  }, [value, variant, measure])

  const mask = variant === 'line' ? edgeMask(edges) : undefined

  return (
    <TabsVariantContext.Provider
      value={variant === 'line' ? 'line' : 'segmented'}
    >
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        style={
          mask ? { ...style, maskImage: mask, WebkitMaskImage: mask } : style
        }
        onScroll={(event) => {
          onScroll?.(event)
          measure()
        }}
        {...props}
        ref={(node) => {
          listRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
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
