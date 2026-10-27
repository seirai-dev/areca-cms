import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { adminQueryKeys } from '#/lib/admin/helpers'
import { useStepUp } from '#/features/security/step-up'
import {
  getDevSiteSyncStatusFn,
  getPushPlanFn,
  pushToProductionFn,
} from '#/server/fn/dev-env'

import { invalidateQueryKeys, writeQueryKeys } from './invalidate'

/**
 * The push plan of a dev env: its items and the hash a push echoes back. It
 * never refetches on its own (no window-focus or interval refetch), so the
 * list the agency reviews does not change under them. "Review again" refetches.
 */
export function usePushPlan(devSiteId: string) {
  const getPlan = useServerFn(getPushPlanFn)
  return useQuery({
    queryKey: adminQueryKeys.pushPlan(devSiteId),
    queryFn: () => getPlan({ data: { devSiteId } }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
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
export function usePushToProduction(
  devSiteId: string,
  productionSiteId: string,
) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const stepUp = useStepUp()
  const push = useServerFn(pushToProductionFn)
  return useMutation({
    mutationFn: (input: PushInput) =>
      stepUp.run(() => push({ data: { devSiteId, ...input } })),
    // A push changes the plan, the banner counts, the push history and the
    // production content the lists and the Go-live tray show. A schema or
    // language item (no production id) bumps entries the push does not name.
    onSuccess: (result) =>
      invalidateQueryKeys(
        queryClient,
        router,
        writeQueryKeys({
          devSiteId,
          productionSiteId,
          productionEntryIds: result.written.flatMap((item) =>
            item.productionId ? [item.productionId] : [],
          ),
          wholeEntryFamily: result.written.some(
            (item) => item.productionId === null,
          ),
        }),
      ),
  })
}
