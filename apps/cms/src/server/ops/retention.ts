/**
 * Hourly retention for rows that only matter for a while. Publications are
 * never removed (rollback needs them). Each statement deletes at most
 * BATCH_SIZE rows, so a large backlog is worked off over several ticks.
 *
 * Foreign keys checked before choosing a rule:
 * - publication_request.job_id cascades from build_job and holds the durable
 *   idempotency records, so a job with one is kept.
 * - oauth tokens reference session with ON DELETE SET NULL (no cascade), so
 *   pruning sessions cannot remove them.
 * - nothing references invitation, verification or email rows.
 */
import { sql } from 'drizzle-orm'

import { db } from '#/db'
import { createLogger } from '#/server/log'

const log = createLogger('retention')

export const RETENTION = {
  /** Expired sessions are kept this long for support lookups. */
  sessionDays: 7,
  /** Expired email verification and password reset tokens. */
  verificationDays: 7,
  /** Unaccepted invitations. Revoking deletes the row, so age counts from expiry. */
  invitationDays: 30,
  /** Finished build jobs (succeeded, failed, cancelled). */
  buildJobDays: 90,
  /** Newest build jobs kept per site, whatever their age. */
  buildJobsKeptPerSite: 20,
  batchSize: 1000,
} as const

export type RetentionResult = {
  sessions: number
  verifications: number
  invitations: number
  buildJobs: number
}

function cutoff(days: number, now: Date) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

/** Deletes one bounded batch per table. Returns the rows removed per table. */
export async function runRetention(now = new Date()): Promise<RetentionResult> {
  const sessions = await deleteBatch(
    sql`session WHERE id IN (
      SELECT id FROM session
      WHERE expires_at < ${cutoff(RETENTION.sessionDays, now)}
      LIMIT ${RETENTION.batchSize})`,
  )
  const verifications = await deleteBatch(
    sql`verification WHERE id IN (
      SELECT id FROM verification
      WHERE expires_at < ${cutoff(RETENTION.verificationDays, now)}
      LIMIT ${RETENTION.batchSize})`,
  )
  const invitations = await deleteBatch(
    sql`invitation WHERE id IN (
      SELECT id FROM invitation
      WHERE accepted_at IS NULL
        AND expires_at < ${cutoff(RETENTION.invitationDays, now)}
      LIMIT ${RETENTION.batchSize})`,
  )
  const buildJobs = await deleteBatch(
    sql`build_job WHERE id IN (
      SELECT j.id FROM build_job j
      WHERE j.status IN ('succeeded', 'failed', 'cancelled')
        AND j.dispatch_uncertain = false
        AND j.finished_at < ${cutoff(RETENTION.buildJobDays, now)}
        AND NOT EXISTS (
          SELECT 1 FROM publication_request r WHERE r.job_id = j.id)
        AND j.id NOT IN (
          SELECT newest.id FROM (
            SELECT id, row_number() OVER (
              PARTITION BY site_id ORDER BY created_at DESC) AS rank
            FROM build_job) newest
          WHERE newest.rank <= ${RETENTION.buildJobsKeptPerSite})
      LIMIT ${RETENTION.batchSize})`,
  )
  const result = { sessions, verifications, invitations, buildJobs }
  if (Object.values(result).some((count) => count > 0)) {
    log.info('retention removed expired rows', result)
  }
  return result
}

/** `DELETE FROM <rest>`; the caller passes the table and its bounded WHERE. */
async function deleteBatch(rest: ReturnType<typeof sql>): Promise<number> {
  const deleted = await db.execute(sql`DELETE FROM ${rest}`)
  return deleted.rowCount ?? 0
}
