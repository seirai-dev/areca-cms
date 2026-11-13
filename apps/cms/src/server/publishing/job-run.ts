import { and, desc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'

import {
  DeploymentNotDispatchedError,
  DeploymentUncertainError,
} from '#/adapters/deployment/types'
import type {
  DeploymentAdapter,
  DeploymentContext,
  DeploymentTarget,
} from '#/adapters/deployment/types'
import { db } from '#/db'
import type { Tx } from '#/db'
import {
  buildJob,
  entry,
  publication,
  site,
  user,
  opsCounter,
} from '#/db/schema'
import { hasCompleteDeploymentTarget } from '#/lib/deployment-target'
import { RUNNING_JOB_STATUSES } from '#/lib/job-status'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import {
  lockSiteLinkIndex,
  syncEntryLinkIndexes,
} from '#/server/content/entry-link-index'
import { CLEARED_SCHEDULE } from '#/server/content/entry-commit'
import { siteCoreColumns } from '#/server/content/site-core'
import { createLogger, redactString } from '#/server/log'
import { queuePublicationEvent } from '#/server/notifications/publication-events'

import { resolveDeploymentAdapter } from './deployment-adapters.ts'
import {
  LEASE_MS,
  leaseColumns,
  lockDeploymentResource,
  lockSiteRow,
  siteHasRunningJob,
} from './job-claim.ts'
import type { BuildJob } from './job-claim.ts'
import { getPublication } from './publications.ts'
import {
  clearSchedulerFailure,
  recordSchedulerFailure,
} from './scheduler-backoff.ts'

const logger = createLogger('worker')

const HEARTBEAT_MS = 15_000
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000
const DEPLOY_POLL_MS = 5000
const HEALTH_TIMEOUT_MS = 2 * 60 * 1000
const HEALTH_POLL_MS = 5000
const STALE_JOB_MS = 30 * 60 * 1000
const LEASE_LOST = 'Publication worker lease lost'

export type ProcessJobDeps = {
  adapter?: DeploymentAdapter
  resolveAdapter?: (
    organizationId: string,
    target: DeploymentTarget,
  ) => Promise<DeploymentAdapter>
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

/** Takes a queued job under the site and resource locks; null when blocked. */
async function claimQueuedJob(job: BuildJob) {
  return db.transaction(async (tx) => {
    await lockSiteRow(tx, job.siteId)
    const { identity, resourceKey, blocked } = await lockDeploymentResource(
      tx,
      job,
    )
    if (blocked) return null
    const active = (
      await tx
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
              inArray(buildJob.status, RUNNING_JOB_STATUSES),
              eq(buildJob.dispatchUncertain, true),
            ),
          ),
        )
        .limit(1)
    ).at(0)
    if (active) return null
    return (
      (
        await tx
          .update(buildJob)
          .set(leaseColumns(identity, 'building'))
          .where(and(eq(buildJob.id, job.id), eq(buildJob.status, 'queued')))
          .returning()
      )[0] ?? null
    )
  })
}

/** Writes to the job only while this worker still holds its lease. */
type Fenced = {
  update: (set: Partial<typeof buildJob.$inferInsert>) => Promise<void>
  /** Locks the job row in `tx`, or throws when the lease is gone. */
  lock: (tx: Tx) => Promise<void>
}

function leaseFence(job: BuildJob): {
  where: ReturnType<typeof and>
  fenced: Fenced
} {
  const where = and(
    eq(buildJob.id, job.id),
    eq(buildJob.attempts, job.attempts),
    inArray(buildJob.status, RUNNING_JOB_STATUSES),
    sql`${buildJob.leaseExpiresAt} > now()`,
  )
  return {
    where,
    fenced: {
      async update(set) {
        const owned = (
          await db
            .update(buildJob)
            .set(set)
            .where(where)
            .returning({ id: buildJob.id })
        ).at(0)
        if (!owned) throw new Error(LEASE_LOST)
      },
      async lock(tx) {
        const owned = (
          await tx.select().from(buildJob).where(where).for('update')
        ).at(0)
        if (!owned) throw new Error(LEASE_LOST)
      },
    },
  }
}

export async function processJob(job: BuildJob, deps: ProcessJobDeps = {}) {
  if (job.status === 'queued') {
    const claimed = await claimQueuedJob(job)
    if (!claimed) return
    job = claimed
  }
  const dispatch = { uncertain: job.dispatchUncertain }
  const { where: fence, fenced } = leaseFence(job)
  const heartbeat = setInterval(() => {
    void db
      .update(buildJob)
      .set({ leaseExpiresAt: new Date(Date.now() + LEASE_MS) })
      .where(fence)
      .catch((error) =>
        logger.error('lease renewal failed', { jobId: job.id, err: error }),
      )
  }, HEARTBEAT_MS)
  const logs: Promise<void>[] = []
  const log = (line: string) => {
    logs.push(
      appendLog(job.id, line).catch((error) => {
        logger.error('appendLog failed', { jobId: job.id, err: error })
      }),
    )
  }

  try {
    const existingSite = (
      await db
        .select(siteCoreColumns)
        .from(site)
        .where(eq(site.id, job.siteId))
        .limit(1)
    ).at(0)
    if (!existingSite) {
      await failJob(
        job,
        job.publicationId,
        'Site not found',
        null,
        dispatch.uncertain,
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
        dispatch.uncertain,
      )
      return
    }

    await db.transaction(async (tx) => {
      await fenced.lock(tx)
      await tx
        .update(publication)
        .set({ status: 'building' })
        .where(eq(publication.id, pub.id))
    })
    log(
      `publication building job=${job.id} publication=${pub.id} snapshot=${pub.snapshotHash}`,
    )

    await fenced.update({ status: 'validating' })
    log('validating snapshot')

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: the column is NOT NULL, but a bad row must still fail the job here
    if (!pub.snapshot || !pub.snapshotHash) {
      await failJob(
        job,
        pub.id,
        'Snapshot missing',
        existingSite.organizationId,
        dispatch.uncertain,
      )
      return
    }
    if (!pub.snapshot.hash || pub.snapshot.hash.length === 0) {
      await failJob(
        job,
        pub.id,
        'Snapshot hash is empty',
        existingSite.organizationId,
        dispatch.uncertain,
      )
      return
    }

    await fenced.update({ status: 'deploying' })
    log('deploying')

    const demo = pub.publishingMode === 'demo'
    if (demo) {
      log('Demo publication: no production deployment or live verification')
    } else {
      const failure = await runDeployment({
        job,
        pub,
        target: job.dispatchTarget ?? existingSite.deploymentTarget,
        organizationId: existingSite.organizationId,
        deps,
        fenced,
        dispatch,
        log,
      })
      if (failure) {
        await failJob(job, pub.id, failure, existingSite.organizationId)
        return
      }
    }

    await completeRelease(job, pub, demo, fenced)

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
  } catch (error) {
    if (error instanceof DeploymentNotDispatchedError)
      dispatch.uncertain = false
    const message = redactString(
      error instanceof Error ? error.message : String(error),
    )
    logger.error('job failed', {
      jobId: job.id,
      siteId: job.siteId,
      err: error,
    })
    try {
      const existingSite = (
        await db
          .select({ organizationId: site.organizationId })
          .from(site)
          .where(eq(site.id, job.siteId))
          .limit(1)
      ).at(0)
      await failJob(
        job,
        job.publicationId,
        message,
        existingSite?.organizationId ?? null,
        dispatch.uncertain,
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

type Publication = typeof publication.$inferSelect

/**
 * Dispatches (or resumes) the upstream deployment, waits for it and checks the
 * site's health. Returns the failure to record, or null when it is live.
 */
async function runDeployment({
  job,
  pub,
  target,
  organizationId,
  deps,
  fenced,
  dispatch,
  log,
}: {
  job: BuildJob
  pub: Publication
  target: DeploymentTarget | null
  organizationId: string
  deps: ProcessJobDeps
  fenced: Fenced
  dispatch: { uncertain: boolean }
  log: (line: string) => void
}): Promise<string | null> {
  if (!hasCompleteDeploymentTarget(target))
    throw new Error(m.server_publication_deployment_required())
  const adapter =
    deps.adapter ??
    (await (deps.resolveAdapter ?? resolveDeploymentAdapter)(
      organizationId,
      target,
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
      const found = await adapter.reconcile?.(target, context, log)
      if (!found)
        throw new DeploymentUncertainError(
          'Deployment acceptance remains unknown; manual investigation required',
        )
      deploymentId = found.deploymentId
    }
    dispatch.uncertain = true
  } else {
    const dispatchedAt = new Date()
    await fenced.update({
      dispatchStartedAt: dispatchedAt,
      dispatchTarget: target,
      dispatchUncertain: true,
    })
    dispatch.uncertain = true
    const result = await adapter.deploy(target, log, {
      ...context,
      dispatchedAt,
    })
    deploymentId = result.deploymentId
  }
  await fenced.update({ upstreamDeploymentId: deploymentId })
  const wait = await adapter.waitForCompletion(
    target,
    deploymentId,
    { timeoutMs: DEPLOY_TIMEOUT_MS, pollMs: DEPLOY_POLL_MS },
    log,
  )
  if (wait === 'timeout')
    throw new DeploymentUncertainError(
      `Deployment ${deploymentId} completion unknown; reconcile manually before publishing again`,
    )
  dispatch.uncertain = false
  await fenced.update({ dispatchUncertain: false })
  if (wait === 'error') return `Deploy error (upstream=${deploymentId})`
  log(`health check ${target.healthCheckUrl}`)
  const healthy = await adapter.healthCheck(target.healthCheckUrl, {
    timeoutMs: HEALTH_TIMEOUT_MS,
    intervalMs: HEALTH_POLL_MS,
    expectPublicationId: pub.id,
  })
  return healthy ? null : 'Health check failed'
}

/** Makes the publication live (or the demo), and releases its scheduled entries. */
async function completeRelease(
  job: BuildJob,
  pub: Publication,
  demo: boolean,
  fenced: Fenced,
) {
  const now = new Date()
  await db.transaction(async (tx) => {
    // Link-index lock first: this release moves scheduled entries to published
    // and rewrites their link rows (see `lockSiteLinkIndex`).
    await lockSiteLinkIndex(tx, job.siteId)
    await fenced.lock(tx)
    // Read before the supersede below: the live notice diffs against this
    // release, and it is no longer 'live' once superseded.
    const predecessor = (
      await tx
        .select({ id: publication.id })
        .from(publication)
        .where(
          and(
            eq(publication.siteId, job.siteId),
            eq(publication.status, 'live'),
            ne(publication.id, pub.id),
          ),
        )
        .orderBy(desc(publication.createdAt))
        .limit(1)
    ).at(0)
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
    if (!demo) {
      await queuePublicationEvent(tx, {
        kind: 'publication.live',
        siteId: job.siteId,
        publicationId: pub.id,
        payload: { previousPublicationId: predecessor?.id ?? null },
      })
    }
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
    const released = pub.entryVersions.filter(
      (selected) => selected.scheduledVersion,
    )
    if (released.length > 0) {
      const ids = released.map((selected) => selected.entryId)
      // Entry rows are locked in id order (see `lockSiteLinkIndex`).
      await tx
        .select({ id: entry.id })
        .from(entry)
        .where(and(eq(entry.siteId, job.siteId), inArray(entry.id, ids)))
        .orderBy(entry.id)
        .for('no key update')
      await tx
        .update(entry)
        .set({
          contentVersion: sql`${entry.contentVersion} + 1`,
          status: 'published',
          publishedData: sql`${entry.scheduledData}`,
          publishedSlug: sql`${entry.scheduledSlug}`,
          publishedAt: now,
          ...CLEARED_SCHEDULE,
        })
        .where(
          and(
            eq(entry.siteId, job.siteId),
            sql`(${entry.id}, ${entry.scheduledVersion}) IN (VALUES ${sql.join(
              released.map(
                (selected) =>
                  sql`(${selected.entryId}, ${selected.scheduledVersion})`,
              ),
              sql`, `,
            )})`,
            eq(entry.status, 'scheduled'),
          ),
        )
      await syncEntryLinkIndexes(tx, ids)
    }
  })
}

/**
 * Marks the publication failed, or keeps it building while the deployment is
 * stuck, and queues the owners' failure notice.
 */
async function markPublicationFailed(
  tx: Tx,
  input: { siteId: string; publicationId: string; stuck: boolean },
) {
  await tx
    .update(publication)
    .set({ status: input.stuck ? 'building' : 'failed' })
    .where(eq(publication.id, input.publicationId))
  await queuePublicationEvent(tx, {
    kind: 'publication.failed',
    siteId: input.siteId,
    publicationId: input.publicationId,
    payload: { stuck: input.stuck },
  })
}

async function failJob(
  job: BuildJob,
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
    const failed = (
      await tx
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
            inArray(buildJob.status, RUNNING_JOB_STATUSES),
            // Expired workers must leave the durable dispatch marker untouched.
            // Recovery acquires the row and decides whether it needs quarantine.
            sql`${buildJob.leaseExpiresAt} > now()`,
          ),
        )
        .returning()
    ).at(0)
    if (!failed) return false
    await incrementFailureCounter(tx)
    await recordSchedulerFailure(tx, job, error, now)
    await markPublicationFailed(tx, {
      siteId: job.siteId,
      publicationId,
      stuck: dispatchUncertain,
    })
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
}

/** Owner/admin entry point: resume the same dispatch, never create another. */
export async function reconcileDeploymentJob(
  jobId: string,
  deps: ProcessJobDeps = {},
) {
  const claimed = await db.transaction(async (tx) => {
    const candidate = (
      await tx.select().from(buildJob).where(eq(buildJob.id, jobId)).limit(1)
    ).at(0)
    if (!candidate) throw new Error('Build job not found')
    await lockSiteRow(tx, candidate.siteId)
    if (await siteHasRunningJob(tx, candidate.siteId))
      throw new Error('A worker is already reconciling this site')
    const { identity, blocked } = await lockDeploymentResource(tx, candidate)
    if (blocked)
      throw new Error(
        'Another deployment for this upstream resource must finish or be resolved first',
      )
    const job = (
      await tx
        .update(buildJob)
        .set(leaseColumns(identity, 'deploying'))
        .where(
          and(
            eq(buildJob.id, jobId),
            eq(buildJob.status, 'failed'),
            eq(buildJob.dispatchUncertain, true),
          ),
        )
        .returning()
    ).at(0)
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
  const actor = (
    await db
      .select({ isAgencyAdmin: user.isAgencyAdmin })
      .from(user)
      .where(eq(user.id, input.actorId))
      .limit(1)
  ).at(0)
  if (!actor?.isAgencyAdmin)
    throw new Error('Only agency admins can release an uncertain deployment')
  const result = await db.transaction(async (tx) => {
    const candidate = (
      await tx
        .select()
        .from(buildJob)
        .where(eq(buildJob.id, input.jobId))
        .limit(1)
    ).at(0)
    if (!candidate) throw new Error('Build job not found')
    const existingSite = (
      await tx
        .select(siteCoreColumns)
        .from(site)
        .where(eq(site.id, candidate.siteId))
        .for('update')
        .limit(1)
    ).at(0)
    if (!existingSite) throw new Error('Site not found')
    if (await siteHasRunningJob(tx, candidate.siteId))
      throw new Error(
        'A worker is still active; wait for reconciliation to finish',
      )
    const reason = redactString(input.reason.trim())
    const resolved = (
      await tx
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
        .returning()
    ).at(0)
    if (!resolved)
      throw new Error('Job does not require deployment reconciliation')
    await markPublicationFailed(tx, {
      siteId: resolved.siteId,
      publicationId: resolved.publicationId,
      stuck: false,
    })
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
  return result
}

/** Stale jobs recovered per transaction, and transactions per call at most. */
export const RECOVERY_BATCH_SIZE = 50
const RECOVERY_MAX_BATCHES = 20

/**
 * Fails jobs whose lease expired. Each batch is its own transaction with
 * `SKIP LOCKED`, so one call never locks every stale job at once. Batches stop
 * when one comes back short, or after RECOVERY_MAX_BATCHES. The rest waits for
 * the next tick.
 */
export async function recoverStaleJobs(
  olderThanMs = STALE_JOB_MS,
  now = new Date(),
  batchSize = RECOVERY_BATCH_SIZE,
) {
  const recovered: Awaited<ReturnType<typeof recoverStaleBatch>> = []
  for (let batch = 0; batch < RECOVERY_MAX_BATCHES; batch++) {
    const jobs = await recoverStaleBatch(olderThanMs, now, batchSize)
    recovered.push(...jobs)
    if (jobs.length < batchSize) break
  }
  return recovered
}

async function recoverStaleBatch(
  olderThanMs: number,
  now: Date,
  batchSize: number,
) {
  const cutoff = new Date(now.getTime() - olderThanMs)
  // Lock and fence in one transaction. A heartbeat cannot resurrect an expired lease.
  const staleJobs = await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(buildJob)
      .where(
        and(
          inArray(buildJob.status, RUNNING_JOB_STATUSES),
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
      .limit(batchSize)
      .for('update', { skipLocked: true })
    for (const job of stale) {
      const stuck = Boolean(job.dispatchStartedAt || job.status === 'deploying')
      await incrementFailureCounter(tx)
      await recordSchedulerFailure(tx, job, 'Worker lease expired', now)
      await tx
        .update(buildJob)
        .set({
          status: 'failed',
          finishedAt: now,
          error: stuck
            ? `Worker lease expired after dispatch intent; reconcile job=${job.id} publication=${job.publicationId} before publishing again`
            : 'Worker lease expired before dispatch; retry publication',
          dispatchUncertain: stuck,
          leaseExpiresAt: null,
        })
        .where(
          and(eq(buildJob.id, job.id), eq(buildJob.attempts, job.attempts)),
        )
      await markPublicationFailed(tx, {
        siteId: job.siteId,
        publicationId: job.publicationId,
        stuck,
      })
    }
    return stale
  })
  return staleJobs
}

async function incrementFailureCounter(tx: Tx) {
  await tx
    .insert(opsCounter)
    .values({ name: 'publication_failures', value: 1 })
    .onConflictDoUpdate({
      target: opsCounter.name,
      set: { value: sql`${opsCounter.value} + 1` },
    })
}
