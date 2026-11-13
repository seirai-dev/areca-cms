import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '#/lib/query-keys'
import { getMeFn } from '#/server/fn/me'

export const ME_QUERY_KEY = queryKeys.me()

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

export async function loadMe(queryClient: QueryClient) {
  const me = await queryClient.fetchQuery(meQueryOptions)
  // Never remember "signed out": the next check after signing in must ask.
  if (!me) {
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY })
  }
  return me
}
