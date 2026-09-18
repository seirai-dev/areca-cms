import { useBranding } from '#/lib/use-branding'
import type { BrandingView } from '#/lib/branding'
import { cn } from '#/lib/utils'
import { Leaf } from '@phosphor-icons/react'

/**
 * Logo tile + app name. Reads the instance branding unless one is passed in
 * (the admin preview passes a draft).
 */
export function BrandMark({
  branding: override,
  className,
  nameClassName,
}: {
  branding?: BrandingView
  className?: string
  nameClassName?: string
}) {
  const current = useBranding()
  const branding = override ?? current

  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <BrandLogo branding={branding} />
      <span
        className={cn(
          'truncate text-ds-heading-5',
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
}: {
  branding: BrandingView
  className?: string
}) {
  if (branding.logoUrl) {
    return (
      <img
        src={branding.logoUrl}
        alt=""
        className={cn('size-8 shrink-0 rounded-control object-contain', className)}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-control bg-action-primary text-action-primary-text',
        className,
      )}
    >
      <Leaf className="size-4" />
    </span>
  )
}
