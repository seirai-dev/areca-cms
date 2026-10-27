import { createServerFn } from '@tanstack/react-start'
import { z } from '#/lib/zod'

import { requireAgencyAdmin } from '#/lib/session.server'
import { forkDevEnvironment } from '#/server/dev-env/fork'
import { refreshDevEnvironment } from '#/server/dev-env/refresh'
import { deleteDevEnvironment } from '#/server/dev-env/delete'
import { getDevEnvironmentStatus } from '#/server/dev-env/status'

// Dev environments are agency-only and throwaway, so these take no step-up
// (docs/design/dev-environments.md, Decision 6).
const devEnvFn = { strict: { output: false } as const }

/**
 * Status of a production site's dev env, or null. `unpushedChanges` is null
 * until the push plan (a later PR) can count them.
 */
export const getDevEnvironmentFn = createServerFn({
  method: 'GET',
  ...devEnvFn,
})
  .validator(z.object({ siteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    const status = await getDevEnvironmentStatus(data.siteId)
    if (!status) return null
    return { ...status, unpushedChanges: null }
  })

export const createDevEnvironmentFn = createServerFn({
  method: 'POST',
  ...devEnvFn,
})
  .validator(z.object({ siteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return forkDevEnvironment(session.user, data.siteId)
  })

export const refreshDevEnvironmentFn = createServerFn({
  method: 'POST',
  ...devEnvFn,
})
  .validator(z.object({ devSiteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return refreshDevEnvironment(session.user, data.devSiteId)
  })

export const deleteDevEnvironmentFn = createServerFn({
  method: 'POST',
  ...devEnvFn,
})
  .validator(z.object({ devSiteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    await deleteDevEnvironment(session.user, data.devSiteId)
    return { ok: true as const }
  })
