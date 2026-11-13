import * as React from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as motion from 'motion/react-m'

import { CheckDraw, FailedIcon, SpinnerRing } from '#/components/ui/status-pill'
import { formatRelativeTime } from '#/lib/relative-time'
import { FADE } from '#/lib/motion'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { CONFLICT_NOTICE_ID } from './conflict-notice'
import { saveIndicatorKind } from './save-indicator-state'
import type { SaveStatus } from './use-entry-editor'

const FRESH_MS = 4000

function useNow(interval = 20_000) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [interval])
  return now
}

/**
 * The live save state in the editor's top bar (brief §3.5): Saving… ·
 * Saved (a check draws in) · Saved 2m ago · Couldn't save + Retry ·
 * Couldn't save — fix N fields · Not saved yet — add a title ·
 * Draft changed elsewhere (no Retry; the text scrolls to the conflict notice).
 */
export function SaveIndicator({
  status,
  isNew,
  conflict = false,
  lastSavedAt,
  updatedAt,
  errorCount,
  onRetry,
  compact = false,
}: {
  status: SaveStatus
  isNew: boolean
  /** The draft moved on the server; the conflict notice explains it. */
  conflict?: boolean
  lastSavedAt: Date | null
  updatedAt?: string | Date
  errorCount: number
  onRetry: () => void
  compact?: boolean
}) {
  const now = useNow()
  const reduce = useReducedMotion()
  const [fresh, setFresh] = React.useState(false)

  React.useEffect(() => {
    if (status !== 'saved' || !lastSavedAt) return
    setFresh(true)
    const timer = setTimeout(() => setFresh(false), FRESH_MS)
    return () => clearTimeout(timer)
  }, [status, lastSavedAt])

  const kind = saveIndicatorKind({ status, isNew, conflict, errorCount, fresh })
  const key = kind
  let icon: React.ReactNode = null
  let text: React.ReactNode
  let tone = 'text-text-muted'
  let action: React.ReactNode = null

  function showConflictNotice() {
    document.getElementById(CONFLICT_NOTICE_ID)?.scrollIntoView({
      block: 'center',
      behavior: reduce ? 'auto' : 'smooth',
    })
  }

  if (kind === 'conflict') {
    tone = 'text-text-warning'
    icon = (
      <WarningCircle weight="fill" size={13} className="text-icon-warning" />
    )
    text = m.editor_draft_changed_elsewhere()
  } else if (kind === 'saving') {
    icon = <SpinnerRing size={13} className="text-icon-muted" />
    text = m.editor_saving()
  } else if (kind === 'fields' || kind === 'failed') {
    tone = 'text-text-error'
    icon = <FailedIcon size={13} className="text-icon-error" />
    text =
      kind === 'fields'
        ? errorCount === 1
          ? m.editor_save_fix_one()
          : m.editor_save_fix_other({ count: errorCount })
        : m.editor_save_failed()
    action =
      kind === 'fields' ? null : (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-text-accent hover:underline"
          data-testid="save-retry"
        >
          {m.editor_save_retry()}
        </button>
      )
  } else if (kind === 'blocked' || kind === 'new') {
    text =
      kind === 'blocked'
        ? m.editor_not_saved_add_title()
        : m.editor_not_saved_yet()
    icon = (
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-text-disabled"
      />
    )
  } else if (kind === 'fresh') {
    icon = <CheckDraw size={13} className="text-icon-success" />
    text = m.editor_saved()
  } else {
    const at = lastSavedAt ?? updatedAt
    void now
    text = at
      ? m.editor_saved_relative({ time: formatRelativeTime(at) })
      : m.editor_saved()
  }

  return (
    <p
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-[13px] leading-5 whitespace-nowrap',
        tone,
      )}
      aria-live="polite"
      data-testid="save-status"
      data-state={status}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={key}
          className="flex min-w-0 items-center gap-1.5"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={FADE}
        >
          {kind === 'conflict' ? (
            // The whole status is the control, so the compact (icon-only)
            // form keeps a visible focus target.
            <button
              type="button"
              onClick={showConflictNotice}
              className="flex min-w-0 items-center gap-1.5 font-medium hover:underline"
              data-testid="save-conflict"
            >
              {icon}
              <span className={cn('truncate', compact && 'sr-only')}>
                {text}
              </span>
            </button>
          ) : (
            <>
              {icon}
              <span className={cn('truncate', compact && 'sr-only')}>
                {text}
              </span>
              {action}
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </p>
  )
}
