import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { queryKeys } from '#/components/editor/query-keys'
import { ReleaseStatusBar } from '#/components/editor/release-status-bar'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { canManageSite } from '#/lib/site-nav'
import type { Field } from '#/lib/types'
import type { Me } from '#/server/fn/me'
import { m } from '#/paraglide/messages'
import { listCollectionsFn, listEntriesFn } from '#/server/fn/content'
import { Plus, Stack } from '@phosphor-icons/react'

import { CollectionDrawer } from './collection-drawer'
import type { CollectionRecord } from './collection-drawer'
import { CollectionsRail } from './collections-rail'
import { EntriesPane } from './entries-pane'

type Collection = CollectionRecord & { id: string; fields: Field[] }

const EMPTY: Collection[] = []

/**
 * The Content screen. Both `/sites/$siteId` and
 * `/sites/$siteId/c/$collectionKey` render this: the first selects the first
 * collection in place so the URL stays clean, the second selects by key.
 */
export function ContentPage({
  siteId,
  organizationId,
  me,
  collectionKey,
}: {
  siteId: string
  organizationId: string
  me: Me
  /** Undefined on `/sites/$siteId`: the first collection wins. */
  collectionKey?: string
}) {
  const navigate = useNavigate()
  const canManage = canManageSite(me, organizationId)
  const isAdmin = me.user.isAgencyAdmin
  const [filter, setFilter] = useState('')
  const [drawer, setDrawer] = useState<{
    collection: Collection | null
    segment: 'fields' | 'settings'
  } | null>(null)

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
  })

  const all: Collection[] = collectionsQuery.data ?? EMPTY
  const visible = isAdmin ? all : all.filter((item) => item.enabled)
  const needle = filter.trim().toLowerCase()
  const collections = needle
    ? visible.filter(
        (item) =>
          item.label.toLowerCase().includes(needle) ||
          item.key.toLowerCase().includes(needle),
      )
    : visible

  const selected =
    (collectionKey
      ? visible.find((item) => item.key === collectionKey)
      : undefined) ?? (collectionKey ? undefined : visible[0])

  const countQueries = useQueries({
    queries: collections.map((collection) => ({
      queryKey: queryKeys.entries(siteId, collection.key, { status: 'count' }),
      queryFn: () =>
        listEntriesFn({
          data: { siteId, collectionKey: collection.key, limit: 1, offset: 0 },
        }),
    })),
  })

  const railItems = useMemo(
    () =>
      collections.map((collection, index) => ({
        key: collection.key,
        label: collection.label,
        routePattern: collection.routePattern,
        enabled: collection.enabled,
        count: countQueries[index]?.data?.total,
      })),
    [collections, countQueries.map((query) => query.data?.total).join(',')],
  )

  function openDrawer(key: string, segment: 'fields' | 'settings') {
    const collection = all.find((item) => item.key === key) ?? null
    setDrawer({ collection, segment })
  }

  return (
    <div
      className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8"
      data-testid="site-content"
      data-ready={collectionsQuery.isFetched ? 'true' : 'false'}
    >
      <aside className="lg:sticky lg:top-[calc(var(--navbar-height,58px)+3.5rem)] lg:max-h-[calc(100dvh-var(--navbar-height,58px)-5rem)] lg:self-start lg:overflow-y-auto">
        <CollectionsRail
          siteId={siteId}
          collections={railItems}
          selectedKey={selected?.key}
          loading={collectionsQuery.isLoading}
          canManage={isAdmin}
          filter={filter}
          onFilterChange={setFilter}
          onAdd={() => setDrawer({ collection: null, segment: 'settings' })}
          onConfigure={(key) => openDrawer(key, 'fields')}
          onSettings={(key) => openDrawer(key, 'settings')}
          onDelete={(key) => openDrawer(key, 'settings')}
        />
      </aside>

      <div className="flex min-w-0 flex-col gap-5" data-testid="collection-page">
        <ReleaseStatusBar siteId={siteId} canPublish={canManage} />
        {collectionsQuery.isError ? (
          <QueryError
            error={collectionsQuery.error}
            title={m.sites_collections_load_error()}
            onRetry={() => collectionsQuery.refetch()}
            retrying={collectionsQuery.isFetching}
          />
        ) : collectionsQuery.isLoading ? null : selected ? (
          <EntriesPane
            key={selected.key}
            siteId={siteId}
            collection={selected}
            canManage={canManage}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Stack weight="duotone" />}
            title={m.sites_no_collections_yet()}
            description={
              isAdmin
                ? m.sites_no_collections_admin()
                : m.sites_no_collections_member()
            }
            action={
              isAdmin ? (
                <Button
                  type="button"
                  onClick={() =>
                    setDrawer({ collection: null, segment: 'settings' })
                  }
                >
                  <Plus />
                  {m.sites_add_collection()}
                </Button>
              ) : null
            }
          />
        ) : (
          <EmptyState
            icon={<Stack weight="duotone" />}
            title={m.editor_collection_not_found()}
            description={m.editor_collection_not_found_description()}
          />
        )}
      </div>

      {isAdmin ? (
        <CollectionDrawer
          open={drawer !== null}
          onOpenChange={(open) => {
            if (!open) setDrawer(null)
          }}
          siteId={siteId}
          collection={drawer?.collection ?? null}
          initialSegment={drawer?.segment}
          onCreated={(key) =>
            void navigate({
              to: '/sites/$siteId/c/$collectionKey',
              params: { siteId, collectionKey: key },
            })
          }
          onDeleted={() =>
            void navigate({ to: '/sites/$siteId', params: { siteId } })
          }
        />
      ) : null}
    </div>
  )
}
