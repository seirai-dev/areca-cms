import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'

import { ReleaseStatusBar } from '#/components/editor/release-status-bar'
import { queryKeys } from '#/components/editor/query-keys'
import { EmptyState } from '#/components/empty-state'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { listCollectionsFn, listEntriesFn } from '#/server/fn/content'

export const Route = createFileRoute('/_app/sites/$siteId/')({
  component: SiteContentPage,
})

function SiteContentPage() {
  const { siteId } = Route.useParams()

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () =>
      listCollectionsFn({ data: { siteId, enabledOnly: true } }),
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
      className="grid gap-6"
      data-testid="site-content"
      data-ready={collectionsQuery.isFetched ? 'true' : 'false'}
    >
      <ReleaseStatusBar siteId={siteId} />
      {collectionsQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          title="No collections"
          description="Sync a manifest from your site (`pnpm --filter @areca/demo-site sync-manifest`). An agency admin can also add a collection in Settings."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {collections.map((collection, index) => (
            <Card key={collection.id} data-testid={`collection-${collection.key}`}>
              <CardHeader>
                <CardTitle>{collection.label}</CardTitle>
                <CardDescription>
                  {countQueries[index]?.data?.total ?? '—'} entries
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link
                    to="/sites/$siteId/c/$collectionKey"
                    params={{ siteId, collectionKey: collection.key }}
                  >
                    Open
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
