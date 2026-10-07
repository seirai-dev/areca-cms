import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '#/db'
import {
  auditLog,
  buildJob,
  publication,
  publicationRequest,
  site,
} from '#/db/schema'
import { createTestCollection, withTestSite } from '#/server/content/test-utils'
import { requestPublication, requestRollback } from './publications'

async function prepare(siteId: string) {
  await db
    .update(site)
    .set({ publishingMode: 'demo', deploymentTarget: null })
    .where(eq(site.id, siteId))
  await createTestCollection(siteId)
}

describe.skipIf(!process.env.DATABASE_URL)(
  'durable publication request idempotency',
  () => {
    it('serializes concurrent identical requests and replays without cancelling a newer request', async () => {
      await withTestSite(async (ctx) => {
        await prepare(ctx.site.id)
        const input = {
          siteId: ctx.site.id,
          actorId: ctx.actor.id,
          requestKey: crypto.randomUUID(),
        }
        const [first, concurrent] = await Promise.all([
          requestPublication(input),
          requestPublication(input),
        ])
        if (!first.ok || !concurrent.ok)
          throw new Error('Expected valid snapshots')
        expect(concurrent.publication.id).toBe(first.publication.id)
        expect(concurrent.job.id).toBe(first.job.id)
        const newer = await requestPublication({
          ...input,
          requestKey: crypto.randomUUID(),
        })
        if (!newer.ok) throw new Error('Expected valid snapshot')
        const replay = await requestPublication(input)
        if (!replay.ok) throw new Error('Expected replay')
        expect(replay.job.id).toBe(first.job.id)
        expect(replay.job.status).toBe('cancelled')
        const [queued] = await db
          .select()
          .from(buildJob)
          .where(eq(buildJob.id, newer.job.id))
        expect(queued.status).toBe('queued')
        const logs = await db
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.targetId, first.publication.id),
              eq(auditLog.action, 'publication.requested'),
            ),
          )
        expect(logs).toHaveLength(1)
        await expect(
          requestPublication({ ...input, priority: 100 }),
        ).rejects.toThrow(/different publishing request/)
        await expect(
          requestPublication({ ...input, actorId: crypto.randomUUID() }),
        ).rejects.toThrow(/different publishing request/)
        await withTestSite(async (other) => {
          await prepare(other.site.id)
          await expect(
            requestPublication({
              ...input,
              siteId: other.site.id,
              actorId: other.actor.id,
            }),
          ).rejects.toThrow(/different publishing request/)
        })
      })
    })

    it('rolls enqueue, coalescing and request identity back when request audit fails', async () => {
      await withTestSite(async (ctx) => {
        await prepare(ctx.site.id)
        const previous = await requestPublication({
          siteId: ctx.site.id,
          actorId: ctx.actor.id,
        })
        if (!previous.ok) throw new Error('Expected valid snapshot')
        const requestKey = crypto.randomUUID()
        await expect(
          requestPublication({
            siteId: ctx.site.id,
            actorId: ctx.actor.id,
            requestKey,
            note: 'scheduled',
            scheduledBy: [crypto.randomUUID()],
          }),
        ).rejects.toThrow()
        expect(
          await db
            .select()
            .from(publication)
            .where(eq(publication.siteId, ctx.site.id)),
        ).toHaveLength(1)
        expect(
          await db
            .select()
            .from(publicationRequest)
            .where(eq(publicationRequest.id, requestKey)),
        ).toHaveLength(0)
        const [job] = await db
          .select()
          .from(buildJob)
          .where(eq(buildJob.id, previous.job.id))
        expect(job.status).toBe('queued')
      })
    })

    it('replays rollback after a lost response and blocks fresh requests for an uncertain dispatch', async () => {
      await withTestSite(async (ctx) => {
        await prepare(ctx.site.id)
        const initial = await requestPublication({
          siteId: ctx.site.id,
          actorId: ctx.actor.id,
        })
        if (!initial.ok) throw new Error('Expected valid snapshot')
        await db
          .update(publication)
          .set({ wasLive: true })
          .where(eq(publication.id, initial.publication.id))
        const input = {
          siteId: ctx.site.id,
          actorId: ctx.actor.id,
          publicationId: initial.publication.id,
          requestKey: crypto.randomUUID(),
        }
        const [first, replay] = await Promise.all([
          requestRollback(input),
          requestRollback(input),
        ])
        expect(replay.job.id).toBe(first.job.id)
        await db
          .update(buildJob)
          .set({ status: 'failed', dispatchUncertain: true })
          .where(eq(buildJob.id, first.job.id))
        expect((await requestRollback(input)).job.id).toBe(first.job.id)
        await expect(
          requestPublication({
            siteId: ctx.site.id,
            actorId: ctx.actor.id,
            requestKey: crypto.randomUUID(),
          }),
        ).rejects.toThrow(/uncertain outcome/)
        await expect(
          requestRollback({ ...input, requestKey: crypto.randomUUID() }),
        ).rejects.toThrow(/uncertain outcome/)
        await expect(
          requestPublication({
            siteId: ctx.site.id,
            actorId: ctx.actor.id,
            requestKey: input.requestKey,
          }),
        ).rejects.toThrow(/different publishing request/)
      })
    })
  },
)
