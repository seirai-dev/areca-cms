import {
  archiveEntry,
  deleteEntry,
  publishEntry,
  unpublishEntry,
} from './entries'

/** The single-entry actions the bulk bar and the MCP mark_ready tool apply to many ids. */
export const BULK_ENTRY_ACTIONS = [
  'ready',
  'draft',
  'archive',
  'delete',
] as const

export type BulkEntryAction = (typeof BULK_ENTRY_ACTIONS)[number]

/**
 * Applies one action to one entry. The caller checks that the entry belongs
 * to the site and that the caller may act on it (docs/design/dev-environments.md,
 * Decision 19). Errors are thrown; the caller decides how to report them.
 */
export async function applyBulkEntryAction(
  action: BulkEntryAction,
  id: string,
  actorId: string,
): Promise<void> {
  switch (action) {
    case 'ready':
      await publishEntry(id, actorId)
      return
    case 'draft':
      await unpublishEntry(id, actorId)
      return
    case 'archive':
      await archiveEntry(id, actorId)
      return
    case 'delete':
      await deleteEntry(id, actorId)
      return
  }
}
