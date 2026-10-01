import * as React from 'react'
import {
  Archive,
  ArrowCounterClockwise,
  ArrowUUpLeft,
  CalendarX,
  CaretDown,
  CheckCircle,
  PencilSimple,
  Sparkle,
} from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { Button } from '#/components/ui/button'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { ClockIcon } from '#/components/ui/status-pill'
import {
  RelativeTime,
  Timeline,
  TimelineItem,
  absoluteTimeLabel,
} from '#/components/ui/timeline'
import { Hint } from '#/components/ui/tooltip'
import { editorPublishReason } from '#/features/golive/golive-tray'
import { EASE_STANDARD } from '#/lib/motion'
import type { StatusTone } from '#/lib/status'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

import { groupRevisions } from './revision-groups'
import type { RevisionGroup } from './revision-groups'
import type { RevisionRecord } from './use-entry-editor'

const PAGE = 12

function noteMeta(note: string): {
  title: () => string
  icon: React.ReactNode
  tone: StatusTone | 'plain'
} {
  switch (note) {
    case 'create':
      return {
        title: () => m.editor_history_created(),
        icon: <Sparkle weight="fill" />,
        tone: 'accent',
      }
    case 'publish':
      return {
        title: () => m.editor_history_ready(),
        icon: <CheckCircle weight="fill" />,
        tone: 'accent',
      }
    case 'unpublish':
      return {
        title: () => m.editor_history_draft(),
        icon: <ArrowUUpLeft weight="bold" />,
        tone: 'neutral',
      }
    case 'archive':
      return {
        title: () => m.editor_history_archived(),
        icon: <Archive weight="bold" />,
        tone: 'neutral',
      }
    case 'schedule':
      return {
        title: () => m.editor_history_scheduled(),
        icon: <ClockIcon size={14} />,
        tone: 'warning',
      }
    case 'cancel_schedule':
      return {
        title: () => m.editor_history_unscheduled(),
        icon: <CalendarX weight="bold" />,
        tone: 'neutral',
      }
    case 'restore':
      return {
        title: () => m.editor_history_restored(),
        icon: <ArrowCounterClockwise weight="bold" />,
        tone: 'success',
      }
    default:
      return {
        title: () => m.editor_history_edited(),
        icon: <PencilSimple weight="bold" />,
        tone: 'plain',
      }
  }
}

/**
 * Entry history (brief §3.5): a timeline in the Proposal Activity style.
 * Runs of autosaves by one person collapse into "Edited · 8 saves", which
 * expands. Restore sits on each item (owners/admins; editors see it
 * disabled with the reason), behind the existing confirm.
 */
export function EntryHistory({
  revisions,
  loading,
  error,
  onRetry,
  canManage,
  onRestore,
}: {
  revisions: RevisionRecord[]
  loading: boolean
  error: unknown
  onRetry: () => void
  canManage: boolean
  onRestore: (revisionId: string) => void
}) {
  const [limit, setLimit] = React.useState(PAGE)
  const groups = React.useMemo(() => groupRevisions(revisions), [revisions])

  if (loading) {
    return (
      <div className="grid gap-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-7 rounded-full" />
            <div className="grid flex-1 gap-1.5 pt-1">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <QueryError
        error={error}
        title={m.editor_could_not_load_revisions()}
        onRetry={onRetry}
      />
    )
  }
  if (groups.length === 0) {
    return (
      <p className="text-callout text-text-muted">{m.editor_history_empty()}</p>
    )
  }

  const newestId = revisions[0]?.id

  return (
    <div
      className="grid gap-3"
      style={
        {
          '--timeline-ring': 'var(--color-background-surface)',
        } as React.CSSProperties
      }
    >
      <Timeline data-testid="entry-history">
        {groups.slice(0, limit).map((group) => (
          <HistoryItem
            key={group.id}
            group={group}
            newestId={newestId}
            canManage={canManage}
            onRestore={onRestore}
          />
        ))}
      </Timeline>
      {groups.length > limit ? (
        <Button
          type="button"
          variant="quiet"
          size="sm"
          className="w-fit"
          onClick={() => setLimit((value) => value + PAGE)}
        >
          {m.collection_show_more()}
        </Button>
      ) : null}
    </div>
  )
}

function RestoreButton({
  revisionId,
  current,
  canManage,
  onRestore,
}: {
  revisionId: string
  current: boolean
  canManage: boolean
  onRestore: (revisionId: string) => void
}) {
  if (current) {
    return (
      <span className="rounded-full bg-background-subtle px-2 py-0.5 text-caption text-text-muted">
        {m.editor_current()}
      </span>
    )
  }
  return (
    <Hint
      label={canManage ? '' : editorPublishReason()}
      wrapDisabled={!canManage}
    >
      <Button
        type="button"
        size="xs"
        variant="quiet"
        disabled={!canManage}
        onClick={() => onRestore(revisionId)}
        data-testid="restore-revision"
      >
        {m.editor_restore()}
      </Button>
    </Hint>
  )
}

function HistoryItem({
  group,
  newestId,
  canManage,
  onRestore,
}: {
  group: RevisionGroup<RevisionRecord>
  newestId: string | undefined
  canManage: boolean
  onRestore: (revisionId: string) => void
}) {
  const reduce = useReducedMotion()
  const [open, setOpen] = React.useState(false)
  const latest = group.items[0]
  const meta = noteMeta(group.note)
  const count = group.items.length
  const title =
    count > 1 ? m.editor_history_edited_saves({ count }) : meta.title()
  const author = latest.createdByName?.trim() || m.editor_unknown_author()

  return (
    <TimelineItem
      icon={meta.icon}
      tone={meta.tone}
      title={title}
      // Time and author share one quiet line, so every item has the same
      // shape in the narrow details panel.
      meta={
        <span className="text-caption font-normal text-text-muted">
          <RelativeTime value={latest.createdAt} /> · {author}
        </span>
      }
      data-testid="history-item"
      data-note={group.note}
      actions={
        <RestoreButton
          revisionId={latest.id}
          current={latest.id === newestId}
          canManage={canManage}
          onRestore={onRestore}
        />
      }
    >
      {count > 1 ? (
        <div className="grid gap-1">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex w-fit items-center gap-1 text-caption text-text-secondary hover:text-text-primary"
          >
            <CaretDown
              weight="bold"
              className={cn(
                'size-3 transition-transform duration-150',
                open ? 'rotate-0' : '-rotate-90',
              )}
            />
            {open
              ? m.editor_history_hide_saves()
              : m.editor_history_show_saves()}
          </button>
          <AnimatePresence initial={false}>
            {open ? (
              <motion.ol
                initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={
                  reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }
                }
                exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: EASE_STANDARD }}
                className="grid overflow-hidden rounded-[10px] border border-border-default"
              >
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 border-b border-border-default px-2.5 py-1.5 text-caption font-normal text-text-secondary last:border-b-0"
                  >
                    <time
                      className="tnum"
                      dateTime={new Date(item.createdAt).toISOString()}
                      title={absoluteTimeLabel(item.createdAt)}
                    >
                      {new Intl.DateTimeFormat(getLocale(), {
                        hour: 'numeric',
                        minute: '2-digit',
                        second: '2-digit',
                      }).format(new Date(item.createdAt))}
                    </time>
                    <RestoreButton
                      revisionId={item.id}
                      current={item.id === newestId}
                      canManage={canManage}
                      onRestore={onRestore}
                    />
                  </li>
                ))}
              </motion.ol>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </TimelineItem>
  )
}
