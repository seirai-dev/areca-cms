import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { OVERVIEW_ENTRIES, queryKeys } from '#/lib/query-keys'
import { ME_QUERY_KEY } from '#/lib/me-query'

/** Used after a reset, which replaces the dev site's entries. */
export const ENTRY_FAMILY_KEYS: QueryKey[] = [queryKeys.entryFamily()]

/**
 * Query keys a development environment's own content and settings live under:
 * its collections, entries, sections, site settings (which hold the languages)
 * and sync status.
 */
export function devSiteQueryKeys(devSiteId: string): QueryKey[] {
  return [
    queryKeys.collections(devSiteId),
    queryKeys.entryCounts(devSiteId),
    queryKeys.entriesOf(devSiteId),
    queryKeys.globals(devSiteId),
    queryKeys.globalFamily(devSiteId),
    queryKeys.site(devSiteId),
    queryKeys.devSync(devSiteId),
  ]
}

/**
 * Query keys of the production site a reset, push or copy writes to: its
 * content, its settings and languages (`['site', id]`, which the push can
 * change), its release and publishing state, and the go-live tray's pending
 * list (`['golive-pending', id]`), which shows the changes a push makes.
 */
export function productionQueryKeys(productionSiteId: string): QueryKey[] {
  return [
    queryKeys.collections(productionSiteId),
    queryKeys.entryCounts(productionSiteId),
    queryKeys.entriesOf(productionSiteId),
    queryKeys.globals(productionSiteId),
    queryKeys.globalFamily(productionSiteId),
    queryKeys.site(productionSiteId),
    queryKeys.releaseStatus(productionSiteId),
    queryKeys.publications(productionSiteId),
    queryKeys.buildJobs(productionSiteId),
    queryKeys.goLivePending(productionSiteId),
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
    queryKeys.devEnvironment(productionSiteId),
    queryKeys.pushPlan(devSiteId),
    ME_QUERY_KEY,
  ]
}

/** The entry caches of the given ids, one key each. */
export function entryQueryKeys(entryIds: readonly string[]): QueryKey[] {
  return entryIds.map((id) => queryKeys.entry(id))
}

/**
 * A reset replaces the dev site's entries, so every entry cache is stale: the
 * whole entry family, plus the dev and production keys of `devEnvQueryKeys`.
 */
export function resetQueryKeys(input: {
  devSiteId: string
  productionSiteId: string
}): QueryKey[] {
  return [...devEnvQueryKeys(input), ...ENTRY_FAMILY_KEYS]
}

/**
 * A push or a copy writes production entries. `productionEntryIds` are the
 * ids it wrote (a push's `written`, a copy's `productionId`); their caches are
 * stale, and so is everything `devEnvQueryKeys` covers.
 *
 * `wholeEntryFamily` is set when a push also wrote schema or language items:
 * those bump the content version of entries the push does not name, so the
 * whole entry family is invalidated, as a reset does.
 */
export function writeQueryKeys(input: {
  devSiteId: string
  productionSiteId: string
  productionEntryIds: readonly string[]
  wholeEntryFamily?: boolean
}): QueryKey[] {
  return [
    ...devEnvQueryKeys(input),
    ...(input.wholeEntryFamily
      ? ENTRY_FAMILY_KEYS
      : entryQueryKeys(input.productionEntryIds)),
  ]
}

/**
 * A bulk action on one collection of a site: its entry list, the site's
 * per-collection counts (a delete changes them), the entries it touched, and
 * the site's sync status (a dev site counts these changes).
 */
export function bulkQueryKeys({
  siteId,
  collectionKey,
  entryIds,
}: {
  siteId: string
  collectionKey: string
  entryIds: readonly string[]
}): QueryKey[] {
  return [
    queryKeys.entriesOf(siteId, collectionKey),
    queryKeys.entriesOf(siteId, OVERVIEW_ENTRIES),
    queryKeys.entryCounts(siteId),
    ...entryQueryKeys(entryIds),
    queryKeys.devSync(siteId),
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
    queryKey: queryKeys.devSync(siteId),
  })
}
