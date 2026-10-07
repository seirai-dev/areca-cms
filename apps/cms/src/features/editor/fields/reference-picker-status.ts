import type { EntryUiStatus } from '#/lib/status'
import type { EntryStatus } from '#/lib/types'

/**
 * Eligible picker rows are Ready (published) or Scheduled. Live vs Ready is
 * decided at render time with `entryUiStatus` and the site's live release.
 */
export function referencePickerUiStatus(
  status: EntryStatus,
): Extract<EntryUiStatus, 'ready' | 'scheduled'> | null {
  if (status === 'published') return 'ready'
  if (status === 'scheduled') return 'scheduled'
  return null
}
