import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { publication, schedulerBackoff, site } from '#/db/schema'
import type { Snapshot } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { ConflictError } from '#/server/content/errors'
import { withTestSite } from '#/server/content/test-utils'

import { requestPublication, requestRollback } from './publications.ts'
import { SCHEDULER_MAX_FAILURES } from './scheduler-backoff.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function useDemo(siteId: string) {
  await db
    .update(site)
    .set({ publishingMode: 'demo', deploymentTarget: null })
    .where(eq(site.id, siteId))
}

async function backoffOf(siteId: string) {
  return (
    await db
      .select()
      .from(schedulerBackoff)
      .where(eq(schedulerBackoff.siteId, siteId))
  ).at(0)
}

describe.skipIf(!hasDb)('release requests', () => {
  it('a new scheduled approval starts a new cycle and clears an old dismissal', async () => {
    await withTestSite(async (ctx) => {
      await useDemo(ctx.site.id)
      await db.insert(schedulerBackoff).values({
        siteId: ctx.site.id,
        approvalFingerprint: 'old-approval',
        failureCount: SCHEDULER_MAX_FAILURES,
        lastAttemptAt: new Date(),
        lastError: 'boom',
        dismissedAt: new Date(),
      })

      const result = await requestPublication({
        siteId: ctx.site.id,
        actorId: 'system',
        schedulerFingerprint: 'new-approval',
      })

      expect(result.ok).toBe(true)
      expect(await backoffOf(ctx.site.id)).toMatchObject({
        approvalFingerprint: 'new-approval',
        failureCount: 0,
        nextAttemptAt: null,
        lastError: null,
        dismissedAt: null,
      })
    })
  })

  it('a paused scheduled approval waits instead of publishing', async () => {
    await withTestSite(async (ctx) => {
      await useDemo(ctx.site.id)
      await db.insert(schedulerBackoff).values({
        siteId: ctx.site.id,
        approvalFingerprint: 'paused-approval',
        failureCount: SCHEDULER_MAX_FAILURES,
        lastAttemptAt: new Date(),
      })

      const result = await requestPublication({
        siteId: ctx.site.id,
        actorId: 'system',
        schedulerFingerprint: 'paused-approval',
      })

      expect(result).toEqual({
        ok: false,
        errors: [m.server_scheduled_release_waiting_retry()],
      })
    })
  })

  it('refuses a production rollback without a deployment target with the publish message', async () => {
    await withTestSite(async (ctx) => {
      const [previous] = await db
        .insert(publication)
        .values({
          siteId: ctx.site.id,
          snapshot: { hash: 'h' } as unknown as Snapshot,
          snapshotHash: 'h',
          status: 'superseded',
          wasLive: true,
        })
        .returning()

      const rollback = requestRollback({
        siteId: ctx.site.id,
        publicationId: previous.id,
        actorId: ctx.actor.id,
      })

      await expect(rollback).rejects.toBeInstanceOf(ConflictError)
      await expect(rollback).rejects.toThrow(
        m.server_publication_deployment_required(),
      )
    })
  })
})
