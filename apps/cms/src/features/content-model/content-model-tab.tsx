import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CaretRight, Plus, Stack } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { errorMessage } from '#/components/admin/helpers'
import { queryKeys } from '#/components/editor/query-keys'
import { Tag } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetGroup, InsetIcon } from '#/components/ui/inset-list'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { Stagger, StaggerItem } from '#/components/ui/stagger'
import { Switch } from '#/components/ui/switch'
import { collectionIcon } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { listCollectionsFn, upsertCollectionFn } from '#/server/fn/content'

import { SchemaEditorSheet } from './schema-editor-sheet'
import type { CollectionRecord } from './schema-editor-sheet'

type ContentType = CollectionRecord & { id: string }

/**
 * Settings › Content (brief §3.10): the site's content types as one inset
 * list (icon, name, key and route whisper, field count, On/Off switch).
 * "New content type" and a row click open the schema editor sheet.
 */
export function ContentModelTab({ siteId }: { siteId: string }) {
  const navigate = useNavigate()
  const [sheet, setSheet] = React.useState<{
    collection: CollectionRecord | null
  } | null>(null)
  const [sheetOpen, setSheetOpen] = React.useState(false)

  const query = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
  })
  const collections = (query.data ?? []) as ContentType[]

  function openSheet(collection: CollectionRecord | null) {
    setSheet({ collection })
    setSheetOpen(true)
  }

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
            onClick={() => openSheet(null)}
          >
            <Plus weight="bold" />
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
          <div className="overflow-hidden surface-card" aria-busy="true">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-8 rounded-[9px]" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-6 w-10 rounded-full" />
              </div>
            ))}
          </div>
        ) : collections.length === 0 ? (
          <EmptyState
            card
            icon={<Stack weight="duotone" />}
            title={m.shell_no_content_types()}
            description={m.content_model_empty_description()}
            action={
              <Button type="button" onClick={() => openSheet(null)}>
                <Plus weight="bold" />
                {m.settings_new_content_type()}
              </Button>
            }
          />
        ) : (
          <Stagger as="ul" className="overflow-hidden surface-card">
            {collections.map((collection) => (
              <ContentTypeRow
                key={collection.id}
                siteId={siteId}
                collection={collection}
                onOpen={() => openSheet(collection)}
              />
            ))}
          </Stagger>
        )}
      </InsetGroup>

      <SchemaEditorSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        siteId={siteId}
        collection={sheet?.collection ?? null}
        initialSegment={sheet?.collection ? 'fields' : 'settings'}
        onCreated={(key) =>
          void navigate({
            to: '/sites/$siteId/c/$collectionKey',
            params: { siteId, collectionKey: key },
          })
        }
      />
    </div>
  )
}

function ContentTypeRow({
  siteId,
  collection,
  onOpen,
}: {
  siteId: string
  collection: ContentType
  onOpen: () => void
}) {
  const queryClient = useQueryClient()
  const upsert = useServerFn(upsertCollectionFn)
  const Icon = collectionIcon(collection.key, collection.label)
  const count = collection.fields.length

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      upsert({
        data: {
          siteId,
          key: collection.key,
          label: collection.label,
          routePattern: collection.routePattern,
          fields: collection.fields,
          enabled,
        },
      }),
    onMutate: async (enabled) => {
      const key = queryKeys.collections(siteId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ContentType[]>(key)
      queryClient.setQueryData<ContentType[]>(key, (list) =>
        list?.map((item) =>
          item.key === collection.key ? { ...item, enabled } : item,
        ),
      )
      return { previous }
    },
    onSuccess: (_result, enabled) =>
      toast.success(
        enabled
          ? m.content_model_turned_on({ label: collection.label })
          : m.content_model_turned_off({ label: collection.label }),
      ),
    onError: (error, _enabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.collections(siteId), context.previous)
      }
      toast.error(errorMessage(error))
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.collections(siteId) }),
  })

  return (
    <StaggerItem
      as="li"
      className="relative after:absolute after:right-0 after:bottom-0 after:left-[60px] after:h-px after:bg-border-default last:after:hidden"
    >
      <div className="flex min-h-[64px] items-center gap-3 pr-4 transition-colors duration-150 hover:bg-surface-state-hover">
        <button
          type="button"
          data-testid={`content-type-${collection.key}`}
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pl-4 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
        >
          <InsetIcon tone={collection.enabled ? 'accent' : 'neutral'}>
            <Icon weight={collection.enabled ? 'fill' : 'regular'} />
          </InsetIcon>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'truncate text-[14px] leading-5 font-medium',
                  collection.enabled ? 'text-text-primary' : 'text-text-secondary',
                )}
              >
                {collection.label}
              </span>
              {collection.enabled ? null : (
                <Tag tone="outline">{m.shell_collection_off()}</Tag>
              )}
            </span>
            <span className="truncate text-mono text-text-muted">
              {collection.key} · {collection.routePattern}
            </span>
          </span>
          <span className="hidden shrink-0 text-callout text-text-secondary tnum sm:inline">
            {count === 1
              ? m.settings_field_count_one({ count })
              : m.settings_field_count_other({ count })}
          </span>
          <CaretRight
            weight="bold"
            className="hidden size-3.5 shrink-0 text-icon-muted sm:block"
          />
        </button>
        <Switch
          checked={collection.enabled}
          disabled={toggle.isPending}
          onCheckedChange={(value) => toggle.mutate(value)}
          aria-label={m.content_model_enabled_label({ label: collection.label })}
          title={
            collection.enabled
              ? m.content_model_switch_off_hint()
              : m.content_model_switch_on_hint()
          }
          data-testid={`content-type-enabled-${collection.key}`}
        />
      </div>
    </StaggerItem>
  )
}
