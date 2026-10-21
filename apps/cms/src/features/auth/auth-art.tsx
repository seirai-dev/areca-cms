import * as React from 'react'

import { BrandLogo } from '#/components/brand-mark'
import type { BrandingView } from '#/lib/branding'
import { cn } from '#/lib/utils'

import { accentTone } from './auth-art-tone'

/**
 * The branded panel beside the auth forms: layered dunes, two soft lights and
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
      {/* Sun, rings and dunes, back to front. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 600 800"
        preserveAspectRatio={compact ? 'xMidYMid slice' : 'xMidYMax slice'}
        className="pointer-events-none absolute inset-0 -z-10 size-full"
      >
        <defs>
          <radialGradient id={`${grainId}-sun`}>
            <stop offset="0%" stopColor="var(--art-glow)" stopOpacity="0.95" />
            <stop offset="70%" stopColor="var(--art-glow)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--art-glow)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g className="auth-art-drift-alt origin-center">
          <circle cx="420" cy="262" r="92" fill={`url(#${grainId}-sun)`} />
          <circle
            cx="420"
            cy="262"
            r="148"
            fill="none"
            stroke="var(--art-ink)"
            strokeOpacity="0.14"
          />
          <circle
            cx="420"
            cy="262"
            r="214"
            fill="none"
            stroke="var(--art-ink)"
            strokeOpacity="0.08"
            strokeDasharray="2 7"
          />
        </g>
        <g className="auth-art-drift origin-bottom">
          <path
            fill="var(--art-far)"
            d="M-60 470 C 70 420, 180 404, 290 432 C 392 458, 470 384, 660 356 L 660 820 L -60 820 Z"
          />
        </g>
        <g className="auth-art-drift-alt origin-bottom [animation-delay:-6s]">
          {/* The big dune: a lit face and a shaded face meeting at a crest. */}
          <path
            fill="var(--art-back)"
            d="M-60 610 C 70 566, 196 474, 326 404 C 378 376, 410 370, 442 382 C 522 412, 584 470, 660 506 L 660 820 L -60 820 Z"
          />
          <path
            fill="var(--art-shade)"
            d="M442 382 C 402 452, 336 520, 306 602 C 286 662, 302 726, 344 820 L 660 820 L 660 506 C 584 470, 522 412, 442 382 Z"
          />
          <path
            fill="none"
            stroke="var(--art-glow)"
            strokeOpacity="0.55"
            strokeWidth="1.5"
            strokeLinecap="round"
            d="M-60 610 C 70 566, 196 474, 326 404 C 378 376, 410 370, 442 382"
          />
        </g>
        <g className="auth-art-drift origin-bottom [animation-delay:-14s]">
          <path
            fill="var(--art-front)"
            d="M-60 706 C 120 652, 262 702, 382 678 C 482 658, 562 672, 660 640 L 660 820 L -60 820 Z"
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
