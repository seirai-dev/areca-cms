import { and, eq, inArray, lte } from 'drizzle-orm'

import { db } from '#/db'
import { buildJob, entry, schedulerBackoff, site } from '#/db/schema'
import { audit } from '#/server/audit'
import { createLogger } from '#/server/log'

import { requestPublication } from './publications.ts'

const log = createLogger('scheduler')

const RETRY_AFTER_MS = 10 * 60 * 1000
const BLOCKING_JOB_STATUSES = [
  'queued',
  'building',
  'validating',
  'deploying',
] as const

/** Kept for tests; cooldown is stored in `scheduler_backoff`, not memory. */
export function resetSchedulerAttempts() {}

function uniqueActorIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))]
}

async function recordBackoff(siteId: string, at: Date, lastError: string) {
  await db
    .insert(schedulerBackoff)
    .values({ siteId, lastAttemptAt: at, lastError })
    .onConflictDoUpdate({
      target: schedulerBackoff.siteId,
      set: { lastAttemptAt: at, lastError },
    })
}

export async function runSchedulerTick() {
  const now = new Date()
  const due = await db
    .selectDistinct({ siteId: entry.siteId })
    .from(entry)
    .where(and(eq(entry.status, 'scheduled'), lte(entry.scheduledAt, now)))

  for (const { siteId } of due) {
    const [backoff] = await db
      .select()
      .from(schedulerBackoff)
      .where(eq(schedulerBackoff.siteId, siteId))
      .limit(1)
    if (
      backoff &&
      now.getTime() - backoff.lastAttemptAt.getTime() < RETRY_AFTER_MS
    ) {
      continue
    }

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

    const owners = await db
      .select({ scheduledBy: entry.scheduledBy })
      .from(entry)
      .where(
        and(
          eq(entry.siteId, siteId),
          eq(entry.status, 'scheduled'),
          lte(entry.scheduledAt, now),
        ),
      )
    const scheduledBy = uniqueActorIds(owners.map((row) => row.scheduledBy))

    try {
      const result = await requestPublication({
        siteId,
        actorId: 'system',
        note: 'scheduled',
        scheduledBy,
      })
      if (result.ok) {
        try {
          await db
            .delete(schedulerBackoff)
            .where(eq(schedulerBackoff.siteId, siteId))
        } catch (error) {
          log.error('failed to clear scheduler backoff', { siteId, err: error })
        }
        continue
      }

      await recordBackoff(siteId, now, result.errors.join('; '))
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
          ...(scheduledBy.length > 0 ? { scheduledBy } : {}),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await recordBackoff(siteId, now, message)
      log.error('scheduler tick failed for site', { siteId, err: error })
    }
  }
}
