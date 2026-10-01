import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { buildJob, publication } from '#/db/schema'
import type { Snapshot } from '#/lib/types'
import { createTestSite, cleanupTestSite } from '#/server/content/test-utils'
import {
  LOG_TRUNCATED_MARKER,
  MAX_JOB_LOG_CHARS,
  appendLog,
} from '#/server/publishing/worker'

import { defaultQueueStats } from './health'
import { collectMetrics, renderPrometheus } from './metrics'

const hasDb = Boolean(process.env.DATABASE_URL)

async function withJob(
  status: 'queued' | 'building' = 'queued',
  run: (ctx: { jobId: string; siteId: string }) => Promise<void>,
) {
  const ctx = await createTestSite()
  try {
    const [pub] = await db
      .insert(publication)
      .values({
        siteId: ctx.site.id,
        snapshot: { hash: 'h' } as unknown as Snapshot,
        snapshotHash: 'h',
        status: 'pending',
      })
      .returning()
    const [job] = await db
      .insert(buildJob)
      .values({
        siteId: ctx.site.id,
        publicationId: pub!.id,
        status,
        leaseExpiresAt:
          status === 'building' ? new Date(Date.now() - 400_000) : null,
      })
      .returning()
    await run({ jobId: job!.id, siteId: ctx.site.id })
  } finally {
    await cleanupTestSite(ctx)
  }
}

const logsOf = async (jobId: string) =>
  (await db.select().from(buildJob).where(eq(buildJob.id, jobId)))[0]!.logs ??
  ''

describe.skipIf(!hasDb)('bounded build logs', () => {
  it('appends timestamped, redacted lines', async () => {
    await withJob('queued', async ({ jobId }) => {
      await appendLog(jobId, 'deploying postgres://u:hunter2pw@db/x')
      await appendLog(jobId, 'health check ok')
      const logs = await logsOf(jobId)
      expect(logs.split('\n').filter(Boolean)).toHaveLength(2)
      expect(logs).toContain('health check ok')
      expect(logs).not.toContain('hunter2pw')
      expect(logs).toContain('postgres://[redacted]@db/x')
    })
  })

  it('caps the log, keeps the tail and a single truncation marker', async () => {
    await withJob('queued', async ({ jobId }) => {
      // Preload just under the cap, then keep appending past it repeatedly.
      await db
        .update(buildJob)
        .set({
          logs: 'old\n'.repeat(Math.floor((MAX_JOB_LOG_CHARS - 100) / 4)),
        })
        .where(eq(buildJob.id, jobId))
      for (let i = 0; i < 40; i++) {
        await appendLog(jobId, `line-${i} ${'x'.repeat(200)}`)
      }
      await appendLog(jobId, 'the very last line')
      const logs = await logsOf(jobId)
      expect(logs.length).toBeLessThanOrEqual(MAX_JOB_LOG_CHARS)
      expect(logs.startsWith(LOG_TRUNCATED_MARKER)).toBe(true)
      expect(logs.split('[truncated]').length - 1).toBe(1)
      expect(logs.trimEnd().endsWith('the very last line')).toBe(true)
    })
  })

  it('cuts oversized single lines', async () => {
    await withJob('queued', async ({ jobId }) => {
      await appendLog(jobId, 'y'.repeat(100_000))
      expect((await logsOf(jobId)).length).toBeLessThan(9_000)
    })
  })

  it('never exceeds the cap under concurrent appends', async () => {
    await withJob('queued', async ({ jobId }) => {
      await Promise.all(
        Array.from({ length: 60 }, (_, i) =>
          appendLog(jobId, `c-${i} ${'z'.repeat(7_000)}`),
        ),
      )
      const length = await db.execute<{ n: number }>(
        sql`select char_length(logs) as n from build_job where id = ${jobId}`,
      )
      expect(Number(length.rows[0]!.n)).toBeLessThanOrEqual(MAX_JOB_LOG_CHARS)
    })
  })
})

describe.skipIf(!hasDb)('queue stats and metrics against the database', () => {
  it('reports queued job age', async () => {
    await withJob('queued', async ({ jobId }) => {
      await db
        .update(buildJob)
        .set({ createdAt: new Date(Date.now() - 1_200_000) })
        .where(eq(buildJob.id, jobId))
      const stats = await defaultQueueStats()
      expect(stats.queued).toBeGreaterThanOrEqual(1)
      expect(stats.oldestQueuedAgeSeconds).toBeGreaterThanOrEqual(1_199)
    })
  })

  it('reports expired leases of active jobs', async () => {
    await withJob('building', async () => {
      const stats = await defaultQueueStats()
      expect(stats.active).toBeGreaterThanOrEqual(1)
      expect(stats.expiredLeases).toBeGreaterThanOrEqual(1)
      expect(stats.oldestExpiredLeaseSeconds).toBeGreaterThanOrEqual(399)
    })
  })

  it('collects and renders metrics from real tables', async () => {
    await withJob('queued', async () => {
      const snapshot = await collectMetrics({
        ok: true,
        checks: {
          db: { ok: true, ms: 1 },
          storage: { ok: true, ms: 1 },
          redis: { ok: true, ms: 1 },
          worker: { ok: true, ms: 1 },
          queue: { ok: true, ms: 1 },
        },
      })
      expect(snapshot.jobsByStatus.queued).toBeGreaterThanOrEqual(1)
      expect(snapshot.publicationsByStatus.pending).toBeGreaterThanOrEqual(1)
      expect(snapshot.scheduledOverdue).toBeGreaterThanOrEqual(0)
      const text = renderPrometheus(snapshot)
      expect(text).toMatch(/areca_build_jobs\{status="queued"\} [1-9]/)
    })
  })
})
