import { hueFor } from '#/components/shell/site-tile'
import { cn } from '#/lib/utils'

import { clientInitials } from './queries'

const SIZES = {
  sm: 'size-8 rounded-[9px] text-[12px]',
  md: 'size-10 rounded-[11px] text-[14px]',
  lg: 'size-12 rounded-[13px] text-[16px]',
  xl: 'size-14 rounded-[15px] text-[19px]',
} as const

/**
 * A client's tile: its initials on a softly tinted square, one hue per client
 * (derived from the id, like site tiles, so a client keeps its colour).
 */
export function ClientTile({
  id,
  name,
  size = 'md',
  className,
}: {
  id: string
  name: string
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="client-tile"
      style={{ '--tile-h': hueFor(id) } as React.CSSProperties}
      className={cn(
        'grid shrink-0 place-content-center font-semibold tracking-[0.01em] select-none',
        'bg-[oklch(0.93_0.05_var(--tile-h))] text-[oklch(0.42_0.13_var(--tile-h))] shadow-[inset_0_0_0_1px_oklch(0.5_0.1_var(--tile-h)/0.12)]',
        'dark:bg-[oklch(0.33_0.07_var(--tile-h))] dark:text-[oklch(0.9_0.07_var(--tile-h))] dark:shadow-[inset_0_0_0_1px_oklch(0.9_0.07_var(--tile-h)/0.1)]',
        SIZES[size],
        className,
      )}
    >
      {clientInitials(name)}
    </span>
  )
}
