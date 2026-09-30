import * as React from 'react'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'

import { queryKeys } from '#/lib/content/query-keys'
import { errorMessage } from '#/lib/content/utils'
import { useInvalidateGoLive } from '#/features/golive/use-go-live'
import type { EntryData, EntryStatus } from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  deleteEntryFn,
  listEntriesFn,
  publishEntryFn,
  unpublishEntryFn,
} from '#/server/fn/content'

const PAGE_SIZE = 25

export type StatusFilter = 'all' | EntryStatus

export type EntryRow = {
  id: string
  slug: string
  status: EntryStatus
  draftData: EntryData
  publishedData?: EntryData | null
  updatedAt: string | Date
  createdAt?: string | Date
  scheduledAt: string | Date | null
  updatedByName?: string | null
}

/**
 * One collection's entries for the Collection screen (brief §3.4): status
 * filter and search go to the server; "Show more" appends pages of 25
 * (server `offset`). Keys live under `['entries', siteId, key, …]`, so every
 * existing invalidation (editor saves, bulk actions) refreshes them.
 */
export function useCollectionEntries({
  siteId,
  collectionKey,
  status,
  search,
}: {
  siteId: string
  collectionKey: string
  status: StatusFilter
  search: string
}) {
  const query = useInfiniteQuery({
    queryKey: [
      ...queryKeys.entries(siteId, collectionKey, { status, search }),
      'paged',
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listEntriesFn({
        data: {
          siteId,
          collectionKey,
          status: status === 'all' ? undefined : status,
          search: search || undefined,
          limit: PAGE_SIZE,
          offset: pageParam,
        },
      }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
  })

  const rows = React.useMemo(
    () => (query.data?.pages.flatMap((page) => page.items) ?? []) as EntryRow[],
    [query.data],
  )
  const total = query.data?.pages[0]?.total

  return { query, rows, total }
}

export type BulkAction = 'ready' | 'draft' | 'delete'

/**
 * Mark as ready / Move back to draft / Delete for one or many entries.
 * Calls run one after another (as before) and end in one toast: a success
 * sentence, or "3 completed, 1 failed."
 */
export function useEntryBulkActions(siteId: string, collectionKey: string) {
  const queryClient = useQueryClient()
  const invalidateGoLive = useInvalidateGoLive(siteId)

  return useMutation({
    mutationFn: async (input: { action: BulkAction; ids: string[] }) => {
      const fn =
        input.action === 'ready'
          ? publishEntryFn
          : input.action === 'draft'
            ? unpublishEntryFn
            : deleteEntryFn
      let failed = 0
      let lastError: unknown = null
      for (const id of input.ids) {
        try {
          await fn({ data: { id } })
        } catch (error) {
          failed += 1
          lastError = error
        }
      }
      return { done: input.ids.length - failed, failed, lastError }
    },
    onSuccess: async (result, input) => {
      if (result.failed > 0) {
        const reason = errorMessage(result.lastError)
        if (result.done === 0) {
          toast.error(
            input.ids.length === 1
              ? m.collection_bulk_failed_one()
              : m.collection_bulk_failed_other({ count: input.ids.length }),
            { description: reason },
          )
        } else {
          toast.warning(
            m.editor_bulk_partial({ done: result.done, failed: result.failed }),
            { description: reason },
          )
        }
      } else {
        const count = result.done
        toast.success(
          input.action === 'ready'
            ? count === 1
              ? m.collection_bulk_ready_one()
              : m.collection_bulk_ready_other({ count })
            : input.action === 'draft'
              ? count === 1
                ? m.collection_bulk_draft_one()
                : m.collection_bulk_draft_other({ count })
              : count === 1
                ? m.collection_bulk_deleted_one()
                : m.editor_bulk_deleted({ count }),
        )
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['entries', siteId, collectionKey],
        }),
        ...input.ids.map((id) =>
          queryClient.invalidateQueries({ queryKey: queryKeys.entry(id) }),
        ),
        invalidateGoLive(),
      ])
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
}

export type CollectionView = 'cards' | 'list'

/** Cards / List, remembered per collection in this browser. */
export function useCollectionView(
  siteId: string,
  collectionKey: string,
  fallback: CollectionView,
) {
  const storageKey = `areca.collection-view.${siteId}.${collectionKey}`
  const [view, setViewState] = React.useState<CollectionView | null>(null)

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      setViewState(stored === 'cards' || stored === 'list' ? stored : null)
    } catch {
      setViewState(null)
    }
  }, [storageKey])

  const setView = React.useCallback(
    (next: CollectionView) => {
      setViewState(next)
      try {
        localStorage.setItem(storageKey, next)
      } catch {
        /* localStorage unavailable */
      }
    },
    [storageKey],
  )

  return [view ?? fallback, setView] as const
}
