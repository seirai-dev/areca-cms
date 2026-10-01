import type { EntryStatus } from '#/lib/types'

/** Poll this often while a scheduled entry is about to go live (or is due). */
export const DUE_POLL_MS = 3000
/** Start polling this long before a scheduled time. */
export const DUE_WINDOW_MS = 60_000
/** Stop polling for an entry that stays scheduled this long after its time
 *  (the worker is down or the job failed; the editor shows the truth). */
export const DUE_GIVE_UP_MS = 10 * 60_000

type ScheduledLike = { status: EntryStatus; scheduledAt: string | Date | null }

/** The scheduled times (ms) of the rows that are still scheduled. */
export function scheduledTimes(rows: ReadonlyArray<ScheduledLike>) {
  const times: number[] = []
  for (const row of rows) {
    if (row.status !== 'scheduled' || !row.scheduledAt) continue
    const at = new Date(row.scheduledAt).getTime()
    if (!Number.isNaN(at)) times.push(at)
  }
  return times
}

/** Poll while any scheduled time is less than a minute away or recently passed. */
export function shouldPollScheduled(
  times: ReadonlyArray<number>,
  now = Date.now(),
) {
  return times.some((at) => {
    const delta = at - now
    return delta <= DUE_WINDOW_MS && delta >= -DUE_GIVE_UP_MS
  })
}

/** When the next scheduled time enters the polling window (ms), or null. */
export function nextPollStart(times: ReadonlyArray<number>, now = Date.now()) {
  let next: number | null = null
  for (const at of times) {
    const start = at - DUE_WINDOW_MS
    if (start > now && (next === null || start < next)) next = start
  }
  return next
}
