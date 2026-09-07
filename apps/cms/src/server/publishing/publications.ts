import { and, desc, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { buildJob, publication, site } from '#/db/schema'
import type { BuildJobStatus } from '#/lib/types'
import { audit } from '#/server/audit'
import { buildSnapshot } from '#/server/content/snapshot'
import { ConflictError, NotFoundError, ValidationError } from '#/server/content/errors'

export function dbActorId(actorId: string | null | undefined) {
  if (!actorId || actorId === 'system') return null
  return actorId
}

export async function getSiteOrThrow(siteId: string) {
  const [row] = await db.select().from(site).where(eq(site.id, siteId)).limit(1)
  if (!row) {
    throw new NotFoundError('Site not found')
  }
  return row
}

export async function requestPublication(input: {
  siteId: string
  actorId: string
  priority?: number
  note?: string
}): Promise<
  | {
      ok: true
      publication: typeof publication.$inferSelect
      job: typeof buildJob.$inferSelect
    }
  | { ok: false; errors: string[] }
> {
  const existingSite = await getSiteOrThrow(input.siteId)
  const built = await buildSnapshot(input.siteId)
  if (!built.ok) {
    return { ok: false, errors: built.errors }
  }

  const publicationId = crypto.randomUUID()
  const snapshot = { ...built.snapshot, publicationId }
  const actorId = dbActorId(input.actorId)
  const priority = input.priority ?? 0

  const created = await db.transaction(async (tx) => {
    const [pub] = await tx
      .insert(publication)
      .values({
        id: publicationId,
        siteId: input.siteId,
        snapshot,
        snapshotHash: built.hash,
        requestedBy: actorId,
        status: 'pending',
      })
      .returning()

    if (!pub) {
      throw new Error('Failed to create publication')
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
        status: 'queued',
      })
      .returning()

    if (!job) {
      throw new Error('Failed to create build job')
    }

    return { publication: pub, job }
  })

  await audit({
    organizationId: existingSite.organizationId,
    siteId: input.siteId,
    actorId,
    action: 'publication.requested',
    targetType: 'publication',
    targetId: created.publication.id,
    meta: {
      jobId: created.job.id,
      priority,
      note: input.note ?? null,
    },
  })

  return { ok: true, ...created }
}

export async function requestRollback(input: {
  siteId: string
  publicationId: string
  actorId: string
}) {
  const existingSite = await getSiteOrThrow(input.siteId)
  const [pub] = await db
    .select()
    .from(publication)
    .where(eq(publication.id, input.publicationId))
    .limit(1)

  if (!pub || pub.siteId !== input.siteId) {
    throw new NotFoundError('Publication not found')
  }
  if (!pub.wasLive) {
    throw new ValidationError([
      {
        path: 'publicationId',
        message: 'Publication has not been live',
      },
    ])
  }

  const actorId = dbActorId(input.actorId)

  const created = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(publication)
      .set({ status: 'pending', deployedAt: null })
      .where(eq(publication.id, pub.id))
      .returning()

    if (!updated) {
      throw new NotFoundError('Publication not found')
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
        publicationId: updated.id,
        priority: 100,
        status: 'queued',
      })
      .returning()

    if (!job) {
      throw new Error('Failed to create build job')
    }

    return { publication: updated, job }
  })

  await audit({
    organizationId: existingSite.organizationId,
    siteId: input.siteId,
    actorId,
    action: 'publication.rollback_requested',
    targetType: 'publication',
    targetId: created.publication.id,
    meta: { jobId: created.job.id },
  })

  return created
}

export async function listPublications(
  siteId: string,
  options: { limit?: number; offset?: number } = {},
) {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const items = await db
    .select()
    .from(publication)
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
            items.map((item) => item.id),
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

  return items.map((item) => ({
    ...item,
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
    throw new NotFoundError('Build job not found')
  }
  if (job.status !== 'queued') {
    throw new ConflictError('Only queued jobs can be cancelled')
  }

  const existingSite = await getSiteOrThrow(job.siteId)
  const [updated] = await db
    .update(buildJob)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(eq(buildJob.id, id))
    .returning()

  if (!updated) {
    throw new NotFoundError('Build job not found')
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

const ACTIVE_JOB_STATUSES: BuildJobStatus[] = [
  'building',
  'validating',
  'deploying',
]

export async function getSiteReleaseStatus(siteId: string) {
  const live = await getLivePublication(siteId)
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

  return {
    live,
    activeJob: activeJob ?? queuedJob ?? null,
  }
}
