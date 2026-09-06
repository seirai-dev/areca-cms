import type { QueryClient } from '@tanstack/react-query'

import type { Me } from '#/server/fn/me'

export type RouterContext = {
  queryClient: QueryClient
  me: Me | null
}
