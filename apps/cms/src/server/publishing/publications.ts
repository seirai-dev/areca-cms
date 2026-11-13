import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'

import { CLOUDFLARE_API_BASE_URL } from '#/adapters/deployment/cloudflare-api'
import { db } from '#/db'
import {
  buildJob,
  cloudflareCredential,
  dokployCredential,
  schedulerBackoff,
  entry,
  publication,
  publicationRequest,
  site,
  user,
} from '#/db/schema'
import type { BuildJobStatus, DeploymentTarget } from '#/lib/types'
import {
  deploymentTargetResourceId,
  hasCompleteDeploymentTarget,
} from '#/lib/deployment-target'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { env } from '#/env'
import { lockOrganizationForMutation } from '#/server/admin/organization-lock'
import { assetAttachLock } from '#/server/assets/usage'
import { siteHasPendingDeployment } from '#/server/publishing/deployment-safety'
import { buildSnapshot } from '#/server/content/snapshot'
import { sectionBlockers } from '#/server/content/globals'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { diffApprovedRelease } from '#/server/publishing/release-diff'
import { isDevSite } from '#/server/security/site-visibility'
import { siteCoreColumns } from '#/server/content/site-core'
import type { SiteCore } from '#/server/content/site-core'

export function dbActorId(actorId: string | null | undefined) {
  if (!actorId || actorId === 'system') return null
  return actorId
}

/**
 * A production site needs a deployment target before anything can go live.
 * The publish transaction refuses without one; release status reports the same
 * message as a blocker, so the tray, panel and overview disable Go live up front.
 */
export function deploymentBlockers(row: SiteCore): string[] {
  if (row.publishingMode === 'demo') return []
  return hasCompleteDeploymentTarget(row.deploymentTarget)
    ? []
    : [m.server_publication_deployment_required()]
}

export async function getSiteOrThrow(siteId: string) {
  const row = (
    await db
      .select(siteCoreColumns)
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!row) {
    throw new NotFoundError(m.server_site_not_found())
  }
  return row
}

function uniqueActorIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))]
}

type RequestTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type RequestIdentity = { siteId: string; actorId: string; requestKey?: string }

async function replayRequest(
  tx: RequestTx,
  input: RequestIdentity,
  operation: 'publish' | 'rollback',
  payload: string,
) {
  if (!input.requestKey) return null
  // Lock the key globally as well as the site, so cross-scope reuse is rejected
  // deterministically instead of racing the unique constraint.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestKey}, 1))`,
  )
  const previousRows = await tx
    .select()
    .from(publicationRequest)
    .where(eq(publicationRequest.id, input.requestKey))
  const previous = previousRows.at(0)
  if (!previous) return null
  if (
    previous.siteId !== input.siteId ||
    previous.actorId !== input.actorId ||
    previous.operation !== operation ||
    previous.payload !== payload
  ) {
    throw new ConflictError(m.server_publication_request_key_reused())
  }
  const publications = await tx
    .select()
    .from(publication)
    .where(eq(publication.id, previous.publicationId))
  const pub = publications.at(0)
  if (!pub) throw new ConflictError(m.server_publication_request_unavailable())
  // A null job means retention pruned it after it finished. The publication the
  // key created is still the answer, so the replay returns it without a job.
  const jobs = previous.jobId
    ? await tx.select().from(buildJob).where(eq(buildJob.id, previous.jobId))
    : []
  return { publication: pub, job: jobs.at(0) ?? null }
}

async function rememberRequest(
  tx: RequestTx,
  input: RequestIdentity,
  operation: 'publish' | 'rollback',
  payload: string,
  pubId: string,
  jobId: string,
) {
  if (!input.requestKey) return
  await tx.insert(publicationRequest).values({
    id: input.requestKey,
    siteId: input.siteId,
    actorId: input.actorId,
    operation,
    payload,
    publicationId: pubId,
    jobId,
  })
}

async function assertDispatchResolved(tx: RequestTx, siteId: string) {
  const uncertainJobs = await tx
    .select({ id: buildJob.id })
    .from(buildJob)
    .where(
      and(eq(buildJob.siteId, siteId), eq(buildJob.dispatchUncertain, true)),
    )
    .limit(1)
  if (uncertainJobs.length > 0)
    throw new ConflictError(m.server_publication_uncertain_reconcile_first())
}

/** Dev envs have no releases and no builds (docs/design/dev-environments.md, Decision 7). */
function assertNotDevSite(row: SiteCore) {
  if (isDevSite(row)) {
    throw new ConflictError(m.server_dev_env_no_releases())
  }
}

export async function requestPublication(input: {
  siteId: string
  actorId: string
  requestKey?: string
  priority?: number
  note?: string
  scheduledBy?: string[]
  schedulerFingerprint?: string
}): Promise<
  | {
      ok: true
      publication: typeof publication.$inferSelect
      /** Null only when a replayed key's job has been pruned. */
      job: typeof buildJob.$inferSelect | null
    }
  | { ok: false; errors: string[] }
> {
  const payload = JSON.stringify({
    priority: input.priority ?? 0,
    note: input.note ?? null,
    scheduledBy: uniqueActorIds(input.scheduledBy ?? []).sort(),
  })
  const publicationId = crypto.randomUUID()
  const actorId = dbActorId(input.actorId)
  const priority = input.priority ?? 0

  const preliminarySite = await getSiteOrThrow(input.siteId)
  assertNotDevSite(preliminarySite)
  return db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, preliminarySite.organizationId)
    const replay = await replayRequest(tx, input, 'publish', payload)
    if (replay) return { ok: true as const, ...replay }
    const lockedSite = (
      await tx
        .select(siteCoreColumns)
        .from(site)
        .where(eq(site.id, input.siteId))
        .for('update')
    ).at(0)
    if (!lockedSite) throw new NotFoundError(m.server_site_not_found())
    const deployment = deploymentBlockers(lockedSite)
    if (deployment.length > 0) {
      return { ok: false as const, errors: deployment }
    }
    if (input.schedulerFingerprint) {
      const pending = (
        await tx
          .select()
          .from(buildJob)
          .where(
            and(
              eq(buildJob.siteId, input.siteId),
              inArray(buildJob.status, [
                'queued',
                'building',
                'validating',
                'deploying',
              ]),
            ),
          )
          .limit(1)
      ).at(0)
      if (pending) {
        const [pendingPublication] = await tx
          .select()
          .from(publication)
          .where(eq(publication.id, pending.publicationId))
        return {
          ok: true as const,
          publication: pendingPublication,
          job: pending,
        }
      }
      const retry = (
        await tx
          .select()
          .from(schedulerBackoff)
          .where(eq(schedulerBackoff.siteId, input.siteId))
      ).at(0)
      if (
        retry?.approvalFingerprint === input.schedulerFingerprint &&
        (retry.failureCount >= 4 ||
          (retry.nextAttemptAt && retry.nextAttemptAt > new Date()))
      )
        return {
          ok: false as const,
          errors: [m.server_scheduled_release_waiting_retry()],
        }
      if (retry?.approvalFingerprint !== input.schedulerFingerprint) {
        await tx
          .insert(schedulerBackoff)
          .values({
            siteId: input.siteId,
            approvalFingerprint: input.schedulerFingerprint,
            failureCount: 0,
            lastAttemptAt: new Date(),
          })
          .onConflictDoUpdate({
            target: schedulerBackoff.siteId,
            set: {
              approvalFingerprint: input.schedulerFingerprint,
              failureCount: 0,
              nextAttemptAt: null,
              lastAttemptAt: new Date(),
              lastError: null,
            },
          })
      }
    }
    await assertDispatchResolved(tx, input.siteId)
    await assetAttachLock(tx, lockedSite.organizationId)
    const built = await buildSnapshot(input.siteId, tx)
    if (!built.ok) return { ok: false as const, errors: built.errors }
    const snapshot = { ...built.snapshot, publicationId }
    const isScheduler =
      input.actorId === 'system' || input.schedulerFingerprint !== undefined
    let scheduledBy = uniqueActorIds(input.scheduledBy ?? [])
    if (isScheduler && scheduledBy.length === 0) {
      const owners = await tx
        .select({ scheduledBy: entry.scheduledBy })
        .from(entry)
        .where(
          and(
            eq(entry.siteId, input.siteId),
            eq(entry.status, 'scheduled'),
            lte(entry.scheduledAt, new Date()),
          ),
        )
      scheduledBy = uniqueActorIds(owners.map((row) => row.scheduledBy))
    }
    const pub = (
      await tx
        .insert(publication)
        .values({
          id: publicationId,
          siteId: input.siteId,
          snapshot,
          snapshotHash: built.hash,
          entryVersions: built.entryVersions,
          publishingMode: lockedSite.publishingMode,
          requestedBy: actorId,
          origin: isScheduler ? 'scheduled' : 'manual',
          scheduledBy: isScheduler ? scheduledBy : [],
          status: 'pending',
        })
        .returning()
    ).at(0)

    if (!pub) {
      throw new Error(m.server_failed_to_create_publication())
    }

    const queued = await tx
      .select()
      .from(buildJob)
      .where(
        and(eq(buildJob.siteId, input.siteId), eq(buildJob.status, 'queued')),
      )

    if (queued.length > 0) {
      await tx
        .update(buildJob)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(
          inArray(
            buildJob.id,
            queued.map((job) => job.id),
          ),
        )
      await tx
        .update(publication)
        .set({ status: 'superseded' })
        .where(
          inArray(
            publication.id,
            queued.map((job) => job.publicationId),
          ),
        )
    }

    const job = (
      await tx
        .insert(buildJob)
        .values({
          siteId: input.siteId,
          publicationId: pub.id,
          priority,
          ...(await deploymentIdentity(tx, lockedSite)),
          schedulerFingerprint: input.schedulerFingerprint ?? null,
          status: 'queued',
        })
        .returning()
    ).at(0)

    if (!job) {
      throw new Error(m.server_failed_to_create_build_job())
    }

    const auditActor =
      isScheduler && scheduledBy.length === 1 ? scheduledBy[0] : actorId
    await audit(
      {
        organizationId: lockedSite.organizationId,
        siteId: input.siteId,
        actorId: auditActor,
        action: 'publication.requested',
        targetType: 'publication',
        targetId: pub.id,
        meta: {
          jobId: job.id,
          priority,
          note: input.note ?? null,
          ...(scheduledBy.length > 0 ? { scheduledBy } : {}),
          ...(isScheduler && scheduledBy.length > 1
            ? { approvers: scheduledBy }
            : {}),
        },
      },
      tx,
    )

    if (input.actorId !== 'system')
      await tx
        .delete(schedulerBackoff)
        .where(eq(schedulerBackoff.siteId, input.siteId))
    await rememberRequest(tx, input, 'publish', payload, pub.id, job.id)
    return { ok: true as const, publication: pub, job }
  })
}

export async function requestRollback(input: {
  siteId: string
  publicationId: string
  actorId: string
  requestKey?: string
}) {
  const payload = JSON.stringify({ publicationId: input.publicationId })
  const actorId = dbActorId(input.actorId)
  const preliminarySite = await getSiteOrThrow(input.siteId)
  assertNotDevSite(preliminarySite)
  return db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, preliminarySite.organizationId)
    const replay = await replayRequest(tx, input, 'rollback', payload)
    if (replay) return replay
    const pub = (
      await tx
        .select()
        .from(publication)
        .where(eq(publication.id, input.publicationId))
        .limit(1)
    ).at(0)

    if (!pub || pub.siteId !== input.siteId) {
      throw new NotFoundError(m.server_publication_not_found())
    }
    if (!pub.wasLive) {
      throw new ValidationError([
        {
          path: 'publicationId',
          message: m.server_publication_not_live(),
        },
      ])
    }

    const lockedSite = (
      await tx
        .select(siteCoreColumns)
        .from(site)
        .where(eq(site.id, input.siteId))
        .for('update')
    ).at(0)
    if (!lockedSite) throw new NotFoundError(m.server_site_not_found())
    if (
      lockedSite.publishingMode !== 'demo' &&
      !hasCompleteDeploymentTarget(lockedSite.deploymentTarget)
    )
      throw new ConflictError(
        'Production publishing requires a deployment target and publication-aware health URL',
      )
    await assertDispatchResolved(tx, input.siteId)
    const rollbackId = crypto.randomUUID()
    const updated = (
      await tx
        .insert(publication)
        .values({
          siteId: input.siteId,
          id: rollbackId,
          snapshot: { ...pub.snapshot, publicationId: rollbackId },
          snapshotHash: pub.snapshotHash,
          requestedBy: actorId,
          origin: 'rollback',
          publishingMode: lockedSite.publishingMode,
          entryVersions: [],
          status: 'pending',
        })
        .returning()
    ).at(0)
    if (!updated) throw new NotFoundError(m.server_publication_not_found())

    const queued = await tx
      .select()
      .from(buildJob)
      .where(
        and(eq(buildJob.siteId, input.siteId), eq(buildJob.status, 'queued')),
      )

    if (queued.length > 0) {
      await tx
        .update(buildJob)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(
          inArray(
            buildJob.id,
            queued.map((job) => job.id),
          ),
        )
      await tx
        .update(publication)
        .set({ status: 'superseded' })
        .where(
          inArray(
            publication.id,
            queued.map((job) => job.publicationId),
          ),
        )
    }

    const job = (
      await tx
        .insert(buildJob)
        .values({
          siteId: input.siteId,
          publicationId: updated.id,
          priority: 100,
          ...(await deploymentIdentity(tx, lockedSite)),
          status: 'queued',
        })
        .returning()
    ).at(0)

    if (!job) {
      throw new Error(m.server_failed_to_create_build_job())
    }

    await audit(
      {
        organizationId: lockedSite.organizationId,
        siteId: input.siteId,
        actorId,
        action: 'publication.rollback_requested',
        targetType: 'publication',
        targetId: updated.id,
        meta: { jobId: job.id },
      },
      tx,
    )
    await rememberRequest(tx, input, 'rollback', payload, updated.id, job.id)
    return { publication: updated, job }
  })
}

/** Publication columns the release lists show; never the snapshot. */
const publicationSummary = {
  id: publication.id,
  siteId: publication.siteId,
  snapshotHash: publication.snapshotHash,
  requestedBy: publication.requestedBy,
  status: publication.status,
  publishingMode: publication.publishingMode,
  wasLive: publication.wasLive,
  origin: publication.origin,
  createdAt: publication.createdAt,
  deployedAt: publication.deployedAt,
}

/** Build job columns the job lists show; logs load per job with getBuildJob. */
const buildJobSummary = {
  id: buildJob.id,
  siteId: buildJob.siteId,
  publicationId: buildJob.publicationId,
  priority: buildJob.priority,
  status: buildJob.status,
  attempts: buildJob.attempts,
  dispatchUncertain: buildJob.dispatchUncertain,
  startedAt: buildJob.startedAt,
  finishedAt: buildJob.finishedAt,
  error: buildJob.error,
  createdAt: buildJob.createdAt,
}

export async function listPublications(
  siteId: string,
  options: { limit?: number; offset?: number } = {},
) {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const items = await db
    .select({
      publication: publicationSummary,
      requestedByName: user.name,
    })
    .from(publication)
    .leftJoin(user, eq(publication.requestedBy, user.id))
    .where(eq(publication.siteId, siteId))
    .orderBy(desc(publication.createdAt))
    .limit(limit)
    .offset(offset)

  const jobs = items.length
    ? await db
        .selectDistinctOn([buildJob.publicationId], buildJobSummary)
        .from(buildJob)
        .where(
          inArray(
            buildJob.publicationId,
            items.map((item) => item.publication.id),
          ),
        )
        .orderBy(buildJob.publicationId, desc(buildJob.createdAt))
    : []

  const latestJob = new Map(jobs.map((job) => [job.publicationId, job]))

  return items.map(({ publication: item, requestedByName }) => ({
    ...item,
    requestedByName: requestedByName ?? null,
    job: latestJob.get(item.id) ?? null,
  }))
}

export async function getPublication(id: string) {
  const row = (
    await db.select().from(publication).where(eq(publication.id, id)).limit(1)
  ).at(0)
  return row ?? null
}

export async function listBuildJobs(
  siteId: string,
  options: { limit?: number } = {},
) {
  const limit = options.limit ?? 50
  return db
    .select(buildJobSummary)
    .from(buildJob)
    .where(eq(buildJob.siteId, siteId))
    .orderBy(desc(buildJob.createdAt))
    .limit(limit)
}

export async function getBuildJob(id: string) {
  const row = (
    await db.select().from(buildJob).where(eq(buildJob.id, id)).limit(1)
  ).at(0)
  return row ?? null
}

export async function cancelJob(id: string, actorId: string) {
  const job = await getBuildJob(id)
  if (!job) {
    throw new NotFoundError(m.server_build_job_not_found())
  }
  if (job.dispatchUncertain)
    throw new ConflictError(
      'Reconcile the uncertain deployment before cancelling',
    )
  if (job.status !== 'queued') {
    throw new ConflictError(m.server_only_queued_jobs_cancel())
  }

  const existingSite = await getSiteOrThrow(job.siteId)
  const updated = (
    await db
      .update(buildJob)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(
        and(
          eq(buildJob.id, id),
          eq(buildJob.status, 'queued'),
          eq(buildJob.dispatchUncertain, false),
        ),
      )
      .returning()
  ).at(0)

  if (!updated) {
    throw new NotFoundError(m.server_build_job_not_found())
  }

  await db
    .update(publication)
    .set({ status: 'superseded' })
    .where(eq(publication.id, job.publicationId))

  await audit({
    organizationId: existingSite.organizationId,
    siteId: job.siteId,
    actorId: dbActorId(actorId),
    action: 'build_job.cancelled',
    targetType: 'build_job',
    targetId: id,
    meta: { publicationId: job.publicationId },
  })

  return updated
}

export async function getLivePublication(siteId: string) {
  const row = (
    await db
      .select()
      .from(publication)
      .where(
        and(eq(publication.siteId, siteId), eq(publication.status, 'live')),
      )
      .orderBy(desc(publication.createdAt))
      .limit(1)
  ).at(0)
  return row ?? null
}

export async function getDemoPublication(siteId: string) {
  const row = (
    await db
      .select()
      .from(publication)
      .where(
        and(eq(publication.siteId, siteId), eq(publication.status, 'demo')),
      )
      .orderBy(desc(publication.createdAt))
      .limit(1)
  ).at(0)
  return row ?? null
}

const ACTIVE_JOB_STATUSES: BuildJobStatus[] = [
  'building',
  'validating',
  'deploying',
]

async function latestPublicationSummary(
  siteId: string,
  status: 'live' | 'demo',
) {
  const row = (
    await db
      .select(publicationSummary)
      .from(publication)
      .where(
        and(eq(publication.siteId, siteId), eq(publication.status, status)),
      )
      .orderBy(desc(publication.createdAt))
      .limit(1)
  ).at(0)
  return row ?? null
}

export async function getSiteReleaseStatus(siteId: string) {
  const existingSite = await getSiteOrThrow(siteId)
  const live = await latestPublicationSummary(siteId, 'live')
  const demo = await latestPublicationSummary(siteId, 'demo')
  const activeJob = (
    await db
      .select(buildJobSummary)
      .from(buildJob)
      .where(
        and(
          eq(buildJob.siteId, siteId),
          inArray(buildJob.status, ACTIVE_JOB_STATUSES),
        ),
      )
      .orderBy(desc(buildJob.startedAt), desc(buildJob.createdAt))
      .limit(1)
  ).at(0)

  const queuedJob = (
    activeJob
      ? [null]
      : await db
          .select(buildJobSummary)
          .from(buildJob)
          .where(
            and(eq(buildJob.siteId, siteId), eq(buildJob.status, 'queued')),
          )
          .orderBy(desc(buildJob.priority), desc(buildJob.createdAt))
          .limit(1)
  ).at(0)

  const diff = await diffApprovedRelease(siteId)
  const blockers = [
    ...deploymentBlockers(existingSite),
    ...(await sectionBlockers(siteId)),
  ]

  return {
    blockers,
    live,
    publishingMode: existingSite.publishingMode,
    demo,
    activeJob: activeJob ?? queuedJob ?? null,
    // The same rule as the deployment-settings guard in updateSite.
    deploymentPending: await siteHasPendingDeployment(db, siteId),
    pendingEntries: diff.pendingCount,
    liveEntryIds: diff.liveEntryIds,
    liveSlugsByEntryId: diff.liveSlugsByEntryId,
    pendingEntryIds: [...diff.adds, ...diff.updates].map((item) => item.id),
  }
}

/**
 * The Cloudflare account API URL that identifies a client's Cloudflare
 * connection. Stable across the test stub base URL override.
 */
export function cloudflareConnectionUrl(accountId: string) {
  return `${CLOUDFLARE_API_BASE_URL}/accounts/${accountId}`
}

/**
 * Identity of one upstream resource: the connection it is reached through and
 * the target's resource ID. Two sites with the same key share a resource, and
 * only one build for it may be in flight at a time.
 */
export function deploymentResourceKey(
  connectionUrl: string,
  target: DeploymentTarget,
) {
  return createHash('sha256')
    .update(`${connectionUrl}\n${deploymentTargetResourceId(target)}`)
    .digest('hex')
}

/** Connection URL for the site's provider, or null when none is configured. */
async function dispatchConnectionUrl(
  tx: RequestTx,
  organizationId: string,
  target: DeploymentTarget | null,
) {
  if (target?.provider === 'cloudflare') {
    const credential = (
      await tx
        .select({ accountId: cloudflareCredential.accountId })
        .from(cloudflareCredential)
        .where(eq(cloudflareCredential.organizationId, organizationId))
    ).at(0)
    return credential ? cloudflareConnectionUrl(credential.accountId) : null
  }
  const credential = (
    await tx
      .select()
      .from(dokployCredential)
      .where(eq(dokployCredential.organizationId, organizationId))
  ).at(0)
  const rawUrl =
    credential?.url ??
    (process.env.NODE_ENV !== 'production' && env.DOKPLOY_DEV_FALLBACK_ENABLED
      ? env.DOKPLOY_URL
      : undefined)
  return rawUrl ? new URL(rawUrl).href.replace(/\/+$/, '') : null
}

/** Freeze the hosting destination when a release is requested. */
export async function deploymentIdentity(
  tx: RequestTx,
  existingSite: SiteCore,
) {
  if (existingSite.publishingMode === 'demo') return {}
  const connectionUrl = await dispatchConnectionUrl(
    tx,
    existingSite.organizationId,
    existingSite.deploymentTarget,
  )
  const target = existingSite.deploymentTarget
  return {
    dispatchTarget: target,
    dispatchConnectionUrl: connectionUrl,
    deploymentResourceKey:
      connectionUrl && target
        ? deploymentResourceKey(connectionUrl, target)
        : null,
  }
}
