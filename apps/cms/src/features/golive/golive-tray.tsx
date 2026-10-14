import * as React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CaretRight, RocketLaunch } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import {
  CheckDraw,
  FailedIcon,
  LiveDot,
  SpinnerRing,
} from '#/components/ui/status-pill'
import { Hint } from '#/components/ui/tooltip'
import { usePanel } from '#/features/shell/panel'
import { formatRelativeTime } from '#/lib/relative-time'
import { EASE_STANDARD, SPRING_SMALL } from '#/lib/motion'
import { GO_LIVE_STEPS, JOB_STATUS } from '#/lib/status'
import type { BuildJobStatus } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { canGoLive } from './go-live-gate'
import { useGoLive } from './use-go-live'
import { useReleaseStatus } from './use-release-status'
import type { GoLiveState, ReleaseStatus } from './use-release-status'

/** "3 changes ready" / "1 change ready". */
export function changesReadyLabel(count: number) {
  return count === 1
    ? m.golive_changes_ready_one({ count })
    : m.golive_changes_ready_other({ count })
}

export function editorPublishReason() {
  return m.golive_editor_reason()
}

/** Remembers a going-live → up-to-date transition for the check bloom. */
function useJustWentLive(state: GoLiveState) {
  const previous = React.useRef(state)
  const [bloom, setBloom] = React.useState(false)
  React.useEffect(() => {
    if (previous.current === 'going-live' && state === 'up-to-date') {
      setBloom(true)
      const timer = window.setTimeout(() => setBloom(false), 1400)
      previous.current = state
      return () => window.clearTimeout(timer)
    }
    previous.current = state
  }, [state])
  return bloom
}

/**
 * The step line while going live: Queued · Building · Checking · Deploying.
 * `compact` (the sidebar tray) shows four step ticks and the current label.
 */
export function GoLiveSteps({
  step,
  compact = false,
  className,
}: {
  step: BuildJobStatus | null
  compact?: boolean
  className?: string
}) {
  const current = step ? Math.max(0, GO_LIVE_STEPS.indexOf(step)) : 0
  if (compact) {
    return (
      <div
        className={cn('flex items-center gap-2', className)}
        role="group"
        aria-label={m.golive_steps_label()}
      >
        <span className="flex items-center gap-1" aria-hidden="true">
          {GO_LIVE_STEPS.map((item, index) => (
            <span
              key={item}
              className={cn(
                'h-1 w-3 rounded-full transition-colors duration-300',
                index <= current ? 'bg-accent' : 'bg-accent-soft',
              )}
            />
          ))}
        </span>
        <span
          className="text-[11.5px] leading-4 font-medium text-accent-text"
          aria-current="step"
        >
          {JOB_STATUS[GO_LIVE_STEPS[current]].label()}
        </span>
        <span className="ml-auto text-[11.5px] leading-4 text-text-muted tnum">
          {current + 1}/{GO_LIVE_STEPS.length}
        </span>
      </div>
    )
  }
  return (
    <ol
      className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1', className)}
      aria-label={m.golive_steps_label()}
    >
      {GO_LIVE_STEPS.map((item, index) => {
        const done = index < current
        const active = index === current
        return (
          <li
            key={item}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-1.5 text-[11.5px] leading-4 font-medium',
              active
                ? 'text-accent-text'
                : done
                  ? 'text-text-secondary'
                  : 'text-text-muted',
            )}
          >
            {index > 0 ? (
              <span aria-hidden="true" className="text-text-disabled">
                ·
              </span>
            ) : null}
            {JOB_STATUS[item].label()}
          </li>
        )
      })}
    </ol>
  )
}

/** Indeterminate accent progress bar. */
export function IndeterminateBar({ className }: { className?: string }) {
  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-label={m.golive_going_live()}
      className={cn(
        'relative h-1 w-full overflow-hidden rounded-full bg-accent-soft',
        className,
      )}
    >
      <span className="absolute inset-y-0 left-0 w-2/5 animate-indeterminate rounded-full bg-accent motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
    </div>
  )
}

function GoLiveButton({
  canPublish,
  blocked = false,
  onGoLive,
  pending,
  label = m.golive_go_live(),
  variant = 'primary',
  size = 'sm',
  className,
  testId = 'publish-site',
  fullWidth = true,
}: {
  canPublish: boolean
  /** Sections block go live; the reason says to fix them, not who may publish. */
  blocked?: boolean
  onGoLive: () => void
  pending: boolean
  label?: string
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md'
  className?: string
  testId?: string
  fullWidth?: boolean
}) {
  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      data-testid={testId}
      disabled={!canPublish}
      loading={pending}
      onClick={(event) => {
        event.stopPropagation()
        onGoLive()
      }}
      className={cn(fullWidth && 'w-full', className)}
    >
      {pending ? null : <RocketLaunch weight="fill" />}
      {label}
    </Button>
  )
  if (canPublish) return button
  return (
    <Hint
      label={blocked ? m.golive_blocked_reason() : editorPublishReason()}
      side="top"
      wrapDisabled
      className={fullWidth ? 'w-full' : undefined}
    >
      {button}
    </Hint>
  )
}

/**
 * The Go‑live tray at the bottom of the site sidebar (brief §1.2, §3.6). It
 * always shows the site's publishing state and animates between states
 * (layout animation). Everything opens the Go‑live panel
 * (`?panel=golive`); the button goes live directly.
 *
 * Test ids: `release-status` (root, `data-state`), `release-live` (the live
 * line), `publish-site` (the Go live button).
 */
export function GoLiveTray({
  siteId,
  canPublish: canPublishRole,
  collapsed = false,
}: {
  siteId: string
  canPublish: boolean
  collapsed?: boolean
}) {
  const release = useReleaseStatus(siteId)
  // A blocked site (site content never marked ready) cannot go live yet.
  const blocked = (release.data?.blockers?.length ?? 0) > 0
  const canPublish = canGoLive({
    canPublish: canPublishRole,
    blockers: release.data?.blockers,
  })
  const { goLive, isPending } = useGoLive(siteId)
  const panel = usePanel()
  const reduce = useReducedMotion()
  const bloom = useJustWentLive(release.state)

  async function handleGoLive() {
    const result = await goLive().catch(() => null)
    if (result && 'ok' in result && result.ok === false) panel.open('golive')
  }

  if (release.data?.publishingMode === 'demo') {
    return (
      <div
        data-testid="release-status"
        data-state="demo"
        className="grid gap-2 rounded-control border border-border-default p-3"
      >
        <button type="button" onClick={() => panel.open('golive')}>
          {m.golive_demo_mode()} ·{' '}
          {release.data.demo ? m.golive_demo_ready() : m.golive_not_published()}{' '}
          · {m.golive_never_production_live()}
        </button>
        {canPublish ? (
          <button
            type="button"
            disabled={isPending || Boolean(release.data.activeJob)}
            onClick={() => void handleGoLive()}
          >
            {m.golive_publish_demo()}
          </button>
        ) : null}
      </div>
    )
  }

  if (collapsed) {
    return (
      <TrayRailButton release={release} onOpen={() => panel.open('golive')} />
    )
  }

  const state = release.state
  const card = state !== 'up-to-date' && state !== 'loading'

  return (
    <motion.div
      layout={!reduce}
      transition={SPRING_SMALL}
      data-testid="release-status"
      data-state={state}
      data-pending={release.pending}
      aria-live="polite"
      className={cn(
        'relative overflow-hidden rounded-[14px]',
        card &&
          'border border-border-default bg-background-surface shadow-card',
        state === 'going-live' && 'animate-border-pulse border-transparent',
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={bloom ? 'bloom' : state}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: EASE_STANDARD }}
        >
          {bloom ? (
            <TrayRow onClick={() => panel.open('golive')} testId="release-live">
              <motion.span
                className="grid size-5 place-content-center rounded-full bg-status-success-bg text-icon-success"
                initial={reduce ? false : { scale: 0.4 }}
                animate={{ scale: [0.4, 1.25, 1] }}
                transition={{ duration: 0.5, ease: EASE_STANDARD }}
              >
                <CheckDraw size={14} circle={false} />
              </motion.span>
              <span className="truncate font-medium text-text-primary">
                {m.golive_went_live()}
              </span>
            </TrayRow>
          ) : state === 'loading' ? (
            <div className="flex h-10 items-center gap-2.5 px-2.5">
              <span className="size-2 rounded-full bg-border-strong" />
              <span className="h-3 w-24 rounded bg-background-subtle" />
            </div>
          ) : state === 'up-to-date' ? (
            <TrayRow onClick={() => panel.open('golive')} testId="release-live">
              <LiveDot pulse="loop" />
              <span className="truncate">
                <span className="font-medium text-text-primary">
                  {m.shell_status_live()}
                </span>
                <span className="text-text-muted">
                  {' · '}
                  {m.golive_up_to_date()}
                </span>
              </span>
            </TrayRow>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() =>
                panel.open('golive', {
                  release: release.lastFailure?.publicationId,
                })
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  panel.open('golive')
                }
              }}
              aria-label={m.golive_open_panel()}
              className="grid cursor-pointer gap-2.5 p-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
            >
              {state === 'ready' ? (
                <>
                  <TrayHeading
                    title={changesReadyLabel(release.pending)}
                    subtitle={
                      release.liveSince
                        ? m.golive_last_live({
                            time: formatRelativeTime(release.liveSince),
                          })
                        : undefined
                    }
                  />
                  <GoLiveButton
                    canPublish={canPublish}
                    blocked={blocked}
                    pending={isPending}
                    onGoLive={() => void handleGoLive()}
                  />
                </>
              ) : state === 'never-live' ? (
                <>
                  <TrayHeading
                    title={m.golive_not_live_yet()}
                    subtitle={
                      release.pending > 0
                        ? changesReadyLabel(release.pending)
                        : m.golive_never_live_hint()
                    }
                  />
                  <GoLiveButton
                    canPublish={canPublish}
                    blocked={blocked}
                    pending={isPending}
                    onGoLive={() => void handleGoLive()}
                  />
                </>
              ) : state === 'going-live' ? (
                <>
                  <div className="flex items-center gap-2">
                    <SpinnerRing size={14} className="text-icon-accent" />
                    <span className="text-[13.5px] leading-5 font-semibold text-text-primary">
                      {m.golive_going_live()}
                    </span>
                  </div>
                  <GoLiveSteps step={release.step} compact />
                  <IndeterminateBar />
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <FailedIcon size={16} className="mt-0.5 text-icon-error" />
                    <div className="grid min-w-0 gap-0.5">
                      <span className="text-[13.5px] leading-5 font-semibold text-text-primary">
                        {m.golive_last_failed()}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[12px] leading-4 font-medium text-text-accent">
                        {m.golive_see_what_happened()}
                        <CaretRight weight="bold" className="size-3" />
                      </span>
                    </div>
                  </div>
                  <GoLiveButton
                    canPublish={canPublish}
                    blocked={blocked}
                    pending={isPending}
                    variant="secondary"
                    label={m.golive_try_again()}
                    onGoLive={() => void handleGoLive()}
                  />
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

function TrayHeading({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[13.5px] leading-5 font-semibold text-text-primary tnum">
        {title}
      </span>
      {subtitle ? (
        <span
          className="line-clamp-2 text-[12px] leading-4 text-text-muted"
          data-testid="release-live"
        >
          {subtitle}
        </span>
      ) : null}
    </div>
  )
}

function TrayRow({
  children,
  onClick,
  testId,
}: {
  children: React.ReactNode
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={m.golive_open_panel()}
      className="flex h-10 w-full min-w-0 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] leading-5 outline-none transition-colors hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
    >
      {children}
    </button>
  )
}

/** Collapsed-rail tray: one icon with the state in a tooltip. */
function TrayRailButton({
  release,
  onOpen,
}: {
  release: ReleaseStatus
  onOpen: () => void
}) {
  const label =
    release.state === 'ready'
      ? changesReadyLabel(release.pending)
      : release.state === 'going-live'
        ? m.golive_going_live()
        : release.state === 'failed'
          ? m.golive_last_failed()
          : release.state === 'never-live'
            ? m.golive_not_live_yet()
            : `${m.shell_status_live()} · ${m.golive_up_to_date()}`
  return (
    <Hint label={label} side="right">
      <button
        type="button"
        onClick={onOpen}
        data-testid="release-status"
        data-state={release.state}
        aria-label={label}
        className="relative grid size-10 place-content-center rounded-[10px] outline-none transition-colors hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:outline-border-focus"
      >
        {release.state === 'going-live' ? (
          <SpinnerRing size={18} className="text-icon-accent" />
        ) : release.state === 'failed' ? (
          <FailedIcon size={18} className="text-icon-error" />
        ) : release.state === 'up-to-date' ? (
          <LiveDot pulse="loop" />
        ) : (
          <RocketLaunch size={18} className="text-icon-accent" />
        )}
        {release.state === 'ready' ? (
          <span className="absolute top-1 right-1 grid h-4 min-w-4 place-content-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-accent-contrast tnum">
            {release.pending}
          </span>
        ) : null}
      </button>
    </Hint>
  )
}

/** Mobile top-bar pill ("3 ready"); opens the panel as a sheet. */
export function GoLivePill({ siteId }: { siteId: string }) {
  const release = useReleaseStatus(siteId)
  const panel = usePanel()
  if (release.state === 'loading') return null
  const label =
    release.state === 'ready'
      ? m.golive_pill_ready({ count: release.pending })
      : release.state === 'going-live'
        ? m.golive_pill_going_live()
        : release.state === 'failed'
          ? m.golive_pub_failed()
          : release.state === 'never-live'
            ? m.golive_pill_not_live()
            : m.shell_status_live()
  return (
    <button
      type="button"
      onClick={() => panel.open('golive')}
      data-testid="golive-pill"
      data-state={release.state}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        release.state === 'ready' || release.state === 'never-live'
          ? 'bg-accent-soft text-accent-text'
          : release.state === 'failed'
            ? 'bg-status-error-bg text-text-error'
            : 'bg-background-subtle text-text-secondary',
      )}
    >
      {release.state === 'going-live' ? (
        <SpinnerRing size={12} />
      ) : release.state === 'up-to-date' ? (
        <LiveDot pulse="none" />
      ) : release.state === 'failed' ? (
        <FailedIcon size={12} />
      ) : (
        <span className="size-1.5 rounded-full bg-accent" />
      )}
      <span className="tnum">{label}</span>
    </button>
  )
}

export { GoLiveButton }
