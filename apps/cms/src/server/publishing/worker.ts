import { and, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'

import {
  DeploymentNotDispatchedError,
  DeploymentUncertainError,
} from '#/adapters/deployment/types'
import type {
  DeploymentAdapter,
  DeploymentContext,
  DeploymentTarget,
} from '#/adapters/deployment/types'
import { db, pool } from '#/db'
import {
  buildJob,
  entry,
  publication,
  site,
  user,
  opsCounter,
} from '#/db/schema'
import { env } from '#/env'
import { audit } from '#/server/audit'
import { drainStorageObjectDeletions } from '#/server/assets/storage-cleanup'
import { cleanupOutbox, processOutbox } from '#/server/mail/outbox'
import { cleanupNotifications } from '#/server/notifications/notify'
import {
  notifyPublicationFailed,
  notifyPublicationLive,
} from '#/server/notifications/triggers'
import {
  markLoopsStarted,
  markLoopsStopped,
  recordTick,
} from '#/server/ops/heartbeat'
import { createLogger, redactString } from '#/server/log'

import { installShutdownHandlers } from './shutdown.ts'
import { getDeploymentAdapterForOrganization } from '#/server/admin/dokploy-credentials'

import { deploymentIdentity, getPublication } from './publications.ts'
import {
  runSchedulerTick,
  recordSchedulerFailure,
  clearSchedulerFailure,
} from './scheduler.ts'

// Legacy active/uncertain rows may predate resource keys. Resolve their frozen
// target (or prior site target) so new releases cannot bypass their quarantine.
const fallbackConnectionUrl =
  process.env.NODE_ENV !== 'production' &&
  env.DOKPLOY_DEV_FALLBACK_ENABLED &&
  env.DOKPLOY_URL
    ? new URL(env.DOKPLOY_URL).href.replace(/\/+$/, '')
    : null

export function resourceBlockerSql(fallbackUrl: string | null) {
  const fallbackLiteral =
    fallbackUrl === null ? 'NULL' : `'${fallbackUrl.replaceAll("'", "''")}'`
  return `
SELECT 1 FROM build_job a
JOIN site legacy_site ON legacy_site.id=a.site_id
LEFT JOIN dokploy_credential credential ON credential.organization_id=legacy_site.organization_id
WHERE a.id<>q.id AND (a.status IN ('building','validating','deploying') OR a.dispatch_uncertain)
AND coalesce(a.deployment_resource_key,
  CASE WHEN coalesce(a.dispatch_connection_url, credential.url, ${fallbackLiteral}) IS NOT NULL
  THEN encode(sha256(convert_to(rtrim(coalesce(a.dispatch_connection_url, credential.url, ${fallbackLiteral}), '/') || E'\\n' || (coalesce(a.dispatch_target, legacy_site.deployment_target)->>'applicationId'), 'UTF8')), 'hex') END
)=q.deployment_resource_key
`
}
const RESOURCE_BLOCKER_SQL = resourceBlockerSql(fallbackConnectionUrl)

export const CLAIM_SQL = `
WITH candidate_site AS (
  SELECT s.id FROM site s
  WHERE EXISTS (SELECT 1 FROM build_job q WHERE q.site_id=s.id AND q.status='queued'
    AND (q.deployment_resource_key IS NULL OR NOT EXISTS (${RESOURCE_BLOCKER_SQL})))
    AND NOT EXISTS (SELECT 1 FROM build_job a WHERE a.site_id=s.id AND (a.status IN ('building','validating','deploying') OR a.dispatch_uncertain))
  ORDER BY (SELECT max(priority) FROM build_job q WHERE q.site_id=s.id AND q.status='queued') DESC, s.id
  LIMIT 1 FOR UPDATE OF s SKIP LOCKED
), candidate_job AS (
  SELECT q.id FROM build_job q JOIN candidate_site s ON s.id=q.site_id
  WHERE q.status='queued' AND (q.deployment_resource_key IS NULL OR NOT EXISTS (${RESOURCE_BLOCKER_SQL}))
  ORDER BY q.priority DESC, q.created_at ASC LIMIT 1 FOR UPDATE OF q SKIP LOCKED
)
UPDATE build_job SET status='building', started_at=now(), lease_expires_at=now()+interval '60 seconds', attempts=attempts+1
WHERE id=(SELECT id FROM candidate_job) RETURNING *
`

const logger = createLogger('worker')

const LEASE_MS = 60_000
const HEARTBEAT_MS = 15_000

const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000
const DEPLOY_POLL_MS = 5000
const HEALTH_TIMEOUT_MS = 2 * 60 * 1000
const HEALTH_POLL_MS = 5000
const MAIL_INTERVAL_MS = 5000
const STALE_JOB_MS = 30 * 60 * 1000
const STALE_JOB_STATUSES = ['building', 'validating', 'deploying'] as const

type WorkerState = {
  timer: ReturnType<typeof setInterval>
  recoveryTimer: ReturnType<typeof setInterval>
  schedulerTimer: ReturnType<typeof setInterval>
  cleanupTimer?: ReturnType<typeof setInterval>
  mailTimer?: ReturnType<typeof setInterval>
  mailCleanupTimer?: ReturnType<typeof setInterval>
  pool?: JobPool
  ticking: boolean
  schedulerTicking: boolean
}

const g = globalThis as typeof globalThis & {
  __arecaWorker?: WorkerState
}

export type ProcessJobDeps = {
  adapter?: DeploymentAdapter
  resolveAdapter?: (organizationId: string) => Promise<DeploymentAdapter>
  audit?: typeof audit
}

/** Per-job build log cap (characters). The tail is kept when exceeded. */
export const MAX_JOB_LOG_CHARS = 256 * 1024
/** A single log line is cut to this length before it is appended. */
export const MAX_JOB_LOG_LINE_CHARS = 8 * 1024
export const LOG_TRUNCATED_MARKER = '[truncated]\n'

export async function appendLog(jobId: string, line: string) {
  const text = redactString(line)
  const bounded =
    text.length > MAX_JOB_LOG_LINE_CHARS
      ? `${text.slice(0, MAX_JOB_LOG_LINE_CHARS)}…[line truncated]`
      : text
  const stamped = `[${new Date().toISOString()}] ${bounded}\n`
  // Done in SQL so concurrent appenders never race a read-modify-write. When
  // the result would exceed the cap, keep the newest MAX chars (marker
  // included) behind a single leading marker; an existing marker is always
  // shifted out because the cut removes at least marker-length characters.
  const combined = sql`coalesce(${buildJob.logs}, '') || ${stamped}::text`
  await db
    .update(buildJob)
    .set({
      logs: sql`CASE WHEN char_length(${combined}) > ${MAX_JOB_LOG_CHARS}
        THEN ${LOG_TRUNCATED_MARKER}::text || right(${combined}, ${MAX_JOB_LOG_CHARS - LOG_TRUNCATED_MARKER.length})
        ELSE ${combined} END`,
    })
    .where(eq(buildJob.id, jobId))
}

export async function claimNextJob() {
  await pool.query(
    `UPDATE build_job j SET
    dispatch_target=coalesce(j.dispatch_target,s.deployment_target),
    dispatch_connection_url=coalesce(j.dispatch_connection_url,c.url,$1::text),
    deployment_resource_key=encode(sha256(convert_to(rtrim(coalesce(j.dispatch_connection_url,c.url,$1::text), '/') || E'\\n' || (coalesce(j.dispatch_target,s.deployment_target)->>'applicationId'), 'UTF8')), 'hex')
    FROM site s LEFT JOIN dokploy_credential c ON c.organization_id=s.organization_id,
      publication p
    WHERE j.site_id=s.id AND j.publication_id=p.id AND p.publishing_mode='production'
      AND j.status='queued' AND j.deployment_resource_key IS NULL
      AND coalesce(j.dispatch_target,s.deployment_target)->>'applicationId' IS NOT NULL
      AND coalesce(j.dispatch_connection_url,c.url,$1::text) IS NOT NULL`,
    [fallbackConnectionUrl],
  )
  let result
  try {
    result = await pool.query<{ id: string }>(CLAIM_SQL)
  } catch (error) {
    // Two sites can race for one upstream resource; the unique index is the
    // final database fence. Leave the losing job queued for the next tick.
    if (
      (error as { code?: string; constraint?: string }).code === '23505' &&
      (error as { constraint?: string }).constraint ===
        'build_job_one_dispatch_per_resource'
    )
      return null
    throw error
  }
  const id = result.rows[0]?.id
  if (!id) return null
  const job = (await db
    .select()
    .from(buildJob)
    .where(eq(buildJob.id, id))
    .limit(1)).at(0)
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
  deps: ProcessJobDeps = {},
) {
  if (job.status === 'queued') {
    const claimed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM site WHERE id=${job.siteId} FOR UPDATE`,
      )
      const identity = await resourceIdentity(tx, job)
      const resourceKey =
        identity.deploymentResourceKey ?? job.deploymentResourceKey
      if (resourceKey) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${resourceKey}, 2))`,
        )
        const blocked = await tx.execute(
          sql`SELECT 1 FROM (SELECT ${job.id}::text id, ${resourceKey}::text deployment_resource_key) q WHERE EXISTS (${sql.raw(RESOURCE_BLOCKER_SQL)})`,
        )
        if (blocked.rows.length) return null
      }
      const active = (await tx
        .select()
        .from(buildJob)
        .where(
          and(
            or(
              eq(buildJob.siteId, job.siteId),
              ...(resourceKey
                ? [eq(buildJob.deploymentResourceKey, resourceKey)]
                : []),
            ),
            or(
              inArray(buildJob.status, ['building', 'validating', 'deploying']),
              eq(buildJob.dispatchUncertain, true),
            ),
          ),
        )
        .limit(1)).at(0)
      if (active) return null
      return (
        (
          await tx
            .update(buildJob)
            .set({
              ...identity,
              status: 'building',
              startedAt: new Date(),
              leaseExpiresAt: new Date(Date.now() + LEASE_MS),
              attempts: sql`${buildJob.attempts}+1`,
            })
            .where(and(eq(buildJob.id, job.id), eq(buildJob.status, 'queued')))
            .returning()
        )[0] ?? null
      )
    })
    if (!claimed) return
    job = claimed
  }
  let dispatchUncertain = job.dispatchUncertain
  const fence = and(
    eq(buildJob.id, job.id),
    eq(buildJob.attempts, job.attempts),
    inArray(buildJob.status, ['building', 'validating', 'deploying']),
    sql`${buildJob.leaseExpiresAt} > now()`,
  )
  const heartbeat = setInterval(() => {
    void db
      .update(buildJob)
      .set({ leaseExpiresAt: new Date(Date.now() + LEASE_MS) })
      .where(fence)
      .catch((error) =>
        logger.error('lease renewal failed', { jobId: job.id, err: error }),
      )
  }, HEARTBEAT_MS)
  const transition = async (status: 'validating' | 'deploying') => {
    const owned = (await db
      .update(buildJob)
      .set({ status })
      .where(fence)
      .returning({ id: buildJob.id })).at(0)
    if (!owned) throw new Error('Publication worker lease lost')
  }
  const logs: Promise<void>[] = []
  const log = (line: string) => {
    logs.push(
      appendLog(job.id, line).catch((error) => {
        logger.error('appendLog failed', { jobId: job.id, err: error })
      }),
    )
  }

  try {
    const existingSite = (await db
      .select()
      .from(site)
      .where(eq(site.id, job.siteId))
      .limit(1)).at(0)
    if (!existingSite) {
      await failJob(
        job,
        job.publicationId,
        'Site not found',
        null,
        dispatchUncertain,
      )
      return
    }

    const pub = await getPublication(job.publicationId)
    if (!pub) {
      await failJob(
        job,
        job.publicationId,
        'Publication not found',
        existingSite.organizationId,
        dispatchUncertain,
      )
      return
    }

    await db.transaction(async (tx) => {
      const owned = (await tx
        .select()
        .from(buildJob)
        .where(fence)
        .for('update')).at(0)
      if (!owned) throw new Error('Publication worker lease lost')
      await tx
        .update(publication)
        .set({ status: 'building' })
        .where(eq(publication.id, pub.id))
    })
    log(
      `publication building job=${job.id} publication=${pub.id} snapshot=${pub.snapshotHash}`,
    )

    await transition('validating')
    log('validating snapshot')

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: the column is NOT NULL, but a bad row must still fail the job here
    if (!pub.snapshot || !pub.snapshotHash) {
      await failJob(
        job,
        pub.id,
        'Snapshot missing',
        existingSite.organizationId,
        dispatchUncertain,
      )
      return
    }
    if (!pub.snapshot.hash || pub.snapshot.hash.length === 0) {
      await failJob(
        job,
        pub.id,
        'Snapshot hash is empty',
        existingSite.organizationId,
        dispatchUncertain,
      )
      return
    }

    await transition('deploying')
    log('deploying')

    const target = job.dispatchTarget ?? existingSite.deploymentTarget
    const demo = pub.publishingMode === 'demo'
    if (demo) {
      log('Demo publication: no production deployment or live verification')
    } else {
      if (!target?.applicationId || !target.healthCheckUrl)
        throw new Error(
          'Production publishing requires a deployment target and publication-aware health URL',
        )
      const adapterTarget: DeploymentTarget = {
        provider: 'dokploy',
        applicationId: target.applicationId,
        healthCheckUrl: target.healthCheckUrl ?? '',
      }
      const adapter =
        deps.adapter ??
        (await (deps.resolveAdapter ?? getDeploymentAdapterForOrganization)(
          existingSite.organizationId,
        ))
      const context: DeploymentContext = {
        jobId: job.id,
        publicationId: pub.id,
        snapshotHash: pub.snapshotHash,
        dispatchedAt: job.dispatchStartedAt ?? undefined,
      }
      let deploymentId = job.upstreamDeploymentId
      if (job.dispatchStartedAt) {
        // A durable intent survives process death. Even without an upstream ID,
        // recovery only reconciles; absence of a match never authorizes a POST.
        if (!deploymentId) {
          const found = await adapter.reconcile?.(adapterTarget, context, log)
          if (!found)
            throw new DeploymentUncertainError(
              'Deployment acceptance remains unknown; manual investigation required',
            )
          deploymentId = found.deploymentId
        }
        dispatchUncertain = true
      } else {
        const dispatchedAt = new Date()
        const intent = (await db
          .update(buildJob)
          .set({
            dispatchStartedAt: dispatchedAt,
            dispatchTarget: adapterTarget,
            dispatchUncertain: true,
          })
          .where(fence)
          .returning({ id: buildJob.id })).at(0)
        if (!intent) throw new Error('Publication worker lease lost')
        dispatchUncertain = true
        const result = await adapter.deploy(adapterTarget, log, {
          ...context,
          dispatchedAt,
        })
        deploymentId = result.deploymentId
      }
      const ownedDispatch = (await db
        .update(buildJob)
        .set({ upstreamDeploymentId: deploymentId })
        .where(fence)
        .returning({ id: buildJob.id })).at(0)
      if (!ownedDispatch) throw new Error('Publication worker lease lost')
      const wait = await adapter.waitForCompletion(
        adapterTarget,
        deploymentId,
        { timeoutMs: DEPLOY_TIMEOUT_MS, pollMs: DEPLOY_POLL_MS },
        log,
      )
      if (wait === 'timeout')
        throw new DeploymentUncertainError(
          `Deployment ${deploymentId} completion unknown; reconcile manually before publishing again`,
        )
      dispatchUncertain = false
      const completedDispatch = (await db
        .update(buildJob)
        .set({ dispatchUncertain: false })
        .where(fence)
        .returning({ id: buildJob.id })).at(0)
      if (!completedDispatch) throw new Error('Publication worker lease lost')
      if (wait === 'error') {
        await failJob(
          job,
          pub.id,
          `Deploy error (upstream=${deploymentId})`,
          existingSite.organizationId,
        )
        return
      }
      if (target.healthCheckUrl) {
        log(`health check ${target.healthCheckUrl}`)
        const healthy = await adapter.healthCheck(target.healthCheckUrl, {
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
      const owned = (await tx
        .select()
        .from(buildJob)
        .where(fence)
        .for('update')).at(0)
      if (!owned) throw new Error('Publication worker lease lost')
      await tx
        .update(publication)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(publication.siteId, job.siteId),
            eq(publication.status, demo ? 'demo' : 'live'),
            ne(publication.id, pub.id),
          ),
        )
      await tx
        .update(publication)
        .set({
          status: demo ? 'demo' : 'live',
          deployedAt: demo ? null : now,
          wasLive: !demo,
        })
        .where(eq(publication.id, pub.id))
      await clearSchedulerFailure(tx, job)
      await tx
        .update(buildJob)
        .set({
          status: 'succeeded',
          finishedAt: now,
          error: null,
          leaseExpiresAt: null,
          dispatchUncertain: false,
        })
        .where(eq(buildJob.id, job.id))
      for (const selected of pub.entryVersions) {
        if (!selected.scheduledVersion) continue
        await tx
          .update(entry)
          .set({
            status: 'published',
            publishedData: sql`${entry.scheduledData}`,
            publishedSlug: sql`${entry.scheduledSlug}`,
            publishedAt: now,
            scheduledAt: null,
            scheduleTimezone: null,
            scheduledBy: null,
            scheduledData: null,
            scheduledSlug: null,
            scheduledVersion: null,
          })
          .where(
            and(
              eq(entry.siteId, job.siteId),
              eq(entry.id, selected.entryId),
              eq(entry.scheduledVersion, selected.scheduledVersion),
              eq(entry.status, 'scheduled'),
            ),
          )
      }
    })

    log(
      demo
        ? 'Demo publication ready (not production live)'
        : 'publication live',
    )
    try {
      await (deps.audit ?? audit)({
        organizationId: existingSite.organizationId,
        siteId: job.siteId,
        actorId: pub.requestedBy,
        action: demo ? 'publication.demo' : 'publication.live',
        targetType: 'publication',
        targetId: pub.id,
        meta: { jobId: job.id },
      })
    } catch (error) {
      logger.error('completion audit failed', {
        jobId: job.id,
        publicationId: pub.id,
        err: error,
      })
    }
    // Never throws; runs after the commit above, so it cannot fail the job.
    await notifyPublicationLive(pub.id)
  } catch (error) {
    if (error instanceof DeploymentNotDispatchedError) dispatchUncertain = false
    const message = redactString(
      error instanceof Error ? error.message : String(error),
    )
    logger.error('job failed', {
      jobId: job.id,
      siteId: job.siteId,
      err: error,
    })
    try {
      const existingSite = (await db
        .select({ organizationId: site.organizationId })
        .from(site)
        .where(eq(site.id, job.siteId))
        .limit(1)).at(0)
      await failJob(
        job,
        job.publicationId,
        message,
        existingSite?.organizationId ?? null,
        dispatchUncertain,
      )
    } catch (failError) {
      logger.error('processJob failed to record failure', {
        jobId: job.id,
        err: failError,
      })
    }
  } finally {
    clearInterval(heartbeat)
    await Promise.allSettled(logs)
  }
}

async function failJob(
  job: typeof buildJob.$inferSelect,
  publicationId: string,
  error: string,
  organizationId: string | null,
  dispatchUncertain = false,
) {
  error = redactString(
    `job=${job.id} publication=${publicationId}: ${error}${dispatchUncertain ? '; deployment outcome uncertain — reconcile this job before publishing again' : ''}`,
  )
  const now = new Date()
  const recorded = await db.transaction(async (tx) => {
    const failed = (await tx
      .update(buildJob)
      .set({
        status: 'failed',
        error,
        finishedAt: now,
        leaseExpiresAt: null,
        dispatchUncertain,
      })
      .where(
        and(
          eq(buildJob.id, job.id),
          eq(buildJob.attempts, job.attempts),
          inArray(buildJob.status, ['building', 'validating', 'deploying']),
          // Expired workers must leave the durable dispatch marker untouched.
          // Recovery acquires the row and decides whether it needs quarantine.
          sql`${buildJob.leaseExpiresAt} > now()`,
        ),
      )
      .returning()).at(0)
    if (!failed) return false
    await incrementFailureCounter(tx)
    await recordSchedulerFailure(tx, job, error, now)
    await tx
      .update(publication)
      .set({ status: dispatchUncertain ? 'building' : 'failed' })
      .where(eq(publication.id, publicationId))
    return true
  })
  if (!recorded) return
  await appendLog(job.id, `failed: ${error}`)
  if (organizationId) {
    await audit({
      organizationId,
      siteId: job.siteId,
      actorId: null,
      action: 'publication.failed',
      targetType: 'publication',
      targetId: publicationId,
      meta: { jobId: job.id, publicationId, error, dispatchUncertain },
    })
  }
  await notifyPublicationFailed(publicationId, { stuck: dispatchUncertain })
}

/** Owner/admin entry point: resume the same dispatch, never create another. */
export async function reconcileDeploymentJob(
  jobId: string,
  deps: ProcessJobDeps = {},
) {
  const claimed = await db.transaction(async (tx) => {
    const candidate = (await tx
      .select()
      .from(buildJob)
      .where(eq(buildJob.id, jobId))
      .limit(1)).at(0)
    if (!candidate) throw new Error('Build job not found')
    await tx.execute(
      sql`SELECT id FROM site WHERE id=${candidate.siteId} FOR UPDATE`,
    )
    const active = (await tx
      .select()
      .from(buildJob)
      .where(
        and(
          eq(buildJob.siteId, candidate.siteId),
          inArray(buildJob.status, ['building', 'validating', 'deploying']),
        ),
      )
      .limit(1)).at(0)
    if (active) throw new Error('A worker is already reconciling this site')
    const identity = await resourceIdentity(tx, candidate)
    const resourceKey =
      identity.deploymentResourceKey ?? candidate.deploymentResourceKey
    if (resourceKey) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${resourceKey}, 2))`,
      )
      const blocked = await tx.execute(
        sql`SELECT 1 FROM (SELECT ${candidate.id}::text id, ${resourceKey}::text deployment_resource_key) q WHERE EXISTS (${sql.raw(RESOURCE_BLOCKER_SQL)})`,
      )
      if (blocked.rows.length)
        throw new Error(
          'Another deployment for this Dokploy application must finish or be resolved first',
        )
    }
    const job = (await tx
      .update(buildJob)
      .set({
        ...identity,
        status: 'deploying',
        startedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        attempts: sql`${buildJob.attempts}+1`,
      })
      .where(
        and(
          eq(buildJob.id, jobId),
          eq(buildJob.status, 'failed'),
          eq(buildJob.dispatchUncertain, true),
        ),
      )
      .returning()).at(0)
    if (!job) throw new Error('Job does not require deployment reconciliation')
    return job
  })
  // Legacy deploying jobs without an intent cannot be reconciled safely. Do
  // not let the resume branch send a fresh deploy request for those jobs.
  if (!claimed.dispatchStartedAt) {
    await failJob(
      claimed,
      claimed.publicationId,
      'Legacy dispatch has no identity; investigate upstream manually',
      null,
      true,
    )
  } else {
    await processJob(claimed, deps)
  }
  return (
    await db.select().from(buildJob).where(eq(buildJob.id, jobId)).limit(1)
  )[0]
}

/** Explicit terminal resolution after an agency admin has stopped/drained upstream. */
export async function resolveUncertainDeploymentJob(input: {
  jobId: string
  actorId: string
  reason: string
  upstreamStopped: boolean
}) {
  if (input.upstreamStopped !== true || input.reason.trim().length < 10)
    throw new Error(
      'Confirm upstream has stopped and provide an investigation reason',
    )
  const actor = (await db
    .select({ isAgencyAdmin: user.isAgencyAdmin })
    .from(user)
    .where(eq(user.id, input.actorId))
    .limit(1)).at(0)
  if (!actor?.isAgencyAdmin)
    throw new Error('Only agency admins can release an uncertain deployment')
  const result = await db.transaction(async (tx) => {
    const candidate = (await tx
      .select()
      .from(buildJob)
      .where(eq(buildJob.id, input.jobId))
      .limit(1)).at(0)
    if (!candidate) throw new Error('Build job not found')
    const existingSite = (await tx
      .select()
      .from(site)
      .where(eq(site.id, candidate.siteId))
      .for('update')
      .limit(1)).at(0)
    if (!existingSite) throw new Error('Site not found')
    const active = (await tx
      .select()
      .from(buildJob)
      .where(
        and(
          eq(buildJob.siteId, candidate.siteId),
          inArray(buildJob.status, ['building', 'validating', 'deploying']),
        ),
      )
      .limit(1)).at(0)
    if (active)
      throw new Error(
        'A worker is still active; wait for reconciliation to finish',
      )
    const reason = redactString(input.reason.trim())
    const resolved = (await tx
      .update(buildJob)
      .set({
        dispatchUncertain: false,
        error: `Manually resolved after upstream stopped: ${reason}`,
      })
      .where(
        and(
          eq(buildJob.id, input.jobId),
          eq(buildJob.status, 'failed'),
          eq(buildJob.dispatchUncertain, true),
        ),
      )
      .returning()).at(0)
    if (!resolved)
      throw new Error('Job does not require deployment reconciliation')
    await tx
      .update(publication)
      .set({ status: 'failed' })
      .where(eq(publication.id, resolved.publicationId))
    await audit(
      {
        organizationId: existingSite.organizationId,
        siteId: existingSite.id,
        actorId: input.actorId,
        action: 'publication.dispatch_resolved',
        targetType: 'publication',
        targetId: resolved.publicationId,
        meta: {
          jobId: resolved.id,
          upstreamDeploymentId: resolved.upstreamDeploymentId,
          reason,
          upstreamStopped: true,
        },
      },
      tx,
    )
    return resolved
  })
  await notifyPublicationFailed(result.publicationId, { stuck: false })
  return result
}

export type JobPool = {
  /** Claims jobs until the concurrency cap is reached or the queue is empty. */
  fill: () => Promise<void>
  inFlight: () => number
  /** Stops claiming and waits (bounded) for running jobs. True if all finished. */
  drain: (timeoutMs?: number) => Promise<boolean>
}

/**
 * Runs claimed jobs as tracked in-flight promises. `fill` only awaits claims,
 * never a job, so a slow deployment for one site cannot delay claiming work for
 * other sites. Per-site serialization stays in the database (claim SQL,
 * partial unique indexes, leases).
 */
export function createJobPool({
  concurrency,
  claim,
  run,
}: {
  concurrency: number
  claim: () => Promise<typeof buildJob.$inferSelect | null>
  run: (job: typeof buildJob.$inferSelect) => Promise<unknown>
}): JobPool {
  const running = new Set<Promise<void>>()
  let filling: Promise<void> | null = null
  let stopped = false

  const fillOnce = async () => {
    while (!stopped && running.size < concurrency) {
      let job: typeof buildJob.$inferSelect | null
      try {
        job = await claim()
      } catch (error) {
        logger.error('claiming job failed', { err: error })
        return
      }
      if (!job) return
      const task: Promise<void> = Promise.resolve()
        .then(async () => {
          await run(job)
        })
        .catch((error) =>
          logger.error('job run failed', { jobId: job.id, err: error }),
        )
        .finally(() => {
          running.delete(task)
          // A slot freed up: pick up queued work without waiting for the timer.
          void fill()
        })
      running.add(task)
    }
  }
  const fill = () => {
    filling ??= fillOnce().finally(() => {
      filling = null
    })
    return filling
  }

  return {
    fill,
    inFlight: () => running.size,
    async drain(timeoutMs = 30_000) {
      stopped = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs)
      })
      try {
        const result = await Promise.race([
          (async () => {
            // A claim already in progress can add a task after stop. Include
            // that task before deciding the pool has finished draining.
            await filling
            await Promise.allSettled([...running])
            return 'done' as const
          })(),
          timeout,
        ])
        return result === 'done'
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export async function recoverStaleJobs(
  olderThanMs = STALE_JOB_MS,
  now = new Date(),
) {
  const cutoff = new Date(now.getTime() - olderThanMs)
  // Lock and fence in one transaction. A heartbeat cannot resurrect an expired lease.
  const staleJobs = await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(buildJob)
      .where(
        and(
          inArray(buildJob.status, [...STALE_JOB_STATUSES]),
          or(
            lte(buildJob.leaseExpiresAt, now),
            and(
              isNull(buildJob.leaseExpiresAt),
              or(
                lte(buildJob.startedAt, cutoff),
                and(
                  isNull(buildJob.startedAt),
                  lte(buildJob.createdAt, cutoff),
                ),
              ),
            ),
          ),
        ),
      )
      .for('update', { skipLocked: true })
    for (const job of stale) {
      await incrementFailureCounter(tx)
      await recordSchedulerFailure(tx, job, 'Worker lease expired', now)
      await tx
        .update(buildJob)
        .set({
          status: 'failed',
          finishedAt: now,
          error:
            job.dispatchStartedAt || job.status === 'deploying'
              ? `Worker lease expired after dispatch intent; reconcile job=${job.id} publication=${job.publicationId} before publishing again`
              : 'Worker lease expired before dispatch; retry publication',
          dispatchUncertain: Boolean(
            job.dispatchStartedAt || job.status === 'deploying',
          ),
          leaseExpiresAt: null,
        })
        .where(
          and(eq(buildJob.id, job.id), eq(buildJob.attempts, job.attempts)),
        )
      await tx
        .update(publication)
        .set({
          status:
            job.dispatchStartedAt || job.status === 'deploying'
              ? 'building'
              : 'failed',
        })
        .where(eq(publication.id, job.publicationId))
    }
    return stale
  })
  for (const job of staleJobs) {
    await notifyPublicationFailed(job.publicationId, {
      stuck: Boolean(job.dispatchStartedAt || job.status === 'deploying'),
    })
  }
  return staleJobs
}

export type WorkerLoopDeps = {
  /** Claims queued jobs and starts them; must return without awaiting them. */
  processJobs: () => Promise<unknown>
  recover: () => Promise<unknown>
  /** Enqueues due scheduled publications. */
  schedule: () => Promise<unknown>
  /** Retries durable storage cleanup independently of releases. */
  cleanup?: () => Promise<unknown>
  /** Sends due emails from the outbox, every 5 s. */
  mail?: () => Promise<unknown>
  /** Deletes outbox rows past retention, hourly. */
  mailCleanup?: () => Promise<unknown>
}

/**
 * Independent timers, each with its own in-flight guard, so a slow
 * deployment (up to DEPLOY_TIMEOUT_MS) never delays recovery or the
 * scheduling of due entries for other sites:
 * - jobs: claims and runs queued jobs
 * - recovery: fails jobs whose lease expired
 * - scheduler: turns due scheduled entries into publications
 * - cleanup: retries durable storage object deletions
 * - mail: sends due outbox emails; mailCleanup: prunes old outbox rows
 */
export function startWorkerLoops(
  deps: WorkerLoopDeps,
  {
    intervalMs = 3000,
    schedulerIntervalMs = Math.min(intervalMs, 15_000),
  } = {},
): WorkerState {
  markLoopsStarted()
  const state = {
    ticking: true,
    schedulerTicking: false,
  } as WorkerState
  let recovering = false

  state.recoveryTimer = setInterval(
    () => {
      if (recovering) return
      recovering = true
      void deps
        .recover()
        .catch((error) =>
          logger.error('periodic recovery failed', { err: error }),
        )
        .finally(() => {
          recovering = false
        })
    },
    Math.min(intervalMs, 15_000),
  )
  state.timer = setInterval(() => {
    // The timer firing proves the event loop is alive even while a long
    // deployment keeps the previous tick in flight.
    recordTick('worker')
    if (state.ticking) return
    state.ticking = true
    void deps
      .processJobs()
      .catch((error) => logger.error('worker tick failed', { err: error }))
      .finally(() => {
        state.ticking = false
      })
  }, intervalMs)
  state.schedulerTimer = setInterval(() => {
    if (state.schedulerTicking) return
    state.schedulerTicking = true
    void deps
      .schedule()
      .then(() => recordTick('scheduler'))
      .catch((error) => logger.error('scheduler tick failed', { err: error }))
      .finally(() => {
        state.schedulerTicking = false
      })
  }, schedulerIntervalMs)

  if (deps.cleanup) {
    let cleaning = false
    const cleanup = () => {
      if (cleaning) return
      cleaning = true
      void deps.cleanup!()
        .catch((error) =>
          logger.error('storage cleanup failed', { err: error }),
        )
        .finally(() => {
          cleaning = false
        })
    }
    state.cleanupTimer = setInterval(cleanup, 15_000)
    cleanup()
  }

  if (deps.mail) {
    let sending = false
    state.mailTimer = setInterval(() => {
      if (sending) return
      sending = true
      void deps.mail!()
        .catch((error) =>
          logger.error('mail outbox tick failed', { err: error }),
        )
        .finally(() => {
          sending = false
        })
    }, MAIL_INTERVAL_MS)
  }

  if (deps.mailCleanup) {
    let pruning = false
    const prune = () => {
      if (pruning) return
      pruning = true
      void deps.mailCleanup!()
        .catch((error) => logger.error('mail cleanup failed', { err: error }))
        .finally(() => {
          pruning = false
        })
    }
    state.mailCleanupTimer = setInterval(prune, 60 * 60 * 1000)
    prune()
  }

  // Boot: recover once, then start processing and scheduling immediately.
  void deps
    .recover()
    .catch((error) => logger.error('stale job recovery failed', { err: error }))
    .finally(() => {
      recordTick('worker')
      void deps
        .processJobs()
        .catch((error) => logger.error('worker tick failed', { err: error }))
        .finally(() => {
          state.ticking = false
        })
    })
  state.schedulerTicking = true
  void deps
    .schedule()
    .then(() => recordTick('scheduler'))
    .catch((error) => logger.error('scheduler tick failed', { err: error }))
    .finally(() => {
      state.schedulerTicking = false
    })
  return state
}

export function startWorker({
  intervalMs = 3000,
}: { intervalMs?: number } = {}) {
  if (!env.WORKER_ENABLED) return
  if (g.__arecaWorker) return g.__arecaWorker

  const workerPool = createJobPool({
    concurrency: env.WORKER_CONCURRENCY,
    claim: claimNextJob,
    run: (job) => processJob(job),
  })
  logger.info('publishing worker started', {
    intervalMs,
    concurrency: env.WORKER_CONCURRENCY,
  })
  const state = startWorkerLoops(
    {
      processJobs: workerPool.fill,
      recover: () => recoverStaleJobs(),
      schedule: () => runSchedulerTick(),
      cleanup: () => drainStorageObjectDeletions(),
      mail: () => processOutbox(),
      mailCleanup: () => Promise.all([cleanupOutbox(), cleanupNotifications()]),
    },
    { intervalMs },
  )
  state.pool = workerPool
  g.__arecaWorker = state
  installShutdownHandlers({
    stop: () => stopWorker({ drainTimeoutMs: env.WORKER_DRAIN_TIMEOUT_MS }),
    exit: (code) => process.exit(code),
  })
  return state
}

/**
 * Stops the timers, stops claiming, and waits up to `drainTimeoutMs` for
 * in-flight jobs. Jobs still running afterwards keep their lease and are
 * recovered by the next process if it never finishes them.
 */
export async function stopWorker({
  drainTimeoutMs = 30_000,
}: { drainTimeoutMs?: number } = {}) {
  const state = g.__arecaWorker
  if (!state) return true
  stopWorkerLoops(state)
  g.__arecaWorker = undefined
  const drained = (await state.pool?.drain(drainTimeoutMs)) ?? true
  if (!drained) {
    logger.warn('worker stopped with jobs still in flight', {
      inFlight: state.pool?.inFlight(),
    })
  }
  return drained
}

export function stopWorkerLoops(state: WorkerState) {
  clearInterval(state.timer)
  clearInterval(state.recoveryTimer)
  clearInterval(state.schedulerTimer)
  clearInterval(state.cleanupTimer)
  clearInterval(state.mailTimer)
  clearInterval(state.mailCleanupTimer)
  markLoopsStopped()
}

async function incrementFailureCounter(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
) {
  await tx
    .insert(opsCounter)
    .values({ name: 'publication_failures', value: 1 })
    .onConflictDoUpdate({
      target: opsCounter.name,
      set: { value: sql`${opsCounter.value} + 1` },
    })
}

async function resourceIdentity(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  job: typeof buildJob.$inferSelect,
) {
  if (job.deploymentResourceKey) return {}
  const existingSite = (await tx
    .select()
    .from(site)
    .where(eq(site.id, job.siteId))).at(0)
  const pub = (await tx
    .select({ publishingMode: publication.publishingMode })
    .from(publication)
    .where(eq(publication.id, job.publicationId))).at(0)
  if (!existingSite || !pub) return {}
  return deploymentIdentity(tx, {
    ...existingSite,
    publishingMode: pub.publishingMode,
    deploymentTarget: job.dispatchTarget ?? existingSite.deploymentTarget,
  })
}
