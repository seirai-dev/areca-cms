import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import type { EntryData, Field } from '#/lib/types'
import { listEntriesFn } from '#/server/fn/content'

import { queryKeys } from '../query-keys'
import { entryTitle } from '../utils'

type EntryRow = {
  id: string
  slug: string
  draftData: EntryData
}

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
  const collectionKey = field.collection ?? ''

  const entriesQuery = useQuery({
    queryKey: queryKeys.entries(siteId, collectionKey, { search: 'ref' }),
    queryFn: () =>
      listEntriesFn({
        data: { siteId, collectionKey, limit: 100, offset: 0 },
      }),
    enabled: Boolean(collectionKey),
  })

  const items = ((entriesQuery.data?.items ?? []) as EntryRow[]).filter(
    (item) => item,
  )
  const selected = items.find((item) => item.id === value)
  const label = selected
    ? entryTitle(selected.draftData ?? {}, [], selected.slug)
    : typeof value === 'string' && value
      ? value
      : 'Select entry…'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search entries…" />
          <CommandList>
            <CommandEmpty>No entries found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none"
                onSelect={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                None
              </CommandItem>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.slug} ${item.id}`}
                  onSelect={() => {
                    onChange(item.id)
                    setOpen(false)
                  }}
                >
                  <Check className={item.id === value ? 'opacity-100' : 'opacity-0'} />
                  {entryTitle(item.draftData ?? {}, [], item.slug)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
