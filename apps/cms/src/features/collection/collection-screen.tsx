import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArrowUUpLeft,
  CheckCircle,
  CheckSquare,
  DotsThree,
  MagnifyingGlass,
  Plus,
  Prohibit,
  Rows,
  SlidersHorizontal,
  SquaresFour,
  Stack,
  Trash,
} from '@phosphor-icons/react'

import type { EntrySummary } from '#/lib/content/entry-summary'
import { collectionsQuery as collectionsOptions } from '#/lib/content/queries'
import { useShortcut } from '#/components/shell/shortcuts'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { EmptyState } from '#/components/ui/empty-state'
import {
  FloatingBar,
  FloatingBarDivider,
  FloatingBarLabel,
} from '#/components/ui/floating-bar'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Skeleton } from '#/components/ui/skeleton'
import { Stagger, StaggerItem } from '#/components/ui/stagger'
import { Hint } from '#/components/ui/tooltip'
import { SchemaEditorSheet } from '#/features/content-model/schema-editor-sheet'
import type { SchemaSegment } from '#/features/content-model/schema-editor-sheet'
import { preloadEditorScreen } from '#/features/editor/load-editor'
import { editorPublishReason } from '#/features/golive/golive-tray'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { canManageSite, collectionIcon, singularLabel } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { isDevSite } from '#/lib/site-environment'
import type { Field } from '#/lib/types'
import { isMultilingual, nonMainLanguages } from '#/lib/site-languages'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

import {
  CollectionSearch,
  MissingLanguageFilter,
  StatusFilterControl,
} from './collection-controls'
import { EntryCard, EntryListRow } from './entry-item'
import {
  missingLanguageFilter,
  useCollectionEntries,
  useCollectionView,
  useEntryBulkActions,
} from './use-collection-entries'
import type {
  BulkAction,
  BulkTarget,
  StatusFilter,
} from './use-collection-entries'
import { BulkFailuresDialog } from './bulk-failures-dialog'

type CollectionRecord = {
  id: string
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
  requiredLanguages?: string[]
}

/**
 * Collection (brief §3.4): header with the entry count and route whisper,
 * expanding search (`/`), Cards/List (remembered), Select, the primary
 * "New"; the status filter; cards or rows; Photos-style select
 * mode with a floating action bar; "Show more" paging.
 */
export function CollectionScreen({
  me,
  site,
  collectionKey,
  missingLanguage = null,
  onMissingLanguageChange,
}: {
  me: Me
  site: MeSite
  collectionKey: string
  /** `?missing=` from the URL: "Missing translation" language tag. */
  missingLanguage?: string | null
  onMissingLanguageChange?: (value: string | null) => void
}) {
  const isAdmin = me.user.isAgencyAdmin
  const collectionsQuery = useQuery(collectionsOptions(site.id))
  const collection = (
    collectionsQuery.data as CollectionRecord[] | undefined
  )?.find((item) => item.key === collectionKey && (item.enabled || isAdmin))

  if (collectionsQuery.isError) {
    return (
      <div data-testid="site-content" data-ready="true" className="grid gap-6">
        <QueryError
          title={m.sites_collections_load_error()}
          query={collectionsQuery}
        />
      </div>
    )
  }

  if (collectionsQuery.isLoading) {
    return <CollectionSkeleton />
  }

  if (!collection) {
    return (
      <div data-testid="site-content" data-ready="true">
        <EmptyState
          card
          tone="neutral"
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
      </div>
    )
  }

  return (
    <CollectionView
      key={collection.key}
      me={me}
      site={site}
      collection={collection}
      missingLanguage={missingLanguage}
      onMissingLanguageChange={onMissingLanguageChange}
    />
  )
}

function CollectionView({
  me,
  site,
  collection,
  missingLanguage,
  onMissingLanguageChange,
}: {
  me: Me
  site: MeSite
  collection: CollectionRecord
  missingLanguage: string | null
  onMissingLanguageChange?: (value: string | null) => void
}) {
  const navigate = useNavigate()
  const siteId = site.id
  const isAdmin = me.user.isAgencyAdmin
  const canManage = canManageSite(me, site.organizationId)
  const imageField = collection.fields.find((field) => field.type === 'image')
  const release = useReleaseStatus(siteId)
  const live = release.liveMembership
  const devSite = isDevSite(site)

  const [status, setStatus] = React.useState<StatusFilter>('all')
  const [searchInput, setSearchInput] = React.useState('')
  const search = useDebouncedValue(searchInput.trim(), 250)
  const [view, setView] = useCollectionView(
    siteId,
    collection.key,
    imageField ? 'cards' : 'list',
  )
  const [selectMode, setSelectMode] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = React.useState<string[] | null>(
    null,
  )
  const [sheet, setSheet] = React.useState<SchemaSegment | null>(null)

  // Coverage chips and the "Missing translation" filter exist only on a
  // multilingual site; a stale `?missing=` is ignored.
  const languages = site.languages ?? null
  const multilingual = isMultilingual(languages)
  const missingFilter = missingLanguageFilter(languages, missingLanguage)

  const { query, rows, total } = useCollectionEntries({
    siteId,
    collectionKey: collection.key,
    status,
    search,
    missingLanguage: missingFilter,
  })
  // Failed entries stay selected (so they can be retried); the rest clear.
  const bulk = useEntryBulkActions(siteId, collection.key, {
    onResult: (result) =>
      setSelected(new Set(result.failed.map((item) => item.id))),
  })

  const filtersActive =
    status !== 'all' || search !== '' || missingFilter !== undefined
  const singular = singularLabel(collection.label)
  const plural = collection.label.toLocaleLowerCase()
  const selectedRows = rows.filter((row) => selected.has(row.id))

  // `n` inside a collection: the shell navigates to New; a turned-off
  // collection overrides it with nothing (no new entries there).
  useShortcut('n', () => undefined, { enabled: !collection.enabled })
  useShortcut(
    'escape',
    () => {
      setSelectMode(false)
      setSelected(new Set())
    },
    { enabled: selectMode },
  )

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelect() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function targetsFor(ids: string[]): BulkTarget[] {
    return ids.map((id) => {
      const row = rows.find((item) => item.id === id)
      return {
        id,
        title: row ? row.title : m.editor_untitled(),
        slug: row?.slug ?? '',
      }
    })
  }

  function runAction(action: BulkAction, ids: string[]) {
    if (ids.length === 0) return
    if (action === 'delete') {
      setConfirmDelete(ids)
      return
    }
    bulk.mutate({ action, targets: targetsFor(ids) })
  }

  function onItemAction(action: BulkAction, row: EntrySummary) {
    runAction(action, [row.id])
  }

  const newEntry = collection.enabled ? (
    <Button asChild data-testid="new-entry">
      <Link
        to="/sites/$siteId/c/$collectionKey/new"
        params={{ siteId, collectionKey: collection.key }}
        onPointerEnter={preloadEditorScreen}
        onFocus={preloadEditorScreen}
      >
        <Plus weight="bold" />
        {m.shell_new()}
      </Link>
    </Button>
  ) : null

  const countLine =
    total === undefined
      ? null
      : total === 1
        ? m.collection_entry_count_one({ count: total })
        : m.collection_entry_count_other({ count: total })

  const ready = !query.isLoading
  const Icon = collectionIcon(collection.key, collection.label)
  const markableIds = selectedRows.map((row) => row.id)
  const draftableIds = selectedRows
    .filter((row) => row.status === 'published')
    .map((row) => row.id)

  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-6 pb-24"
      data-testid="site-content"
      data-ready={ready ? 'true' : 'false'}
      data-collection={collection.key}
    >
      <PageHeader
        title={collection.label}
        meta={
          <span className="inline-flex items-center gap-1.5">
            <Icon aria-hidden="true" className="size-3.5 text-icon-muted" />
            {countLine ? <span className="tnum">{countLine}</span> : null}
            {countLine ? <span aria-hidden="true">·</span> : null}
            <span className="font-mono">{collection.routePattern}</span>
          </span>
        }
        actions={
          <>
            <CollectionSearch
              value={searchInput}
              onChange={setSearchInput}
              label={m.collection_search({ name: plural })}
            />
            <SegmentedControl
              iconOnly
              aria-label={m.collection_view()}
              value={view}
              onValueChange={setView}
              data-testid="view-toggle"
              options={[
                {
                  value: 'cards',
                  label: m.collection_view_cards(),
                  ariaLabel: m.collection_view_cards(),
                  icon: <SquaresFour />,
                  testId: 'view-cards',
                },
                {
                  value: 'list',
                  label: m.collection_view_list(),
                  ariaLabel: m.collection_view_list(),
                  icon: <Rows />,
                  testId: 'view-list',
                },
              ]}
            />
            <Button
              type="button"
              variant={selectMode ? 'secondary' : 'quiet'}
              aria-pressed={selectMode}
              data-testid="select-mode"
              className="max-sm:w-9 max-sm:px-0"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              disabled={rows.length === 0}
            >
              <CheckSquare />
              <span className="sr-only sm:not-sr-only">
                {selectMode ? m.collection_done() : m.collection_select()}
              </span>
            </Button>
            {isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="quiet"
                    size="icon"
                    aria-label={m.collection_more_actions()}
                    data-testid="collection-menu"
                  >
                    <DotsThree weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onSelect={() => setSheet('fields')}
                    data-testid="edit-structure"
                  >
                    <SlidersHorizontal />
                    {m.shell_edit_structure()}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setSheet('settings')}
                    data-testid="collection-settings"
                  >
                    <Stack />
                    {m.collection_settings()}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {newEntry}
          </>
        }
      />

      {!collection.enabled ? (
        <div
          role="status"
          data-testid="collection-disabled"
          className="flex items-start gap-3 rounded-card border border-border-default bg-status-warning-bg px-4 py-3.5 text-[14px] leading-5 text-text-primary"
        >
          <Prohibit className="mt-0.5 size-4 shrink-0 text-icon-warning" />
          <span className="grid gap-1">
            <span>{m.collection_disabled_banner()}</span>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => setSheet('settings')}
                className="w-fit text-callout font-medium text-text-accent hover:underline"
              >
                {m.collection_disabled_manage()}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}

      {multilingual ? (
        <div className="flex flex-wrap items-center gap-3">
          <StatusFilterControl
            value={status}
            devSite={devSite}
            onChange={(next) => {
              setStatus(next)
              setSelected(new Set())
            }}
          />
          <MissingLanguageFilter
            value={missingFilter ?? null}
            languages={nonMainLanguages(languages)}
            onChange={(next) => {
              onMissingLanguageChange?.(next)
              setSelected(new Set())
            }}
          />
        </div>
      ) : (
        <StatusFilterControl
          value={status}
          devSite={devSite}
          onChange={(next) => {
            setStatus(next)
            setSelected(new Set())
          }}
        />
      )}

      {query.isError ? (
        <QueryError title={m.editor_could_not_load_entries()} query={query} />
      ) : query.isLoading ? (
        <EntriesSkeleton view={view} />
      ) : rows.length === 0 ? (
        filtersActive ? (
          <EmptyState
            card
            tone="neutral"
            icon={<MagnifyingGlass weight="duotone" />}
            title={m.collection_nothing_matches()}
            description={
              search
                ? m.collection_nothing_matches_description()
                : missingFilter && status === 'all'
                  ? m.coverage_nothing_missing()
                  : m.collection_nothing_matches_status()
            }
            data-testid="collection-empty-filtered"
            action={
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStatus('all')
                  setSearchInput('')
                  onMissingLanguageChange?.(null)
                }}
              >
                {m.editor_clear_filters()}
              </Button>
            }
          />
        ) : (
          <EmptyState
            card
            icon={<Icon weight="duotone" />}
            title={m.collection_empty_title({ name: plural })}
            description={
              collection.enabled
                ? m.collection_empty_description()
                : m.collection_empty_disabled()
            }
            data-testid="collection-empty"
            action={
              collection.enabled ? (
                <Button asChild>
                  <Link
                    to="/sites/$siteId/c/$collectionKey/new"
                    params={{ siteId, collectionKey: collection.key }}
                    onPointerEnter={preloadEditorScreen}
                    onFocus={preloadEditorScreen}
                  >
                    <Plus weight="bold" />
                    {singular
                      ? m.collection_write_first({
                          name: singular.toLocaleLowerCase(),
                        })
                      : m.collection_write_first_entry()}
                  </Link>
                </Button>
              ) : null
            }
          />
        )
      ) : (
        <div
          className={cn(
            'grid min-w-0 gap-5 transition-opacity duration-150',
            query.isFetching && !query.isFetchingNextPage && 'opacity-70',
          )}
          aria-busy={query.isFetching}
        >
          {view === 'cards' ? (
            <Stagger
              key={`cards-${status}-${search}-${missingFilter ?? ''}`}
              className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3"
              aria-label={m.editor_entries_caption({ name: collection.label })}
              role="list"
            >
              {rows.map((row) => (
                <StaggerItem key={row.id} role="listitem" className="min-w-0">
                  <EntryCard
                    siteId={siteId}
                    collectionKey={collection.key}
                    row={row}
                    title={row.title}
                    coverAssetId={row.cover ?? undefined}
                    live={live}
                    devSite={devSite}
                    canManage={canManage}
                    selectMode={selectMode}
                    selected={selected.has(row.id)}
                    onToggleSelect={() => toggle(row.id)}
                    onAction={onItemAction}
                    muted={!collection.enabled}
                    coverage={row.coverage ?? undefined}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          ) : (
            <Stagger
              key={`list-${status}-${search}-${missingFilter ?? ''}`}
              className="-mx-2 grid min-w-0 grid-cols-1 gap-px"
              role="list"
              aria-label={m.editor_entries_caption({ name: collection.label })}
            >
              {rows.map((row) => (
                <StaggerItem key={row.id} className="min-w-0">
                  <EntryListRow
                    siteId={siteId}
                    collectionKey={collection.key}
                    row={row}
                    title={row.title}
                    coverAssetId={row.cover ?? undefined}
                    live={live}
                    devSite={devSite}
                    canManage={canManage}
                    selectMode={selectMode}
                    selected={selected.has(row.id)}
                    onToggleSelect={() => toggle(row.id)}
                    onAction={onItemAction}
                    muted={!collection.enabled}
                    coverage={row.coverage ?? undefined}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          )}

          <div className="flex flex-col items-center gap-2 pt-2">
            {query.hasNextPage ? (
              <Button
                type="button"
                variant="secondary"
                data-testid="show-more"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {m.collection_show_more()}
              </Button>
            ) : null}
            {total !== undefined && total > 0 ? (
              <p className="text-caption font-normal text-text-muted tnum">
                {m.collection_showing({ shown: rows.length, total })}
              </p>
            ) : null}
          </div>
        </div>
      )}

      <FloatingBar
        open={selectMode}
        label={m.collection_selection_actions()}
        data-testid="bulk-actions"
      >
        <FloatingBarLabel>
          {selected.size === 0
            ? m.collection_select_hint()
            : m.editor_selected_count({ count: selected.size })}
        </FloatingBarLabel>
        <BulkButton
          canManage={canManage}
          disabled={markableIds.length === 0 || bulk.isPending}
          onClick={() => runAction('ready', markableIds)}
          testId="bulk-ready"
          label={m.collection_mark_ready()}
        >
          <CheckCircle />
        </BulkButton>
        <BulkButton
          canManage={canManage}
          disabled={draftableIds.length === 0 || bulk.isPending}
          onClick={() => runAction('draft', draftableIds)}
          testId="bulk-draft"
          label={m.collection_move_to_draft_short()}
        >
          <ArrowUUpLeft />
        </BulkButton>
        <BulkButton
          canManage={canManage}
          disabled={selected.size === 0 || bulk.isPending}
          onClick={() => runAction('archive', [...selected])}
          testId="bulk-archive"
          label={m.collection_bulk_archive({ count: selected.size })}
        >
          <Archive />
        </BulkButton>
        <BulkButton
          canManage={canManage}
          destructive
          disabled={selected.size === 0 || bulk.isPending}
          onClick={() => runAction('delete', [...selected])}
          testId="bulk-delete"
          label={m.editor_delete()}
        >
          <Trash />
        </BulkButton>
        <FloatingBarDivider />
        <Button
          type="button"
          size="sm"
          variant="primary"
          className="rounded-full"
          onClick={exitSelect}
          data-testid="bulk-done"
        >
          {m.collection_done()}
        </Button>
      </FloatingBar>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title={
          confirmDelete?.length === 1
            ? m.editor_delete_entry_title()
            : m.editor_delete_entries_title({
                count: confirmDelete?.length ?? 0,
              })
        }
        description={
          confirmDelete?.length === 1
            ? m.editor_delete_entry_description()
            : m.editor_delete_entries_description()
        }
        confirmLabel={m.editor_delete()}
        variant="destructive"
        onConfirm={async () => {
          if (!confirmDelete) return
          // The bulk mutation shows its own error toast.
          await bulk
            .mutateAsync({
              action: 'delete',
              targets: targetsFor(confirmDelete),
            })
            .catch(() => undefined)
        }}
      />

      <BulkFailuresDialog
        details={bulk.details}
        pending={bulk.isPending}
        onClose={bulk.closeDetails}
        onRetry={bulk.retryFailed}
      />

      {isAdmin ? (
        <SchemaEditorSheet
          open={sheet !== null}
          onOpenChange={(open) => {
            if (!open) setSheet(null)
          }}
          siteId={siteId}
          collection={collection}
          initialSegment={sheet ?? 'fields'}
          onDeleted={() =>
            void navigate({ to: '/sites/$siteId', params: { siteId } })
          }
        />
      ) : null}
    </div>
  )
}

/**
 * One bulk action. Below `sm` only the icon shows, so the label is also the
 * accessible name: it is set as `aria-label` at every width.
 */
function BulkButton({
  canManage,
  destructive,
  disabled,
  onClick,
  testId,
  label,
  children,
}: {
  canManage: boolean
  destructive?: boolean
  disabled: boolean
  onClick: () => void
  testId: string
  /** The action's full name. Shown beside the icon from `sm` up. */
  label: string
  /** The icon. */
  children: React.ReactNode
}) {
  const button = (
    <Button
      type="button"
      size="sm"
      variant="quiet"
      className={cn(
        'rounded-full',
        destructive && 'text-text-error hover:text-text-error',
      )}
      disabled={!canManage || disabled}
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
  if (!canManage) {
    return (
      <Hint label={editorPublishReason()} wrapDisabled className="rounded-full">
        {button}
      </Hint>
    )
  }
  return button
}

function CollectionSkeleton() {
  return (
    <div className="grid gap-6" data-testid="site-content" data-ready="false">
      <div className="flex items-end justify-between gap-6">
        <div className="grid gap-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-3.5 w-40" />
        </div>
        <Skeleton className="h-9 w-36 rounded-control" />
      </div>
      <Skeleton className="h-9 w-[420px] max-w-full rounded-control" />
      <EntriesSkeleton view="cards" />
    </div>
  )
}

function EntriesSkeleton({ view }: { view: 'cards' | 'list' }) {
  if (view === 'list') {
    return (
      <div className="grid gap-1" aria-busy="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex h-14 items-center gap-3 px-1">
            <Skeleton className="size-8 rounded-[8px]" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div
      className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="overflow-hidden surface-card">
          <Skeleton className="aspect-[16/10] w-full rounded-none" />
          <div className="grid gap-3 p-4">
            <Skeleton className="h-4 w-4/5" />
            <div className="flex justify-between">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
