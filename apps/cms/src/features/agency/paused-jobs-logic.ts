import type { PausedJobs } from '#/server/ops/paused-jobs'

export type PausedRow = {
  key: string
  kind: 'storage' | 'schedule'
  id: string
  attempts: number
  lastError: string | null
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
    })),
    ...data.schedules.map((row): PausedRow => ({
      key: `schedule:${row.id}`,
      kind: 'schedule',
      id: row.id,
      attempts: row.attempts,
      lastError: row.lastError,
      siteName: row.siteName,
      organizationName: row.organizationName,
    })),
  ]
}
