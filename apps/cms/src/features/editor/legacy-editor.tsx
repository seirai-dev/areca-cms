// LEGACY (phase 1 bridge): replaced in phase 2
import { useQuery } from '@tanstack/react-query'
import { Stack } from '@phosphor-icons/react'

import { EntryEditor } from '#/components/editor/entry-editor'
import { queryKeys } from '#/components/editor/query-keys'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { canManageSite } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import { listCollectionsFn } from '#/server/fn/content'
import type { Me } from '#/server/fn/me'

/**
 * The existing entry editor, rendered in the new focus-mode frame (no
 * sidebar). Omit `entryId` for a new entry.
 */
export function LegacyEditor({
  me,
  site,
  collectionKey,
  entryId,
}: {
  me: Me
  site: MeSite
  collectionKey: string
  entryId?: string
}) {
  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(site.id),
    queryFn: () => listCollectionsFn({ data: { siteId: site.id } }),
  })

  const collection = collectionsQuery.data?.find(
    (item) => item.key === collectionKey,
  )

  if (collectionsQuery.isLoading) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-14 w-full" />
        <div className="mx-auto grid w-full max-w-[760px] gap-6">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    )
  }

  if (!collection) {
    return (
      <EmptyState
        card
        icon={<Stack weight="duotone" />}
        title={m.editor_collection_not_found()}
        description={m.editor_collection_not_found_description()}
      />
    )
  }

  return (
    <EntryEditor
      siteId={site.id}
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
