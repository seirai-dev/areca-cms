import type { SaveStatus } from './use-entry-editor'

/** Which save-status copy the editor header shows. */
export type SaveIndicatorKind =
  | 'conflict'
  | 'saving'
  | 'fields'
  | 'failed'
  | 'blocked'
  | 'new'
  | 'fresh'
  | 'ago'

/**
 * Picks the header save copy. A draft conflict outranks every save state: the
 * conflict notice is up, and retrying would only conflict again.
 */
export function saveIndicatorKind({
  status,
  isNew,
  conflict,
  errorCount,
  fresh,
}: {
  status: SaveStatus
  isNew: boolean
  conflict: boolean
  errorCount: number
  fresh: boolean
}): SaveIndicatorKind {
  if (conflict) return 'conflict'
  if (status === 'saving') return 'saving'
  if (status === 'failed') return errorCount > 0 ? 'fields' : 'failed'
  if (isNew) return status === 'blocked' ? 'blocked' : 'new'
  if (fresh) return 'fresh'
  return 'ago'
}
