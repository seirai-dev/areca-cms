import type { MailSecure } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { MAIL_MAX_ATTEMPTS } from '#/server/mail/types'
import { isEventKey } from '#/lib/notifications'
import { eventLabel } from '#/features/notifications/notification-copy'

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

export type MailEmailKind =
  'queued' | 'retrying' | 'sent' | 'failed' | 'skipped'

/** The one status a row shows, from the outbox fields. */
export function emailStatusKind(email: {
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'
  retrying: boolean
}): MailEmailKind {
  if (email.status === 'sent') return 'sent'
  if (email.status === 'failed') return 'failed'
  if (email.status === 'cancelled') return 'skipped'
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
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'
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
const ACCOUNT_KIND_LABELS: Partial<Record<string, () => string>> = {
  invitation: () => m.agency_mail_kind_invitation(),
  test: () => m.agency_mail_kind_test(),
  password_reset: () => m.agency_mail_kind_password_reset(),
  password_reset_sso: () => m.agency_mail_kind_password_reset_sso(),
  verify_email: () => m.agency_mail_kind_verify_email(),
  password_changed: () => m.agency_mail_kind_password_changed(),
  two_factor_enabled: () => m.agency_mail_kind_two_factor_enabled(),
  two_factor_disabled: () => m.agency_mail_kind_two_factor_disabled(),
  membership_removed: () => m.agency_mail_kind_membership_removed(),
  membership_role_changed: () => m.agency_mail_kind_membership_role_changed(),
  agency_admin_granted: () => m.agency_mail_kind_agency_admin_granted(),
  agency_admin_revoked: () => m.agency_mail_kind_agency_admin_revoked(),
}

/** Account email kinds and notification events, as people read them. */
export function mailKindLabel(kind: string) {
  const account = ACCOUNT_KIND_LABELS[kind]
  if (account) return account()
  if (isEventKey(kind)) return eventLabel(kind)
  return kind
}

export function mailStatusLabel(email: {
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'
  retrying: boolean
  attempts: number
}) {
  switch (emailStatusKind(email)) {
    case 'sent':
      return m.agency_mail_status_sent()
    case 'failed':
      return m.agency_mail_status_failed()
    case 'skipped':
      return m.agency_mail_status_skipped()
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
