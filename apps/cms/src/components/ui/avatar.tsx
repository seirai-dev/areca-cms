import * as React from 'react'
import { Avatar as AvatarPrimitive } from 'radix-ui'
import { Gear } from '@phosphor-icons/react'

import { cn, initials } from '#/lib/utils'

const SIZES = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  default: 'size-8 text-[12px]',
  md: 'size-8 text-[12px]',
  lg: 'size-10 text-[14px]',
  xl: 'size-12 text-[16px]',
} as const

function Avatar({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: keyof typeof SIZES
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'group/avatar relative flex shrink-0 overflow-hidden rounded-full select-none',
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  )
}

/** Monogram fallback: an Apple-Contacts style soft grey gradient. */
function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full font-semibold tracking-[0.02em] text-white',
        'bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-text-muted)_62%,white),color-mix(in_oklab,var(--color-text-muted)_92%,black))]',
        className,
      )}
      {...props}
    />
  )
}

/** Avatar for a person by name: image when available, initials otherwise. */
function UserAvatar({
  name,
  image,
  size = 'default',
  className,
  title,
}: {
  name: string | null | undefined
  image?: string | null
  size?: keyof typeof SIZES
  className?: string
  title?: string
}) {
  return (
    <Avatar
      size={size}
      className={className}
      title={title ?? name ?? undefined}
    >
      {image ? <AvatarImage src={image} alt="" /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

/** The "System" glyph for events without an actor. */
function SystemAvatar({
  size = 'default',
  className,
  label,
}: {
  size?: keyof typeof SIZES
  className?: string
  label?: string
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'grid shrink-0 place-content-center rounded-full bg-accent-soft text-icon-accent',
        SIZES[size],
        className,
      )}
    >
      <Gear weight="fill" className="size-[55%] min-h-3 min-w-3" />
    </span>
  )
}

export { UserAvatar, SystemAvatar }
