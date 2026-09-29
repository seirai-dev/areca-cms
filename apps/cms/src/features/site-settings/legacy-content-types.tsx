// LEGACY (phase 1 bridge): replaced in phase 2
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Stack } from '@phosphor-icons/react'

import { CollectionDrawer } from '#/components/content/collection-drawer'
import type { CollectionRecord } from '#/components/content/collection-drawer'
import { queryKeys } from '#/components/editor/query-keys'
import { Tag } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetGroup, InsetIcon, InsetList, InsetRow } from '#/components/ui/inset-list'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { collectionIcon } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import { listCollectionsFn } from '#/server/fn/content'

/**
 * Settings › Content: the site's content types. Rows and "New content type"
 * open the existing schema editor drawer (fields, settings, delete).
 */
export function LegacyContentTypes({ siteId }: { siteId: string }) {
  const [drawer, setDrawer] = React.useState<{
    collection: CollectionRecord | null
  } | null>(null)

  const query = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
  })
  const collections = query.data ?? []

  return (
    <div className="grid gap-4" data-testid="content-types">
      <InsetGroup
        title={m.settings_content_types_title()}
        description={m.settings_content_types_description()}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="new-content-type"
            onClick={() => setDrawer({ collection: null })}
          >
            <Plus />
            {m.settings_new_content_type()}
          </Button>
        }
      >
        {query.isError ? (
          <QueryError
            title={m.sites_collections_load_error()}
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : query.isLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-14 w-full rounded-card" />
            <Skeleton className="h-14 w-full rounded-card" />
          </div>
        ) : collections.length === 0 ? (
          <EmptyState
            card
            size="sm"
            icon={<Stack weight="duotone" />}
            title={m.shell_no_content_types()}
            description={m.sites_no_collections_admin()}
          />
        ) : (
          <InsetList>
            {collections.map((collection) => {
              const Icon = collectionIcon(collection.key, collection.label)
              return (
                <InsetRow
                  key={collection.id}
                  asChild
                  chevron
                  leading={
                    <InsetIcon tone={collection.enabled ? 'accent' : 'neutral'}>
                      <Icon />
                    </InsetIcon>
                  }
                  title={collection.label}
                  subtitle={
                    <span className="text-mono text-text-muted">
                      {collection.key} · {collection.routePattern}
                    </span>
                  }
                  trailing={
                    <>
                      <span className="tnum">
                        {collection.fields.length === 1
                          ? m.settings_field_count_one({ count: 1 })
                          : m.settings_field_count_other({
                              count: collection.fields.length,
                            })}
                      </span>
                      {collection.enabled ? null : (
                        <Tag tone="outline">{m.shell_collection_off()}</Tag>
                      )}
                    </>
                  }
                >
                  <button
                    type="button"
                    data-testid={`content-type-${collection.key}`}
                    onClick={() => setDrawer({ collection })}
                  />
                </InsetRow>
              )
            })}
          </InsetList>
        )}
      </InsetGroup>

      <CollectionDrawer
        open={drawer !== null}
        onOpenChange={(open) => {
          if (!open) setDrawer(null)
        }}
        siteId={siteId}
        collection={drawer?.collection ?? null}
        initialSegment={drawer?.collection ? 'fields' : 'settings'}
      />
    </div>
  )
}
