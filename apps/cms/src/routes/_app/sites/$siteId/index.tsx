import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { FolderOpen, Plus } from 'lucide-react'

import { ReleaseStatusBar } from '#/components/editor/release-status-bar'
import { queryKeys } from '#/components/editor/query-keys'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { listCollectionsFn, listEntriesFn } from '#/server/fn/content'

export const Route = createFileRoute('/_app/sites/$siteId/')({
  component: SiteContentPage,
})

function SiteContentPage() {
  const { siteId } = Route.useParams()
  const { me } = Route.useRouteContext()

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId, enabledOnly: true } }),
  })

  const collections = collectionsQuery.data ?? []

  const countQueries = useQueries({
    queries: collections.map((collection) => ({
      queryKey: queryKeys.entries(siteId, collection.key, { status: 'count' }),
      queryFn: () =>
        listEntriesFn({
          data: { siteId, collectionKey: collection.key, limit: 1, offset: 0 },
        }),
    })),
  })

  return (
    <div
      className="grid gap-8"
      data-testid="site-content"
      data-ready={collectionsQuery.isFetched ? 'true' : 'false'}
    >
      <ReleaseStatusBar siteId={siteId} />
      <section className="grid gap-1">
        <h2 className="text-lg">Collections</h2>
        {collectionsQuery.isLoading ? (
          <div className="grid gap-2 border-t pt-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : collectionsQuery.isError ? (
          <QueryError
            error={collectionsQuery.error}
            title="Could not load collections"
            onRetry={() => collectionsQuery.refetch()}
            retrying={collectionsQuery.isFetching}
          />
        ) : collections.length === 0 ? (
          <EmptyState
            icon={<FolderOpen />}
            title="No collections yet"
            description={
              me.user.isAgencyAdmin
                ? 'Sync a manifest from the site project, or add a collection in Settings.'
                : 'Your agency has not set up any content types for this site yet.'
            }
            action={
              me.user.isAgencyAdmin ? (
                <Button asChild variant="outline">
                  <Link to="/sites/$siteId/settings" params={{ siteId }}>
                    Open settings
                  </Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y border-y">
            {collections.map((collection, index) => {
              const count = countQueries[index]?.data?.total
              return (
                <li
                  key={collection.id}
                  data-testid={`collection-${collection.key}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium">{collection.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {typeof count === 'number'
                        ? `${count} ${count === 1 ? 'entry' : 'entries'}`
                        : countQueries[index]?.isError
                          ? 'Count unavailable'
                          : 'Counting…'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to="/sites/$siteId/c/$collectionKey/new"
                        params={{ siteId, collectionKey: collection.key }}
                      >
                        <Plus />
                        New entry
                      </Link>
                    </Button>
                    <Button asChild size="sm">
                      <Link
                        to="/sites/$siteId/c/$collectionKey"
                        params={{ siteId, collectionKey: collection.key }}
                      >
                        Open
                      </Link>
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
