/**
 * Entry history grouping (brief §3.5): autosave writes a revision on every
 * save, so consecutive `update` revisions by the same author, each within 15
 * minutes of the next, collapse into one "Edited · N saves" item.
 */

export type RevisionLike = {
  id: string
  createdAt: string | Date
  note: string | null
  createdBy?: string | null
  createdByName?: string | null
}

export type RevisionGroup<T extends RevisionLike = RevisionLike> = {
  /** Id of the newest revision in the group (stable React key). */
  id: string
  note: string
  /** Newest first, like the input. */
  items: T[]
}

export const GROUP_WINDOW_MS = 15 * 60 * 1000

function time(value: string | Date) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function author(revision: RevisionLike) {
  return revision.createdBy ?? revision.createdByName ?? null
}

/** `revisions` newest first (as `listRevisionsFn` returns them). */
export function groupRevisions<T extends RevisionLike>(
  revisions: T[],
  windowMs = GROUP_WINDOW_MS,
): RevisionGroup<T>[] {
  const groups: RevisionGroup<T>[] = []
  for (const revision of revisions) {
    const note = revision.note ?? 'update'
    const current = groups.at(-1)
    const previous = current?.items.at(-1)
    if (
      current &&
      previous &&
      note === 'update' &&
      current.note === 'update' &&
      author(previous) === author(revision) &&
      Math.abs(time(previous.createdAt) - time(revision.createdAt)) <= windowMs
    ) {
      current.items.push(revision)
      continue
    }
    groups.push({ id: revision.id, note, items: [revision] })
  }
  return groups
}
