import * as React from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CaretUpDown, Check, LinkSimple, X } from '@phosphor-icons/react'

import { queryKeys } from '#/lib/content/query-keys'
import { entryTitle } from '#/lib/content/utils'
import { Button } from '#/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { SpinnerRing } from '#/components/ui/status-pill'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import type { EntryData, Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import {
  getEntryFn,
  listCollectionsFn,
  listEntriesFn,
} from '#/server/fn/content'

type EntryRow = {
  id: string
  slug: string
  draftData: EntryData
}

const PAGE = 50

/**
 * Reference field (brief §3.5): a searchable picker of entries in the target
 * collection, server-side search so large collections stay usable. Shows the
 * chosen entry's title even when it is not in the current page.
 */
export function ReferencePicker({
  id,
  siteId,
  field,
  value,
  onChange,
  invalid,
}: {
  id: string
  siteId: string
  field: Field
  value: unknown
  onChange: (value: string) => void
  invalid?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const debouncedSearch = useDebouncedValue(search, 200)
  const collectionKey = field.collection ?? ''
  const selectedId = typeof value === 'string' && value ? value : ''
  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
    staleTime: 60_000,
  })
  const targetFields: Field[] =
    collectionsQuery.data?.find((item) => item.key === collectionKey)?.fields ??
    []

  const entriesQuery = useQuery({
    queryKey: queryKeys.entries(siteId, collectionKey, {
      search: debouncedSearch,
      status: 'reference',
    }),
    queryFn: () =>
      listEntriesFn({
        data: {
          siteId,
          collectionKey,
          search: debouncedSearch || undefined,
          limit: PAGE,
          offset: 0,
        },
      }),
    enabled: Boolean(collectionKey) && open,
    placeholderData: keepPreviousData,
  })

  const items = (entriesQuery.data?.items ?? []) as EntryRow[]
  const total = entriesQuery.data?.total ?? 0
  const inList = items.find((item) => item.id === selectedId)

  const selectedQuery = useQuery({
    queryKey: queryKeys.entry(selectedId),
    queryFn: () => getEntryFn({ data: { id: selectedId } }),
    enabled: Boolean(selectedId) && !inList,
  })
  const selected = inList ?? selectedQuery.data

  const label = selected
    ? entryTitle(selected.draftData, targetFields, selected.slug)
    : selectedId
      ? selectedQuery.isError
        ? m.editor_entry_no_longer_exists()
        : m.editor_loading()
      : m.editor_select_an_entry()

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            className="h-9 min-w-0 flex-1 justify-between px-3 font-normal shadow-none"
            data-testid="reference-picker"
          >
            <span className="flex min-w-0 items-center gap-2">
              <LinkSimple
                className={cn(
                  'size-4 shrink-0',
                  selectedId ? 'text-icon-accent' : 'text-icon-muted',
                )}
              />
              <span
                className={cn(
                  'truncate',
                  selectedId ? 'text-text-primary' : 'text-text-muted',
                )}
              >
                {label}
              </span>
            </span>
            <CaretUpDown className="text-icon-muted" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) min-w-72 p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={m.editor_search_entries_placeholder()}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {entriesQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-callout text-text-muted">
                  <SpinnerRing />
                  {m.editor_loading()}
                </div>
              ) : entriesQuery.isError ? (
                <div className="py-6 text-center text-callout text-text-error">
                  {m.editor_could_not_load_entries_period()}
                </div>
              ) : (
                <>
                  <CommandEmpty>{m.editor_no_entries_found()}</CommandEmpty>
                  <CommandGroup>
                    {items.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        onSelect={() => {
                          onChange(item.id)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            'text-icon-accent',
                            item.id === selectedId
                              ? 'opacity-100'
                              : 'opacity-0',
                          )}
                        />
                        <span className="truncate">
                          {entryTitle(item.draftData, targetFields, item.slug)}
                        </span>
                        <span className="ml-auto truncate text-mono text-text-muted">
                          {item.slug}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {total > items.length ? (
                    <p className="border-t border-border-default px-3 py-2 text-caption font-normal text-text-muted">
                      {m.editor_showing_of_total({
                        shown: items.length,
                        total,
                      })}
                    </p>
                  ) : null}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedId ? (
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          aria-label={m.editor_clear_selection()}
          title={m.editor_clear_selection()}
          onClick={() => onChange('')}
        >
          <X />
        </Button>
      ) : null}
    </div>
  )
}
