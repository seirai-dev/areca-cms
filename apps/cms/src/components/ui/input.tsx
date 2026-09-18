import * as React from 'react'
import { cn } from '#/lib/utils'

/** Shared field shell: 36px, border-only focus, no ring. */
export const fieldClasses = cn(
  'w-full min-w-0 rounded-control border border-border-default bg-transparent',
  'px-3 font-sans text-sm leading-5 text-text-primary',
  'transition-colors duration-[120ms] ease-(--motion-ease-standard)',
  'outline-none placeholder:text-text-muted',
  'hover:bg-input-bg-hover',
  'focus-visible:border-border-strong focus:border-border-strong',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-text-disabled',
  'aria-invalid:border-border-error',
)

function Input({
  className,
  type,
  ...props
}: React.ComponentProps<'input'> & { inputSize?: 'sm' | 'md' }) {
  const { inputSize = 'md', ...rest } = props
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClasses,
        inputSize === 'sm' ? 'h-8' : 'h-9',
        'selection:bg-action-primary selection:text-action-primary-text',
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-primary',
        className,
      )}
      {...rest}
    />
  )
}

export { Input }
