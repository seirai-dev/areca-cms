import { Badge } from '#/components/ui/badge'
import { StatusPill, formatScheduleShort } from '#/components/ui/status-pill'
import { entryUiStatus } from '#/features/golive/entry-live-state'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { ENTRY_STATUS } from '#/lib/status'
import type { EntryUiStatus } from '#/lib/status'
import type {
  BuildJobStatus,
  EntryStatus,
  PublicationStatus,
} from '#/lib/types'
import { m } from '#/paraglide/messages'

const publicationVariant: Record<
  PublicationStatus,
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'success'
  | 'muted'
  | 'warning'
> = {
  pending: 'outline',
  building: 'warning',
  live: 'success',
  failed: 'destructive',
  superseded: 'muted',
  rolled_back: 'outline',
}

const jobVariant: Record<
  BuildJobStatus,
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'success'
  | 'muted'
  | 'warning'
> = {
  queued: 'outline',
  building: 'warning',
  validating: 'warning',
  deploying: 'warning',
  succeeded: 'success',
  failed: 'destructive',
  cancelled: 'muted',
}

export function entryStatusLabel(status: EntryStatus | 'unsaved') {
  switch (status) {
    case 'unsaved':
    case 'draft':
      return m.editor_status_draft()
    case 'published':
      return m.editor_status_published()
    case 'scheduled':
      return m.editor_status_scheduled()
    case 'archived':
      return m.editor_status_archived()
  }
}

export function publicationStatusLabel(status: PublicationStatus) {
  switch (status) {
    case 'pending':
      return m.editor_publication_pending()
    case 'building':
      return m.editor_publication_building()
    case 'live':
      return m.editor_publication_live()
    case 'failed':
      return m.editor_publication_failed()
    case 'superseded':
      return m.editor_publication_superseded()
    case 'rolled_back':
      return m.editor_publication_rolled_back()
  }
}

export function jobStatusLabel(status: BuildJobStatus) {
  switch (status) {
    case 'queued':
      return m.editor_job_queued()
    case 'building':
      return m.editor_job_building()
    case 'validating':
      return m.editor_job_validating()
    case 'deploying':
      return m.editor_job_deploying()
    case 'succeeded':
      return m.editor_job_succeeded()
    case 'failed':
      return m.editor_job_failed()
    case 'cancelled':
      return m.editor_job_cancelled()
  }
}

/**
 * LEGACY (phase 1 bridge): the old entry badge now speaks the new vocabulary
 * (Draft · Ready · Live · Scheduled · Archived, from `lib/status.ts`). Pass
 * `siteId` and `updatedAt` so a published entry resolves to Ready or Live;
 * `data-status` keeps the backend status for existing tests.
 */
export function EntryStatusBadge({
  status,
  testId,
  siteId,
  updatedAt,
  scheduledAt,
}: {
  status: EntryStatus | 'unsaved'
  testId?: string
  siteId?: string
  updatedAt?: string | Date
  scheduledAt?: string | Date | null
}) {
  const release = useReleaseStatus(siteId)
  const ui: EntryUiStatus =
    status === 'unsaved'
      ? 'draft'
      : entryUiStatus(
          { status, updatedAt: updatedAt ?? new Date(0) },
          siteId && updatedAt && release.data ? release.live : undefined,
        )
  const meta = ENTRY_STATUS[ui]
  const label =
    ui === 'scheduled' && scheduledAt
      ? formatScheduleShort(scheduledAt)
      : meta.label()
  return (
    <StatusPill
      tone={meta.tone}
      icon={meta.icon}
      label={label}
      status={status}
      data-ui-status={ui}
      data-testid={testId}
    />
  )
}

export function PublicationStatusBadge({
  status,
  testId,
}: {
  status: PublicationStatus
  testId?: string
}) {
  return (
    <Badge
      variant={publicationVariant[status]}
      dot={status === 'live'}
      data-testid={testId}
      data-status={status}
    >
      {publicationStatusLabel(status)}
    </Badge>
  )
}

export function JobStatusBadge({ status }: { status: BuildJobStatus }) {
  return (
    <Badge variant={jobVariant[status]} data-status={status}>
      {jobStatusLabel(status)}
    </Badge>
  )
}
