import * as React from 'react'
import { Link } from '@tanstack/react-router'
import type { LinkOptions } from '@tanstack/react-router'
import { useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'
import type { Icon } from '@phosphor-icons/react'

import { Hint } from '#/components/ui/tooltip'
import { SPRING_SMALL } from '#/lib/motion'
import { cn } from '#/lib/utils'

const NAV_ITEM_CLASS = cn(
  'group/nav relative flex h-8 w-full min-w-0 items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] leading-5 select-none',
  'text-text-secondary transition-colors duration-150 ease-(--ease-standard)',
  'hover:bg-surface-state-hover hover:text-text-primary',
  'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
  'data-[status=active]:text-text-primary data-[status=active]:font-medium',
)

/**
 * The active background that glides between nav items (`layoutId`). One per
 * nav container (pass the container's `layoutGroup` id).
 */
function NavActiveBackground({ group }: { group: string }) {
  const reduce = useReducedMotion()
  if (reduce) {
    return (
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-[8px] bg-accent-soft"
      />
    )
  }
  return (
    <motion.span
      aria-hidden="true"
      layoutId={`${group}-nav-active`}
      transition={SPRING_SMALL}
      className="absolute inset-0 rounded-[8px] bg-accent-soft"
    />
  )
}

/**
 * One sidebar link: 18px Phosphor icon (regular; `fill` in the accent when
 * active), label, optional trailing count. In the collapsed rail only the
 * icon shows and the label moves into a tooltip.
 */
export function NavItem({
  link,
  icon: IconComponent,
  label,
  exact = false,
  trailing,
  collapsed = false,
  muted = false,
  testId,
  group = 'sidebar',
  onNavigate,
  className,
}: {
  link: LinkOptions
  icon: Icon
  label: React.ReactNode
  exact?: boolean
  trailing?: React.ReactNode
  collapsed?: boolean
  /** Greyed (disabled collections for admins). */
  muted?: boolean
  testId?: string
  group?: string
  onNavigate?: () => void
  className?: string
}) {
  const item = (
    <Link
      {...link}
      activeOptions={{ exact, includeSearch: false }}
      data-testid={testId}
      onClick={onNavigate}
      aria-label={collapsed && typeof label === 'string' ? label : undefined}
      className={cn(
        NAV_ITEM_CLASS,
        collapsed && 'size-10 justify-center px-0',
        muted && 'text-text-muted',
        className,
      )}
    >
      {({ isActive }) => (
        <>
          {isActive ? <NavActiveBackground group={group} /> : null}
          <IconComponent
            size={18}
            weight={isActive ? 'fill' : 'regular'}
            className={cn(
              'relative shrink-0 transition-colors',
              isActive
                ? 'text-icon-accent'
                : muted
                  ? 'text-icon-muted opacity-60'
                  : 'text-icon-default group-hover/nav:text-text-primary',
            )}
          />
          {collapsed ? null : (
            <>
              <span className="relative min-w-0 flex-1 truncate">{label}</span>
              {trailing ? (
                <span className="relative flex shrink-0 items-center gap-1.5">
                  {trailing}
                </span>
              ) : null}
            </>
          )}
        </>
      )}
    </Link>
  )
  if (collapsed) {
    return (
      <Hint label={label} side="right">
        {item}
      </Hint>
    )
  }
  return item
}

/** Quiet count at the end of a nav item. */
export function NavCount({ value }: { value: number | undefined }) {
  if (value === undefined) return null
  return (
    <span className="text-[12px] font-normal text-text-muted tnum">
      {value}
    </span>
  )
}

/** Group label ("CONTENT") with an optional action on the right. */
export function NavGroupLabel({
  children,
  actions,
}: {
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex h-7 items-center justify-between gap-2 pr-1 pl-2.5">
      <span className="text-overline text-text-muted">{children}</span>
      {actions ? (
        <span className="flex items-center gap-0.5">{actions}</span>
      ) : null}
    </div>
  )
}
