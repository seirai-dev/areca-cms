import type * as React from 'react'
import { useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'
import { RocketLaunch } from '@phosphor-icons/react'

import { Skeleton } from '#/components/ui/skeleton'
import {
  CheckDraw,
  FailedIcon,
  LiveDot,
  SpinnerRing,
} from '#/components/ui/status-pill'
import { formatRelativeTime } from '#/lib/relative-time'
import type { MeSite } from '#/lib/site-nav'
import { EASE_STANDARD } from '#/lib/motion'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { GoLiveSteps, IndeterminateBar, changesReadyLabel } from './golive-tray'
import type { ReleaseStatus } from './use-release-status'

export function StatusHero({
  site,
  release,
}: {
  site: MeSite
  release: ReleaseStatus
}) {
  const reduce = useReducedMotion()
  const { state, pending } = release

  let icon: React.ReactNode
  let tone: string
  let sentence: string
  let detail: React.ReactNode = null

  switch (state) {
    case 'loading':
      return (
        <div className="flex items-center gap-4 px-5 pt-2 pb-6">
          <Skeleton className="size-12 rounded-[14px]" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      )
    case 'going-live':
      icon = <SpinnerRing size={24} />
      tone = 'bg-accent-soft text-icon-accent'
      sentence = m.golive_hero_going_live({ site: site.name })
      detail = (
        <div className="grid gap-2.5 pt-1">
          <GoLiveSteps step={release.step} />
          <IndeterminateBar />
        </div>
      )
      break
    case 'failed':
      icon = <FailedIcon size={24} />
      tone = 'bg-status-error-bg text-icon-error'
      sentence = release.live
        ? m.golive_hero_failed()
        : m.golive_hero_failed_never_live()
      detail = release.lastFailure?.error ? (
        <p
          className="line-clamp-3 text-callout text-text-secondary"
          title={release.lastFailure.error}
        >
          {release.lastFailure.error}
        </p>
      ) : null
      break
    case 'never-live':
      icon = <RocketLaunch weight="fill" className="size-6" />
      tone = 'bg-accent-soft text-icon-accent'
      sentence =
        pending > 0
          ? m.golive_hero_not_live_ready({
              site: site.name,
              changes: changesReadyLabel(pending).toLowerCase(),
            })
          : m.golive_hero_not_live({ site: site.name })
      detail =
        pending > 0 ? null : (
          <p className="text-callout text-text-secondary">
            {m.golive_never_live_hint()}
          </p>
        )
      break
    case 'ready':
      icon = <RocketLaunch weight="fill" className="size-6" />
      tone = 'bg-accent-soft text-icon-accent'
      sentence = m.golive_hero_ready({
        site: site.name,
        changes: changesReadyLabel(pending).toLowerCase(),
      })
      break
    case 'up-to-date':
      icon = <CheckDraw size={24} circle={false} />
      tone = 'bg-status-success-bg text-icon-success'
      sentence = m.golive_hero_up_to_date({ site: site.name })
      break
  }

  return (
    <div
      className="grid gap-3 px-5 pt-2 pb-6"
      aria-live="polite"
      data-testid="golive-hero"
      data-state={state}
    >
      <div className="flex items-start gap-4">
        <motion.span
          key={state}
          initial={reduce ? false : { scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: EASE_STANDARD }}
          className={cn(
            'grid size-12 shrink-0 place-content-center rounded-[14px]',
            tone,
          )}
        >
          {icon}
        </motion.span>
        <div className="grid min-w-0 gap-1 pt-0.5">
          <p className="text-[17px] leading-6 font-semibold tracking-[-0.012em] text-balance text-text-primary">
            {sentence}
          </p>
          {release.liveSince ? (
            <p
              className="flex items-center gap-1.5 text-callout text-text-secondary"
              data-testid="release-live"
            >
              <LiveDot pulse="none" />
              {m.golive_live_since({
                time: formatRelativeTime(release.liveSince),
              })}
              <a
                href={site.productionUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-text-accent hover:underline"
              >
                {site.productionUrl
                  .replace(/^https?:\/\//, '')
                  .replace(/\/$/, '')}
              </a>
            </p>
          ) : null}
        </div>
      </div>
      {detail}
    </div>
  )
}
