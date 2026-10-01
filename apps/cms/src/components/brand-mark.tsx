import { Leaf } from '@phosphor-icons/react'

import type { BrandingView } from '#/lib/branding'
import { useBranding } from '#/lib/use-branding'
import { cn } from '#/lib/utils'

/**
 * Logo tile + app name. Reads the instance branding unless one is passed in
 * (the branding preview passes a draft).
 */
export function BrandMark({
  branding: override,
  className,
  nameClassName,
  size = 'md',
}: {
  branding?: BrandingView
  className?: string
  nameClassName?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const current = useBranding()
  const branding = override ?? current

  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <BrandLogo branding={branding} size={size} />
      <span
        className={cn(
          'truncate text-[15px] leading-5 font-semibold tracking-[-0.01em] text-text-primary',
          nameClassName,
        )}
      >
        {branding.appName}
      </span>
    </span>
  )
}

export function BrandLogo({
  branding,
  className,
  size = 'md',
}: {
  branding: BrandingView
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const box =
    size === 'sm'
      ? 'size-7 rounded-[8px]'
      : size === 'lg'
        ? 'size-12 rounded-[14px]'
        : 'size-9 rounded-[10px]'
  if (branding.logoUrl) {
    return (
      <img
        src={branding.logoUrl}
        alt=""
        className={cn('shrink-0 object-contain', box, className)}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-content-center bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.12)]',
        box,
        className,
      )}
    >
      <Leaf
        weight="fill"
        className={
          size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-6' : 'size-[18px]'
        }
      />
    </span>
  )
}
