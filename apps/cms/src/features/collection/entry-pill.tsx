import {
  EditedMarker,
  StatusPill,
  formatScheduleShort,
} from '#/components/ui/status-pill'
import { entryLiveState } from '#/features/golive/entry-live-state'
import type { EntryLike } from '#/features/golive/entry-live-state'
import type { ReleaseStatusData } from '#/features/golive/queries'
import { ENTRY_STATUS } from '#/lib/status'
import type { EntryUiStatus } from '#/lib/status'

/**
 * The entry status pill of the Collection and the editor (brief §1.2):
 * Draft · Ready · Live · Scheduled "Fri 9:00" · Archived, plus the
 * "Edited since ready" dot. `data-status` keeps the backend status (the
 * test contract); `data-ui-status` carries the UI status.
 *
 * `live` is `useReleaseStatus(siteId).data?.live` (undefined while loading).
 */
export function EntryPill({
  entry,
  live,
  long = false,
  size,
  testId,
  className,
}: {
  entry: EntryLike
  live: ReleaseStatusData['live'] | undefined
  long?: boolean
  size?: 'sm' | 'md'
  testId?: string
  className?: string
}) {
  const state = entryLiveState(entry, live)
  return (
    <EntryPillView
      status={state.status}
      backendStatus={entry.status}
      scheduledAt={state.scheduledAt}
      editedSinceReady={state.editedSinceReady}
      long={long}
      size={size}
      testId={testId}
      className={className}
    />
  )
}

export function EntryPillView({
  status,
  backendStatus,
  scheduledAt,
  editedSinceReady,
  long,
  size,
  testId,
  className,
}: {
  status: EntryUiStatus
  backendStatus: string
  scheduledAt?: string | Date | null
  editedSinceReady?: boolean
  long?: boolean
  size?: 'sm' | 'md'
  testId?: string
  className?: string
}) {
  const meta = ENTRY_STATUS[status]
  const label =
    status === 'scheduled' && scheduledAt
      ? formatScheduleShort(scheduledAt)
      : long
        ? meta.long()
        : meta.label()
  return (
    <StatusPill
      tone={meta.tone}
      icon={meta.icon}
      label={label}
      status={backendStatus}
      size={size}
      data-ui-status={status}
      data-testid={testId}
      aria-label={status === 'scheduled' ? `${meta.label()} ${label}` : undefined}
      className={className}
    >
      {editedSinceReady ? <EditedMarker /> : null}
    </StatusPill>
  )
}
