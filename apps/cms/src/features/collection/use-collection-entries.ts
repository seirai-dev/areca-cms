import * as React from 'react'
import {
  infiniteQueryOptions,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { queryKeys } from '#/lib/query-keys'
import { errorMessage } from '#/lib/errors'
import { useInvalidateGoLive } from '#/features/golive/use-go-live'
import {
  bulkQueryKeys,
  invalidateQueryKeys,
} from '#/features/dev-env/invalidate'
import type { EntryStatus, SiteLanguages } from '#/lib/types'
import { isMultilingual, nonMainLanguages } from '#/lib/site-languages'
import {
  DUE_POLL_MS,
  nextPollStart,
  scheduledTimes,
  shouldPollScheduled,
} from './scheduled-poll'
import { m } from '#/paraglide/messages'
import { useStoredState } from '#/hooks/use-stored-state'
import type { StoredCodec } from '#/hooks/use-stored-state'
import { BULK_ENTRY_MAX_IDS } from '#/lib/content-limits'
import { bulkEntryActionFn, listEntriesFn } from '#/server/fn/content'
import type { BulkEntryActionResult } from '#/server/fn/content'

const PAGE_SIZE = 25

export type StatusFilter = 'all' | EntryStatus

/** A page's rows. A malformed response (no `items`) reads as an empty page. */
function pageItems<T>(page: { items?: T[] } | null | undefined): T[] {
  return page?.items ?? []
}

function pageTotal(page: { total?: number } | null | undefined): number {
  return page?.total ?? 0
}

/** `?missing=` as the list filters by it: only a non-main language of a multilingual site. */
export function missingLanguageFilter(
  languages: SiteLanguages | null | undefined,
  missing: string | null | undefined,
): string | undefined {
  return isMultilingual(languages) &&
    missing &&
    nonMainLanguages(languages).includes(missing)
    ? missing
    : undefined
}

/** The paged entry list of one collection, for one filter. */
export function collectionEntriesQuery({
  siteId,
  collectionKey,
  status,
  search,
  missingLanguage,
}: {
  siteId: string
  collectionKey: string
  status: StatusFilter
  search: string
  missingLanguage?: string
}) {
  return infiniteQueryOptions({
    queryKey: [
      ...queryKeys.entries(siteId, collectionKey, {
        status,
        search,
        missingLanguage,
      }),
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
          missingLanguage,
          limit: PAGE_SIZE,
          offset: pageParam,
        },
      }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce(
        (sum, page) => sum + pageItems(page).length,
        0,
      )
      return loaded < pageTotal(last) ? loaded : undefined
    },
    // A scheduled entry goes live on the server; refresh the list while one
    // is due (or less than a minute away) and stop once none is.
    refetchInterval: (q) => {
      const pages = q.state.data?.pages ?? []
      const times = scheduledTimes(pages.flatMap((page) => pageItems(page)))
      return shouldPollScheduled(times) ? DUE_POLL_MS : false
    },
  })
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
  missingLanguage,
}: {
  siteId: string
  collectionKey: string
  status: StatusFilter
  search: string
  /** Only entries not complete in this language (multilingual sites). */
  missingLanguage?: string
}) {
  const query = useInfiniteQuery({
    ...collectionEntriesQuery({
      siteId,
      collectionKey,
      status,
      search,
      missingLanguage,
    }),
    placeholderData: keepPreviousData,
  })

  // A malformed response shows the list's normal empty or error state rather
  // than throwing to the route error boundary.
  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => pageItems(page)) ?? [],
    [query.data],
  )
  const total = query.data?.pages[0]?.total

  // Re-render when the next scheduled time enters the polling window, so the
  // interval above is evaluated again (it is otherwise only checked after a
  // fetch).
  const [tick, setTick] = React.useState(0)
  const pollStart = nextPollStart(scheduledTimes(rows))
  React.useEffect(() => {
    if (pollStart === null) return
    const wait = pollStart - Date.now()
    const timer = setTimeout(
      () => setTick((n) => n + 1),
      Math.min(Math.max(wait, 0) + 50, 2_147_483_647),
    )
    return () => clearTimeout(timer)
  }, [pollStart, tick])

  // When a scheduled entry leaves that state, the site has a new change
  // ready (or live): refresh the Go-live tray too.
  const invalidateGoLive = useInvalidateGoLive(siteId)
  const scheduledIds = rows
    .filter((row) => row.status === 'scheduled')
    .map((row) => row.id)
    .join(',')
  const previousScheduled = React.useRef(scheduledIds)
  React.useEffect(() => {
    const before = previousScheduled.current.split(',').filter(Boolean)
    previousScheduled.current = scheduledIds
    const now = new Set(scheduledIds.split(','))
    if (before.some((id) => !now.has(id))) void invalidateGoLive()
  }, [scheduledIds])

  return { query, rows, total }
}

export type BulkAction = 'ready' | 'draft' | 'archive' | 'delete'

/** One entry in a bulk action: its id, and the title and slug the list shows for it. */
export type BulkTarget = { id: string; title: string; slug: string }

export type BulkFailure = BulkTarget & { reason: string }

/** Per-entry outcome of one bulk action. `failed` lists what did not change. */
export type BulkResult = {
  action: BulkAction
  /** Every entry the action was attempted on. */
  ids: string[]
  total: number
  done: number
  failed: BulkFailure[]
}

function bulkPartialMessage(result: BulkResult) {
  const counts = {
    done: result.done,
    total: result.total,
    failed: result.failed.length,
  }
  switch (result.action) {
    case 'ready':
      return m.collection_bulk_partial_ready(counts)
    case 'draft':
      return m.collection_bulk_partial_draft(counts)
    case 'archive':
      return m.collection_bulk_partial_archive(counts)
    case 'delete':
      return m.collection_bulk_partial_delete(counts)
  }
}

function bulkSuccessMessage(action: BulkAction, count: number) {
  switch (action) {
    case 'ready':
      return count === 1
        ? m.collection_bulk_ready_one()
        : m.collection_bulk_ready_other({ count })
    case 'draft':
      return count === 1
        ? m.collection_bulk_draft_one()
        : m.collection_bulk_draft_other({ count })
    case 'archive':
      return count === 1
        ? m.collection_bulk_archived_one()
        : m.collection_bulk_archived_other({ count })
    case 'delete':
      return count === 1
        ? m.collection_bulk_deleted_one()
        : m.editor_bulk_deleted({ count })
  }
}

/** Runs the action for one batch of ids on the server, and returns one result per id. */
export type BulkRunner = (ids: string[]) => Promise<BulkEntryActionResult[]>

/**
 * The failure reason of each id in a batch that did not change. Ids that
 * changed are absent. A failed request fails every id in its batch.
 */
async function batchFailures(
  batch: BulkTarget[],
  run: BulkRunner,
): Promise<Map<string, string>> {
  const reasons = new Map<string, string>()
  try {
    const byId = new Map(
      (await run(batch.map((target) => target.id))).map((result) => [
        result.id,
        result,
      ]),
    )
    for (const target of batch) {
      const result = byId.get(target.id)
      if (!result) {
        reasons.set(target.id, m.editor_something_went_wrong())
      } else if (!result.ok) {
        reasons.set(target.id, result.error ?? m.editor_something_went_wrong())
      }
    }
  } catch (error) {
    for (const target of batch) reasons.set(target.id, errorMessage(error))
  }
  return reasons
}

/**
 * Runs a bulk action in batches of at most BULK_ENTRY_MAX_IDS ids, one server
 * request per batch, and records which entries did not change. A failure does
 * not stop the other entries or batches.
 */
export async function runBulkAction(
  input: { action: BulkAction; targets: BulkTarget[] },
  run: BulkRunner,
): Promise<BulkResult> {
  const failed: BulkFailure[] = []
  for (
    let start = 0;
    start < input.targets.length;
    start += BULK_ENTRY_MAX_IDS
  ) {
    const batch = input.targets.slice(start, start + BULK_ENTRY_MAX_IDS)
    const reasons = await batchFailures(batch, run)
    for (const target of batch) {
      const reason = reasons.get(target.id)
      if (reason !== undefined) failed.push({ ...target, reason })
    }
  }
  return {
    action: input.action,
    ids: input.targets.map((target) => target.id),
    total: input.targets.length,
    done: input.targets.length - failed.length,
    failed,
  }
}

/**
 * Mark as ready / Move back to draft / Delete for one or many entries. Each
 * entry is one request, so every entry has its own outcome. The result goes
 * to `onResult` (the screen keeps the failed entries selected). A partial
 * result shows a summary toast whose "Show details" lists each failed entry
 * with its reason, and offers to retry only those.
 */
export function useEntryBulkActions(
  siteId: string,
  collectionKey: string,
  options: { onResult?: (result: BulkResult) => void } = {},
) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const invalidateGoLive = useInvalidateGoLive(siteId)
  const [details, setDetails] = React.useState<BulkResult | null>(null)
  const onResultRef = React.useRef(options.onResult)
  onResultRef.current = options.onResult

  const mutation = useMutation({
    mutationFn: (input: { action: BulkAction; targets: BulkTarget[] }) =>
      runBulkAction(input, async (ids) => {
        const response = await bulkEntryActionFn({
          data: { siteId, action: input.action, ids },
        })
        return response.results
      }),
    onSuccess: async (result) => {
      onResultRef.current?.(result)
      if (result.failed.length === 0) {
        toast.success(bulkSuccessMessage(result.action, result.done))
      } else {
        const showDetails = {
          label: m.collection_bulk_show_details(),
          onClick: () => setDetails(result),
        }
        if (result.done === 0) {
          toast.error(
            result.total === 1
              ? m.collection_bulk_failed_one()
              : m.collection_bulk_failed_other({ count: result.total }),
            { description: result.failed[0]?.reason, action: showDetails },
          )
        } else {
          toast.warning(bulkPartialMessage(result), { action: showDetails })
        }
      }
      await Promise.all([
        // The list, each entry touched, and (on a dev site) the sync status,
        // which counts these changes; the router refreshes its loaders.
        invalidateQueryKeys(
          queryClient,
          router,
          bulkQueryKeys({
            siteId,
            collectionKey,
            entryIds: result.ids,
          }),
        ),
        invalidateGoLive(),
      ])
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  /** Runs the failed entries again, with the same action. */
  function retryFailed() {
    if (!details) return
    const { action, failed } = details
    setDetails(null)
    mutation.mutate({
      action,
      targets: failed.map(({ id, title, slug }) => ({ id, title, slug })),
    })
  }

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    details,
    closeDetails: () => setDetails(null),
    retryFailed,
  }
}

export type CollectionView = 'cards' | 'list'

const COLLECTION_VIEW: StoredCodec<CollectionView | null> = {
  parse: (raw) => (raw === 'cards' || raw === 'list' ? raw : null),
  serialize: (view) => view,
}

/** Cards / List, remembered per collection in this browser. */
export function useCollectionView(
  siteId: string,
  collectionKey: string,
  fallback: CollectionView,
) {
  const [view, setView] = useStoredState(
    `areca.collection-view.${siteId}.${collectionKey}`,
    COLLECTION_VIEW,
    { serverValue: null },
  )
  return [view ?? fallback, setView] as const
}
