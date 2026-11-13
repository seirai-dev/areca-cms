import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { db, pool } from '#/db'
import {
  buildJob,
  dokployCredential,
  entry,
  opsCounter,
  schedulerBackoff,
  site,
} from '#/db/schema'
import { deleteSite } from '#/server/admin/sites'
import {
  removeDokployCredentials,
  saveDokployCredentials,
} from '#/server/admin/dokploy-credentials'
import {
  createTestCollection,
  dueScheduleIso,
  sampleRichText,
  withTestSite,
} from '#/server/content/test-utils'
import { createEntry, scheduleEntry } from '#/server/content/entries'
import { requestPublication } from './publications'
import { CLAIM_SQL, resourceBlockerSql } from './job-claim'
import { processJob, recoverStaleJobs } from './job-run'
import { runSchedulerTick } from './scheduler'
import { createMockDeploymentAdapter, jobOf } from './test-helpers'

const fakeFetch: typeof fetch = async () =>
  Response.json({ items: [], total: 0 })
async function configure(
  ctx: Parameters<Parameters<typeof withTestSite>[0]>[0],
) {
  await saveDokployCredentials({
    organizationId: ctx.org.id,
    url: 'https://shared-dokploy.example.com',
    apiKey: 'test-key',
    actorId: ctx.actor.id,
    fetch: fakeFetch,
  })
  await db
    .update(site)
    .set({
      deploymentTarget: {
        provider: 'dokploy',
        applicationId: 'shared-app',
        healthCheckUrl: 'http://localhost:3999',
      },
    })
    .where(eq(site.id, ctx.site.id))
}
async function claimScoped(siteIds: string[]) {
  return (
    await pool.query(
      CLAIM_SQL.replace(
        'WHERE EXISTS',
        'WHERE s.id = ANY($1::text[]) AND EXISTS',
      ),
      [siteIds],
    )
  ).rows[0]
}

// All rows belong to isolated test fixtures; these tests never reset shared data.
describe('audit publishing regressions', () => {
  it('serializes shared upstream apps, including legacy uncertain jobs without resource keys', async () => {
    await withTestSite(async (a) =>
      withTestSite(async (b) => {
        await configure(a)
        await configure(b)
        const first = await requestPublication({
          siteId: a.site.id,
          actorId: a.actor.id,
        })
        const second = await requestPublication({
          siteId: b.site.id,
          actorId: b.actor.id,
        })
        if (!first.ok || !second.ok) throw new Error('fixture enqueue failed')
        expect(jobOf(first).deploymentResourceKey).toBe(
          jobOf(second).deploymentResourceKey,
        )
        expect(jobOf(first).deploymentResourceKey).toBe(
          createHash('sha256')
            .update('https://shared-dokploy.example.com\nshared-app')
            .digest('hex'),
        )
        const claimed = await claimScoped([a.site.id, b.site.id])
        expect(claimed).toBeTruthy()
        expect(await claimScoped([a.site.id, b.site.id])).toBeUndefined()
        await db
          .update(buildJob)
          .set({
            status: 'failed',
            dispatchUncertain: true,
            deploymentResourceKey: null,
          })
          .where(eq(buildJob.id, claimed.id))
        expect(await claimScoped([a.site.id, b.site.id])).toBeUndefined()
        await db
          .update(buildJob)
          .set({ dispatchUncertain: false })
          .where(eq(buildJob.id, claimed.id))
        expect(await claimScoped([a.site.id, b.site.id])).toBeTruthy()
      }),
    )
  })

  it('recognizes legacy uncertain resources using the enabled development connection fallback', async () => {
    await withTestSite(async (a) =>
      withTestSite(async (b) => {
        await configure(a)
        await configure(b)
        const first = await requestPublication({
          siteId: a.site.id,
          actorId: a.actor.id,
        })
        const second = await requestPublication({
          siteId: b.site.id,
          actorId: b.actor.id,
        })
        if (!first.ok || !second.ok) throw new Error('fixture enqueue failed')
        await db
          .update(buildJob)
          .set({
            status: 'failed',
            dispatchUncertain: true,
            deploymentResourceKey: null,
            dispatchConnectionUrl: null,
          })
          .where(eq(buildJob.id, jobOf(first).id))
        await db
          .delete(dokployCredential)
          .where(eq(dokployCredential.organizationId, a.org.id))
        const result = await pool.query(
          `SELECT 1 FROM (SELECT $1::text id, $2::text deployment_resource_key) q WHERE EXISTS (${resourceBlockerSql('https://shared-dokploy.example.com')})`,
          [jobOf(second).id, jobOf(second).deploymentResourceKey],
        )
        expect(result.rowCount).toBe(1)
      }),
    )
  })

  it('starts only one deployment when two workers race for sites sharing an application', async () => {
    await withTestSite(async (a) =>
      withTestSite(async (b) => {
        await configure(a)
        await configure(b)
        const first = await requestPublication({
          siteId: a.site.id,
          actorId: a.actor.id,
        })
        const second = await requestPublication({
          siteId: b.site.id,
          actorId: b.actor.id,
        })
        if (!first.ok || !second.ok) throw new Error('fixture enqueue failed')
        let finish!: () => void
        const waiting = new Promise<'done'>((resolve) => {
          finish = () => resolve('done')
        })
        const mock = createMockDeploymentAdapter()
        const deploy = vi.fn(mock.deploy)
        const adapter = { ...mock, deploy, waitForCompletion: () => waiting }
        const running = [
          processJob(jobOf(first), { adapter }),
          processJob(jobOf(second), { adapter }),
        ]
        try {
          await vi.waitFor(() => expect(deploy).toHaveBeenCalledOnce())
          const queued = await db
            .select()
            .from(buildJob)
            .where(
              and(
                eq(buildJob.status, 'queued'),
                sql`${buildJob.id} in (${jobOf(first).id}, ${jobOf(second).id})`,
              ),
            )
          expect(queued).toHaveLength(1)
        } finally {
          finish()
          await Promise.all(running)
        }
      }),
    )
  })

  it('blocks deleting a pending/uncertain site and changing/removing its upstream connection', async () => {
    await withTestSite(async (ctx) => {
      await configure(ctx)
      const result = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      if (!result.ok) throw new Error('fixture enqueue failed')
      await expect(deleteSite(ctx.site.id, ctx.actor.id)).rejects.toThrow(
        /pending releases/,
      )
      await expect(
        saveDokployCredentials({
          organizationId: ctx.org.id,
          url: 'https://other-dokploy.example.com',
          apiKey: 'other-key',
          actorId: ctx.actor.id,
          fetch: fakeFetch,
        }),
      ).rejects.toThrow(/pending releases/)
      await expect(
        removeDokployCredentials({
          organizationId: ctx.org.id,
          actorId: ctx.actor.id,
        }),
      ).rejects.toThrow(/pending releases/)
      await db
        .update(buildJob)
        .set({ status: 'failed', dispatchUncertain: true })
        .where(eq(buildJob.id, jobOf(result).id))
      await expect(deleteSite(ctx.site.id, ctx.actor.id)).rejects.toThrow(
        /uncertain deployments/,
      )
      await db
        .update(buildJob)
        .set({ dispatchUncertain: false })
        .where(eq(buildJob.id, jobOf(result).id))
      await deleteSite(ctx.site.id, ctx.actor.id)
      expect(
        await db.select().from(site).where(eq(site.id, ctx.site.id)),
      ).toHaveLength(0)
      // Deletion is CMS-only: no hosting adapter was invoked.
      expect(
        await db
          .select()
          .from(dokployCredential)
          .where(eq(dokployCredential.organizationId, ctx.org.id)),
      ).toHaveLength(1)
    })
  })

  it('records asynchronous scheduler failures, allows exactly three retries, and resets on a new approval', async () => {
    await withTestSite(async (ctx) => {
      await configure(ctx)
      await createTestCollection(ctx.site.id)
      const row = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        actorId: ctx.actor.id,
        data: {
          title: 'Due',
          slug: `retry-${ctx.suffix}`,
          body: sampleRichText,
        },
      })
      await scheduleEntry(row.id, dueScheduleIso(), 'UTC', ctx.actor.id)
      const failure = {
        ...createMockDeploymentAdapter(),
        waitForCompletion: async () => 'error' as const,
      }
      for (let attempt = 1; attempt <= 4; attempt++) {
        await runSchedulerTick()
        const [job] = await db
          .select()
          .from(buildJob)
          .where(
            and(
              eq(buildJob.siteId, ctx.site.id),
              eq(buildJob.status, 'queued'),
            ),
          )
        expect(job).toBeTruthy()
        await processJob(job, { adapter: failure })
        const backoff = (
          await db
            .select()
            .from(schedulerBackoff)
            .where(eq(schedulerBackoff.siteId, ctx.site.id))
        ).at(0)
        expect(backoff?.failureCount).toBe(attempt)
        await runSchedulerTick()
        expect(
          await db
            .select()
            .from(buildJob)
            .where(
              and(
                eq(buildJob.siteId, ctx.site.id),
                eq(buildJob.status, 'queued'),
              ),
            ),
        ).toHaveLength(0)
        if (attempt < 4)
          await db
            .update(schedulerBackoff)
            .set({ nextAttemptAt: new Date(Date.now() - 1000) })
            .where(eq(schedulerBackoff.siteId, ctx.site.id))
      }
      expect(
        await db
          .select()
          .from(buildJob)
          .where(eq(buildJob.siteId, ctx.site.id)),
      ).toHaveLength(4)
      await db
        .update(entry)
        .set({ scheduledVersion: crypto.randomUUID() })
        .where(eq(entry.id, row.id))
      await runSchedulerTick()
      const reset = (
        await db
          .select()
          .from(schedulerBackoff)
          .where(eq(schedulerBackoff.siteId, ctx.site.id))
      ).at(0)
      expect(reset?.failureCount).toBe(0)
      const [queued] = await db
        .select()
        .from(buildJob)
        .where(
          and(eq(buildJob.siteId, ctx.site.id), eq(buildJob.status, 'queued')),
        )
      await processJob(queued, { adapter: createMockDeploymentAdapter() })
      expect(
        await db
          .select()
          .from(schedulerBackoff)
          .where(eq(schedulerBackoff.siteId, ctx.site.id)),
      ).toHaveLength(0)
    })
  })

  it('keeps cumulative failures after failed jobs are deleted, including stale recovery', async () => {
    await withTestSite(async (ctx) => {
      await configure(ctx)
      const before =
        (
          await db
            .select()
            .from(opsCounter)
            .where(eq(opsCounter.name, 'publication_failures'))
        )[0]?.value ?? 0
      const result = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      if (!result.ok) throw new Error('fixture enqueue failed')
      await processJob(jobOf(result), {
        resolveAdapter: async () => {
          throw new Error('credentials unavailable')
        },
      })
      const after = (
        await db
          .select()
          .from(opsCounter)
          .where(eq(opsCounter.name, 'publication_failures'))
      )[0].value
      expect(after).toBeGreaterThanOrEqual(before + 1)
      await db.delete(buildJob).where(eq(buildJob.id, jobOf(result).id))
      expect(
        (
          await db
            .select()
            .from(opsCounter)
            .where(eq(opsCounter.name, 'publication_failures'))
        )[0].value,
      ).toBeGreaterThanOrEqual(after)
      const next = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      if (!next.ok) throw new Error('fixture enqueue failed')
      await db
        .update(buildJob)
        .set({
          status: 'building',
          leaseExpiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(buildJob.id, jobOf(next).id))
      await recoverStaleJobs()
      expect(
        (
          await db
            .select()
            .from(opsCounter)
            .where(eq(opsCounter.name, 'publication_failures'))
        )[0].value,
      ).toBeGreaterThanOrEqual(after + 1)
    })
  })
})
