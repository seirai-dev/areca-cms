import * as React from 'react'

import { BrandLogo } from '#/components/brand-mark'
import type { BrandingView } from '#/lib/branding'
import { cn } from '#/lib/utils'

import { accentTone } from './auth-art-tone'

/**
 * The branded panel beside the auth forms: abstract palm fans, two soft lights and
 * a little grain, all drawn from the accent colour (see `.auth-art` in
 * styles.css), with the logo and app name on top and the tagline at the
 * bottom. As a narrow band (`compact`) it keeps only the logo and name.
 *
 * Purely decorative apart from the name and tagline, which repeat what the
 * page heading says, so screen readers skip the shapes.
 */
export function AuthArt({
  branding,
  tagline,
  compact = false,
  size = 'md',
  className,
}: {
  branding: BrandingView
  tagline: string
  /** Band layout for narrow screens and small previews: no tagline. */
  compact?: boolean
  /** `sm` for small previews (Agency → Branding): tighter padding and type. */
  size?: 'sm' | 'md'
  className?: string
}) {
  const grainId = React.useId()
  return (
    <div
      data-testid="auth-art"
      data-tone={accentTone(branding.accentColor)}
      className={cn(
        'auth-art relative isolate overflow-hidden rounded-panel bg-(--art-sky-bottom)',
        className,
      )}
    >
      {/* Sky: deeper at the top, where the logo sits. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,var(--art-sky-top)_0%,var(--art-sky-bottom)_62%)]"
      />
      {/* Lights. */}
      <div
        aria-hidden="true"
        className="auth-art-float pointer-events-none absolute top-[-18%] right-[-14%] -z-10 size-[70%] rounded-full bg-[radial-gradient(closest-side,var(--art-glow),transparent)] opacity-(--art-glow-opacity) blur-2xl"
      />
      <div
        aria-hidden="true"
        className="auth-art-float pointer-events-none absolute top-[30%] left-[-22%] -z-10 size-[55%] rounded-full bg-[radial-gradient(closest-side,var(--art-glow),transparent)] opacity-[calc(var(--art-glow-opacity)*0.6)] blur-3xl [animation-delay:-14s]"
      />
      {/* Cropped palm fans: cut-paper blades and long, curved stems. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 600 800"
        preserveAspectRatio={compact ? 'xMidYMid slice' : 'xMidYMax slice'}
        className="pointer-events-none absolute inset-0 -z-10 size-full"
      >
        <defs>
          {/* Each tapered blade meets at the fan's folded base. */}
          <path
            id={`${grainId}-blade`}
            d="M0 0 C-12-40-27-118-19-194 C-15-228-6-255 0-272 C6-255 15-228 19-194 C27-118 12-40 0 0Z"
          />
          <g id={`${grainId}-fan`}>
            <use
              href={`#${grainId}-blade`}
              transform="rotate(-80) scale(.76)"
            />
            <use
              href={`#${grainId}-blade`}
              transform="rotate(-60) scale(.88)"
            />
            <use
              href={`#${grainId}-blade`}
              transform="rotate(-40) scale(.96)"
            />
            <use href={`#${grainId}-blade`} transform="rotate(-20)" />
            <use href={`#${grainId}-blade`} />
            <use href={`#${grainId}-blade`} transform="rotate(20)" />
            <use href={`#${grainId}-blade`} transform="rotate(40) scale(.96)" />
            <use href={`#${grainId}-blade`} transform="rotate(60) scale(.88)" />
            <use href={`#${grainId}-blade`} transform="rotate(80) scale(.76)" />
          </g>
        </defs>
        <g className="auth-art-drift-alt origin-bottom">
          {/* A quieter fan reaches into the panel from the left edge. */}
          <path
            d="M-48 810 C-8 656 54 462 112 354"
            fill="none"
            stroke="var(--art-far)"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <use
            href={`#${grainId}-fan`}
            transform="translate(112 354) rotate(-32) scale(1.12)"
            fill="var(--art-far)"
          />
        </g>
        <g className="auth-art-drift origin-bottom [animation-delay:-6s]">
          <path
            d="M248 854 C243 716 394 670 410 496"
            fill="none"
            stroke="var(--art-shade)"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M245 854 C240 716 391 670 407 496"
            fill="none"
            stroke="var(--art-glow)"
            strokeOpacity="0.35"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <g transform="translate(410 496) rotate(20) scale(1.18)">
            <use href={`#${grainId}-fan`} fill="var(--art-back)" />
            {/* A shaded half-blade gives the folds a little depth. */}
            <path
              d="M0 0 C12-40 27-118 19-194 C15-228 6-255 0-272Z"
              fill="var(--art-shade)"
            />
            <path
              d="M0 0 0-258"
              stroke="var(--art-glow)"
              strokeOpacity="0.45"
              strokeWidth="1"
            />
          </g>
        </g>
        {/* A cropped foreground frond balances the tall fan. */}
        <g className="auth-art-drift-alt origin-bottom [animation-delay:-14s]">
          <path
            d="M660 862 C576 788 494 717 174 602"
            fill="none"
            stroke="var(--art-front)"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <use
            href={`#${grainId}-fan`}
            transform="translate(174 602) rotate(-62) scale(.82)"
            fill="var(--art-front)"
          />
        </g>
      </svg>
      {/* Grain keeps the gradients from banding and gives the surface a print feel. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 size-full opacity-(--art-grain-opacity) mix-blend-overlay"
      >
        <filter id={grainId}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${grainId})`} />
      </svg>
      {/* Scrims behind the text, so any accent stays readable. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-32 bg-[linear-gradient(180deg,var(--art-scrim-top),transparent)]"
      />
      {compact ? null : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-[linear-gradient(0deg,var(--art-scrim-bottom),transparent)]"
        />
      )}

      <div
        className={cn(
          'flex h-full flex-col',
          compact
            ? 'justify-center p-5'
            : size === 'sm'
              ? 'justify-between p-4'
              : 'justify-between p-7 lg:p-9',
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandLogo branding={branding} size={size === 'sm' ? 'sm' : 'md'} />
          <span
            className={cn(
              'truncate font-semibold tracking-[-0.015em] text-(--art-ink)',
              size === 'sm' ? 'text-[13px] leading-5' : 'text-[17px] leading-6',
            )}
          >
            {branding.appName}
          </span>
        </div>
        {compact ? null : (
          <p
            data-testid="auth-art-tagline"
            className={cn(
              'max-w-[22ch] font-semibold tracking-[-0.022em] text-balance text-(--art-ink)',
              size === 'sm'
                ? 'text-[15px] leading-5'
                : 'text-[28px] leading-[34px] lg:text-[32px] lg:leading-[38px]',
            )}
          >
            {tagline}
          </p>
        )}
      </div>
    </div>
  )
}
