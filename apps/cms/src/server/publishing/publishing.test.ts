import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createMockDeploymentAdapter } from '#/adapters/deployment/mock'
import type { DeploymentAdapter } from '#/adapters/deployment/types'
import { db } from '#/db'
import { buildJob, site } from '#/db/schema'
import {
  createEntry,
  getEntry,
  publishEntry,
  scheduleEntry,
} from '#/server/content/entries'
import {
  createTestCollection,
  sampleRichText,
  withTestSite,
} from '#/server/content/test-utils'

import {
  getBuildJob,
  getLivePublication,
  getPublication,
  listBuildJobs,
  requestPublication,
  requestRollback,
} from './publications.ts'
import { resetSchedulerAttempts, runSchedulerTick } from './scheduler.ts'
import { claimNextJob, processJob, recoverStaleJobs } from './worker.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const failingAdapter: DeploymentAdapter = {
  async deploy() {
    return { deploymentId: 'fail' }
  },
  async waitForCompletion() {
    return 'error'
  },
  async healthCheck() {
    return true
  },
}

async function setDeploymentTarget(siteId: string) {
  await db
    .update(site)
    .set({
      deploymentTarget: {
        provider: 'dokploy',
        applicationId: 'app-test',
        healthCheckUrl: 'http://localhost:3999',
      },
    })
    .where(eq(site.id, siteId))
}

async function seedPublishedEntry(
  siteId: string,
  actorId: string,
  suffix: string,
  slugPrefix = 'pub',
) {
  return publishEntry(
    (
      await createEntry({
        siteId,
        collectionKey: 'articles',
        data: {
          title: 'Published',
          slug: `${slugPrefix}-${suffix}`,
          body: sampleRichText,
        },
        actorId,
      })
    ).id,
    actorId,
  )
}

describe.skipIf(!hasDb)('publishing pipeline', () => {
  it('resolves deployment credentials by site organization and skips resolution without a target', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix, 'resolve')

      const localOnly = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(localOnly.ok).toBe(true)
      if (!localOnly.ok) return
      await processJob(localOnly.job, {
        resolveAdapter: async () => {
          throw new Error('resolver should not run')
        },
      })
      expect((await getBuildJob(localOnly.job.id)).status).toBe('succeeded')

      await setDeploymentTarget(ctx.site.id)
      const deployed = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(deployed.ok).toBe(true)
      if (!deployed.ok) return
      const resolvedOrganizations: string[] = []
      await processJob(deployed.job, {
        resolveAdapter: async (organizationId) => {
          resolvedOrganizations.push(organizationId)
          return createMockDeploymentAdapter()
        },
      })
      expect(resolvedOrganizations).toEqual([ctx.org.id])
      expect((await getBuildJob(deployed.job.id)).status).toBe('succeeded')
    })
  })

  it('fails a targeted publication when organization credentials are unavailable', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await setDeploymentTarget(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix, 'missing')
      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(requested.ok).toBe(true)
      if (!requested.ok) return

      await processJob(requested.job, {
        resolveAdapter: async () => {
          throw new Error('Dokploy credentials are not configured')
        },
      })

      expect((await getBuildJob(requested.job.id)).status).toBe('failed')
      expect((await getBuildJob(requested.job.id)).error).toMatch(
        /not configured/,
      )
      expect((await getPublication(requested.publication.id)).status).toBe(
        'failed',
      )
    })
  })

  it('requests, coalesces, deploys, promotes scheduled, fails without clobbering live, and rolls back', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await setDeploymentTarget(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix)

      const scheduled = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Due',
          slug: `due-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await scheduleEntry(
        scheduled.id,
        '2020-01-01T00:00:00.000Z',
        'UTC',
        ctx.actor.id,
      )

      const first = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.job.status).toBe('queued')
      expect(first.publication.status).toBe('pending')
      expect(first.publication.snapshot.publicationId).toBe(
        first.publication.id,
      )

      const second = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(second.ok).toBe(true)
      if (!second.ok) return

      const cancelled = await getBuildJob(first.job.id)
      expect(cancelled?.status).toBe('cancelled')
      expect((await getPublication(first.publication.id))?.status).toBe(
        'superseded',
      )
      expect(second.job.status).toBe('queued')

      await processJob(second.job, { adapter: createMockDeploymentAdapter() })

      const liveAfterFirstDeploy = await getLivePublication(ctx.site.id)
      expect(liveAfterFirstDeploy?.id).toBe(second.publication.id)
      expect(liveAfterFirstDeploy?.status).toBe('live')
      expect(liveAfterFirstDeploy?.wasLive).toBe(true)
      expect((await getPublication(first.publication.id))?.status).toBe(
        'superseded',
      )
      expect((await getBuildJob(second.job.id))?.status).toBe('succeeded')
      expect((await getEntry(scheduled.id))?.status).toBe('published')
      expect((await getEntry(scheduled.id))?.publishedData).toMatchObject({
        title: 'Due',
      })

      const third = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(third.ok).toBe(true)
      if (!third.ok) return
      await processJob(third.job, { adapter: createMockDeploymentAdapter() })
      expect((await getLivePublication(ctx.site.id))?.id).toBe(
        third.publication.id,
      )
      expect((await getPublication(second.publication.id))?.status).toBe(
        'superseded',
      )

      const failedReq = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(failedReq.ok).toBe(true)
      if (!failedReq.ok) return
      await processJob(failedReq.job, { adapter: failingAdapter })
      expect((await getBuildJob(failedReq.job.id))?.status).toBe('failed')
      expect((await getPublication(failedReq.publication.id))?.status).toBe(
        'failed',
      )
      expect((await getLivePublication(ctx.site.id))?.id).toBe(
        third.publication.id,
      )

      const rollback = await requestRollback({
        siteId: ctx.site.id,
        publicationId: second.publication.id,
        actorId: ctx.actor.id,
      })
      expect(rollback.job.priority).toBe(100)
      expect(rollback.publication.status).toBe('pending')
      await processJob(rollback.job, { adapter: createMockDeploymentAdapter() })
      expect((await getLivePublication(ctx.site.id))?.id).toBe(
        second.publication.id,
      )
      expect((await getPublication(third.publication.id))?.status).toBe(
        'superseded',
      )
    })
  })

  it('keeps a previously live publication rollback-eligible after a failed rollback deploy', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await setDeploymentTarget(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix, 'retry')

      const first = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(first.ok).toBe(true)
      if (!first.ok) return
      await processJob(first.job, { adapter: createMockDeploymentAdapter() })
      expect((await getPublication(first.publication.id))?.wasLive).toBe(true)

      const rollback = await requestRollback({
        siteId: ctx.site.id,
        publicationId: first.publication.id,
        actorId: ctx.actor.id,
      })
      await processJob(rollback.job, { adapter: failingAdapter })

      const failed = await getPublication(first.publication.id)
      expect(failed?.status).toBe('failed')
      expect(failed?.wasLive).toBe(true)

      const retry = await requestRollback({
        siteId: ctx.site.id,
        publicationId: first.publication.id,
        actorId: ctx.actor.id,
      })
      expect(retry.publication.status).toBe('pending')
      expect(retry.job.status).toBe('queued')
    })
  })

  it('rejects rollback for a publication that was never live', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix, 'never')

      const first = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect((await getPublication(first.publication.id))?.wasLive).toBe(false)

      await expect(
        requestRollback({
          siteId: ctx.site.id,
          publicationId: first.publication.id,
          actorId: ctx.actor.id,
        }),
      ).rejects.toThrow(/has not been live/)
    })
  })

  it('enqueues a publication from the scheduler for due scheduled entries', async () => {
    await withTestSite(async (ctx) => {
      resetSchedulerAttempts()
      await createTestCollection(ctx.site.id)
      const scheduled = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Scheduled',
          slug: `sched-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await scheduleEntry(
        scheduled.id,
        '2020-01-01T00:00:00.000Z',
        'UTC',
        ctx.actor.id,
      )

      await runSchedulerTick()
      const jobs = await listBuildJobs(ctx.site.id, { limit: 10 })
      expect(jobs).toHaveLength(1)
      expect(jobs[0]?.status).toBe('queued')
    })
  })

  it('claims only one active job per site', async () => {
    await withTestSite(async (siteA) => {
      await withTestSite(async (siteB) => {
        await createTestCollection(siteA.site.id)
        await createTestCollection(siteB.site.id)
        await seedPublishedEntry(siteA.site.id, siteA.actor.id, siteA.suffix)
        await seedPublishedEntry(siteB.site.id, siteB.actor.id, siteB.suffix)

        const a1 = await requestPublication({
          siteId: siteA.site.id,
          actorId: siteA.actor.id,
        })
        const a2 = await requestPublication({
          siteId: siteA.site.id,
          actorId: siteA.actor.id,
        })
        const b1 = await requestPublication({
          siteId: siteB.site.id,
          actorId: siteB.actor.id,
        })
        expect(a1.ok && a2.ok && b1.ok).toBe(true)
        if (!a1.ok || !a2.ok || !b1.ok) return

        await db
          .update(buildJob)
          .set({ status: 'building', startedAt: new Date(), attempts: 1 })
          .where(eq(buildJob.id, a2.job.id))

        const claimed = await claimNextJob()
        expect(claimed?.id).toBe(b1.job.id)
        expect(claimed?.siteId).toBe(siteB.site.id)
        expect(claimed?.status).toBe('building')

        const claimedAgain = await claimNextJob()
        expect(claimedAgain).toBeNull()

        const leftover = await getBuildJob(a1.job.id)
        expect(leftover?.status).toBe('cancelled')
        const a2Queued = await getBuildJob(a2.job.id)
        expect(a2Queued?.status).toBe('building')
      })
    })
  })

  it('fails jobs stuck in building longer than 30 minutes on recovery', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix, 'stale')

      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(requested.ok).toBe(true)
      if (!requested.ok) return

      const staleStarted = new Date(Date.now() - 31 * 60 * 1000)
      await db
        .update(buildJob)
        .set({ status: 'building', startedAt: staleStarted, attempts: 1 })
        .where(eq(buildJob.id, requested.job.id))

      const recovered = await recoverStaleJobs()
      expect(recovered.some((job) => job.id === requested.job.id)).toBe(true)

      const failed = await getBuildJob(requested.job.id)
      expect(failed?.status).toBe('failed')
      expect(failed?.error).toBe('worker restarted')
      expect((await getPublication(requested.publication.id))?.status).toBe(
        'failed',
      )
    })
  })
})
