import type { MailSecure } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { MAIL_MAX_ATTEMPTS } from '#/server/mail/types'

/**
 * Pure helpers for Agency → Mail and the shell banners. No React and no
 * server imports beyond types, so they unit-test without a database.
 */

/** Consecutive failed sends before the shell shows "Emails are failing". */
export const MAIL_FAILURE_BANNER_THRESHOLD = 3

/** Ports that look like a default, so changing encryption may move them. */
const DEFAULT_PORTS: readonly number[] = [25, 465, 587]

/** The port the usual setup for this encryption listens on, if any. */
export function suggestedPort(secure: MailSecure): number | null {
  if (secure === 'starttls') return 587
  if (secure === 'tls') return 465
  return null
}

/**
 * The port to show after the encryption changes. A custom port (1025 for a
 * local test server, say) is kept; only a default port follows the choice.
 */
export function portForEncryption(currentPort: number, next: MailSecure) {
  const suggestion = suggestedPort(next)
  if (suggestion === null) return currentPort
  return DEFAULT_PORTS.includes(currentPort) ? suggestion : currentPort
}

/** Parses the port input. Returns null for anything outside 1–65535. */
export function parsePort(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const port = Number(trimmed)
  return port >= 1 && port <= 65_535 ? port : null
}

export type MailEmailKind = 'queued' | 'retrying' | 'sent' | 'failed'

/** The one status a row shows, from the outbox fields. */
export function emailStatusKind(email: {
  status: 'queued' | 'sending' | 'sent' | 'failed'
  retrying: boolean
}): MailEmailKind {
  if (email.status === 'sent') return 'sent'
  if (email.status === 'failed') return 'failed'
  return email.retrying ? 'retrying' : 'queued'
}

/** "Retrying (attempt 2 of 3)": the attempt that comes next, capped. */
export function nextAttemptNumber(attempts: number) {
  return Math.min(attempts + 1, MAIL_MAX_ATTEMPTS)
}

export type TimelineState =
  'done' | 'current' | 'skipped' | 'pending' | 'failed'

export type TimelineStep = {
  key: 'queued' | 'retrying' | 'sent' | 'failed'
  state: TimelineState
}

/**
 * Three dots per row: queued → retrying → sent or failed. A retry dot that
 * was never needed is `skipped` (drawn muted), not `pending`.
 */
export function emailTimeline(email: {
  status: 'queued' | 'sending' | 'sent' | 'failed'
  retrying: boolean
  attempts: number
}): TimelineStep[] {
  const kind = emailStatusKind(email)
  const retried = email.attempts > 1
  if (kind === 'queued') {
    return [
      { key: 'queued', state: 'current' },
      { key: 'retrying', state: 'pending' },
      { key: 'sent', state: 'pending' },
    ]
  }
  if (kind === 'retrying') {
    return [
      { key: 'queued', state: 'done' },
      { key: 'retrying', state: 'current' },
      { key: 'sent', state: 'pending' },
    ]
  }
  const retryState: TimelineState = retried ? 'done' : 'skipped'
  if (kind === 'sent') {
    return [
      { key: 'queued', state: 'done' },
      { key: 'retrying', state: retryState },
      { key: 'sent', state: 'done' },
    ]
  }
  return [
    { key: 'queued', state: 'done' },
    { key: 'retrying', state: retryState },
    { key: 'failed', state: 'failed' },
  ]
}

/** Human label for an email kind; unknown kinds are shown as stored. */
export function mailKindLabel(kind: string) {
  if (kind === 'invitation') return m.agency_mail_kind_invitation()
  if (kind === 'test') return m.agency_mail_kind_test()
  return kind
}

export function mailStatusLabel(email: {
  status: 'queued' | 'sending' | 'sent' | 'failed'
  retrying: boolean
  attempts: number
}) {
  switch (emailStatusKind(email)) {
    case 'sent':
      return m.agency_mail_status_sent()
    case 'failed':
      return m.agency_mail_status_failed()
    case 'retrying':
      return m.agency_mail_status_retrying({
        attempt: String(nextAttemptNumber(email.attempts)),
        max: String(MAIL_MAX_ATTEMPTS),
      })
    case 'queued':
      return m.agency_mail_status_queued()
  }
}

/** Whether the shell should warn that every send is failing. */
export function isMailFailing(health: { consecutiveFailures: number }) {
  return health.consecutiveFailures >= MAIL_FAILURE_BANNER_THRESHOLD
}

export function isMailSecure(value: unknown): value is MailSecure {
  return value === 'starttls' || value === 'tls' || value === 'none'
}
