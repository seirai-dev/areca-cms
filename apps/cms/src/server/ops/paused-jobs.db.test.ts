import { and, eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  organization,
  schedulerBackoff,
  storageObjectDeletion,
} from '#/db/schema'
import { createTestSite } from '#/server/content/test-utils'
import {
  insertPublication,
  removeUsers,
} from '#/server/notifications/test-utils'

import {
  autoRetryPausedJobs,
  dismissPausedJob,
  listPausedJobs,
  retryPausedJob,
} from './paused-jobs.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

function key(label: string) {
  return `paused-test/${label}-${crypto.randomUUID()}`
}

async function storageRow(
  storageKey: string,
  attempts: number,
  dismissed = false,
) {
  await db.insert(storageObjectDeletion).values({
    storageKey,
    attempts,
    lastError: `boom ${storageKey}`,
    dismissedAt: dismissed ? new Date() : null,
  })
  cleanups.push(async () => {
    await db
      .delete(storageObjectDeletion)
      .where(eq(storageObjectDeletion.storageKey, storageKey))
  })
}

async function attemptsOf(storageKey: string) {
  const row = (
    await db
      .select({ attempts: storageObjectDeletion.attempts })
      .from(storageObjectDeletion)
      .where(eq(storageObjectDeletion.storageKey, storageKey))
  ).at(0)
  return row?.attempts
}

async function auditFor(targetId: string, action: string) {
  return db
    .select({ actorId: auditLog.actorId, meta: auditLog.meta })
    .from(auditLog)
    .where(and(eq(auditLog.targetId, targetId), eq(auditLog.action, action)))
}

describe.skipIf(!hasDb)('paused jobs', () => {
  it('lists paused storage deletions that are not dismissed', async () => {
    const paused = key('listed')
    const dismissed = key('hidden')
    const active = key('active')
    await storageRow(paused, 4)
    await storageRow(dismissed, 4, true)
    await storageRow(active, 1)

    const { storage } = await listPausedJobs()
    const ids = storage.map((row) => row.id)

    expect(ids).toContain(paused)
    expect(ids).not.toContain(dismissed)
    expect(ids).not.toContain(active)
    expect(storage.find((row) => row.id === paused)).toMatchObject({
      kind: 'storage',
      attempts: 4,
      lastError: `boom ${paused}`,
    })
  })

  it('retries one paused storage deletion, audits it, and leaves dismissed ones alone', async () => {
    const ctx = await createTestSite()
    const actor = ctx.actor
    const paused = key('retry')
    const dismissed = key('retry-dismissed')
    await storageRow(paused, 4)
    await storageRow(dismissed, 4, true)

    await expect(retryPausedJob('storage', paused, actor.id)).resolves.toBe(
      true,
    )
    await expect(retryPausedJob('storage', dismissed, actor.id)).resolves.toBe(
      false,
    )

    expect(await attemptsOf(paused)).toBe(0)
    expect(await attemptsOf(dismissed)).toBe(4)
    expect(await auditFor(paused, 'ops.paused_job.retry')).toEqual([
      { actorId: actor.id, meta: expect.objectContaining({ kind: 'storage' }) },
    ])
    cleanups.push(async () => {
      await db.delete(organization).where(eq(organization.id, ctx.org.id))
      await removeUsers([actor.id])
    })
  })

  it('dismisses a paused storage deletion: hidden, not deleted, and not retried automatically', async () => {
    const ctx = await createTestSite()
    const actor = ctx.actor
    const paused = key('dismiss')
    await storageRow(paused, 4)

    await expect(dismissPausedJob('storage', paused, actor.id)).resolves.toBe(
      true,
    )

    const { storage } = await listPausedJobs()
    expect(storage.map((row) => row.id)).not.toContain(paused)
    expect(await attemptsOf(paused)).toBe(4)
    await autoRetryPausedJobs()
    expect(await attemptsOf(paused)).toBe(4)
    expect(await auditFor(paused, 'ops.paused_job.dismiss')).toHaveLength(1)
    cleanups.push(async () => {
      await db.delete(organization).where(eq(organization.id, ctx.org.id))
      await removeUsers([actor.id])
    })
  })

  it('hourly retry resets paused storage deletions that were not dismissed', async () => {
    const due = key('auto')
    const kept = key('auto-dismissed')
    await storageRow(due, 4)
    await storageRow(kept, 4, true)

    await autoRetryPausedJobs()

    expect(await attemptsOf(due)).toBe(0)
    expect(await attemptsOf(kept)).toBe(4)
  })

  it('lists and retries an exhausted schedule, and starts a fresh cycle', async () => {
    const ctx = await createTestSite()
    await insertPublication({ siteId: ctx.site.id })
    await db.insert(schedulerBackoff).values({
      siteId: ctx.site.id,
      lastAttemptAt: new Date(),
      failureCount: 4,
      approvalFingerprint: 'fp',
      lastError: 'Health check failed',
    })
    cleanups.push(async () => {
      await db.delete(organization).where(eq(organization.id, ctx.org.id))
      await removeUsers([ctx.actor.id])
    })

    const listed = await listPausedJobs()
    expect(listed.schedules.map((row) => row.id)).toContain(ctx.site.id)
    expect(
      listed.schedules.find((row) => row.id === ctx.site.id),
    ).toMatchObject({
      kind: 'schedule',
      attempts: 4,
      lastError: 'Health check failed',
    })

    await expect(
      retryPausedJob('schedule', ctx.site.id, ctx.actor.id),
    ).resolves.toBe(true)

    const after = (
      await db
        .select({ failureCount: schedulerBackoff.failureCount })
        .from(schedulerBackoff)
        .where(eq(schedulerBackoff.siteId, ctx.site.id))
    ).at(0)
    expect(after?.failureCount).toBe(0)
    const { schedules } = await listPausedJobs()
    expect(schedules.map((row) => row.id)).not.toContain(ctx.site.id)
    expect(await auditFor(ctx.site.id, 'ops.paused_job.retry')).toHaveLength(1)
  })

  it('leaves a dismissed schedule out of the panel and out of the hourly retry', async () => {
    const ctx = await createTestSite()
    await db.insert(schedulerBackoff).values({
      siteId: ctx.site.id,
      lastAttemptAt: new Date(),
      failureCount: 4,
      approvalFingerprint: 'fp-dismissed',
      dismissedAt: new Date(),
    })
    cleanups.push(async () => {
      await db.delete(organization).where(eq(organization.id, ctx.org.id))
      await removeUsers([ctx.actor.id])
    })

    await autoRetryPausedJobs()

    const row = (
      await db
        .select({ failureCount: schedulerBackoff.failureCount })
        .from(schedulerBackoff)
        .where(inArray(schedulerBackoff.siteId, [ctx.site.id]))
    ).at(0)
    expect(row?.failureCount).toBe(4)
    expect((await listPausedJobs()).schedules.map((r) => r.id)).not.toContain(
      ctx.site.id,
    )
  })
})
