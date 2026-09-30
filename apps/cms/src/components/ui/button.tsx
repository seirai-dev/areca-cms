import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { CaretDown } from '@phosphor-icons/react'

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/** Keyboard focus: a 2px accent outline, offset 2px. Pointer focus: nothing. */
const FOCUS_RING =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus'

/**
 * Buttons (brief §0.3, §4.3). One `primary` (ink) per screen; everything else
 * is quieter. Heights: sm 30, md 36, lg 44 (auth and mobile primary).
 */
const buttonVariants = cva(
  cn(
    'relative inline-flex shrink-0 items-center justify-center gap-2 rounded-control select-none',
    'font-sans text-[14px] leading-5 font-medium tracking-[-0.003em] whitespace-nowrap',
    'transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-(--ease-standard)',
    'active:scale-[0.98]',
    FOCUS_RING,
    'disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40',
    'aria-invalid:border-border-error',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      variant: {
        primary:
          'bg-action-primary text-action-primary-text shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.08)] hover:bg-action-primary-hover',
        /** LEGACY alias of `primary`. */
        default:
          'bg-action-primary text-action-primary-text shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.08)] hover:bg-action-primary-hover',
        accent:
          'bg-accent text-accent-contrast shadow-[0_1px_2px_rgb(0_0_0/0.12)] hover:bg-accent-hover',
        secondary:
          'bg-action-secondary text-text-primary hover:bg-action-secondary-hover',
        outline:
          'border border-border-strong bg-background-surface text-text-primary shadow-card hover:bg-background-subtle',
        ghost:
          'text-text-primary hover:bg-surface-state-hover active:bg-surface-state-pressed',
        quiet:
          'text-text-secondary hover:bg-surface-state-hover hover:text-text-primary active:bg-surface-state-pressed',
        link: 'h-auto! px-0! text-text-accent underline-offset-4 hover:underline active:scale-100',
        destructive:
          'bg-action-destructive text-text-inverse hover:bg-action-destructive-hover',
      },
      size: {
        xs: "h-7 gap-1.5 rounded-[8px] px-2.5 text-[12.5px] [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-[30px] gap-1.5 rounded-[8px] px-3 text-[13px]',
        md: 'h-9 px-3.5',
        /** LEGACY alias of `md`. */
        default: 'h-9 px-3.5',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'size-9',
        'icon-xs':
          "size-7 rounded-[8px] [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': 'size-[30px] rounded-[8px]',
        'icon-md': 'size-9',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Shows a spinner in place of the leading icon and disables the button. */
    loading?: boolean
  }

function Button({
  className,
  variant = 'primary',
  size = 'md',
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading ? 'true' : undefined}
      aria-busy={loading || undefined}
      disabled={asChild ? disabled : disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <ButtonSpinner /> : null}
          {children}
        </>
      )}
    </Comp>
  )
}

function ButtonSpinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 animate-spin motion-reduce:animate-none"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Horizontal run of buttons sharing one outline: inner corners square, inner
 * borders collapsed.
 */
function ButtonGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="button-group"
      role="group"
      className={cn(
        'inline-flex items-center',
        '[&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none',
        '[&>*:hover]:z-10 [&>*:focus-visible]:z-10',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Primary action plus a menu of related ones. `children` are the menu content
 * (the caller supplies its own `DropdownMenuContent`). The two halves share a
 * hairline divider in the button's own text colour.
 */
function SplitButton({
  label,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  menuDisabled,
  className,
  menuLabel = m.ui_more(),
  menuProps,
  triggerProps,
  loading,
  children,
  ...props
}: Omit<React.ComponentProps<'button'>, 'children'> &
  VariantProps<typeof buttonVariants> & {
    label: React.ReactNode
    menuLabel?: string
    /** Disable only the caret (defaults to `disabled`). */
    menuDisabled?: boolean
    loading?: boolean
    menuProps?: React.ComponentProps<typeof DropdownMenu>
    triggerProps?: React.ComponentProps<'button'> & { 'data-testid'?: string }
    children: React.ReactNode
  }) {
  const iconSize =
    size === 'xs'
      ? 'icon-xs'
      : size === 'sm'
        ? 'icon-sm'
        : size === 'lg'
          ? 'icon-lg'
          : 'icon'
  return (
    <ButtonGroup className={className}>
      <Button
        variant={variant}
        size={size}
        onClick={onClick}
        disabled={disabled}
        loading={loading}
        {...props}
      >
        {label}
      </Button>
      <DropdownMenu {...menuProps}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={iconSize}
            aria-label={menuLabel}
            disabled={menuDisabled ?? disabled}
            className="w-8 before:absolute before:inset-y-2 before:left-0 before:w-px before:bg-current before:opacity-20"
            {...triggerProps}
          >
            <CaretDown weight="bold" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        {children}
      </DropdownMenu>
    </ButtonGroup>
  )
}

export { Button, SplitButton, buttonVariants }
export type { ButtonProps }
