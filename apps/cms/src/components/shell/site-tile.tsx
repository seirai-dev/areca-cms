import { cn, initials } from '#/lib/utils'

/** Stable hue per id so each site keeps its colour everywhere. */
export function hueFor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return hash % 360
}

const SIZES = {
  xs: 'size-5 rounded-[6px] text-[10px]',
  sm: 'size-7 rounded-[8px] text-[12px]',
  md: 'size-9 rounded-[10px] text-[14px]',
  lg: 'size-12 rounded-[13px] text-[18px]',
  xl: 'size-14 rounded-[15px] text-[21px]',
} as const

/**
 * The site's icon tile: its initial on a softly tinted square, one hue per
 * site (derived from the id, not hard-coded). Used by the workspace card,
 * the switcher, the picker and site cards.
 */
export function SiteTile({
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
  const letter = initials(name).charAt(0) || '?'
  return (
    <span
      aria-hidden="true"
      data-slot="site-tile"
      style={{ '--tile-h': hueFor(id) } as React.CSSProperties}
      className={cn(
        'grid shrink-0 place-content-center font-semibold tracking-[-0.01em] select-none',
        'bg-[oklch(0.93_0.05_var(--tile-h))] text-[oklch(0.42_0.13_var(--tile-h))] shadow-[inset_0_0_0_1px_oklch(0.5_0.1_var(--tile-h)/0.12)]',
        'dark:bg-[oklch(0.33_0.07_var(--tile-h))] dark:text-[oklch(0.9_0.07_var(--tile-h))] dark:shadow-[inset_0_0_0_1px_oklch(0.9_0.07_var(--tile-h)/0.1)]',
        SIZES[size],
        className,
      )}
    >
      {letter}
    </span>
  )
}
