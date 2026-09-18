import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '#/lib/utils'
import { Slot } from 'radix-ui'
import { CaretDown } from '@phosphor-icons/react'

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

/**
 * Keyboard focus is a 2px `border-strong` outline offset 2px. Pointer focus
 * shows nothing: inputs and buttons never get a coloured ring.
 */
const FOCUS_RING =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong'

const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-control',
    'font-sans text-sm leading-[17px] font-medium whitespace-nowrap',
    'transition-colors duration-[120ms] ease-(--motion-ease-standard)',
    'active:translate-y-px',
    FOCUS_RING,
    // Filled buttons drop to the secondary surface with muted text when
    // disabled (a dimmed green left white text at about 2:1). Quiet variants
    // just dim.
    'disabled:pointer-events-none disabled:opacity-45',
    'aria-invalid:border-border-error',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      variant: {
        primary:
          'bg-action-primary text-action-primary-text hover:bg-action-primary-hover disabled:bg-action-secondary disabled:text-text-muted disabled:opacity-100',
        default:
          'bg-action-primary text-action-primary-text hover:bg-action-primary-hover disabled:bg-action-secondary disabled:text-text-muted disabled:opacity-100',
        secondary:
          'bg-action-secondary text-text-primary hover:bg-action-secondary-hover',
        outline:
          'border border-border-default bg-background-default text-text-primary hover:bg-surface-state-hover',
        ghost:
          'text-text-primary hover:bg-surface-state-hover active:bg-surface-state-pressed',
        link: 'text-text-accent underline-offset-4 hover:underline active:translate-y-0',
        destructive:
          'bg-action-destructive text-white hover:bg-action-destructive/90 disabled:bg-action-secondary disabled:text-text-muted disabled:opacity-100',
      },
      size: {
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 px-3',
        md: 'h-9 px-4',
        default: 'h-9 px-4',
        lg: 'h-10 px-5',
        icon: 'size-9',
        'icon-xs': "size-7 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-md': 'size-9',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
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
        '[&>*:not(:first-child)]:-ml-px',
        '[&>*:hover]:z-10 [&>*:focus-visible]:z-10',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Primary action plus a menu of related ones. `children` are the menu items
 * (rendered inside a `DropdownMenu`); the caller supplies their own
 * `DropdownMenuContent`.
 */
function SplitButton({
  label,
  onClick,
  variant = 'primary',
  size = 'default',
  disabled,
  className,
  menuLabel = 'More actions',
  menuProps,
  triggerProps,
  children,
  ...props
}: Omit<React.ComponentProps<'button'>, 'children'> &
  VariantProps<typeof buttonVariants> & {
    label: React.ReactNode
    menuLabel?: string
    menuProps?: React.ComponentProps<typeof DropdownMenu>
    triggerProps?: React.ComponentProps<'button'>
    children: React.ReactNode
  }) {
  return (
    <ButtonGroup className={className}>
      <Button
        variant={variant}
        size={size}
        onClick={onClick}
        disabled={disabled}
        {...props}
      >
        {label}
      </Button>
      <DropdownMenu {...menuProps}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={
              size === 'xs' ? 'icon-xs' : size === 'sm' ? 'icon-sm' : 'icon'
            }
            aria-label={menuLabel}
            disabled={disabled}
            className="border-l border-black/10 px-0 dark:border-white/10"
            {...triggerProps}
          >
            <CaretDown />
          </Button>
        </DropdownMenuTrigger>
        {children}
      </DropdownMenu>
    </ButtonGroup>
  )
}

export { Button, ButtonGroup, SplitButton, buttonVariants }
