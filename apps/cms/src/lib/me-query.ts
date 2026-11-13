import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { getMeFn } from '#/server/fn/me'

export const ME_QUERY_KEY = ['me'] as const

/**
 * The signed-in user, cached briefly so clicking around the app (pages, tabs,
 * link preloads on hover) does not ask the server again every time. Anything
 * that changes the user calls `router.invalidate()`, which drops this cache
 * (see router.tsx), and sign-in and sign-out reload the page. Server functions
 * check the session themselves, so a stale copy never grants access.
 */
const meQueryOptions = queryOptions({
  queryKey: ME_QUERY_KEY,
  queryFn: () => getMeFn(),
  staleTime: 30_000,
})

/** The user each query client last loaded data for (null: signed out). */
const cacheOwner = new WeakMap<QueryClient, string | null>()

export async function loadMe(queryClient: QueryClient) {
  const me = await queryClient.fetchQuery(meQueryOptions)
  // Cached queries belong to whoever was signed in when they ran. When that
  // changes without a page load (sign-out, another account), drop them all.
  const userId = me?.user.id ?? null
  if (cacheOwner.has(queryClient) && cacheOwner.get(queryClient) !== userId) {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== ME_QUERY_KEY[0],
    })
  }
  cacheOwner.set(queryClient, userId)
  // Never remember "signed out": the next check after signing in must ask.
  if (!me) {
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY })
  }
  return me
}
