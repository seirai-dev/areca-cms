import { QueryClient } from '@tanstack/react-query'

import type { Me } from '#/server/fn/me'

/** How long a query result counts as fresh: no refetch on mount or focus. */
export const QUERY_STALE_MS = 30_000

export function getContext() {
  // Data that must be current on every mount (the open entry, live build
  // state) sets `staleTime: 0` itself; mutations invalidate the rest.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: QUERY_STALE_MS } },
  })

  return {
    queryClient,
    me: null as Me | null,
  }
}
