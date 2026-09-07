import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { EntryEditor } from '#/components/editor/entry-editor'
import { queryKeys } from '#/components/editor/query-keys'
import { EmptyState } from '#/components/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import type { Field } from '#/lib/types'
import { listCollectionsFn } from '#/server/fn/content'

export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey/new')({
  component: NewEntryPage,
})

function NewEntryPage() {
  const { siteId, collectionKey } = Route.useParams()
  const { site } = Route.useRouteContext()

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
  })

  const collection = collectionsQuery.data?.find((item) => item.key === collectionKey)

  if (collectionsQuery.isLoading) {
    return <Skeleton className="h-96 w-full" />
  }

  if (!collection) {
    return <EmptyState title="Collection not found" />
  }

  return (
    <EntryEditor
      siteId={siteId}
      collectionKey={collectionKey}
      collectionLabel={collection.label}
      fields={(collection.fields ?? []) as Field[]}
      organizationId={site.organizationId}
    />
  )
}
