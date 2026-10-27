import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'

import { adminQueryKeys } from '#/lib/admin/helpers'
import { useStepUp } from '#/features/security/step-up'
import {
  getDevSiteSyncStatusFn,
  getPushPlanFn,
  pushToProductionFn,
} from '#/server/fn/dev-env'

/** The push plan of a dev env: its items and the hash a push echoes back. */
export function usePushPlan(devSiteId: string) {
  const getPlan = useServerFn(getPushPlanFn)
  return useQuery({
    queryKey: adminQueryKeys.pushPlan(devSiteId),
    queryFn: () => getPlan({ data: { devSiteId } }),
  })
}

/** Unpushed and production change counts for the dev banner and reset confirm. */
export function useDevSyncStatus(devSiteId: string, { enabled = true } = {}) {
  const getSync = useServerFn(getDevSiteSyncStatusFn)
  return useQuery({
    queryKey: adminQueryKeys.devSync(devSiteId),
    queryFn: () => getSync({ data: { devSiteId } }),
    enabled,
  })
}

export type PushInput = {
  planHash: string
  exclude: string[]
  apply: string[]
  goLive: boolean
}

/**
 * Pushes the dev env into production. A stale session answers
 * `REAUTH_REQUIRED`; `useStepUp` asks for a code and retries once. A refused
 * plan (`The plan changed`) rejects with that message for the screen to show.
 */
export function usePushToProduction(devSiteId: string) {
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const push = useServerFn(pushToProductionFn)
  return useMutation({
    mutationFn: (input: PushInput) =>
      stepUp.run(() => push({ data: { devSiteId, ...input } })),
    onSuccess: async () => {
      // A push changes the plan, the banner counts, the push history and
      // every production entry the lists show.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['push-plan'] }),
        queryClient.invalidateQueries({ queryKey: ['dev-sync'] }),
        queryClient.invalidateQueries({ queryKey: ['dev-environment'] }),
      ])
    },
  })
}
