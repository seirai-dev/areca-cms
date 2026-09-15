import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react'

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
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import type { EntryData, Field } from '#/lib/types'
import { getEntryFn, listEntriesFn } from '#/server/fn/content'

import { queryKeys } from '../query-keys'
import { entryTitle } from '../utils'

type EntryRow = {
  id: string
  slug: string
  draftData: EntryData
}

const PAGE = 50

export function ReferenceFieldInput({
  siteId,
  field,
  value,
  onChange,
}: {
  siteId: string
  field: Field
  value: unknown
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 200)
  const collectionKey = field.collection ?? ''
  const selectedId = typeof value === 'string' && value ? value : ''

  // Server-side search so large collections stay usable.
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

  // Resolve the selected entry's title even when it is not in the current page.
  const selectedQuery = useQuery({
    queryKey: queryKeys.entry(selectedId),
    queryFn: () => getEntryFn({ data: { id: selectedId } }),
    enabled: Boolean(selectedId) && !inList,
  })
  const selected = inList ?? selectedQuery.data

  const label = selected
    ? entryTitle(selected.draftData, [], selected.slug)
    : selectedId
      ? selectedQuery.isError
        ? 'Entry no longer exists'
        : 'Loading…'
      : 'Select an entry…'

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="min-w-0 flex-1 justify-between font-normal"
          >
            <span
              className={
                selectedId ? 'truncate' : 'truncate text-muted-foreground'
              }
            >
              {label}
            </span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search entries…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {entriesQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading…
                </div>
              ) : entriesQuery.isError ? (
                <div className="py-6 text-center text-sm text-destructive">
                  Could not load entries.
                </div>
              ) : (
                <>
                  <CommandEmpty>No entries found.</CommandEmpty>
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
                          className={
                            item.id === selectedId ? 'opacity-100' : 'opacity-0'
                          }
                        />
                        <span className="truncate">
                          {entryTitle(item.draftData, [], item.slug)}
                        </span>
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {item.slug}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {total > items.length ? (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                      Showing {items.length} of {total}. Type to narrow the
                      list.
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
          variant="ghost"
          size="icon-sm"
          aria-label="Clear selection"
          title="Clear selection"
          onClick={() => onChange('')}
        >
          <X />
        </Button>
      ) : null}
    </div>
  )
}
