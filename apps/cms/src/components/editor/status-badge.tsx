import { Badge } from '#/components/ui/badge'
import type {
  BuildJobStatus,
  EntryStatus,
  PublicationStatus,
} from '#/lib/types'

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

const entryLabel: Record<EntryStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  scheduled: 'Scheduled',
  archived: 'Archived',
}

const jobLabel: Record<BuildJobStatus, string> = {
  queued: 'Queued',
  building: 'Building',
  validating: 'Validating',
  deploying: 'Deploying',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
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

export function EntryStatusBadge({
  status,
  testId,
}: {
  status: EntryStatus | 'unsaved'
  testId?: string
}) {
  const label = status === 'unsaved' ? 'Draft' : entryLabel[status]
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
      data-testid={testId}
      data-status={status}
    >
      {status}
    </Badge>
  )
}

export function JobStatusBadge({ status }: { status: BuildJobStatus }) {
  return (
    <Badge variant={jobVariant[status]} data-status={status}>
      {jobLabel[status]}
    </Badge>
  )
}
