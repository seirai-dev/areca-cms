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
  status: EntryStatus
  testId?: string
}) {
  return (
    <Badge variant={entryVariant[status]} data-testid={testId}>
      {status}
    </Badge>
  )
}

export function PublicationStatusBadge({ status }: { status: PublicationStatus }) {
  return <Badge variant={publicationVariant[status]}>{status}</Badge>
}

export function JobStatusBadge({ status }: { status: BuildJobStatus }) {
  return <Badge variant={jobVariant[status]}>{status}</Badge>
}
