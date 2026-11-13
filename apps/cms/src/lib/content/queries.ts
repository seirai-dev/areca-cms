import { queryOptions } from '@tanstack/react-query'

import { getAiAvailabilityFn } from '#/server/fn/ai'
import {
  getEntryFn,
  getPreviewUrlFn,
  listCollectionsFn,
  listEntryCountsFn,
  listRecentEntriesFn,
} from '#/server/fn/content'

import { queryKeys } from './query-keys'

/*
 * Query options shared by the screens and the route loaders that start the
 * same requests early (on hover and while the page's code downloads).
 */

/** A site's collections (sidebar, collection list, editor). */
export function collectionsQuery(siteId: string) {
  return queryOptions({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

export function entryCountsQuery(siteId: string) {
  return queryOptions({
    queryKey: queryKeys.entryCounts(siteId),
    queryFn: () => listEntryCountsFn({ data: { siteId } }),
    staleTime: 60_000,
  })
}

/** The overview's "Recently edited" list. */
export function recentEntriesQuery(siteId: string) {
  return queryOptions({
    queryKey: queryKeys.recentEntries(siteId, 'recent'),
    queryFn: () => listRecentEntriesFn({ data: { siteId, limit: 8 } }),
    staleTime: 15_000,
  })
}

/** The overview's "Drafts waiting" card (owners and admins). */
export function draftsByOthersQuery(siteId: string) {
  return queryOptions({
    queryKey: queryKeys.recentEntries(siteId, 'drafts-by-others'),
    queryFn: () =>
      listRecentEntriesFn({
        data: { siteId, draftsByOthers: true, limit: 3 },
      }),
    staleTime: 30_000,
  })
}

/**
 * Opening an entry loads its current version: a copy is reused only when it
 * was fetched moments ago (by the route loader, on hover or navigation).
 */
export const ENTRY_FRESH_MS = 5_000

/** One entry, as the editor loads it. */
export function entryQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.entry(id),
    queryFn: () => getEntryFn({ data: { id } }),
    staleTime: ENTRY_FRESH_MS,
  })
}

/** The signed preview URL of a collection entry. */
export function previewUrlQuery(
  siteId: string,
  collection: string,
  slug: string,
) {
  return queryOptions({
    queryKey: queryKeys.previewUrl(siteId, collection, slug),
    queryFn: () => getPreviewUrlFn({ data: { siteId, collection, slug } }),
    staleTime: 5 * 60 * 1000,
  })
}

export function aiAvailabilityQuery() {
  return queryOptions({
    queryKey: queryKeys.aiAvailability(),
    queryFn: () => getAiAvailabilityFn(),
    staleTime: 30_000,
  })
}
