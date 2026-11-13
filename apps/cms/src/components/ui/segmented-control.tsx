import * as React from 'react'
import { LayoutGroup, useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'

import { SPRING_SMALL } from '#/lib/motion'
import { cn } from '#/lib/utils'

import { Hint } from './tooltip'

export type SegmentedOption<T extends string> = {
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
  /** Accessible name when `label` is visual only (icon-only segments). */
  ariaLabel?: string
  disabled?: boolean
  testId?: string
  /** Tooltip on the segment (not shown while the segment is disabled). */
  hint?: React.ReactNode
}

/**
 * Sliding-pill segmented control (brief §3.4, §3.9, account menu). The pill
 * glides between segments with `layoutId`. Keyboard: arrow keys, Home/End.
 *
 * - `semantics="radio"` (default): a radiogroup of radios; selection follows
 *   focus, like native segmented controls.
 * - `semantics="tabs"`: a tablist of tabs (for view switches that swap a
 *   region; pair with `aria-controls` on the caller's side).
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  semantics = 'radio',
  fullWidth = false,
  iconOnly = false,
  hintSide,
  className,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: {
  value: T
  onValueChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  size?: 'sm' | 'md'
  semantics?: 'radio' | 'tabs'
  fullWidth?: boolean
  iconOnly?: boolean
  /** Where segment tooltips open (default: above). */
  hintSide?: 'top' | 'bottom'
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}) {
  const id = React.useId()
  const reduce = useReducedMotion()
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const enabled = options.filter((option) => !option.disabled)

  function move(from: number, delta: number | 'first' | 'last') {
    if (enabled.length === 0) return
    const current = enabled.findIndex(
      (option) => option.value === options[from]?.value,
    )
    const nextIndex =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? enabled.length - 1
          : (current + delta + enabled.length) % enabled.length
    const next = enabled[nextIndex]
    onValueChange(next.value)
    const domIndex = options.findIndex((option) => option.value === next.value)
    refs.current[domIndex]?.focus()
  }

  const itemRole = semantics === 'radio' ? 'radio' : 'tab'
  // With nothing selected (an optional choice), the first segment takes the
  // tab stop so the group stays keyboard reachable.
  const hasSelection = options.some((option) => option.value === value)
  const firstEnabled = options.findIndex((option) => !option.disabled)

  return (
    <LayoutGroup id={id}>
      <div
        role={semantics === 'radio' ? 'radiogroup' : 'tablist'}
        aria-label={ariaLabel}
        data-slot="segmented-control"
        data-testid={testId}
        className={cn(
          'relative inline-flex items-center gap-0.5 rounded-control bg-segment-track p-[2px]',
          size === 'sm' ? 'h-[30px]' : 'h-9',
          fullWidth && 'flex w-full',
          className,
        )}
      >
        {options.map((option, index) => {
          const selected = option.value === value
          const button = (
            <button
              ref={(node) => {
                refs.current[index] = node
              }}
              type="button"
              role={itemRole}
              aria-checked={semantics === 'radio' ? selected : undefined}
              aria-selected={semantics === 'tabs' ? selected : undefined}
              aria-label={option.ariaLabel}
              tabIndex={
                selected || (!hasSelection && index === firstEnabled) ? 0 : -1
              }
              disabled={option.disabled}
              data-state={selected ? 'on' : 'off'}
              data-testid={option.testId}
              onClick={() => onValueChange(option.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  move(index, 1)
                } else if (
                  event.key === 'ArrowLeft' ||
                  event.key === 'ArrowUp'
                ) {
                  event.preventDefault()
                  move(index, -1)
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  move(index, 'first')
                } else if (event.key === 'End') {
                  event.preventDefault()
                  move(index, 'last')
                }
              }}
              className={cn(
                'relative inline-flex h-full min-w-0 items-center justify-center gap-1.5 rounded-[8px] font-medium whitespace-nowrap select-none touch-target',
                'transition-colors duration-150 ease-(--ease-standard)',
                'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                'disabled:pointer-events-none disabled:opacity-40',
                size === 'sm' ? 'px-2.5 text-[12.5px]' : 'px-3 text-[13px]',
                iconOnly && (size === 'sm' ? 'w-[30px] px-0' : 'w-9 px-0'),
                fullWidth && 'flex-1',
                selected
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
                "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
              )}
            >
              {selected ? (
                reduce ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 -z-0 rounded-[8px] bg-segment-thumb shadow-[0_1px_2px_rgb(0_0_0/0.1),0_0_0_0.5px_var(--color-segment-edge)]"
                  />
                ) : (
                  <motion.span
                    aria-hidden="true"
                    layoutId="segment-thumb"
                    transition={SPRING_SMALL}
                    className="absolute inset-0 -z-0 rounded-[8px] bg-segment-thumb shadow-[0_1px_2px_rgb(0_0_0/0.1),0_0_0_0.5px_var(--color-segment-edge)]"
                  />
                )
              ) : null}
              <span className="relative z-[1] inline-flex min-w-0 items-center gap-1.5">
                {option.icon}
                {iconOnly ? null : (
                  <span className="truncate">{option.label}</span>
                )}
              </span>
            </button>
          )
          return (
            <React.Fragment key={option.value}>
              {option.hint && !option.disabled ? (
                <Hint label={option.hint} side={hintSide}>
                  {button}
                </Hint>
              ) : (
                button
              )}
            </React.Fragment>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
