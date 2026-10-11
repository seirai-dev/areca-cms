import { createHash } from 'node:crypto'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'

import { db } from '#/db'
import { buildJob, entry, schedulerBackoff, site } from '#/db/schema'
import { audit } from '#/server/audit'
import { createLogger } from '#/server/log'

import { requestPublication } from './publications.ts'

const log = createLogger('scheduler')
export const SCHEDULER_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000]
const BLOCKING_JOB_STATUSES = [
  'queued',
  'building',
  'validating',
  'deploying',
] as const
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Kept for tests; retry state is durable, never process-local. */
export function resetSchedulerAttempts() {}

export function scheduleFingerprint(
  rows: Array<{ id: string; scheduledVersion: string | null }>,
) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        rows
          .map((row) => [row.id, row.scheduledVersion])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ),
    )
    .digest('hex')
}

export function nextSchedulerAttempt(failureCount: number, at: Date) {
  const delay = SCHEDULER_RETRY_DELAYS_MS[failureCount - 1]
  return delay === undefined ? null : new Date(at.getTime() + delay)
}

export async function recordSchedulerFailure(
  tx: Transaction,
  job: Pick<typeof buildJob.$inferSelect, 'siteId' | 'schedulerFingerprint'>,
  error: string,
  at: Date,
) {
  if (!job.schedulerFingerprint) return
  const [current] = await tx
    .select()
    .from(schedulerBackoff)
    .where(eq(schedulerBackoff.siteId, job.siteId))
    .for('update')
  // A replaced approval or manual retry starts a new cycle; an older job
  // must not consume its retry budget.
  if (current && current.approvalFingerprint !== job.schedulerFingerprint)
    return
  const failureCount = (current?.failureCount ?? 0) + 1
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
  tx: Transaction,
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

export async function runSchedulerTick() {
  const now = new Date()
  const due = await db
    .selectDistinct({ siteId: entry.siteId })
    .from(entry)
    .where(and(eq(entry.status, 'scheduled'), lte(entry.scheduledAt, now)))

  for (const { siteId } of due) {
    const owners = await db
      .select({
        id: entry.id,
        scheduledVersion: entry.scheduledVersion,
        scheduledBy: entry.scheduledBy,
      })
      .from(entry)
      .where(
        and(
          eq(entry.siteId, siteId),
          eq(entry.status, 'scheduled'),
          lte(entry.scheduledAt, now),
        ),
      )
    if (!owners.length) continue
    const fingerprint = scheduleFingerprint(owners)
    const [backoff] = await db
      .select()
      .from(schedulerBackoff)
      .where(eq(schedulerBackoff.siteId, siteId))
      .limit(1)
    if (
      backoff?.approvalFingerprint === fingerprint &&
      (backoff.failureCount >= 4 ||
        (backoff.nextAttemptAt && backoff.nextAttemptAt > now))
    )
      continue
    const [blocking] = await db
      .select({ id: buildJob.id })
      .from(buildJob)
      .where(
        and(
          eq(buildJob.siteId, siteId),
          inArray(buildJob.status, [...BLOCKING_JOB_STATUSES]),
        ),
      )
      .limit(1)
    if (blocking) continue
    const scheduledBy = [
      ...new Set(
        owners
          .map((row) => row.scheduledBy)
          .filter((id): id is string => Boolean(id)),
      ),
    ]

    try {
      const result = await requestPublication({
        siteId,
        actorId: 'system',
        note: 'scheduled',
        scheduledBy,
        schedulerFingerprint: fingerprint,
      })
      if (result.ok) continue
      await recordRequestFailure(
        siteId,
        fingerprint,
        now,
        result.errors.join('; '),
      )
      const [found] = await db
        .select({ organizationId: site.organizationId })
        .from(site)
        .where(eq(site.id, siteId))
        .limit(1)
      if (!found) continue
      await audit({
        organizationId: found.organizationId,
        siteId,
        actorId: scheduledBy.length === 1 ? scheduledBy[0] : null,
        action: 'publication.scheduled_failed',
        targetType: 'site',
        targetId: siteId,
        meta: {
          errors: result.errors,
          ...(scheduledBy.length ? { scheduledBy } : {}),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await recordRequestFailure(siteId, fingerprint, now, message)
      log.error('scheduler tick failed for site', { siteId, err: error })
    }
  }
}

async function recordRequestFailure(
  siteId: string,
  fingerprint: string,
  at: Date,
  error: string,
) {
  await db.transaction(async (tx) => {
    // Serialize retries on the site, including concurrent scheduler replicas.
    await tx.execute(sql`SELECT id FROM site WHERE id=${siteId} FOR UPDATE`)
    const [current] = await tx
      .select()
      .from(schedulerBackoff)
      .where(eq(schedulerBackoff.siteId, siteId))
    if (current?.approvalFingerprint !== fingerprint) {
      await tx
        .insert(schedulerBackoff)
        .values({
          siteId,
          lastAttemptAt: at,
          approvalFingerprint: fingerprint,
          failureCount: 0,
        })
        .onConflictDoUpdate({
          target: schedulerBackoff.siteId,
          set: {
            approvalFingerprint: fingerprint,
            failureCount: 0,
            nextAttemptAt: null,
            lastAttemptAt: at,
            lastError: null,
          },
        })
    } else if (
      current.failureCount >= 4 ||
      (current.nextAttemptAt && current.nextAttemptAt > at)
    )
      return
    await recordSchedulerFailure(
      tx,
      { siteId, schedulerFingerprint: fingerprint },
      error,
      at,
    )
  })
}
