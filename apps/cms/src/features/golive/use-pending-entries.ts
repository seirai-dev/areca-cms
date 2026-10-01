import { useQueries, useQuery } from '@tanstack/react-query'

import { queryKeys } from '#/lib/content/query-keys'
import { entryTitle } from '#/lib/content/utils'
import type { EntryData, Field } from '#/lib/types'
import { listCollectionsFn, listEntriesFn } from '#/server/fn/content'

export type PendingEntry = {
  id: string
  title: string
  slug: string
  collectionKey: string
  collectionLabel: string
  updatedAt: string | Date
  updatedByName: string | null
  scheduledAt: string | Date | null
  kind: 'ready' | 'scheduled'
}

type EntryRow = {
  id: string
  slug: string
  draftData: EntryData
  updatedAt: string | Date
  scheduledAt: string | Date | null
  updatedByName?: string | null
}

const LIMIT = 100

/**
 * "What's changing" (brief §3.6): published entries of every enabled
 * collection whose `updatedAt` is after the live release (all of them when
 * nothing is live), plus scheduled entries. One cached query per collection;
 * only runs while `enabled` (the panel is open).
 */
export function usePendingEntries({
  siteId,
  liveCreatedAt,
  enabled,
}: {
  siteId: string
  liveCreatedAt: string | Date | null | undefined
  enabled: boolean
}) {
  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
    enabled,
  })
  const collections = (collectionsQuery.data ?? []).filter(
    (collection) => collection.enabled,
  )

  const results = useQueries({
    queries: collections.flatMap((collection) =>
      (['published', 'scheduled'] as const).map((status) => ({
        queryKey: ['golive-pending', siteId, collection.key, status] as const,
        queryFn: async () =>
          (
            await listEntriesFn({
              data: {
                siteId,
                collectionKey: collection.key,
                status,
                limit: LIMIT,
                offset: 0,
              },
            })
          ).items,
        enabled,
        staleTime: 5_000,
      })),
    ),
  })

  const liveTime =
    liveCreatedAt == null ? null : new Date(liveCreatedAt).getTime()

  const entries: PendingEntry[] = []
  collections.forEach((collection, index) => {
    const fields = collection.fields
    const published = results[index * 2]?.data ?? []
    const scheduled = results[index * 2 + 1]?.data ?? []
    for (const row of published) {
      if (liveTime !== null && new Date(row.updatedAt).getTime() <= liveTime) {
        continue
      }
      entries.push(toPending(row, collection, fields, 'ready'))
    }
    for (const row of scheduled) {
      entries.push(toPending(row, collection, fields, 'scheduled'))
    }
  })
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'ready' ? -1 : 1
    if (a.kind === 'scheduled') {
      return (
        new Date(a.scheduledAt ?? 0).getTime() -
        new Date(b.scheduledAt ?? 0).getTime()
      )
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  return {
    entries,
    ready: entries.filter((entry) => entry.kind === 'ready'),
    scheduled: entries.filter((entry) => entry.kind === 'scheduled'),
    isLoading:
      collectionsQuery.isLoading || results.some((result) => result.isLoading),
  }
}

function toPending(
  row: EntryRow,
  collection: { key: string; label: string },
  fields: Field[],
  kind: PendingEntry['kind'],
): PendingEntry {
  return {
    id: row.id,
    title: entryTitle(row.draftData, fields, row.slug),
    slug: row.slug,
    collectionKey: collection.key,
    collectionLabel: collection.label,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName ?? null,
    scheduledAt: row.scheduledAt,
    kind,
  }
}
