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

/** Order-insensitive JSON for comparing draft and published data. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * A published entry whose draft differs from what was marked ready
 * ("Edited since ready"). Needs both `draftData` and `publishedData`.
 */
export function isEditedSinceReady(entry: EditedSinceReadyInput) {
  if (entry.status !== 'published') return false
  if (entry.draftData === undefined || entry.publishedData == null) return false
  return stable(entry.draftData) !== stable(entry.publishedData)
}
