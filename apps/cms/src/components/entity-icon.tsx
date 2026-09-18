import { cn } from '#/lib/utils'
import type { Icon as IconComponent } from '@phosphor-icons/react'

/**
 * Small rounded tile that precedes an entity name (site, collection, field
 * type, asset). `tone` picks the tint: brand for primary entities, muted for
 * secondary ones.
 */
export function EntityIcon({
  icon: Icon,
  tone = 'brand',
  size = 'md',
  className,
}: {
  icon: IconComponent
  tone?: 'brand' | 'muted' | 'warning' | 'success'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control',
        size === 'sm' && 'size-7 [&>svg]:size-3.5',
        size === 'md' && 'size-9 [&>svg]:size-4',
        size === 'lg' && 'size-11 rounded-surface [&>svg]:size-5',
        tone === 'brand' && 'bg-status-success-bg text-icon-accent',
        tone === 'muted' && 'bg-background-subtle text-icon-muted',
        tone === 'warning' && 'bg-status-warning-bg text-icon-warning',
        tone === 'success' && 'bg-status-success-bg text-icon-success',
        className,
      )}
    >
      <Icon weight="duotone" />
    </span>
  )
}
