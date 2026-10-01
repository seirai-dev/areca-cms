import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { site } from '#/db/schema'
import { requireOrgMemberOrNotFound, requireUser } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
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
import { listPendingReleaseChanges } from '#/server/publishing/release-diff'

const loose = { strict: { output: false } as const }

async function requireSiteAccess(
  siteId: string,
  role?: 'owner',
  notFoundMessage: () => ReturnType<
    typeof m.server_site_not_found
  > = m.server_site_not_found,
) {
  // Authenticate first; a missing site and a site the caller cannot access
  // look identical (NotFound), so other tenants' ids cannot be probed.
  await requireUser()
  const [found] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!found) {
    throw new NotFoundError(notFoundMessage())
  }
  const session = await requireOrgMemberOrNotFound(
    found.organizationId,
    role,
    () => new NotFoundError(notFoundMessage()),
  )
  return { session, site: found }
}

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
      priority: z.number().int().optional(),
      note: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireSiteAccess(data.siteId, 'owner')
    return requestPublication({
      siteId: data.siteId,
      actorId: session.user.id,
      priority: data.priority,
      note: data.note,
    })
  })

export const requestRollbackFn = createServerFn({ method: 'POST', ...loose })
  .validator(
    z.object({
      siteId: z.string().min(1),
      publicationId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await requireSiteAccess(data.siteId, 'owner')
    return requestRollback({
      siteId: data.siteId,
      publicationId: data.publicationId,
      actorId: session.user.id,
    })
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
    return listPendingReleaseChanges(data.siteId)
  })
