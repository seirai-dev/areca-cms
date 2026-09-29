// LEGACY (phase 1 bridge): replaced in phase 2
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { DotsThree, Prohibit, Sliders, Stack } from '@phosphor-icons/react'

import { CollectionDrawer } from '#/components/content/collection-drawer'
import { EntriesPane } from '#/components/content/entries-pane'
import { queryKeys } from '#/components/editor/query-keys'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { EmptyState } from '#/components/ui/empty-state'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { canManageSite } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import { listCollectionsFn } from '#/server/fn/content'
import type { Me } from '#/server/fn/me'

/**
 * The collection screen for phase 1: the existing entries pane (filters,
 * search, table, bulk actions) without the old collections rail; the sidebar
 * lists collections now. Admins get "Edit structure" in a ⋯ menu.
 */
export function LegacyCollection({
  me,
  site,
  collectionKey,
}: {
  me: Me
  site: MeSite
  collectionKey: string
}) {
  const isAdmin = me.user.isAgencyAdmin
  const navigate = useNavigate()
  const [drawer, setDrawer] = React.useState<'fields' | 'settings' | null>(null)

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(site.id),
    queryFn: () => listCollectionsFn({ data: { siteId: site.id } }),
  })
  const collection = collectionsQuery.data?.find(
    (item) => item.key === collectionKey && (item.enabled || isAdmin),
  )

  if (collectionsQuery.isError) {
    return (
      <QueryError
        title={m.sites_collections_load_error()}
        error={collectionsQuery.error}
        onRetry={() => void collectionsQuery.refetch()}
        retrying={collectionsQuery.isFetching}
      />
    )
  }

  if (collectionsQuery.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-9 w-full max-w-md" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
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
        action={
          <Button asChild variant="secondary">
            <Link to="/sites/$siteId" params={{ siteId: site.id }}>
              {m.shell_nav_overview()}
            </Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid gap-5" data-testid="collection-page" data-ready="true">
      {!collection.enabled ? (
        <div
          role="status"
          data-testid="collection-disabled"
          className="flex items-start gap-3 rounded-card border border-border-default bg-status-warning-bg px-4 py-3 text-callout text-text-primary"
        >
          <Prohibit className="mt-0.5 size-4 shrink-0 text-icon-warning" />
          {m.collection_disabled_banner()}
        </div>
      ) : null}
      <EntriesPane
        key={collection.key}
        siteId={site.id}
        collection={collection}
        canManage={canManageSite(me, site.organizationId)}
        headerActions={
          isAdmin ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label={m.collection_more_actions()}
                  data-testid="collection-menu"
                >
                  <DotsThree weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDrawer('fields')}>
                  <Sliders />
                  {m.shell_edit_structure()}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDrawer('settings')}>
                  <Stack />
                  {m.collection_settings()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
      {isAdmin ? (
        <CollectionDrawer
          open={drawer !== null}
          onOpenChange={(open) => {
            if (!open) setDrawer(null)
          }}
          siteId={site.id}
          collection={collection}
          initialSegment={drawer ?? 'fields'}
          onDeleted={() =>
            void navigate({ to: '/sites/$siteId', params: { siteId: site.id } })
          }
        />
      ) : null}
    </div>
  )
}
