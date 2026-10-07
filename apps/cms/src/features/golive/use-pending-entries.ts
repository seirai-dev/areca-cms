import { useQuery } from '@tanstack/react-query'

import { listPendingReleaseChangesFn } from '#/server/fn/publishing'

export type PendingEntry = {
  id: string
  title: string
  slug: string
  collectionKey: string
  collectionLabel: string
  updatedAt: string | Date
  updatedByName: string | null
  scheduledAt: string | Date | null
  kind: 'ready' | 'scheduled' | 'removal'
  exists: boolean
}

/**
 * "What's changing" (brief §3.6): approved candidate vs live snapshot
 * (adds, updates, removals) plus upcoming scheduled entries that do not
 * change the candidate. One cached server list; only runs while `enabled`
 * (the panel or overview card is open).
 */
export function usePendingEntries({
  siteId,
  enabled,
}: {
  siteId: string
  enabled: boolean
}) {
  const query = useQuery({
    queryKey: ['golive-pending', siteId] as const,
    queryFn: async () =>
      (await listPendingReleaseChangesFn({
        data: { siteId },
      })) as PendingEntry[],
    enabled,
    staleTime: 5_000,
  })

  const entries = query.data ?? []
  const changing = entries.filter((entry) => entry.kind !== 'scheduled')

  return {
    entries,
    ready: changing,
    scheduled: entries.filter((entry) => entry.kind === 'scheduled'),
    isLoading: query.isLoading,
  }
}
