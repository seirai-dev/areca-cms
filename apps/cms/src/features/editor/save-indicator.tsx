import * as React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { CheckDraw, FailedIcon, SpinnerRing } from '#/components/ui/status-pill'
import { formatRelativeTime } from '#/lib/relative-time'
import { FADE } from '#/lib/motion'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

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
 * Couldn't save — fix N fields · Not saved yet — add a title.
 */
export function SaveIndicator({
  status,
  isNew,
  lastSavedAt,
  updatedAt,
  errorCount,
  onRetry,
  compact = false,
}: {
  status: SaveStatus
  isNew: boolean
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

  let key: string
  let icon: React.ReactNode = null
  let text: React.ReactNode
  let tone = 'text-text-muted'
  let action: React.ReactNode = null

  if (status === 'saving') {
    key = 'saving'
    icon = <SpinnerRing size={13} className="text-icon-muted" />
    text = m.editor_saving()
  } else if (status === 'failed') {
    key = 'failed'
    tone = 'text-text-error'
    icon = <FailedIcon size={13} className="text-icon-error" />
    text =
      errorCount > 0
        ? errorCount === 1
          ? m.editor_save_fix_one()
          : m.editor_save_fix_other({ count: errorCount })
        : m.editor_save_failed()
    action =
      errorCount > 0 ? null : (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-text-accent hover:underline"
          data-testid="save-retry"
        >
          {m.editor_save_retry()}
        </button>
      )
  } else if (isNew) {
    key = status === 'blocked' ? 'blocked' : 'new'
    text =
      status === 'blocked'
        ? m.editor_not_saved_add_title()
        : m.editor_not_saved_yet()
    icon = (
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-text-disabled"
      />
    )
  } else if (fresh) {
    key = 'fresh'
    icon = <CheckDraw size={13} className="text-icon-success" />
    text = m.editor_saved()
  } else {
    key = 'ago'
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
          {icon}
          <span className={cn('truncate', compact && 'sr-only')}>{text}</span>
          {action}
        </motion.span>
      </AnimatePresence>
    </p>
  )
}
