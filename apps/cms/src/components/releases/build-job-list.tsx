import { JobStatusBadge } from '#/components/editor/status-badge'
import { RelativeTime } from '#/components/ui/timeline'
import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'
import { Scroll, XCircle } from '@phosphor-icons/react'

import type { JobRow } from './types'

function duration(job: JobRow) {
  if (!job.startedAt) return null
  const start = new Date(job.startedAt).getTime()
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now()
  const seconds = Math.round((end - start) / 1000)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * The build jobs behind one publication (or the leftovers, grouped at the
 * bottom of the timeline). Flat rows, no box: this always sits inside
 * something that already has a frame.
 */
export function BuildJobList({
  jobs,
  canManage,
  onLogs,
  onCancel,
}: {
  jobs: JobRow[]
  canManage: boolean
  onLogs: (job: JobRow) => void
  onCancel: (job: JobRow) => void
}) {
  if (jobs.length === 0) {
    return (
      <p className="text-ds-body-sm text-text-muted">{m.releases_no_jobs()}</p>
    )
  }

  return (
    <ul className="grid gap-px" data-testid="build-jobs">
      {jobs.map((job) => {
        const took = duration(job)
        return (
          <li
            key={job.id}
            data-testid={`build-job-${job.status}`}
            className="grid gap-2 border-b border-border-subtle py-2 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
          >
            <JobStatusBadge status={job.status} />
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-ds-body-xs text-text-muted">
              <RelativeTime value={job.createdAt} />
              <span className="tnum">
                {job.attempts === 1
                  ? m.sites_attempts_one({ count: job.attempts })
                  : m.sites_attempts_other({ count: job.attempts })}
              </span>
              {took ? (
                <span className="tnum">
                  {m.releases_duration({ duration: took })}
                </span>
              ) : null}
              {job.status === 'failed' && job.error ? (
                <span className="truncate text-text-error" title={job.error}>
                  {job.error}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1 justify-self-start sm:justify-self-end">
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={() => onLogs(job)}
              >
                <Scroll />
                {m.sites_logs()}
              </Button>
              {canManage && job.status === 'queued' ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="text-text-error hover:bg-status-error-bg hover:text-text-error"
                  onClick={() => onCancel(job)}
                >
                  <XCircle />
                  {m.sites_cancel()}
                </Button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
