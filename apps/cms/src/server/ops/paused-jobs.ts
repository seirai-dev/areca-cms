/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
/**
 * Work that stopped after repeated failures and needs an operator, or the
 * hourly automatic retry: storage deletions (four failed attempts) and
 * scheduled publications (four failed attempts). Dismissing hides an item from
 * the panel and from automatic retries. It deletes nothing.
 */
import { and, desc, eq, gte, isNull } from 'drizzle-orm'

import { db } from '#/db'
import {
  organization,
  schedulerBackoff,
  site,
  storageObjectDeletion,
} from '#/db/schema'
import {
  dismissPausedStorageDeletion,
  retryPausedStorageDeletions,
} from '#/server/assets/storage-cleanup'
import { audit } from '#/server/audit'
import { createLogger, redactString } from '#/server/log'
import { SCHEDULER_MAX_FAILURES } from '#/server/publishing/scheduler'

const log = createLogger('ops')
const LIST_LIMIT = 100

export type PausedKind = 'storage' | 'schedule'

export type PausedStorageDeletion = {
  kind: 'storage'
  /** Storage key. Opaque: the operator acts on it, nothing parses it. */
  id: string
  attempts: number
  lastError: string | null
  queuedAt: Date
}

export type PausedSchedule = {
  kind: 'schedule'
  /** Site id. */
  id: string
  siteName: string
  organizationName: string
  attempts: number
  lastError: string | null
  lastAttemptAt: Date
}

export type PausedJobs = {
  storage: PausedStorageDeletion[]
  schedules: PausedSchedule[]
}

function safeError(value: string | null) {
  return value ? redactString(value) : null
}

export async function listPausedJobs(): Promise<PausedJobs> {
  const storage = await db
    .select({
      storageKey: storageObjectDeletion.storageKey,
      attempts: storageObjectDeletion.attempts,
      lastError: storageObjectDeletion.lastError,
      createdAt: storageObjectDeletion.createdAt,
    })
    .from(storageObjectDeletion)
    .where(
      and(
        gte(storageObjectDeletion.attempts, 4),
        isNull(storageObjectDeletion.dismissedAt),
      ),
    )
    .orderBy(desc(storageObjectDeletion.createdAt))
    .limit(LIST_LIMIT)
  const schedules = await db
    .select({
      siteId: schedulerBackoff.siteId,
      siteName: site.name,
      organizationName: organization.name,
      failureCount: schedulerBackoff.failureCount,
      lastError: schedulerBackoff.lastError,
      lastAttemptAt: schedulerBackoff.lastAttemptAt,
    })
    .from(schedulerBackoff)
    .innerJoin(site, eq(site.id, schedulerBackoff.siteId))
    .innerJoin(organization, eq(organization.id, site.organizationId))
    .where(
      and(
        gte(schedulerBackoff.failureCount, SCHEDULER_MAX_FAILURES),
        isNull(schedulerBackoff.dismissedAt),
      ),
    )
    .orderBy(desc(schedulerBackoff.lastAttemptAt))
    .limit(LIST_LIMIT)
  return {
    storage: storage.map((row) => ({
      kind: 'storage',
      id: row.storageKey,
      attempts: row.attempts,
      lastError: safeError(row.lastError),
      queuedAt: row.createdAt,
    })),
    schedules: schedules.map((row) => ({
      kind: 'schedule',
      id: row.siteId,
      siteName: row.siteName,
      organizationName: row.organizationName,
      attempts: row.failureCount,
      lastError: safeError(row.lastError),
      lastAttemptAt: row.lastAttemptAt,
    })),
  }
}

/** Retries one paused item now. False when it is not paused (or already dismissed). */
export async function retryPausedJob(
  kind: PausedKind,
  id: string,
  actorId: string,
): Promise<boolean> {
  if (kind === 'storage') {
    const reset = await retryPausedStorageDeletions(id)
    if (reset === 0) return false
    await audit({
      organizationId: null,
      actorId,
      action: 'ops.paused_job.retry',
      targetType: 'storage_deletion',
      targetId: id,
      meta: { kind },
    })
    return true
  }
  const found = await resetSchedules(
    and(
      eq(schedulerBackoff.siteId, id),
      gte(schedulerBackoff.failureCount, SCHEDULER_MAX_FAILURES),
      isNull(schedulerBackoff.dismissedAt),
    ),
  )
  if (found.length === 0) return false
  const owner = await siteOwnerOf(id)
  await audit({
    organizationId: owner,
    siteId: id,
    actorId,
    action: 'ops.paused_job.retry',
    targetType: 'site',
    targetId: id,
    meta: { kind },
  })
  return true
}

/** Hides one paused item from the panel and from automatic retries. */
export async function dismissPausedJob(
  kind: PausedKind,
  id: string,
  actorId: string,
): Promise<boolean> {
  if (kind === 'storage') {
    const dismissed = await dismissPausedStorageDeletion(id)
    if (!dismissed) return false
    await audit({
      organizationId: null,
      actorId,
      action: 'ops.paused_job.dismiss',
      targetType: 'storage_deletion',
      targetId: id,
      meta: { kind },
    })
    return true
  }
  const dismissed = await db
    .update(schedulerBackoff)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(schedulerBackoff.siteId, id),
        gte(schedulerBackoff.failureCount, SCHEDULER_MAX_FAILURES),
        isNull(schedulerBackoff.dismissedAt),
      ),
    )
    .returning({ siteId: schedulerBackoff.siteId })
  if (dismissed.length === 0) return false
  await audit({
    organizationId: await siteOwnerOf(id),
    siteId: id,
    actorId,
    action: 'ops.paused_job.dismiss',
    targetType: 'site',
    targetId: id,
    meta: { kind },
  })
  return true
}

/**
 * The hourly retry: every paused, undismissed item gets a fresh set of attempts.
 * Items that still fail pause again after their attempts, and are logged then.
 */
export async function autoRetryPausedJobs(): Promise<{
  storage: number
  schedules: number
}> {
  const storage = await retryPausedStorageDeletions()
  const schedules = (
    await resetSchedules(
      and(
        gte(schedulerBackoff.failureCount, SCHEDULER_MAX_FAILURES),
        isNull(schedulerBackoff.dismissedAt),
      ),
    )
  ).length
  if (storage + schedules > 0) {
    log.info('retried paused jobs', { storage, schedules })
  }
  return { storage, schedules }
}

/**
 * Starts a new attempt cycle for matching schedules. The scheduler then tries
 * them on its next tick, if their entries are still due.
 */
async function resetSchedules(where: ReturnType<typeof and>) {
  return db
    .update(schedulerBackoff)
    .set({ failureCount: 0, nextAttemptAt: null, lastError: null })
    .where(where)
    .returning({ siteId: schedulerBackoff.siteId })
}

async function siteOwnerOf(siteId: string) {
  const [row] = await db
    .select({ organizationId: site.organizationId })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  return row?.organizationId ?? null
}
