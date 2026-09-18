import { CircleNotch } from '@phosphor-icons/react'
import { cn } from '#/lib/utils'

/**
 * The only spinner in the product: 16px, `currentColor`, used inside buttons
 * while an action is in flight. Lists use skeletons instead.
 */
export function Spinner({
  className,
  size = 16,
  label,
}: {
  className?: string
  size?: number
  label?: string
}) {
  return (
    <CircleNotch
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'status' : undefined}
      size={size}
      weight="bold"
      className={cn('animate-spin text-current', className)}
    />
  )
}
