import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { adminQueryKeys } from '#/lib/admin/helpers'
import {
  createDevEnvironmentFn,
  deleteDevEnvironmentFn,
  getDevEnvironmentFn,
  refreshDevEnvironmentFn,
} from '#/server/fn/dev-env'
import {
  devEnvQueryKeys,
  invalidateQueryKeys,
} from '#/features/dev-env/invalidate'

/**
 * A production site's development environment (docs/design/dev-environments.md).
 * Create, reset and delete take no step-up: the dev env is throwaway. The
 * site list changes too (dev envs are listed for agency admins), so every
 * mutation also invalidates the router, which drops the cached `me`.
 */
export function useDevEnvironment(siteId: string, enabled: boolean) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const getStatus = useServerFn(getDevEnvironmentFn)
  const create = useServerFn(createDevEnvironmentFn)
  const refreshFn = useServerFn(refreshDevEnvironmentFn)
  const deleteFn = useServerFn(deleteDevEnvironmentFn)

  const status = useQuery({
    queryKey: adminQueryKeys.devEnvironment(siteId),
    queryFn: () => getStatus({ data: { siteId } }),
    enabled,
  })

  /**
   * Create, reset and delete change the dev env's status, the push screen and
   * the banner. A reset also replaces the dev site's content and the production
   * site's (the copy in the dev site is new), so both are refreshed.
   */
  async function refresh(devSiteId?: string) {
    await invalidateQueryKeys(
      queryClient,
      router,
      devSiteId
        ? devEnvQueryKeys({ devSiteId, productionSiteId: siteId })
        : [adminQueryKeys.devEnvironment(siteId), ['dev-sync'], ['push-plan']],
    )
  }

  const createEnv = useMutation({
    mutationFn: () => create({ data: { siteId } }),
    onSuccess: () => refresh(),
  })
  const reset = useMutation({
    mutationFn: (devSiteId: string) => refreshFn({ data: { devSiteId } }),
    onSuccess: (_result, devSiteId) => refresh(devSiteId),
  })
  const remove = useMutation({
    mutationFn: (devSiteId: string) => deleteFn({ data: { devSiteId } }),
    onSuccess: () => refresh(),
  })

  return { status, createEnv, reset, remove }
}
