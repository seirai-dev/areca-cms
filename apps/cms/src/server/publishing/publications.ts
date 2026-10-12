import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'

import { db } from '#/db'
import {
  buildJob,
  dokployCredential,
  schedulerBackoff,
  entry,
  publication,
  publicationRequest,
  site,
  user,
} from '#/db/schema'
import type { BuildJobStatus } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { env } from '#/env'
import { lockOrganizationForMutation } from '#/server/admin/organization-lock'
import { assetMutationLock } from '#/server/assets/usage'
import { buildSnapshot } from '#/server/content/snapshot'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { diffApprovedRelease } from '#/server/publishing/release-diff'

export function dbActorId(actorId: string | null | undefined) {
  if (!actorId || actorId === 'system') return null
  return actorId
}

export async function getSiteOrThrow(siteId: string) {
  const [row] = await db.select().from(site).where(eq(site.id, siteId)).limit(1)
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
  const jobs = await tx
    .select()
    .from(buildJob)
    .where(eq(buildJob.id, previous.jobId))
  const pub = publications.at(0)
  const job = jobs.at(0)
  if (!pub || !job)
    throw new ConflictError(m.server_publication_request_unavailable())
  return { publication: pub, job }
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
      job: typeof buildJob.$inferSelect
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
  return db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, preliminarySite.organizationId)
    const replay = await replayRequest(tx, input, 'publish', payload)
    if (replay) return { ok: true as const, ...replay }
    const [lockedSite] = await tx
      .select()
      .from(site)
      .where(eq(site.id, input.siteId))
      .for('update')
    if (!lockedSite) throw new NotFoundError(m.server_site_not_found())
    if (
      lockedSite.publishingMode !== 'demo' &&
      (!lockedSite.deploymentTarget?.applicationId ||
        !lockedSite.deploymentTarget.healthCheckUrl)
    ) {
      return {
        ok: false as const,
        errors: [m.server_publication_deployment_required()],
      }
    }
    if (input.schedulerFingerprint) {
      const [pending] = await tx
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
      const [retry] = await tx
        .select()
        .from(schedulerBackoff)
        .where(eq(schedulerBackoff.siteId, input.siteId))
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
    await assetMutationLock(tx, lockedSite.organizationId)
    const built = await buildSnapshot(input.siteId, tx)
    if (!built.ok) return { ok: false as const, errors: built.errors }
    const snapshot = { ...built.snapshot, publicationId }
    const [pub] = await tx
      .insert(publication)
      .values({
        id: publicationId,
        siteId: input.siteId,
        snapshot,
        snapshotHash: built.hash,
        entryVersions: built.entryVersions,
        publishingMode: lockedSite.publishingMode,
        requestedBy: actorId,
        status: 'pending',
      })
      .returning()

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

    const [job] = await tx
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

    if (!job) {
      throw new Error(m.server_failed_to_create_build_job())
    }

    const isScheduler = input.note === 'scheduled' || input.actorId === 'system'
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
  return db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, preliminarySite.organizationId)
    const replay = await replayRequest(tx, input, 'rollback', payload)
    if (replay) return replay
    const [pub] = await tx
      .select()
      .from(publication)
      .where(eq(publication.id, input.publicationId))
      .limit(1)

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

    const [lockedSite] = await tx
      .select()
      .from(site)
      .where(eq(site.id, input.siteId))
      .for('update')
    if (!lockedSite) throw new NotFoundError(m.server_site_not_found())
    if (
      lockedSite.publishingMode !== 'demo' &&
      (!lockedSite.deploymentTarget?.applicationId ||
        !lockedSite.deploymentTarget.healthCheckUrl)
    )
      throw new ConflictError(
        'Production publishing requires a deployment target and publication-aware health URL',
      )
    await assertDispatchResolved(tx, input.siteId)
    const rollbackId = crypto.randomUUID()
    const [updated] = await tx
      .insert(publication)
      .values({
        siteId: input.siteId,
        id: rollbackId,
        snapshot: { ...pub.snapshot, publicationId: rollbackId },
        snapshotHash: pub.snapshotHash,
        requestedBy: actorId,
        publishingMode: lockedSite.publishingMode,
        entryVersions: [],
        status: 'pending',
      })
      .returning()
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

    const [job] = await tx
      .insert(buildJob)
      .values({
        siteId: input.siteId,
        publicationId: updated.id,
        priority: 100,
        ...(await deploymentIdentity(tx, lockedSite)),
        status: 'queued',
      })
      .returning()

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

export async function listPublications(
  siteId: string,
  options: { limit?: number; offset?: number } = {},
) {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const items = await db
    .select({
      publication,
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
        .select()
        .from(buildJob)
        .where(
          inArray(
            buildJob.publicationId,
            items.map((item) => item.publication.id),
          ),
        )
        .orderBy(desc(buildJob.createdAt))
    : []

  const latestJob = new Map<string, typeof buildJob.$inferSelect>()
  for (const job of jobs) {
    if (!latestJob.has(job.publicationId)) {
      latestJob.set(job.publicationId, job)
    }
  }

  return items.map(({ publication: item, requestedByName }) => ({
    ...item,
    requestedByName: requestedByName ?? null,
    job: latestJob.get(item.id) ?? null,
  }))
}

export async function getPublication(id: string) {
  const [row] = await db
    .select()
    .from(publication)
    .where(eq(publication.id, id))
    .limit(1)
  return row ?? null
}

export async function listBuildJobs(
  siteId: string,
  options: { limit?: number } = {},
) {
  const limit = options.limit ?? 50
  return db
    .select()
    .from(buildJob)
    .where(eq(buildJob.siteId, siteId))
    .orderBy(desc(buildJob.createdAt))
    .limit(limit)
}

export async function getBuildJob(id: string) {
  const [row] = await db
    .select()
    .from(buildJob)
    .where(eq(buildJob.id, id))
    .limit(1)
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
  const [updated] = await db
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
  const [row] = await db
    .select()
    .from(publication)
    .where(and(eq(publication.siteId, siteId), eq(publication.status, 'live')))
    .orderBy(desc(publication.createdAt))
    .limit(1)
  return row ?? null
}

export async function getDemoPublication(siteId: string) {
  const [row] = await db
    .select()
    .from(publication)
    .where(and(eq(publication.siteId, siteId), eq(publication.status, 'demo')))
    .orderBy(desc(publication.createdAt))
    .limit(1)
  return row ?? null
}

const ACTIVE_JOB_STATUSES: BuildJobStatus[] = [
  'building',
  'validating',
  'deploying',
]

export async function getSiteReleaseStatus(siteId: string) {
  const existingSite = await getSiteOrThrow(siteId)
  const live = await getLivePublication(siteId)
  const demo = await getDemoPublication(siteId)
  const [activeJob] = await db
    .select()
    .from(buildJob)
    .where(
      and(
        eq(buildJob.siteId, siteId),
        inArray(buildJob.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .orderBy(desc(buildJob.startedAt), desc(buildJob.createdAt))
    .limit(1)

  const [queuedJob] = activeJob
    ? [null]
    : await db
        .select()
        .from(buildJob)
        .where(and(eq(buildJob.siteId, siteId), eq(buildJob.status, 'queued')))
        .orderBy(desc(buildJob.priority), desc(buildJob.createdAt))
        .limit(1)

  const diff = await diffApprovedRelease(siteId)

  return {
    live,
    publishingMode: existingSite.publishingMode,
    demo,
    activeJob: activeJob ?? queuedJob ?? null,
    pendingEntries: diff.pendingCount,
    liveEntryIds: diff.liveEntryIds,
    liveSlugsByEntryId: diff.liveSlugsByEntryId,
    pendingEntryIds: [...diff.adds, ...diff.updates].map((item) => item.id),
  }
}

/** Freeze the hosting destination when a release is requested. */
export async function deploymentIdentity(
  tx: RequestTx,
  existingSite: typeof site.$inferSelect,
) {
  if (existingSite.publishingMode === 'demo') return {}
  const [credential] = await tx
    .select()
    .from(dokployCredential)
    .where(eq(dokployCredential.organizationId, existingSite.organizationId))
  const rawUrl =
    credential?.url ??
    (process.env.NODE_ENV !== 'production' && env.DOKPLOY_DEV_FALLBACK_ENABLED
      ? env.DOKPLOY_URL
      : undefined)
  const connectionUrl = rawUrl ? new URL(rawUrl).href.replace(/\/+$/, '') : null
  return {
    dispatchTarget: existingSite.deploymentTarget,
    dispatchConnectionUrl: connectionUrl,
    deploymentResourceKey:
      connectionUrl && existingSite.deploymentTarget
        ? createHash('sha256')
            .update(
              `${connectionUrl}\n${existingSite.deploymentTarget.applicationId}`,
            )
            .digest('hex')
        : null,
  }
}
