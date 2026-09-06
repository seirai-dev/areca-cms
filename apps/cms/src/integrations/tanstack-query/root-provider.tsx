import { QueryClient } from '@tanstack/react-query'

import type { Me } from '#/server/fn/me'

export function getContext() {
  const queryClient = new QueryClient()

  return {
    queryClient,
    me: null as Me | null,
  }
}
export default function TanstackQueryProvider() {}
