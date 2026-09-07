import { Badge } from '#/components/ui/badge'
import type { BuildJobStatus, EntryStatus, PublicationStatus } from '#/lib/types'

const entryVariant: Record<
  EntryStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  draft: 'secondary',
  published: 'default',
  scheduled: 'outline',
  archived: 'destructive',
}

const publicationVariant: Record<
  PublicationStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  pending: 'secondary',
  building: 'outline',
  live: 'default',
  failed: 'destructive',
  superseded: 'secondary',
  rolled_back: 'outline',
}

const jobVariant: Record<
  BuildJobStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  queued: 'secondary',
  building: 'outline',
  validating: 'outline',
  deploying: 'outline',
  succeeded: 'default',
  failed: 'destructive',
  cancelled: 'secondary',
}

export function EntryStatusBadge({
  status,
  testId,
}: {
  status: EntryStatus | 'unsaved'
  testId?: string
}) {
  const label = status === 'unsaved' ? 'draft' : status
  const variant = status === 'unsaved' ? 'secondary' : entryVariant[status]
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
    <Badge variant={publicationVariant[status]} data-testid={testId} data-status={status}>
      {status}
    </Badge>
  )
}

export function JobStatusBadge({ status }: { status: BuildJobStatus }) {
  return <Badge variant={jobVariant[status]}>{status}</Badge>
}
