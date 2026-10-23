import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowSquareOut,
  ArrowUUpLeft,
  CheckCircle,
  DotsThree,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react'

import { queryKeys } from '#/lib/content/query-keys'
import { UserAvatar } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { RelativeTime } from '#/components/ui/timeline'
import { editorPublishReason } from '#/features/golive/golive-tray'
import { isEditedSinceReady } from '#/features/golive/entry-live-state'
import type { LiveMembership } from '#/features/golive/entry-live-state'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { EntryCover, EntryThumb } from './entry-cover'
import { EntryPill } from './entry-pill'
import { LocaleChips } from './locale-chips'
import type { LocaleCoverage } from './entry-coverage'
import type { BulkAction, EntryRow } from './use-collection-entries'

export type EntryItemProps = {
  siteId: string
  collectionKey: string
  row: EntryRow
  title: string
  coverAssetId: string | undefined
  live: LiveMembership
  canManage: boolean
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onAction: (action: BulkAction, row: EntryRow) => void
  muted?: boolean
  /** Language coverage chips; only on multilingual sites. */
  coverage?: LocaleCoverage[]
}

/** Shared-element name: the card/row title morphs into the editor title. */
export function entryTransitionName(id: string) {
  return `entry-${id}`
}

/**
 * Seed the editor's entry query from the list row so the editor can paint
 * its title at once (which is what lets the view transition morph). The
 * editor still refetches the full record.
 */
function useSeedEntry(row: EntryRow, collectionKey: string) {
  const queryClient = useQueryClient()
  return React.useCallback(() => {
    const key = queryKeys.entry(row.id)
    if (queryClient.getQueryData(key)) return
    queryClient.setQueryData(key, { ...row, collectionKey }, { updatedAt: 1 })
  }, [queryClient, row, collectionKey])
}

function EditorLink({
  siteId,
  collectionKey,
  row,
  className,
  children,
  onSeed,
}: {
  siteId: string
  collectionKey: string
  row: EntryRow
  className?: string
  children: React.ReactNode
  onSeed: () => void
}) {
  return (
    <Link
      to="/sites/$siteId/c/$collectionKey/$entryId"
      params={{ siteId, collectionKey, entryId: row.id }}
      viewTransition
      onClick={onSeed}
      className={className}
    >
      {children}
    </Link>
  )
}

/** The ⋯ quick menu of a card or row. */
function EntryQuickMenu({
  siteId,
  collectionKey,
  row,
  title,
  canManage,
  onAction,
  className,
}: {
  siteId: string
  collectionKey: string
  row: EntryRow
  title: string
  canManage: boolean
  onAction: (action: BulkAction, row: EntryRow) => void
  className?: string
}) {
  const markable =
    row.status !== 'published' ||
    isEditedSinceReady({
      status: row.status,
      updatedAt: row.updatedAt,
      draftData: row.draftData,
      publishedData: row.publishedData,
    })
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          aria-label={m.editor_actions_for({ title })}
          data-testid="entry-quick-menu"
          className={className}
          onClick={(event) => event.stopPropagation()}
        >
          <DotsThree weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link
            to="/sites/$siteId/c/$collectionKey/$entryId"
            params={{ siteId, collectionKey, entryId: row.id }}
          >
            <PencilSimple />
            {m.collection_open()}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={`/sites/${siteId}/c/${collectionKey}/${row.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <ArrowSquareOut />
            {m.editor_open_in_new_tab()}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {markable ? (
          <DropdownMenuItem
            disabled={!canManage}
            onSelect={() => onAction('ready', row)}
          >
            <CheckCircle />
            {m.collection_mark_ready()}
          </DropdownMenuItem>
        ) : null}
        {row.status === 'published' ? (
          <DropdownMenuItem
            disabled={!canManage}
            onSelect={() => onAction('draft', row)}
          >
            <ArrowUUpLeft />
            {m.collection_move_to_draft()}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          variant="destructive"
          className="data-[disabled]:text-text-disabled! data-[disabled]:*:[svg]:text-text-disabled!"
          disabled={!canManage}
          onSelect={() => onAction('delete', row)}
        >
          <Trash />
          {m.editor_delete_ellipsis()}
        </DropdownMenuItem>
        {canManage ? null : (
          <DropdownMenuLabel className="max-w-56 pt-2 text-caption font-normal whitespace-normal text-text-muted">
            {editorPublishReason()}
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SelectBox({
  selected,
  title,
  onToggle,
  className,
}: {
  selected: boolean
  title: string
  onToggle: () => void
  className?: string
}) {
  return (
    <Checkbox
      checked={selected}
      aria-label={m.editor_select_entry({ title })}
      onCheckedChange={onToggle}
      onClick={(event) => event.stopPropagation()}
      className={className}
    />
  )
}

function Author({ name }: { name: string | null | undefined }) {
  // An author is only missing once their account has been deleted.
  const label = name?.trim() || m.people_deleted_user()
  return <UserAvatar name={label} size="xs" title={label} />
}

/** Card view item (brief §3.4): cover, two-line title, pill, edited time. */
export function EntryCard(props: EntryItemProps) {
  const {
    siteId,
    collectionKey,
    row,
    title,
    coverAssetId,
    live,
    canManage,
    selectMode,
    selected,
    onToggleSelect,
    onAction,
    muted,
    coverage,
  } = props
  const seed = useSeedEntry(row, collectionKey)

  const body = (
    <>
      <EntryCover assetId={coverAssetId} title={title} />
      <div className="grid gap-3 px-4 pt-3.5 pb-4">
        <h3
          className="line-clamp-2 min-h-10 text-[15px] leading-5 font-semibold tracking-[-0.006em] text-balance text-text-primary"
          style={{ viewTransitionName: entryTransitionName(row.id) }}
        >
          {title}
        </h3>
        {coverage ? <LocaleChips coverage={coverage} /> : null}
        <div className="flex items-center justify-between gap-2">
          <EntryPill entry={row} live={live} size="sm" testId="entry-status" />
          <span className="flex min-w-0 items-center gap-1.5 text-caption font-normal text-text-muted">
            <span className="truncate">
              {m.collection_edited()} <RelativeTime value={row.updatedAt} />
            </span>
            <Author name={row.updatedByName} />
          </span>
        </div>
      </div>
    </>
  )

  return (
    <article
      data-testid={`entry-${row.slug}`}
      data-entry-id={row.id}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'group relative overflow-hidden surface-card',
        'transition-[transform,box-shadow,border-color] duration-200 ease-(--ease-standard)',
        'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raise motion-reduce:hover:translate-y-0',
        'focus-within:border-border-strong',
        selected &&
          'border-accent shadow-[0_0_0_1.5px_var(--color-accent)] hover:border-accent',
        muted && 'opacity-75',
      )}
    >
      {selectMode ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={m.editor_select_entry({ title })}
          onClick={onToggleSelect}
          className="block w-full text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
        >
          {body}
        </button>
      ) : (
        <EditorLink
          siteId={siteId}
          collectionKey={collectionKey}
          row={row}
          onSeed={seed}
          className="block outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
        >
          {body}
        </EditorLink>
      )}
      {selectMode ? (
        <span className="pointer-events-none absolute top-2.5 left-2.5 grid size-7 place-content-center rounded-full bg-background-elevated/90 shadow-card backdrop-blur">
          <SelectBox
            selected={selected}
            title={title}
            onToggle={onToggleSelect}
            className="pointer-events-auto"
          />
        </span>
      ) : (
        <EntryQuickMenu
          siteId={siteId}
          collectionKey={collectionKey}
          row={row}
          title={title}
          canManage={canManage}
          onAction={onAction}
          className={cn(
            'absolute top-2 right-2 bg-background-elevated/90 shadow-card backdrop-blur-md hover:bg-background-elevated',
            'opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        />
      )}
    </article>
  )
}

/** List view item: a 56px row with no table chrome. */
export function EntryListRow(props: EntryItemProps) {
  const {
    siteId,
    collectionKey,
    row,
    title,
    coverAssetId,
    live,
    canManage,
    selectMode,
    selected,
    onToggleSelect,
    onAction,
    muted,
    coverage,
  } = props
  const seed = useSeedEntry(row, collectionKey)

  const content = (
    <>
      <EntryThumb assetId={coverAssetId} title={title} size={32} />
      <span className="grid min-w-0 flex-1 gap-px">
        <span
          className="w-fit max-w-full truncate text-[14px] leading-5 font-medium text-text-primary"
          style={{ viewTransitionName: entryTransitionName(row.id) }}
        >
          {title}
        </span>
        <span className="truncate text-mono text-text-muted">{row.slug}</span>
      </span>
    </>
  )

  return (
    <div
      role="listitem"
      data-testid={`entry-${row.slug}`}
      data-entry-id={row.id}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'group relative flex min-h-14 items-center gap-3 rounded-[12px] pr-2 transition-colors duration-150',
        'hover:bg-surface-state-hover',
        selected && 'bg-accent-soft hover:bg-accent-soft',
        muted && 'opacity-75',
      )}
    >
      {selectMode ? (
        <span className="pl-3">
          <SelectBox
            selected={selected}
            title={title}
            onToggle={onToggleSelect}
          />
        </span>
      ) : null}
      {selectMode ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={m.editor_select_entry({ title })}
          onClick={onToggleSelect}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-[12px] py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-border-focus"
        >
          {content}
        </button>
      ) : (
        <EditorLink
          siteId={siteId}
          collectionKey={collectionKey}
          row={row}
          onSeed={seed}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-[12px] py-2 pl-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-border-focus"
        >
          {content}
        </EditorLink>
      )}
      {coverage ? (
        <span className="hidden shrink-0 sm:block">
          <LocaleChips coverage={coverage} />
        </span>
      ) : null}
      <EntryPill entry={row} live={live} size="sm" testId="entry-status" />
      <span className="hidden w-24 shrink-0 text-right text-caption font-normal text-text-muted tnum md:block">
        <RelativeTime value={row.updatedAt} />
      </span>
      <span className="hidden shrink-0 sm:block">
        <Author name={row.updatedByName} />
      </span>
      {selectMode ? (
        <span className="size-[30px] shrink-0" />
      ) : (
        <EntryQuickMenu
          siteId={siteId}
          collectionKey={collectionKey}
          row={row}
          title={title}
          canManage={canManage}
          onAction={onAction}
          className="shrink-0 opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100"
        />
      )}
    </div>
  )
}
