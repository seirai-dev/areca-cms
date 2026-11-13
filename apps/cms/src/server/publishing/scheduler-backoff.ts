import { and, eq, inArray } from 'drizzle-orm'

import type { Tx } from '#/db'
import { buildJob, publication, schedulerBackoff } from '#/db/schema'
import { ACTIVE_JOB_STATUSES } from '#/lib/job-status'
import { createLogger } from '#/server/log'

const log = createLogger('scheduler')
export const SCHEDULER_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000]
/** Failed attempts after which a schedule stops retrying (paused until an operator acts). */
export const SCHEDULER_MAX_FAILURES = 4

type Backoff = typeof schedulerBackoff.$inferSelect

export function nextSchedulerAttempt(failureCount: number, at: Date) {
  const delay = SCHEDULER_RETRY_DELAYS_MS[failureCount - 1] as
    number | undefined
  return delay === undefined ? null : new Date(at.getTime() + delay)
}

/** Whether this approval is paused or cooling down after failed attempts. */
export function backoffBlocks(
  row: Backoff | undefined,
  fingerprint: string,
  now: Date,
) {
  return (
    row?.approvalFingerprint === fingerprint &&
    (row.failureCount >= SCHEDULER_MAX_FAILURES ||
      (row.nextAttemptAt !== null && row.nextAttemptAt > now))
  )
}

/** A new approval is a new cycle: no failures, and an old dismissal does not carry over. */
export async function startSchedulerCycle(
  tx: Tx,
  siteId: string,
  fingerprint: string,
  at: Date,
) {
  await tx
    .insert(schedulerBackoff)
    .values({
      siteId,
      approvalFingerprint: fingerprint,
      failureCount: 0,
      lastAttemptAt: at,
    })
    .onConflictDoUpdate({
      target: schedulerBackoff.siteId,
      set: {
        approvalFingerprint: fingerprint,
        failureCount: 0,
        nextAttemptAt: null,
        lastAttemptAt: at,
        lastError: null,
        dismissedAt: null,
      },
    })
}

/**
 * The scheduler's checks inside a publish request, under the site lock. A
 * release already queued or running is the answer; a paused or cooling-down
 * approval waits; a new approval starts a new cycle and proceeds (null).
 */
export async function schedulerGate(
  tx: Tx,
  siteId: string,
  fingerprint: string,
): Promise<
  | 'waiting'
  | {
      publication: typeof publication.$inferSelect
      job: typeof buildJob.$inferSelect
    }
  | null
> {
  const pending = (
    await tx
      .select()
      .from(buildJob)
      .where(
        and(
          eq(buildJob.siteId, siteId),
          inArray(buildJob.status, ACTIVE_JOB_STATUSES),
        ),
      )
      .limit(1)
  ).at(0)
  if (pending) {
    const [pendingPublication] = await tx
      .select()
      .from(publication)
      .where(eq(publication.id, pending.publicationId))
    return { publication: pendingPublication, job: pending }
  }
  const now = new Date()
  const current = (
    await tx
      .select()
      .from(schedulerBackoff)
      .where(eq(schedulerBackoff.siteId, siteId))
  ).at(0)
  if (backoffBlocks(current, fingerprint, now)) return 'waiting'
  if (current?.approvalFingerprint !== fingerprint)
    await startSchedulerCycle(tx, siteId, fingerprint, now)
  return null
}

export async function recordSchedulerFailure(
  tx: Tx,
  job: Pick<typeof buildJob.$inferSelect, 'siteId' | 'schedulerFingerprint'>,
  error: string,
  at: Date,
) {
  if (!job.schedulerFingerprint) return
  const current = (
    await tx
      .select()
      .from(schedulerBackoff)
      .where(eq(schedulerBackoff.siteId, job.siteId))
      .for('update')
  ).at(0)
  // A replaced approval or manual retry starts a new cycle; an older job
  // must not consume its retry budget.
  if (current && current.approvalFingerprint !== job.schedulerFingerprint)
    return
  const failureCount = (current?.failureCount ?? 0) + 1
  if (failureCount === SCHEDULER_MAX_FAILURES) {
    // Stops retrying until an operator retries it from Paused jobs.
    log.error('scheduled publication paused after four failed attempts', {
      siteId: job.siteId,
      reason: error,
    })
  }
  await tx
    .insert(schedulerBackoff)
    .values({
      siteId: job.siteId,
      approvalFingerprint: job.schedulerFingerprint,
      failureCount,
      lastAttemptAt: at,
      lastError: error,
      nextAttemptAt: nextSchedulerAttempt(failureCount, at),
    })
    .onConflictDoUpdate({
      target: schedulerBackoff.siteId,
      set: {
        failureCount,
        lastAttemptAt: at,
        lastError: error,
        nextAttemptAt: nextSchedulerAttempt(failureCount, at),
      },
    })
}

export async function clearSchedulerFailure(
  tx: Tx,
  job: Pick<typeof buildJob.$inferSelect, 'siteId' | 'schedulerFingerprint'>,
) {
  if (!job.schedulerFingerprint) return
  await tx
    .delete(schedulerBackoff)
    .where(
      and(
        eq(schedulerBackoff.siteId, job.siteId),
        eq(schedulerBackoff.approvalFingerprint, job.schedulerFingerprint),
      ),
    )
}
