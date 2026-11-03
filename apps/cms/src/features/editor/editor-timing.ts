/**
 * Timing rules of the entry editor, kept free of React so they can be tested
 * with plain numbers.
 */

/** Autosave waits this long after the last change (brief §3.5). */
export const AUTOSAVE_DELAY = 3000
/**
 * While the user keeps typing, a save still happens this long after the first
 * unsaved change, so a long edit is never held back for good.
 */
export const AUTOSAVE_MAX_WAIT = 10_000

/**
 * Milliseconds until the autosave timer should fire. `firstChangeAt` is when
 * the first change not yet saved was made. The timer restarts on every change,
 * but never fires later than `AUTOSAVE_MAX_WAIT` after that first change.
 */
export function autosaveDelay(now: number, firstChangeAt: number): number {
  const untilMaxWait = firstChangeAt + AUTOSAVE_MAX_WAIT - now
  return Math.max(0, Math.min(AUTOSAVE_DELAY, untilMaxWait))
}

/** Polling of a scheduled entry, while the worker has not published it yet. */
export const SCHEDULED_POLL_FAST = 2000
/** Polling of a scheduled entry that is still well away from its time. */
export const SCHEDULED_POLL_SLOW = 30_000
/** Within this window before the scheduled time, poll fast. */
export const SCHEDULED_POLL_WINDOW = 60_000

/**
 * How often to refetch a scheduled entry. Fast when it is due within the
 * window or already past due (the worker is about to publish it). Otherwise
 * slow, but never past the moment the fast window starts.
 */
export function scheduledPollInterval(
  scheduledAt: string | Date | null | undefined,
  now: number,
): number {
  if (!scheduledAt) return SCHEDULED_POLL_FAST
  const due = new Date(scheduledAt).getTime()
  if (!Number.isFinite(due)) return SCHEDULED_POLL_FAST
  const untilWindow = due - SCHEDULED_POLL_WINDOW - now
  if (untilWindow <= 0) return SCHEDULED_POLL_FAST
  return Math.min(SCHEDULED_POLL_SLOW, untilWindow)
}
