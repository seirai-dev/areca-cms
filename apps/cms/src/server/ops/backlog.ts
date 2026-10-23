/**
 * Queue depths and paused work, read in one round trip. Used by readiness (mail
 * and loop health) and by metrics. Test sends are not counted as mail backlog.
 */
import { sql } from 'drizzle-orm'

import { db } from '#/db'

/** Pending mail older than this makes readiness degraded. */
export const MAIL_BACKLOG_DEGRADED_SECONDS = 15 * 60

export type Backlog = {
  /** Queued emails waiting for a send (not counting test sends). */
  mailPending: number
  mailOldestPendingAgeSeconds: number | null
  /** Rows whose sender died: the lease lapsed and no one has reclaimed them yet. */
  mailExpiredLeases: number
  notificationEventsPending: number
  notificationEventsOldestPendingAgeSeconds: number | null
  /** Storage deletions paused after 4 failed attempts. */
  storageDeletionsPaused: number
  /** Scheduled publications stopped after 4 failed attempts. */
  schedulesExhausted: number
}

export async function collectBacklog(): Promise<Backlog> {
  const result = await db.execute<{
    mail_pending: string
    mail_oldest: string | null
    mail_expired: string
    events_pending: string
    events_oldest: string | null
    storage_paused: string
    schedules_exhausted: string
  }>(sql`
    select
      (select count(*) from email_outbox where status = 'queued' and kind <> 'test') as mail_pending,
      (select extract(epoch from now() - min(created_at)) from email_outbox
        where status = 'queued' and kind <> 'test') as mail_oldest,
      (select count(*) from email_outbox where status = 'sending' and lease_until < now()) as mail_expired,
      (select count(*) from notification_event where status = 'pending') as events_pending,
      (select extract(epoch from now() - min(created_at)) from notification_event
        where status = 'pending') as events_oldest,
      (select count(*) from storage_object_deletion where attempts >= 4) as storage_paused,
      (select count(*) from scheduler_backoff where failure_count >= 4) as schedules_exhausted
  `)
  const row = result.rows.at(0)
  return {
    mailPending: Number(row?.mail_pending ?? 0),
    mailOldestPendingAgeSeconds:
      row?.mail_oldest == null ? null : Number(row.mail_oldest),
    mailExpiredLeases: Number(row?.mail_expired ?? 0),
    notificationEventsPending: Number(row?.events_pending ?? 0),
    notificationEventsOldestPendingAgeSeconds:
      row?.events_oldest == null ? null : Number(row.events_oldest),
    storageDeletionsPaused: Number(row?.storage_paused ?? 0),
    schedulesExhausted: Number(row?.schedules_exhausted ?? 0),
  }
}

/** Pure. Degraded when the oldest pending mail has waited too long. */
export function evaluateMailBacklog(
  backlog: Pick<Backlog, 'mailOldestPendingAgeSeconds'>,
  maxAgeSeconds = MAIL_BACKLOG_DEGRADED_SECONDS,
): { degraded: boolean; reason?: string } {
  const age = backlog.mailOldestPendingAgeSeconds
  if (age != null && age > maxAgeSeconds) {
    return {
      degraded: true,
      reason: `mail waiting ${Math.round(age / 60)} min to send (limit ${Math.round(maxAgeSeconds / 60)} min)`,
    }
  }
  return { degraded: false }
}
