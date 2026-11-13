import { createServerFn } from '@tanstack/react-start'
import { z } from '#/lib/zod'

import {
  requireAgencyAdmin,
  requireUser,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import {
  reconcileDeploymentJob,
  resolveUncertainDeploymentJob,
} from '#/server/publishing/worker'
import { requireSiteAccess } from '#/server/content/access'
import { NotFoundError } from '#/server/content/errors'
import { AppError } from '#/server/http/app-error'
import { pageLimitSchema, pageOffsetSchema } from '#/server/pagination'
import {
  cancelJob,
  getBuildJob,
  getSiteReleaseStatus,
  listBuildJobs,
  listPublications,
  requestPublication,
  requestRollback,
} from '#/server/publishing/publications'
import { listPendingRelease } from '#/server/publishing/release-diff'

const loose = { strict: { output: false } as const }

async function requireJobAccess(jobId: string, role?: 'owner') {
  await requireUser()
  const job = await getBuildJob(jobId)
  if (!job) {
    throw new NotFoundError(m.server_build_job_not_found())
  }
  const access = await requireSiteAccess(
    job.siteId,
    role,
    m.server_build_job_not_found,
  )
  return { ...access, job }
}

export const requestPublicationFn = createServerFn({ method: 'POST', ...loose })
  .validator(
    z.object({
      siteId: z.string().min(1),
      requestKey: z.string().uuid(),
      // The UI sends 0 or 100 (urgent); the build queue is shared by every
      // client, so other values are refused.
      priority: z.union([z.literal(0), z.literal(100)]).optional(),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireSiteAccess(data.siteId, 'owner')
    try {
      return await requestPublication({
        siteId: data.siteId,
        actorId: session.user.id,
        requestKey: data.requestKey,
        priority: data.priority,
        note: data.note,
      })
    } catch (error) {
      if (error instanceof AppError && !(error instanceof NotFoundError))
        return { ok: false as const, errors: [error.message] }
      throw error
    }
  })

export const requestRollbackFn = createServerFn({ method: 'POST', ...loose })
  .validator(
    z.object({
      siteId: z.string().min(1),
      requestKey: z.string().uuid(),
      publicationId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireSiteAccess(data.siteId, 'owner')
    try {
      return await requestRollback({
        siteId: data.siteId,
        publicationId: data.publicationId,
        actorId: session.user.id,
        requestKey: data.requestKey,
      })
    } catch (error) {
      if (error instanceof AppError && !(error instanceof NotFoundError))
        return { ok: false as const, errors: [error.message] }
      throw error
    }
  })

export const listPublicationsFn = createServerFn({ method: 'GET', ...loose })
  .validator(
    z.object({
      siteId: z.string().min(1),
      limit: pageLimitSchema.optional(),
      offset: pageOffsetSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId)
    return listPublications(data.siteId, {
      limit: data.limit,
      offset: data.offset,
    })
  })

export const listBuildJobsFn = createServerFn({ method: 'GET', ...loose })
  .validator(
    z.object({
      siteId: z.string().min(1),
      limit: pageLimitSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId)
    return listBuildJobs(data.siteId, { limit: data.limit })
  })

export const getBuildJobFn = createServerFn({ method: 'GET', ...loose })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { job } = await requireJobAccess(data.id)
    return job
  })

export const cancelJobFn = createServerFn({ method: 'POST', ...loose })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { session } = await requireJobAccess(data.id, 'owner')
    return cancelJob(data.id, session.user.id)
  })

export const getSiteReleaseStatusFn = createServerFn({
  method: 'GET',
  ...loose,
})
  .validator(z.object({ siteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId)
    return getSiteReleaseStatus(data.siteId)
  })

export const listPendingReleaseChangesFn = createServerFn({
  method: 'GET',
  ...loose,
})
  .validator(z.object({ siteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireSiteAccess(data.siteId)
    return listPendingRelease(data.siteId)
  })

export const reconcileDeploymentJobFn = createServerFn({
  method: 'POST',
  ...loose,
})
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireJobAccess(data.id, 'owner')
    return reconcileDeploymentJob(data.id)
  })

export const resolveUncertainDeploymentJobFn = createServerFn({
  method: 'POST',
  ...loose,
})
  .validator(
    z.object({
      id: z.string().min(1),
      reason: z.string().trim().min(10).max(2000),
      upstreamStopped: z.literal(true),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return resolveUncertainDeploymentJob({
      jobId: data.id,
      reason: data.reason,
      actorId: session.user.id,
      upstreamStopped: data.upstreamStopped,
    })
  })
