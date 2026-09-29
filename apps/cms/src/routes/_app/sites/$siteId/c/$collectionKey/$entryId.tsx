import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { EntryEditor } from '#/components/editor/entry-editor'
import { queryKeys } from '#/components/editor/query-keys'
import { EmptyState } from '#/components/ui/empty-state'
import { useHideSiteStrip } from '#/routes/_app/sites/$siteId'
import { Skeleton } from '#/components/ui/skeleton'
import { canManageSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import { listCollectionsFn } from '#/server/fn/content'

export const Route = createFileRoute(
  '/_app/sites/$siteId/c/$collectionKey/$entryId',
)({
  component: EditEntryPage,
})

function EditEntryPage() {
  const { siteId, collectionKey, entryId } = Route.useParams()
  const { site, me } = Route.useRouteContext()

  // The editor toolbar takes over the site identity strip row.
  useHideSiteStrip()

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
  })

  const collection = collectionsQuery.data?.find(
    (item) => item.key === collectionKey,
  )

  if (collectionsQuery.isLoading) {
    return <Skeleton className="h-96 w-full" />
  }

  if (!collection) {
    return <EmptyState title={m.editor_collection_not_found()} />
  }

  return (
    <EntryEditor
      siteId={siteId}
      siteName={site.name}
      collectionKey={collectionKey}
      collectionLabel={collection.label}
      fields={collection.fields}
      organizationId={site.organizationId}
      canManage={canManageSite(me, site.organizationId)}
      entryId={entryId}
    />
  )
}
