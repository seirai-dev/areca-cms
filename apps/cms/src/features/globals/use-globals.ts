import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '#/lib/query-keys'
import { listGlobalsFn } from '#/server/fn/content'

/**
 * The site's sections as the server returns them (raw collection rows with
 * kind 'global'). Editors receive enabled sections only. Disabled until a
 * site is known (the palette may be open outside a site).
 */
export function useSiteGlobals(siteId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.globals(siteId ?? ''),
    queryFn: () => listGlobalsFn({ data: { siteId: siteId! } }),
    enabled: Boolean(siteId),
    staleTime: 60_000,
  })
}
