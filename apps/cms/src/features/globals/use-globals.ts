import { useQuery } from '@tanstack/react-query'

import { listGlobalsFn } from '#/server/fn/content'

/**
 * Query key of a site's site content sections (globals). Settings, the
 * sidebar, the palette and the section editor share it: invalidate it after
 * any section change.
 */
export function globalsQueryKey(siteId: string) {
  return ['globals', siteId] as const
}

/**
 * The site's sections as the server returns them (raw collection rows with
 * kind 'global'). Editors receive enabled sections only. Disabled until a
 * site is known (the palette may be open outside a site).
 */
export function useSiteGlobals(siteId: string | undefined) {
  return useQuery({
    queryKey: globalsQueryKey(siteId ?? ''),
    queryFn: () => listGlobalsFn({ data: { siteId: siteId! } }),
    enabled: Boolean(siteId),
    staleTime: 60_000,
  })
}
