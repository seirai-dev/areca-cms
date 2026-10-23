import type { PausedJobs } from '#/server/ops/paused-jobs'

export type PausedRow = {
  key: string
  kind: 'storage' | 'schedule'
  id: string
  attempts: number
  /** Redacted, as stored. The row shows its first line; Details shows all of it. */
  lastError: string | null
  /** When it was queued (storage) or last tried (schedule). */
  at: Date
  /** Storage only: the full key, e.g. `sites/acme/uploads/hero-banner.webp`. */
  storageKey?: string
  /** Schedules only. */
  siteName?: string
  /** Schedules only. */
  organizationName?: string
}

/** One list for the panel: storage deletions first, then schedules, in server order. */
export function pausedRows(data: PausedJobs | undefined): PausedRow[] {
  if (!data) return []
  return [
    ...data.storage.map((row): PausedRow => ({
      key: `storage:${row.id}`,
      kind: 'storage',
      id: row.id,
      attempts: row.attempts,
      lastError: row.lastError,
      at: row.queuedAt,
      storageKey: row.id,
    })),
    ...data.schedules.map((row): PausedRow => ({
      key: `schedule:${row.id}`,
      kind: 'schedule',
      id: row.id,
      attempts: row.attempts,
      lastError: row.lastError,
      at: row.lastAttemptAt,
      siteName: row.siteName,
      organizationName: row.organizationName,
    })),
  ]
}

/** The last path segment of a storage key: the name people recognise a file by. */
export function storageFileName(key: string) {
  const segments = key.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? key
}

/** The first non-blank line of an error. Stack frames and detail go to Details. */
export function errorSummary(error: string | null): string | null {
  if (!error) return null
  const line = error
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  return line ?? null
}

/** The client name is said in the sentence only when it adds to the site name. */
export function clientDiffersFromSite(
  siteName: string,
  organizationName: string,
) {
  return siteName.trim().toLowerCase() !== organizationName.trim().toLowerCase()
}
