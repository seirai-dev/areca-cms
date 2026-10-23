import { createServerFn } from '@tanstack/react-start'
import { z } from '#/lib/zod'

import {
  requireAgencyAdmin,
  requireFreshAgencyAdmin,
} from '#/lib/session.server'
import {
  dismissPausedJob,
  listPausedJobs,
  retryPausedJob,
} from '#/server/ops/paused-jobs'

const pausedFn = { strict: { output: false } as const }

const pausedJobSchema = z.object({
  kind: z.enum(['storage', 'schedule']),
  id: z.string().min(1).max(500),
})

/** Paused storage deletions and schedules. Agency admins only, with local MFA. */
export const listPausedJobsFn = createServerFn({
  method: 'GET',
  ...pausedFn,
}).handler(async () => {
  await requireAgencyAdmin()
  return listPausedJobs()
})

/** Starts a fresh attempt cycle. `ok: false` when the item is no longer paused. */
export const retryPausedJobFn = createServerFn({ method: 'POST', ...pausedFn })
  .validator(pausedJobSchema)
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    const ok = await retryPausedJob(data.kind, data.id, session.user.id)
    return { ok }
  })

/** Hides the item from the panel and from automatic retries. Deletes nothing. */
export const dismissPausedJobFn = createServerFn({
  method: 'POST',
  ...pausedFn,
})
  .validator(pausedJobSchema)
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    const ok = await dismissPausedJob(data.kind, data.id, session.user.id)
    return { ok }
  })
