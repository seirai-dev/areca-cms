import { QueryClient } from '@tanstack/react-query'

import type { Me } from '#/server/fn/me'

export function getContext() {
  // Results stay stale by default, so opening a screen always shows current
  // data. Queries that are heavy and kept fresh by invalidation opt out of
  // the window-focus refetch instead (`refetchOnWindowFocus: false`).
  const queryClient = new QueryClient()

  return {
    queryClient,
    me: null as Me | null,
  }
}
