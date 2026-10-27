import { createServerFn } from '@tanstack/react-start'
import { z } from '#/lib/zod'

import {
  requireAgencyAdmin,
  requireFreshAgencyAdmin,
} from '#/lib/session.server'
import { forkDevEnvironment } from '#/server/dev-env/fork'
import { refreshDevEnvironment } from '#/server/dev-env/refresh'
import { deleteDevEnvironment } from '#/server/dev-env/delete'
import { getDevEnvironmentStatus } from '#/server/dev-env/status'
import { getDevSiteSyncStatus, loadPlan } from '#/server/dev-env/load-plan'
import { db } from '#/db'
import { pushDevEnvironment } from '#/server/dev-env/push'

// Dev environments are agency-only and throwaway, so these take no step-up
// (docs/design/dev-environments.md, Decision 6).
const devEnvFn = { strict: { output: false } as const }

/**
 * Status of a production site's dev env, or null. `unpushedChanges` counts the
 * push plan items; `productionChanges` counts production changes since the
 * baseline (the "Production changed" notice).
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
    const sync = await getDevSiteSyncStatus(status.id)
    return { ...status, ...sync }
  })

/** Dev banner counts for one dev env: unpushed changes and production changes. */
export const getDevSiteSyncStatusFn = createServerFn({
  method: 'GET',
  ...devEnvFn,
})
  .validator(z.object({ devSiteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return getDevSiteSyncStatus(data.devSiteId)
  })

/** The push screen's items, with the plan hash a push must echo back. */
export const getPushPlanFn = createServerFn({
  method: 'GET',
  ...devEnvFn,
})
  .validator(z.object({ devSiteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    const plan = await loadPlan(db, data.devSiteId)
    return { items: plan.items, planHash: plan.planHash }
  })

export const pushToProductionFn = createServerFn({
  method: 'POST',
  ...devEnvFn,
})
  .validator(
    z.object({
      devSiteId: z.string().min(1),
      planHash: z.string().min(1),
      exclude: z.array(z.string()).default([]),
      apply: z.array(z.string()).default([]),
      goLive: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    return pushDevEnvironment(session.user, data)
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
