import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { adminQueryKeys } from '#/lib/admin/helpers'
import { queryKeys } from '#/lib/content/query-keys'
import { ME_QUERY_KEY } from '#/lib/me-query'
import { globalsQueryKey } from '#/features/globals/use-globals'

/**
 * Query keys a development environment's own content and settings live under:
 * its collections, entries, sections, site settings (which hold the languages)
 * and sync status.
 */
export function devSiteQueryKeys(devSiteId: string): QueryKey[] {
  return [
    queryKeys.collections(devSiteId),
    ['entries', devSiteId],
    globalsQueryKey(devSiteId),
    adminQueryKeys.site(devSiteId),
    adminQueryKeys.devSync(devSiteId),
  ]
}

/** Query keys of the production site a reset, push or copy writes to. */
export function productionQueryKeys(productionSiteId: string): QueryKey[] {
  return [
    queryKeys.collections(productionSiteId),
    ['entries', productionSiteId],
    globalsQueryKey(productionSiteId),
    queryKeys.releaseStatus(productionSiteId),
    queryKeys.publications(productionSiteId),
    queryKeys.buildJobs(productionSiteId),
  ]
}

/**
 * Everything a reset, a push or a copy changes: both sites' content, the dev
 * environment status and push plan, and the signed-in user (`me` lists the
 * sites). Prefix keys, so the lists under them refresh too.
 */
export function devEnvQueryKeys({
  devSiteId,
  productionSiteId,
}: {
  devSiteId: string
  productionSiteId: string
}): QueryKey[] {
  return [
    ...devSiteQueryKeys(devSiteId),
    ...productionQueryKeys(productionSiteId),
    adminQueryKeys.devEnvironment(productionSiteId),
    adminQueryKeys.pushPlan(devSiteId),
    ME_QUERY_KEY,
  ]
}

/**
 * Invalidates each key, refetching the active ones, and refreshes the router
 * (its loaders and the cached `me`). `router` is the app router or any object
 * with its `invalidate`.
 */
export async function invalidateQueryKeys(
  queryClient: QueryClient,
  router: { invalidate: () => Promise<void> },
  keys: QueryKey[],
): Promise<void> {
  await Promise.all([
    ...keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    router.invalidate(),
  ])
}

/**
 * Marks a development site's sync status (the unpushed and production counts)
 * stale. Called after a dev entry saves, a bulk action, a schema or language
 * edit on the dev site.
 */
export function invalidateDevSync(queryClient: QueryClient, siteId: string) {
  return queryClient.invalidateQueries({
    queryKey: adminQueryKeys.devSync(siteId),
  })
}
