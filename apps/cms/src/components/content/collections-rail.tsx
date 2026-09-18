import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'

import { EntityIcon } from '#/components/entity-icon'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import {
  DotsThree,
  Gear,
  PencilSimple,
  Plus,
  Stack,
  Trash,
} from '@phosphor-icons/react'

export type RailCollection = {
  key: string
  label: string
  routePattern: string
  enabled: boolean
  /** Entry count; `undefined` while it loads. */
  count?: number
}

/** Shown when the rail has more than this many rows. */
const FILTER_THRESHOLD = 8

export function CollectionsRail({
  siteId,
  collections,
  selectedKey,
  loading,
  canManage,
  filter,
  onFilterChange,
  onAdd,
  onConfigure,
  onSettings,
  onDelete,
}: {
  siteId: string
  collections: RailCollection[]
  selectedKey?: string
  loading?: boolean
  canManage: boolean
  filter: string
  onFilterChange: (value: string) => void
  onAdd: () => void
  onConfigure: (key: string) => void
  onSettings: (key: string) => void
  onDelete: (key: string) => void
}) {
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  // A row that animates its position while its menu is open keeps the menu
  // moving with it, so the row freezes while the menu is up.
  const [menuOpenKey, setMenuOpenKey] = useState<string | undefined>()
  const showFilter = collections.length > FILTER_THRESHOLD || filter !== ''

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-ds-heading-6 text-text-primary">
          {m.sites_collections()}
        </h2>
        <span className="tnum text-ds-mono-xs text-text-muted">
          {collections.length}
        </span>
        {canManage ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            data-testid="add-collection"
            aria-label={m.sites_add_collection()}
            title={m.sites_add_collection()}
            onClick={onAdd}
          >
            <Plus />
          </Button>
        ) : null}
      </div>

      {showFilter ? (
        <Input
          type="search"
          aria-label={m.sites_search_collections()}
          placeholder={m.sites_search_collections()}
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      ) : null}

      {/* Mobile: the rail collapses into a selector above the entries pane. */}
      <div className="lg:hidden">
        <Select
          value={selectedKey}
          onValueChange={(value) =>
            navigate({
              to: '/sites/$siteId/c/$collectionKey',
              params: { siteId, collectionKey: value },
            })
          }
        >
          <SelectTrigger
            className="w-full"
            aria-label={m.content_choose_collection()}
          >
            <SelectValue placeholder={m.content_choose_collection()} />
          </SelectTrigger>
          <SelectContent>
            {collections.map((collection) => (
              <SelectItem key={collection.key} value={collection.key}>
                {collection.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="hidden flex-col gap-0.5 lg:flex">
        {loading
          ? Array.from({ length: 4 }, (_, index) => (
              <li key={index} className="px-2 py-2">
                <Skeleton className="h-9 w-full" />
              </li>
            ))
          : collections.map((collection) => {
              const selected = collection.key === selectedKey
              return (
                <motion.li
                  key={collection.key}
                  layout={
                    reduceMotion || menuOpenKey !== undefined
                      ? false
                      : 'position'
                  }
                  transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                  data-testid={`collection-${collection.key}`}
                  data-selected={selected ? 'true' : undefined}
                  className={cn(
                    'group relative flex items-center gap-2 rounded-control py-1.5 pr-1 pl-3',
                    'transition-colors duration-[120ms] ease-(--motion-ease-standard)',
                    selected
                      ? 'bg-surface-state-hover'
                      : 'hover:bg-surface-state-hover',
                  )}
                >
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-action-primary"
                    />
                  ) : null}
                  <EntityIcon
                    icon={Stack}
                    size="sm"
                    tone={collection.enabled ? 'brand' : 'muted'}
                  />
                  <Link
                    to="/sites/$siteId/c/$collectionKey"
                    params={{ siteId, collectionKey: collection.key }}
                    className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
                  >
                    <span
                      className={cn(
                        'block truncate text-ds-label-md',
                        collection.enabled
                          ? 'text-text-primary'
                          : 'text-text-disabled',
                      )}
                    >
                      {collection.label}
                    </span>
                    <span className="block truncate text-ds-mono-xs text-text-muted">
                      {collection.routePattern}
                    </span>
                  </Link>
                  {!collection.enabled ? (
                    <span className="relative shrink-0 text-ds-mono-caps text-text-muted">
                      {m.sites_disabled()}
                    </span>
                  ) : (
                    <span className="tnum relative shrink-0 text-ds-mono-xs text-text-muted">
                      {typeof collection.count === 'number'
                        ? collection.count
                        : ''}
                    </span>
                  )}
                  <Link
                    to="/sites/$siteId/c/$collectionKey"
                    params={{ siteId, collectionKey: collection.key }}
                    className={cn(
                      'relative shrink-0 rounded-control px-2 py-1 text-ds-label-sm text-text-secondary opacity-0',
                      'transition-opacity duration-[120ms] hover:bg-surface-state-pressed hover:text-text-primary',
                      'group-hover:opacity-100 focus-visible:opacity-100',
                    )}
                  >
                    {m.sites_open()}
                  </Link>
                  {canManage ? (
                    <DropdownMenu
                      onOpenChange={(open) =>
                        setMenuOpenKey(open ? collection.key : undefined)
                      }
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="relative shrink-0"
                          aria-label={m.sites_actions()}
                          data-testid="collection-menu"
                        >
                          <DotsThree />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => onConfigure(collection.key)}
                        >
                          <PencilSimple />
                          {m.content_configure_fields()}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => onSettings(collection.key)}
                        >
                          <Gear />
                          {m.shell_nav_settings()}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onDelete(collection.key)}
                        >
                          <Trash />
                          {m.sites_delete()}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </motion.li>
              )
            })}
      </ul>
    </div>
  )
}
