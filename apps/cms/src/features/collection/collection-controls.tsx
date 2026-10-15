import * as React from 'react'
import {
  Archive,
  ClockCountdown,
  MagnifyingGlass,
  PencilSimple,
  RocketLaunch,
  Stack,
  X,
} from '@phosphor-icons/react'

import { Kbd } from '#/components/ui/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { uiLanguageName } from '#/lib/site-languages'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import type { StatusFilter } from './use-collection-entries'

/**
 * Search that expands from an icon (brief §3.4). The input is always in the
 * DOM (so `/` can focus it through `data-shortcut-search`); collapsed it
 * looks like an icon button, focused or filled it grows to a field.
 */
export function CollectionSearch({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  const [focused, setFocused] = React.useState(false)
  const open = focused || value !== ''
  return (
    <div
      className={cn(
        'relative h-9 transition-[width] duration-200 ease-(--ease-standard) motion-reduce:transition-none',
        open ? 'w-full sm:w-60' : 'w-9',
      )}
    >
      <MagnifyingGlass
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2',
          open ? 'text-icon-muted' : 'text-icon-default',
        )}
      />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (value) onChange('')
            else ref.current?.blur()
          }
        }}
        aria-label={label}
        placeholder={open ? label : ''}
        data-shortcut-search
        data-testid="collection-search"
        className={cn(
          'h-9 w-full rounded-control pr-8 pl-8 text-[14px] text-text-primary outline-none placeholder:text-text-muted',
          'transition-[background-color,border-color,box-shadow] duration-150',
          '[&::-webkit-search-cancel-button]:appearance-none',
          open
            ? 'border border-border-strong bg-background-surface focus:border-accent focus:ring-[3px] focus:ring-accent-soft'
            : 'cursor-pointer border border-transparent bg-transparent hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label={m.collection_clear_search()}
          onClick={() => {
            onChange('')
            ref.current?.focus()
          }}
          className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-content-center rounded-full text-icon-muted hover:bg-surface-state-hover hover:text-text-primary"
        >
          <X weight="bold" className="size-3" />
        </button>
      ) : open ? (
        <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
          /
        </Kbd>
      ) : null}
    </div>
  )
}

/** All · Drafts · Ready & live · Scheduled · Archived, sliding pill. */
export function StatusFilterControl({
  value,
  onChange,
}: {
  value: StatusFilter
  onChange: (value: StatusFilter) => void
}) {
  return (
    <div className="-mx-4 min-w-0 overflow-x-auto px-4 no-scrollbar md:mx-0 md:px-0">
      <SegmentedControl
        aria-label={m.editor_filter_by_status()}
        value={value}
        onValueChange={onChange}
        data-testid="status-filter"
        options={[
          {
            value: 'all',
            label: m.collection_filter_all(),
            icon: <Stack />,
            testId: 'status-filter-all',
          },
          {
            value: 'draft',
            label: m.collection_filter_drafts(),
            icon: <PencilSimple />,
            testId: 'status-filter-draft',
          },
          {
            value: 'published',
            label: m.collection_filter_published(),
            icon: <RocketLaunch />,
            testId: 'status-filter-published',
          },
          {
            value: 'scheduled',
            label: m.collection_filter_scheduled(),
            icon: <ClockCountdown />,
            testId: 'status-filter-scheduled',
          },
          {
            value: 'archived',
            label: m.collection_filter_archived(),
            icon: <Archive />,
            testId: 'status-filter-archived',
          },
        ]}
      />
    </div>
  )
}

const ANY_LANGUAGE = '__any__'

/**
 * "Missing translation: <language>" next to the status filter (multilingual
 * sites only). `value` is a language tag, or null for any language.
 */
export function MissingLanguageFilter({
  value,
  languages,
  onChange,
}: {
  value: string | null
  /** Non-main languages of the site, in site order. */
  languages: string[]
  onChange: (value: string | null) => void
}) {
  return (
    <Select
      value={value ?? ANY_LANGUAGE}
      onValueChange={(next) => onChange(next === ANY_LANGUAGE ? null : next)}
    >
      <SelectTrigger
        aria-label={m.coverage_missing_filter()}
        data-testid="missing-language-filter"
        className="h-9 w-auto min-w-44 text-[14px]"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_LANGUAGE} data-testid="missing-language-any">
          {m.coverage_missing_any()}
        </SelectItem>
        {languages.map((locale) => (
          <SelectItem
            key={locale}
            value={locale}
            data-testid={`missing-language-${locale}`}
          >
            {m.coverage_missing_in({ language: uiLanguageName(locale) })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
