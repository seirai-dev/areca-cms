import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { createMockDeploymentAdapter } from '#/adapters/deployment/mock'
import type { DeploymentAdapter } from '#/adapters/deployment/types'
import { db, pool } from '#/db'
import {
  auditLog,
  buildJob,
  publication,
  schedulerBackoff,
  site,
} from '#/db/schema'
import {
  createEntry,
  getEntry,
  publishEntry,
  scheduleEntry,
  updateDraft,
} from '#/server/content/entries'
import {
  createTestCollection,
  dueScheduleIso,
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
import {
  CLAIM_SQL,
  claimNextJob,
  processJob,
  recoverStaleJobs,
} from './worker.ts'

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
  it('resolves production credentials and explicitly labels no-target demo publications', async () => {
    await withTestSite(async (ctx) => {
      await setDeploymentTarget(ctx.site.id)
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix, 'resolve')

      await db
        .update(site)
        .set({ publishingMode: 'demo', deploymentTarget: null })
        .where(eq(site.id, ctx.site.id))
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

      expect((await getPublication(localOnly.publication.id)).status).toBe(
        'demo',
      )
      expect(await getLivePublication(ctx.site.id)).toBeNull()
      await db
        .update(site)
        .set({ publishingMode: 'production' })
        .where(eq(site.id, ctx.site.id))
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
      await setDeploymentTarget(ctx.site.id)
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
      await setDeploymentTarget(ctx.site.id)
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
      await scheduleEntry(scheduled.id, dueScheduleIso(), 'UTC', ctx.actor.id)

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
        rollback.publication.id,
      )
      expect((await getPublication(third.publication.id))?.status).toBe(
        'superseded',
      )
    })
  })

  it('keeps a previously live publication rollback-eligible after a failed rollback deploy', async () => {
    await withTestSite(async (ctx) => {
      await setDeploymentTarget(ctx.site.id)
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
      expect(failed?.status).toBe('live')
      expect((await getPublication(rollback.publication.id))?.status).toBe(
        'failed',
      )
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
      await setDeploymentTarget(ctx.site.id)
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
      await setDeploymentTarget(ctx.site.id)
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
      await scheduleEntry(scheduled.id, dueScheduleIso(), 'UTC', ctx.actor.id)

      await runSchedulerTick()
      const jobs = await listBuildJobs(ctx.site.id, { limit: 10 })
      expect(jobs).toHaveLength(1)
      expect(jobs[0]?.status).toBe('queued')
      const queued = await getPublication(jobs[0].publicationId)
      expect(queued).not.toBeNull()
      expect(queued.requestedBy).toBeNull()
      const [requested] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.targetId, queued.id),
            eq(auditLog.action, 'publication.requested'),
          ),
        )
      expect(requested?.actorId).toBe(ctx.actor.id)
      expect(requested?.meta).toEqual(
        expect.objectContaining({
          note: 'scheduled',
          scheduledBy: [ctx.actor.id],
        }),
      )
    })
  })

  it('claims only one active job per site', async () => {
    await withTestSite(async (siteA) => {
      await withTestSite(async (siteB) => {
        await setDeploymentTarget(siteA.site.id)
        await setDeploymentTarget(siteB.site.id)
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
      await setDeploymentTarget(ctx.site.id)
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
      expect(failed?.error).toMatch(/lease expired/)
      expect((await getPublication(requested.publication.id))?.status).toBe(
        'failed',
      )
    })
  })
  it('rejects production without a target or health URL', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix)
      expect(
        (
          await requestPublication({
            siteId: ctx.site.id,
            actorId: ctx.actor.id,
          })
        ).ok,
      ).toBe(false)
      await db
        .update(site)
        .set({
          deploymentTarget: { provider: 'dokploy', applicationId: 'app' },
        })
        .where(eq(site.id, ctx.site.id))
      expect(
        (
          await requestPublication({
            siteId: ctx.site.id,
            actorId: ctx.actor.id,
          })
        ).ok,
      ).toBe(false)
    })
  })

  it('serializes concurrent enqueue and claims across independent DB connections', async () => {
    await withTestSite(async (ctx) => {
      await setDeploymentTarget(ctx.site.id)
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix)
      await Promise.all(
        Array.from({ length: 4 }, () =>
          requestPublication({ siteId: ctx.site.id, actorId: ctx.actor.id }),
        ),
      )
      expect(
        (await listBuildJobs(ctx.site.id)).filter(
          (job) => job.status === 'queued',
        ),
      ).toHaveLength(1)
      const first = await pool.connect()
      const second = await pool.connect()
      try {
        await first.query('BEGIN')
        const claimed = await first.query(CLAIM_SQL)
        expect(claimed.rows).toHaveLength(1)
        const concurrent = await second.query(CLAIM_SQL)
        expect(concurrent.rows).toHaveLength(0)
        await first.query('COMMIT')
        expect((await second.query(CLAIM_SQL)).rows).toHaveLength(0)
      } finally {
        await first.query('ROLLBACK')
        first.release()
        second.release()
      }
    })
  })

  it('promotes only the frozen due members, preserving drafts edited during deployment and rollback', async () => {
    await withTestSite(async (ctx) => {
      await setDeploymentTarget(ctx.site.id)
      await createTestCollection(ctx.site.id)
      const scheduled = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Approved',
          slug: `approved-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await scheduleEntry(scheduled.id, dueScheduleIso(), 'UTC', ctx.actor.id)
      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      if (!requested.ok) throw new Error(requested.errors.join(', '))
      await updateDraft(
        scheduled.id,
        {
          title: 'Later draft',
          slug: `later-${ctx.suffix}`,
          body: sampleRichText,
        },
        ctx.actor.id,
        scheduled.draftVersion,
      )
      const late = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Not in snapshot',
          slug: `late-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await scheduleEntry(late.id, dueScheduleIso(), 'UTC', ctx.actor.id)
      await processJob(requested.job, {
        adapter: createMockDeploymentAdapter(),
      })
      const promoted = await getEntry(scheduled.id)
      if (!promoted) throw new Error('Entry missing')
      expect(promoted.publishedData?.title).toBe('Approved')
      expect(promoted.publishedSlug).toBe(`approved-${ctx.suffix}`)
      expect(promoted.draftData.title).toBe('Later draft')
      expect((await getEntry(late.id))?.status).toBe('scheduled')
      const rollback = await requestRollback({
        siteId: ctx.site.id,
        publicationId: requested.publication.id,
        actorId: ctx.actor.id,
      })
      expect(rollback.publication.entryVersions).toEqual([])
      await processJob(rollback.job, { adapter: createMockDeploymentAdapter() })
      expect((await getEntry(late.id))?.status).toBe('scheduled')
    })
  })

  it('recovers an expired lease while a stale worker is still awaiting deployment, fencing its completion', async () => {
    await withTestSite(async (ctx) => {
      await setDeploymentTarget(ctx.site.id)
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix)
      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      if (!requested.ok) throw new Error(requested.errors.join(', '))
      let releaseWait!: () => void
      let deployStarted!: () => void
      const started = new Promise<void>((resolve) => {
        deployStarted = resolve
      })
      const wait = new Promise<void>((resolve) => {
        releaseWait = resolve
      })
      const mock = createMockDeploymentAdapter()
      const running = processJob(requested.job, {
        adapter: {
          ...mock,
          async waitForCompletion() {
            deployStarted()
            await wait
            return 'done'
          },
        },
      })
      await started
      await db
        .update(buildJob)
        .set({ leaseExpiresAt: new Date(Date.now() - 1) })
        .where(eq(buildJob.id, requested.job.id))
      expect(
        (await recoverStaleJobs()).some((job) => job.id === requested.job.id),
      ).toBe(true)
      releaseWait()
      await running
      expect((await getBuildJob(requested.job.id)).status).toBe('failed')
      expect(await getLivePublication(ctx.site.id)).toBeNull()
    })
  })
  it('enforces queue and active invariants even when a writer bypasses enqueue', async () => {
    await withTestSite(async (ctx) => {
      await setDeploymentTarget(ctx.site.id)
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix)
      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      if (!requested.ok) throw new Error(requested.errors.join(', '))
      await expect(
        db.insert(buildJob).values({
          siteId: ctx.site.id,
          publicationId: requested.publication.id,
        }),
      ).rejects.toThrow()
      const claimed = await claimNextJob()
      expect(claimed?.id).toBe(requested.job.id)
      await expect(
        db.insert(buildJob).values({
          siteId: ctx.site.id,
          publicationId: requested.publication.id,
          status: 'building',
        }),
      ).rejects.toThrow()
    })
  })

  it('verifies the frozen production health URL even if site settings change after enqueue', async () => {
    await withTestSite(async (ctx) => {
      await setDeploymentTarget(ctx.site.id)
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix)
      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      if (!requested.ok) throw new Error(requested.errors.join(', '))
      await db
        .update(site)
        .set({ deploymentTarget: null })
        .where(eq(site.id, ctx.site.id))
      const adapter = createMockDeploymentAdapter()
      const healthCheck = vi.fn(adapter.healthCheck)
      await processJob(requested.job, { adapter: { ...adapter, healthCheck } })
      expect(healthCheck).toHaveBeenCalledWith(
        'http://localhost:3999',
        expect.objectContaining({
          expectPublicationId: requested.publication.id,
        }),
      )
      expect((await getBuildJob(requested.job.id)).status).toBe('succeeded')
      expect((await getLivePublication(ctx.site.id))?.id).toBe(
        requested.publication.id,
      )
    })
  })

  it('does not promote a new scheduled approval replacing the version in a running snapshot', async () => {
    await withTestSite(async (ctx) => {
      await setDeploymentTarget(ctx.site.id)
      await createTestCollection(ctx.site.id)
      const scheduled = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'First approval',
          slug: `first-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await scheduleEntry(scheduled.id, dueScheduleIso(), 'UTC', ctx.actor.id)
      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      if (!requested.ok) throw new Error(requested.errors.join(', '))
      await updateDraft(
        scheduled.id,
        {
          title: 'Replacement approval',
          slug: `replacement-${ctx.suffix}`,
          body: sampleRichText,
        },
        ctx.actor.id,
        scheduled.draftVersion,
      )
      const rescheduled = await scheduleEntry(
        scheduled.id,
        dueScheduleIso(),
        'UTC',
        ctx.actor.id,
      )
      await processJob(requested.job, {
        adapter: createMockDeploymentAdapter(),
      })
      const after = await getEntry(scheduled.id)
      expect(after?.status).toBe('scheduled')
      expect(after?.scheduledVersion).toBe(rescheduled.scheduledVersion)
      expect(after?.scheduledData?.title).toBe('Replacement approval')
      expect(after?.publishedData).toBeNull()
    })
  })
  it('uses the locked site publishing mode when settings change during enqueue', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix)
      await db
        .update(site)
        .set({ publishingMode: 'demo', deploymentTarget: null })
        .where(eq(site.id, ctx.site.id))
      const connection = await pool.connect()
      try {
        await connection.query('BEGIN')
        await connection.query(
          "UPDATE site SET publishing_mode='production' WHERE id=$1",
          [ctx.site.id],
        )
        const {
          rows: [{ pid }],
        } = await connection.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        )
        const requested = requestPublication({
          siteId: ctx.site.id,
          actorId: ctx.actor.id,
        })
        let blocked = false
        for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
          const state = await pool.query<{ blocked: boolean }>(
            'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
            [pid],
          )
          blocked = state.rows[0].blocked
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 5))
        }
        expect(blocked).toBe(true)
        await connection.query('COMMIT')
        const result = await requested
        expect(result.ok).toBe(false)
        expect(await listBuildJobs(ctx.site.id)).toHaveLength(0)
      } finally {
        await connection.query('ROLLBACK')
        connection.release()
      }
    })
  })

  it('keeps scheduler backoff in the database across resetSchedulerAttempts', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const scheduled = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Due',
          slug: `backoff-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await scheduleEntry(scheduled.id, dueScheduleIso(), 'UTC', ctx.actor.id)

      await runSchedulerTick()
      const [row] = await db
        .select()
        .from(schedulerBackoff)
        .where(eq(schedulerBackoff.siteId, ctx.site.id))
        .limit(1)
      expect(row).toBeDefined()
      expect(row?.lastError).toBeTruthy()
      expect(await listBuildJobs(ctx.site.id)).toHaveLength(0)
      const [failed] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.siteId, ctx.site.id),
            eq(auditLog.action, 'publication.scheduled_failed'),
          ),
        )
      expect(failed?.actorId).toBe(ctx.actor.id)
      expect(failed?.meta).toEqual(
        expect.objectContaining({ scheduledBy: [ctx.actor.id] }),
      )

      resetSchedulerAttempts()
      await runSchedulerTick()
      expect(await listBuildJobs(ctx.site.id)).toHaveLength(0)
      const [still] = await db
        .select()
        .from(schedulerBackoff)
        .where(eq(schedulerBackoff.siteId, ctx.site.id))
        .limit(1)
      expect(still?.lastAttemptAt.getTime()).toBe(row.lastAttemptAt.getTime())
    })
  })

  it('does not fail a demo job if completion audit throws', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await seedPublishedEntry(ctx.site.id, ctx.actor.id, ctx.suffix, 'audit')
      await db
        .update(site)
        .set({ publishingMode: 'demo', deploymentTarget: null })
        .where(eq(site.id, ctx.site.id))
      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(requested.ok).toBe(true)
      if (!requested.ok) return
      await processJob(requested.job, {
        audit: async () => {
          throw new Error('audit unavailable')
        },
      })
      expect((await getBuildJob(requested.job.id)).status).toBe('succeeded')
      expect((await getPublication(requested.publication.id))?.status).toBe(
        'demo',
      )
      const [failed] = await db
        .select()
        .from(publication)
        .where(
          and(
            eq(publication.id, requested.publication.id),
            eq(publication.status, 'failed'),
          ),
        )
      expect(failed).toBeUndefined()
    })
  })
})
