import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { PublicationStatusBadge } from '#/components/editor/status-badge'
import { RelativeTime, TimelineItem } from '#/components/timeline'
import type { TimelineTone } from '#/components/timeline'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { shortId } from '#/components/editor/utils'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import {
  ArrowCounterClockwise,
  CaretDown,
  DotsThree,
} from '@phosphor-icons/react'

import { BuildJobList } from './build-job-list'
import type { JobRow, PublicationRow as Publication } from './types'

function toneFor(status: Publication['status']): TimelineTone {
  switch (status) {
    case 'live':
      return 'success'
    case 'building':
    case 'pending':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'muted'
  }
}

export function canRollback(row: Publication) {
  return row.wasLive && row.status !== 'live'
}

/**
 * One publication on the timeline. Collapsed it reads as a line of facts;
 * expanded it reveals the build jobs that produced it.
 */
export function PublicationTimelineRow({
  row,
  jobs,
  expanded,
  onToggle,
  canManage,
  onRollback,
  onLogs,
  onCancel,
}: {
  row: Publication
  jobs: JobRow[]
  expanded: boolean
  onToggle: () => void
  canManage: boolean
  onRollback: () => void
  onLogs: (job: JobRow) => void
  onCancel: (job: JobRow) => void
}) {
  const reduceMotion = useReducedMotion()
  const live = row.status === 'live'
  const showRollback = canManage && canRollback(row)

  return (
    <TimelineItem
      tone={toneFor(row.status)}
      data-testid={`publication-${row.status}`}
    >
      <div
        className={cn(
          'rounded-surface border border-border-default bg-background-surface',
          live && 'border-status-success/40',
        )}
      >
        <div className="flex items-center gap-2 pr-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-surface px-4 py-3 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-strong"
          >
            <CaretDown
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0 text-icon-muted transition-transform duration-[180ms] motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
            />
            <PublicationStatusBadge
              status={row.status}
              testId={`publication-status-${row.status}`}
            />
            <RelativeTime
              value={row.createdAt}
              className="text-ds-label-md text-text-primary"
            />
            <span className="truncate text-ds-body-xs text-text-muted">
              {m.sites_requested_by_name({
                name: row.requestedByName ?? m.sites_system(),
              })}
            </span>
            <span
              className="text-ds-mono-xs text-text-muted"
              title={row.snapshotHash}
            >
              {shortId(row.snapshotHash)}
            </span>
            <span className="sr-only">
              {expanded ? m.releases_hide_builds() : m.releases_show_builds()}
            </span>
          </button>
          {showRollback ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.releases_actions()}
                  data-testid="publication-menu"
                >
                  <DotsThree />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="rollback-publication"
                  onSelect={onRollback}
                >
                  <ArrowCounterClockwise />
                  {m.releases_rollback_to_this()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              key="jobs"
              initial={reduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{
                duration: reduceMotion ? 0 : 0.18,
                ease: [0.2, 0.8, 0.2, 1],
              }}
              className="overflow-hidden"
            >
              <div className="border-t border-border-subtle px-4 py-3">
                <BuildJobList
                  jobs={jobs}
                  canManage={canManage}
                  onLogs={onLogs}
                  onCancel={onCancel}
                />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </TimelineItem>
  )
}
