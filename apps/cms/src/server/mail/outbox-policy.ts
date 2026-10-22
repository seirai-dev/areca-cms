import { MAIL_MAX_ATTEMPTS } from './types.ts'
import type { MailFailure } from './types.ts'

export type InvitationDeliveryStatus = 'sent' | 'queued' | 'failed'

/**
 * Wait before the next attempt. Attempt 1 → 1 minute, attempt 2 → 5 minutes.
 * Later attempts never wait, because `nextStep` stops retrying first.
 */
export function retryDelayMs(attempt: number) {
  return attempt <= 1 ? 60_000 : 5 * 60_000
}

/** Whether a failed attempt is retried, and when. Pure. */
export function nextStep(
  failure: Pick<MailFailure, 'retryable'>,
  attempt: number,
  now: Date,
): { retry: true; nextAttemptAt: Date } | { retry: false } {
  if (!failure.retryable || attempt >= MAIL_MAX_ATTEMPTS)
    return { retry: false }
  return {
    retry: true,
    nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempt)),
  }
}

/** Invitation columns that mirror the outcome of its email. */
export function invitationDeliveryPatch(
  status: InvitationDeliveryStatus,
  message: string | null,
  now: Date,
): {
  deliveryStatus: InvitationDeliveryStatus
  lastDeliveryError: string | null
  lastSentAt?: Date
} {
  if (status === 'sent') {
    return { deliveryStatus: 'sent', lastDeliveryError: null, lastSentAt: now }
  }
  return { deliveryStatus: status, lastDeliveryError: message }
}

/**
 * Mail health counts failures from the last live success or the last change
 * to the mail settings, whichever is later.
 */
export function healthWindowStart(
  lastLiveSentAt: Date | null,
  settingsUpdatedAt: Date | null,
): Date {
  return new Date(
    Math.max(lastLiveSentAt?.getTime() ?? 0, settingsUpdatedAt?.getTime() ?? 0),
  )
}

/**
 * Consecutive failed attempts, newest first, up to the first success. Pure:
 * `attempts` are in newest-first order. Returns the streak and the newest
 * failure, if any.
 */
export function failureStreak(
  attempts: ReadonlyArray<{
    outcome: 'sent' | 'retrying' | 'failed'
    createdAt: Date
    errorCode: string | null
    errorParams: Record<string, string> | null
  }>,
): {
  consecutiveFailures: number
  last: (typeof attempts)[number] | null
} {
  let consecutiveFailures = 0
  let last: (typeof attempts)[number] | null = null
  for (const attempt of attempts) {
    if (attempt.outcome === 'sent') break
    consecutiveFailures++
    last ??= attempt
  }
  return { consecutiveFailures, last }
}
