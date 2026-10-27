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

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: adminQueryKeys.devEnvironment(siteId),
    })
    await router.invalidate()
  }

  const createEnv = useMutation({
    mutationFn: () => create({ data: { siteId } }),
    onSuccess: refresh,
  })
  const reset = useMutation({
    mutationFn: (devSiteId: string) => refreshFn({ data: { devSiteId } }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (devSiteId: string) => deleteFn({ data: { devSiteId } }),
    onSuccess: refresh,
  })

  return { status, createEnv, reset, remove }
}
