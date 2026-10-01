import { and, eq, inArray, lte } from 'drizzle-orm'

import { db } from '#/db'
import { buildJob, entry, site } from '#/db/schema'
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

const lastAttempt = new Map<string, number>()

export function resetSchedulerAttempts() {
  lastAttempt.clear()
}

export async function runSchedulerTick() {
  const now = new Date()
  const due = await db
    .selectDistinct({ siteId: entry.siteId })
    .from(entry)
    .where(and(eq(entry.status, 'scheduled'), lte(entry.scheduledAt, now)))

  for (const { siteId } of due) {
    const prev = lastAttempt.get(siteId)
    if (prev && now.getTime() - prev < RETRY_AFTER_MS) {
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

    try {
      const result = await requestPublication({
        siteId,
        actorId: 'system',
        note: 'scheduled',
      })
      if (result.ok) {
        lastAttempt.delete(siteId)
        continue
      }

      lastAttempt.set(siteId, now.getTime())
      const [found] = await db
        .select({ organizationId: site.organizationId })
        .from(site)
        .where(eq(site.id, siteId))
        .limit(1)
      if (!found) continue

      await audit({
        organizationId: found.organizationId,
        siteId,
        actorId: null,
        action: 'publication.scheduled_failed',
        targetType: 'site',
        targetId: siteId,
        meta: { errors: result.errors },
      })
    } catch (error) {
      lastAttempt.set(siteId, now.getTime())
      log.error('scheduler tick failed for site', { siteId, err: error })
    }
  }
}
