import { useInfiniteQuery } from '@tanstack/react-query'

import { queryKeys } from '#/lib/content/query-keys'
import { listRevisionsFn } from '#/server/fn/content'

/**
 * An entry's history, one page of summaries at a time (newest first). Revision
 * data is not loaded here. Saves and restores invalidate `queryKeys.revisions`.
 */
export function useRevisionHistory(entryId: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.revisions(entryId ?? ''),
    queryFn: ({ pageParam }) =>
      listRevisionsFn({ data: { entryId: entryId!, cursor: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(entryId),
    // Saves and restores invalidate it; a focus refetch reloads every page.
    refetchOnWindowFocus: false,
  })
}
