import { Badge } from '#/components/ui/badge'
import type {
  BuildJobStatus,
  EntryStatus,
  PublicationStatus,
} from '#/lib/types'
import { m } from '#/paraglide/messages'

const entryVariant: Record<
  EntryStatus,
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'success'
  | 'muted'
  | 'warning'
> = {
  draft: 'outline',
  published: 'success',
  scheduled: 'warning',
  archived: 'muted',
}

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

export function EntryStatusBadge({
  status,
  testId,
}: {
  status: EntryStatus | 'unsaved'
  testId?: string
}) {
  const label = entryStatusLabel(status)
  const variant = status === 'unsaved' ? 'outline' : entryVariant[status]
  return (
    <Badge variant={variant} data-testid={testId} data-status={status}>
      {label}
    </Badge>
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
