import { stableStringify } from '#/lib/stable-json'
import type { EntryStatus } from '#/lib/types'

/**
 * The fields of an entry that "edited since ready" reads. Shared by the
 * client (entry pills, editor) and the server (list summaries), so both give
 * the same answer for the same entry.
 */
export type EditedSinceReadyInput = {
  status: EntryStatus
  updatedAt?: string | Date
  draftData?: unknown
  publishedData?: unknown
}

/**
 * A published entry whose draft differs from what was marked ready
 * ("Edited since ready"). Needs both `draftData` and `publishedData`.
 */
export function isEditedSinceReady(entry: EditedSinceReadyInput) {
  if (entry.status !== 'published') return false
  if (entry.draftData === undefined || entry.publishedData == null) return false
  return (
    stableStringify(entry.draftData, { undefinedAsNull: true }) !==
    stableStringify(entry.publishedData, { undefinedAsNull: true })
  )
}
