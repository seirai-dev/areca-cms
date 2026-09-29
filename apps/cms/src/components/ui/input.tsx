import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * Shared field shell: 36px, hairline border, surface fill, accent focus ring
 * drawn as a soft 3px halo plus an accent border.
 */
export const fieldClasses = cn(
  'w-full min-w-0 rounded-control border border-border-strong bg-background-surface',
  'px-3 font-sans text-[14px] leading-5 text-text-primary shadow-[0_1px_1px_rgb(0_0_0/0.02)]',
  'transition-[border-color,box-shadow,background-color] duration-150 ease-(--ease-standard)',
  'outline-none placeholder:text-text-muted',
  'hover:border-[color-mix(in_oklab,var(--color-border-strong),var(--color-text-primary)_12%)]',
  'focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft',
  'focus:border-accent focus:ring-[3px] focus:ring-accent-soft',
  'disabled:cursor-not-allowed disabled:bg-background-subtle disabled:text-text-disabled',
  'read-only:bg-background-subtle',
  'aria-invalid:border-border-error aria-invalid:ring-status-error-bg',
)

function Input({
  className,
  type,
  inputSize = 'md',
  ...props
}: React.ComponentProps<'input'> & { inputSize?: 'sm' | 'md' | 'lg' }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClasses,
        inputSize === 'sm' ? 'h-[30px] text-[13px]' : inputSize === 'lg' ? 'h-11 text-[15px]' : 'h-9',
        'file:mr-3 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-text-primary',
        '[&::-webkit-search-cancel-button]:appearance-none',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
