import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createMockDeploymentAdapter } from '#/adapters/deployment/mock'
import type { DeploymentAdapter } from '#/adapters/deployment/types'
import { db } from '#/db'
import { buildJob, publication, site } from '#/db/schema'
import type { Snapshot } from '#/lib/types'
import { cleanupTestSite, createTestSite } from '#/server/content/test-utils'

import { claimNextJob, createJobPool, processJob } from './worker.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function queueJob(siteId: string) {
  await db
    .update(site)
    .set({
      deploymentTarget: {
        provider: 'dokploy',
        applicationId: 'app',
        healthCheckUrl: 'http://localhost:3999',
      },
    })
    .where(eq(site.id, siteId))
  const [pub] = await db
    .insert(publication)
    .values({
      siteId,
      snapshot: { hash: 'h' } as unknown as Snapshot,
      snapshotHash: 'h',
      status: 'pending',
    })
    .returning()
  const [job] = await db
    .insert(buildJob)
    .values({ siteId, publicationId: pub.id })
    .returning()
  return job
}

/**
 * The pool stops filling at the first claim it cannot use, so a queued job
 * left in the shared database by an earlier run would hide this test's own
 * jobs. Cancel whatever is still queued before queueing them.
 */
async function cancelStaleQueuedJobs() {
  await db
    .update(buildJob)
    .set({ status: 'cancelled' })
    .where(eq(buildJob.status, 'queued'))
}

describe.skipIf(!hasDb)('worker job pool against the database', () => {
  it('finishes site B while site A deployment never returns, and drain is bounded', async () => {
    await cancelStaleQueuedJobs()
    const a = await createTestSite()
    const b = await createTestSite()
    try {
      const jobA = await queueJob(a.site.id)
      const jobB = await queueJob(b.site.id)
      const hanging: DeploymentAdapter = {
        ...createMockDeploymentAdapter(),
        deploy: () => new Promise(() => {}),
      }
      const mock = createMockDeploymentAdapter()
      // Only claim our two jobs (the shared DB may hold others).
      const mine = new Set([jobA.id, jobB.id])
      const pool = createJobPool({
        concurrency: 2,
        claim: async () => {
          const claimed = await claimNextJob()
          if (!claimed) return null
          if (!mine.has(claimed.id)) {
            // Not ours: put it back so other tests/workers can take it.
            await db
              .update(buildJob)
              .set({ status: 'queued', startedAt: null, leaseExpiresAt: null })
              .where(eq(buildJob.id, claimed.id))
            return null
          }
          return claimed
        },
        run: (job) =>
          processJob(job, {
            adapter: job.siteId === a.site.id ? hanging : mock,
          }),
      })

      await pool.fill()
      const state = async (id: string) =>
        (await db.select().from(buildJob).where(eq(buildJob.id, id)))[0].status
      await expect
        .poll(() => state(jobB.id), { timeout: 10_000 })
        .toBe('succeeded')
      expect(await state(jobA.id)).toBe('deploying')
      // B's status is written inside its transaction; the pool lets go of B a
      // moment later, once the job's run has fully returned.
      await expect.poll(() => pool.inFlight()).toBe(1)
      expect(await pool.drain(100)).toBe(false)
    } finally {
      await cleanupTestSite(a)
      await cleanupTestSite(b)
    }
    // The poll above waits up to 10s, longer than the default 5s timeout.
  }, 30_000)
})
