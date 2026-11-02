import * as React from 'react'
import { ArrowsClockwise, CaretUpDown } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import {
  Command,
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
import { Skeleton } from '#/components/ui/skeleton'
import { Tag } from '#/components/ui/tag'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { matchesTargetSearch } from './deployment-target-draft'

export type TargetComboboxItem = {
  /** Unique within the combobox, e.g. `pages:marketing-site`. */
  value: string
  testId: string
  name: string
  /** Mono second line: production branch or application ID. */
  detail?: string | null
  /** Primary domain, shown after the detail. */
  domain?: string | null
  /** Trailing marker on a pickable row, e.g. an application status. */
  meta?: React.ReactNode
  /** Set when the row cannot be picked. The text says why. */
  disabledReason?: string | null
  /** Extra fields the search matches (name, detail and domain always match). */
  searchFields?: (string | null | undefined)[]
}

export type TargetComboboxGroup = {
  heading: string
  items: TargetComboboxItem[]
}

/**
 * The one searchable picker for a site's deployment target (Dokploy
 * applications and Cloudflare Pages projects or Workers). A popover with a
 * search field; rows can be grouped and disabled with a reason. Refresh and
 * retry are optional.
 */
export function TargetCombobox({
  label,
  value,
  selectedLabel,
  placeholder,
  groups,
  status,
  idleMessage,
  emptyMessage,
  searchPlaceholder,
  error,
  onRetry,
  retryLabel,
  onRefresh,
  refreshing,
  refreshLabel,
  disabled,
  onSelect,
  testId,
  searchTestId,
  invalid,
}: {
  label: string
  /** The selected item's value, or null. */
  value: string | null
  /** Trigger text when something is selected. Defaults to the placeholder. */
  selectedLabel?: string | null
  placeholder: string
  groups: TargetComboboxGroup[]
  status: 'idle' | 'loading' | 'error' | 'ready'
  /** Shown in the popover when the list is not loaded and not loading. */
  idleMessage?: string
  emptyMessage: string
  searchPlaceholder: string
  /** Shown under the trigger, so the failure stays visible when closed. */
  error?: string | null
  onRetry?: () => void
  retryLabel?: string
  onRefresh?: () => void
  refreshing?: boolean
  refreshLabel?: string
  disabled?: boolean
  onSelect: (value: string) => void
  testId?: string
  searchTestId?: string
  invalid?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const visibleGroups = groups
    .map((group) => ({
      heading: group.heading,
      items: group.items.filter((item) =>
        matchesTargetSearch(query, [
          item.name,
          item.detail,
          item.domain,
          ...(item.searchFields ?? []),
        ]),
      ),
    }))
    .filter((group) => group.items.length > 0)
  const visibleCount = visibleGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  )
  const hasItems = groups.some((group) => group.items.length > 0)

  function choose(next: string) {
    setOpen(false)
    setQuery('')
    onSelect(next)
  }

  return (
    <div
      className="grid gap-2"
      data-testid={testId ? `${testId}-wrap` : undefined}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-invalid={invalid ? true : undefined}
            disabled={disabled}
            data-testid={testId}
            data-state={open ? 'open' : 'closed'}
            className={cn(
              'flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-control border bg-background-surface px-3 text-left text-[14px] text-text-primary',
              'transition-colors outline-none hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:outline-border-focus',
              'disabled:cursor-not-allowed disabled:opacity-50',
              invalid ? 'border-border-error' : 'border-border-default',
            )}
          >
            <span
              className={cn(
                'min-w-0 truncate',
                value ? 'font-medium' : 'text-text-muted',
              )}
            >
              {value ? (selectedLabel ?? placeholder) : placeholder}
            </span>
            <CaretUpDown className="size-4 shrink-0 text-icon-muted" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(calc(100vw-2rem),22rem)] p-0"
        >
          <Command loop shouldFilter={false} className="bg-transparent">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              data-testid={searchTestId}
              trailing={
                onRefresh ? (
                  <button
                    type="button"
                    aria-label={refreshLabel}
                    title={refreshLabel}
                    data-testid="target-combobox-refresh"
                    disabled={refreshing}
                    onClick={onRefresh}
                    className="grid size-7 shrink-0 place-content-center rounded-[8px] text-icon-muted outline-none hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-border-focus disabled:opacity-50"
                  >
                    <ArrowsClockwise
                      className={cn('size-4', refreshing && 'animate-spin')}
                    />
                  </button>
                ) : undefined
              }
            />
            <CommandList>
              {status === 'loading' && !hasItems ? (
                <div className="grid gap-1.5 p-1.5" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-11 rounded-[10px]" />
                  ))}
                </div>
              ) : null}
              {status === 'idle' && !hasItems ? (
                <p className="px-3 py-8 text-center text-callout text-text-muted">
                  {idleMessage}
                </p>
              ) : null}
              {status === 'ready' && visibleCount === 0 ? (
                <p className="px-3 py-8 text-center text-callout text-text-muted">
                  {emptyMessage}
                </p>
              ) : null}
              {visibleGroups.map((group) => (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.items.map((item) => {
                    const blocked = Boolean(item.disabledReason)
                    return (
                      <CommandItem
                        key={item.value}
                        value={item.value}
                        disabled={blocked}
                        onSelect={() => choose(item.value)}
                        data-testid={item.testId}
                        className={cn(
                          'items-center',
                          blocked && 'data-[disabled=true]:opacity-100',
                          item.value === value && 'bg-accent-soft/60',
                        )}
                      >
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span
                            className={cn(
                              'truncate text-[14px] leading-5 font-medium',
                              blocked ? 'text-text-muted' : 'text-text-primary',
                            )}
                          >
                            {item.name}
                          </span>
                          {item.detail || item.domain ? (
                            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-text-muted">
                              {item.detail ? (
                                <span className="truncate">{item.detail}</span>
                              ) : null}
                              {item.detail && item.domain ? (
                                <span aria-hidden="true">·</span>
                              ) : null}
                              {item.domain ? (
                                <span className="truncate">{item.domain}</span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                        {item.disabledReason ? (
                          <Tag tone="outline">{item.disabledReason}</Tag>
                        ) : (
                          item.meta
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-status-error-bg px-3 py-2.5 text-callout text-text-error"
        >
          <span className="min-w-0">{error}</span>
          {onRetry ? (
            <Button
              type="button"
              variant="quiet"
              size="xs"
              onClick={onRetry}
              className="text-text-error hover:text-text-error"
            >
              {retryLabel ?? m.settings_target_retry()}
            </Button>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
