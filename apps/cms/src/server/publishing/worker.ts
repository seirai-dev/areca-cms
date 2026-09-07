import { and, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'

import { getDeploymentAdapter } from '#/adapters'
import type { DeploymentAdapter, DeploymentTarget } from '#/adapters/deployment/types'
import { db, pool } from '#/db'
import { buildJob, entry, publication, site } from '#/db/schema'
import { env } from '#/env'
import { audit } from '#/server/audit'

import { getPublication } from './publications.ts'
import { runSchedulerTick } from './scheduler.ts'

const CLAIM_SQL = `
UPDATE build_job SET status='building', started_at=now(), attempts=attempts+1 WHERE id = (SELECT id FROM build_job WHERE status='queued' AND site_id NOT IN (SELECT site_id FROM build_job WHERE status IN ('building','validating','deploying')) ORDER BY priority DESC, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *
`

const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000
const DEPLOY_POLL_MS = 5000
const HEALTH_TIMEOUT_MS = 2 * 60 * 1000
const HEALTH_POLL_MS = 5000
const STALE_JOB_MS = 30 * 60 * 1000
const STALE_JOB_STATUSES = ['building', 'validating', 'deploying'] as const

type WorkerState = {
  timer: ReturnType<typeof setInterval>
  ticking: boolean
}

const g = globalThis as typeof globalThis & {
  __arecaWorker?: WorkerState
}

export type ProcessJobDeps = {
  adapter: DeploymentAdapter
}

export async function appendLog(jobId: string, line: string) {
  const stamped = `[${new Date().toISOString()}] ${line}`
  const [row] = await db
    .select({ logs: buildJob.logs })
    .from(buildJob)
    .where(eq(buildJob.id, jobId))
    .limit(1)
  await db
    .update(buildJob)
    .set({ logs: `${row?.logs ?? ''}${stamped}\n` })
    .where(eq(buildJob.id, jobId))
}

export async function claimNextJob() {
  const result = await pool.query<{ id: string }>(CLAIM_SQL)
  const id = result.rows[0]?.id
  if (!id) return null
  const [job] = await db
    .select()
    .from(buildJob)
    .where(eq(buildJob.id, id))
    .limit(1)
  return job ?? null
}

export async function runOnce(deps?: ProcessJobDeps) {
  const job = await claimNextJob()
  if (!job) return null
  await processJob(job, deps)
  return job
}

export async function processJob(
  job: typeof buildJob.$inferSelect,
  deps: ProcessJobDeps = { adapter: getDeploymentAdapter() },
) {
  const logs: Promise<void>[] = []
  const log = (line: string) => {
    logs.push(
      appendLog(job.id, line).catch((error) => {
        console.error('[areca] appendLog failed', error)
      }),
    )
  }

  try {
    const [existingSite] = await db
      .select()
      .from(site)
      .where(eq(site.id, job.siteId))
      .limit(1)
    if (!existingSite) {
      await failJob(job, job.publicationId, 'Site not found', null)
      return
    }

    const pub = await getPublication(job.publicationId)
    if (!pub) {
      await failJob(
        job,
        job.publicationId,
        'Publication not found',
        existingSite.organizationId,
      )
      return
    }

    await db
      .update(publication)
      .set({ status: 'building' })
      .where(eq(publication.id, pub.id))
    log('publication building')

    await db
      .update(buildJob)
      .set({ status: 'validating' })
      .where(eq(buildJob.id, job.id))
    log('validating snapshot')

    if (!pub.snapshot || !pub.snapshotHash) {
      await failJob(
        job,
        pub.id,
        'Snapshot missing',
        existingSite.organizationId,
      )
      return
    }
    if (!pub.snapshot.hash || pub.snapshot.hash.length === 0) {
      await failJob(
        job,
        pub.id,
        'Snapshot hash is empty',
        existingSite.organizationId,
      )
      return
    }

    await db
      .update(buildJob)
      .set({ status: 'deploying' })
      .where(eq(buildJob.id, job.id))
    log('deploying')

    const target = existingSite.deploymentTarget
    if (!target) {
      log('no deployment target configured, marking live without deploy')
    } else {
      const adapterTarget: DeploymentTarget = {
        provider: 'dokploy',
        applicationId: target.applicationId,
        healthCheckUrl: target.healthCheckUrl ?? '',
      }
      const { deploymentId } = await deps.adapter.deploy(adapterTarget, log)
      const wait = await deps.adapter.waitForCompletion(
        adapterTarget,
        deploymentId,
        { timeoutMs: DEPLOY_TIMEOUT_MS, pollMs: DEPLOY_POLL_MS },
        log,
      )
      if (wait !== 'done') {
        await failJob(
          job,
          pub.id,
          `Deploy ${wait}`,
          existingSite.organizationId,
        )
        return
      }
      if (target.healthCheckUrl) {
        log(`health check ${target.healthCheckUrl}`)
        const healthy = await deps.adapter.healthCheck(target.healthCheckUrl, {
          timeoutMs: HEALTH_TIMEOUT_MS,
          intervalMs: HEALTH_POLL_MS,
          expectPublicationId: pub.id,
        })
        if (!healthy) {
          await failJob(
            job,
            pub.id,
            'Health check failed',
            existingSite.organizationId,
          )
          return
        }
      }
    }

    const now = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(publication)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(publication.siteId, job.siteId),
            eq(publication.status, 'live'),
            ne(publication.id, pub.id),
          ),
        )
      await tx
        .update(publication)
        .set({ status: 'live', deployedAt: now })
        .where(eq(publication.id, pub.id))
      await tx
        .update(buildJob)
        .set({ status: 'succeeded', finishedAt: now, error: null })
        .where(eq(buildJob.id, job.id))
      await tx
        .update(entry)
        .set({
          status: 'published',
          publishedData: sql`${entry.draftData}`,
          publishedAt: now,
          scheduledAt: null,
          scheduleTimezone: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(entry.siteId, job.siteId),
            eq(entry.status, 'scheduled'),
            lte(entry.scheduledAt, now),
          ),
        )
    })

    log('publication live')
    await audit({
      organizationId: existingSite.organizationId,
      siteId: job.siteId,
      actorId: pub.requestedBy,
      action: 'publication.live',
      targetType: 'publication',
      targetId: pub.id,
      meta: { jobId: job.id },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      const [existingSite] = await db
        .select({ organizationId: site.organizationId })
        .from(site)
        .where(eq(site.id, job.siteId))
        .limit(1)
      await failJob(
        job,
        job.publicationId,
        message,
        existingSite?.organizationId ?? null,
      )
    } catch (failError) {
      console.error('[areca] processJob failed to record failure', failError)
    }
  } finally {
    await Promise.allSettled(logs)
  }
}

async function failJob(
  job: typeof buildJob.$inferSelect,
  publicationId: string,
  error: string,
  organizationId: string | null,
) {
  const now = new Date()
  await db
    .update(buildJob)
    .set({ status: 'failed', error, finishedAt: now })
    .where(eq(buildJob.id, job.id))
  await db
    .update(publication)
    .set({ status: 'failed' })
    .where(eq(publication.id, publicationId))
  await appendLog(job.id, `failed: ${error}`)
  if (organizationId) {
    await audit({
      organizationId,
      siteId: job.siteId,
      actorId: null,
      action: 'publication.failed',
      targetType: 'publication',
      targetId: publicationId,
      meta: { jobId: job.id, error },
    })
  }
}

async function tick() {
  try {
    await Promise.all([runOnce(), runOnce()])
    await runSchedulerTick()
  } catch (error) {
    console.error('[areca] publishing worker tick failed', error)
  }
}

export async function recoverStaleJobs(
  olderThanMs = STALE_JOB_MS,
  now = new Date(),
) {
  const cutoff = new Date(now.getTime() - olderThanMs)
  const stale = await db
    .select()
    .from(buildJob)
    .where(
      and(
        inArray(buildJob.status, [...STALE_JOB_STATUSES]),
        or(
          and(isNotNull(buildJob.startedAt), lte(buildJob.startedAt, cutoff)),
          and(isNull(buildJob.startedAt), lte(buildJob.createdAt, cutoff)),
        ),
      ),
    )

  for (const job of stale) {
    const [existingSite] = await db
      .select({ organizationId: site.organizationId })
      .from(site)
      .where(eq(site.id, job.siteId))
      .limit(1)
    await failJob(
      job,
      job.publicationId,
      'worker restarted',
      existingSite?.organizationId ?? null,
    )
  }

  return stale
}

export function startWorker({ intervalMs = 3000 }: { intervalMs?: number } = {}) {
  if (!env.WORKER_ENABLED) return
  if (g.__arecaWorker) return g.__arecaWorker

  console.log(`[areca] publishing worker started (interval ${intervalMs}ms)`)
  const state: WorkerState = {
    timer: setInterval(() => {
      if (state.ticking) return
      state.ticking = true
      void tick().finally(() => {
        state.ticking = false
      })
    }, intervalMs),
    ticking: true,
  }
  g.__arecaWorker = state
  void recoverStaleJobs()
    .catch((error) => {
      console.error('[areca] stale job recovery failed', error)
    })
    .finally(() => {
      state.ticking = false
      void tick()
    })
  return state
}

export function stopWorker() {
  const state = g.__arecaWorker
  if (!state) return
  clearInterval(state.timer)
  g.__arecaWorker = undefined
}
