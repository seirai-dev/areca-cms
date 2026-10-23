import { useQuery } from '@tanstack/react-query'

import { listPendingReleaseChangesFn } from '#/server/fn/publishing'

/** Site languages the next go live changes. Null when they are unchanged. */
export type PendingLanguages = {
  added: string[]
  removed: string[]
  mainChanged: { from: string; to: string } | null
}

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
  global: boolean
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
      await listPendingReleaseChangesFn({
        data: { siteId },
      }),
    enabled,
    staleTime: 5_000,
  })

  const entries = query.data?.changes ?? []
  const changing = entries.filter((entry) => entry.kind !== 'scheduled')
  const languages = query.data?.languages ?? null

  return {
    entries,
    languages,
    ready: changing,
    /** Entries that change plus the language change, as the badge counts them. */
    changeCount: changing.length + (languages ? 1 : 0),
    scheduled: entries.filter((entry) => entry.kind === 'scheduled'),
    isLoading: query.isLoading,
  }
}
