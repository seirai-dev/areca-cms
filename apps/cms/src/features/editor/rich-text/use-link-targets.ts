import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { queryKeys } from '#/lib/content/query-keys'
import {
  checkLinkTargetsFn,
  linkTargetHeadingsFn,
  searchLinkTargetsFn,
} from '#/server/fn/link-targets'

/**
 * The server data behind the rich text link field: entries to link to, the
 * sections of an entry, and whether the links in a text still work. Cached with
 * TanStack Query; the editor's save refreshes them (see use-entry-editor).
 */

/** How long a search answer stays fresh; typing again within it costs nothing. */
const SEARCH_STALE_MS = 30_000

export function useLinkSearch({
  siteId,
  query,
  locale,
  limit,
  enabled,
}: {
  siteId: string
  query: string
  locale: string | null
  limit: number
  enabled: boolean
}) {
  return useQuery({
    queryKey: queryKeys.linkSearch(siteId, locale, query, limit),
    queryFn: () =>
      searchLinkTargetsFn({ data: { siteId, query, locale, limit } }),
    enabled,
    // Keep the rows of the last query while the next one loads: no flicker.
    placeholderData: keepPreviousData,
    staleTime: SEARCH_STALE_MS,
  })
}

export function useLinkHeadings({
  siteId,
  entryId,
  locale,
  enabled,
}: {
  siteId: string
  entryId: string | null | undefined
  locale: string | null
  enabled: boolean
}) {
  return useQuery({
    queryKey: queryKeys.linkHeadings(siteId, entryId ?? '', locale),
    queryFn: () =>
      linkTargetHeadingsFn({
        data: { siteId, entryId: entryId ?? '', locale },
      }),
    enabled: enabled && Boolean(entryId),
    staleTime: SEARCH_STALE_MS,
  })
}

export type LinkPair = { entryId: string; anchor: string | null }

/** A stable key for a set of links, so the check runs once per set. */
export function linkPairsKey(pairs: LinkPair[]) {
  return JSON.stringify(
    pairs
      .map((pair) => [pair.entryId, pair.anchor ?? ''])
      .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])),
  )
}

export function useLinkChecks({
  siteId,
  locale,
  pairs,
}: {
  siteId: string
  locale: string | null
  pairs: LinkPair[]
}) {
  const key = linkPairsKey(pairs)
  return useQuery({
    queryKey: queryKeys.linkChecks(siteId, locale, key),
    queryFn: () =>
      checkLinkTargetsFn({
        data: {
          siteId,
          locale,
          links: pairs.map((pair) => ({
            entryId: pair.entryId,
            anchor: pair.anchor,
          })),
        },
      }),
    enabled: pairs.length > 0,
    // Checked again when the editor opens or saves: targets change in other tabs too.
    staleTime: 0,
  })
}
