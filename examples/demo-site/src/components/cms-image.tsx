import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { ImageValue } from '@areca-cms/site-sdk'
import { m } from '#/paraglide/messages'
import type { FieldMarker } from '../lib/visual-markers.tsx'
import { buttonSecondary, Eyebrow } from './ui.tsx'

/**
 * Renders a CMS image with its intrinsic size (to prevent layout shift) and
 * alt text. Images load lazily unless they are above the fold (`priority`).
 * `marker` is the image field's visual editor marker.
 */
export function CmsImage({
  image,
  className,
  priority = false,
  marker = {},
}: {
  image: ImageValue
  className?: string
  priority?: boolean
  marker?: FieldMarker
}) {
  return (
    <img
      src={image.url}
      alt={image.alt}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={className}
      {...marker}
    />
  )
}

/** Marks a page that shows draft content. `incomplete` says the draft could not be shown, so the live version is. */
export function PreviewBanner({ incomplete = false }: { incomplete?: boolean }) {
  return (
    <p className="mb-8 rounded-full border border-accent-strong/40 bg-accent-strong/10 px-5 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.18em] text-accent-strong">
      {incomplete ? m.preview_banner_incomplete() : m.preview_banner()}
    </p>
  )
}

export function PageMessage({
  title,
  eyebrow,
  children,
}: {
  title: string
  eyebrow?: string
  children?: ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-start px-5 py-24 sm:px-8 md:py-36">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h1 className="mt-4 font-display text-5xl leading-[1.05] tracking-tight text-ink md:text-6xl">
        {title}
      </h1>
      {children ? <div className="mt-6 max-w-xl text-lg leading-8 text-muted">{children}</div> : null}
      <Link to="/" className={`${buttonSecondary} mt-10`}>
        {m.back_to_roastery()}
      </Link>
    </div>
  )
}
