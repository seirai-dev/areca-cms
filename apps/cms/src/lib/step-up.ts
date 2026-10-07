/** How recently a session must have been established or re-verified. */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000

/**
 * A session is fresh when it was created (sign-in, which includes the
 * two-factor challenge) or last re-verified within the window. Future
 * timestamps (clock skew) count as fresh; missing ones do not.
 */
export function isFresh(
  timestamps: ReadonlyArray<Date | null | undefined>,
  now: Date = new Date(),
  windowMs: number = STEP_UP_WINDOW_MS,
) {
  return timestamps.some(
    (at) => at != null && now.getTime() - at.getTime() <= windowMs,
  )
}
