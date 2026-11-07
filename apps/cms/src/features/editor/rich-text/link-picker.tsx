import * as React from 'react'
import { FileText, Hash, LinkBreak, LinkSimple } from '@phosphor-icons/react'
import type { Editor } from '@tiptap/react'

import { Button } from '#/components/ui/button'
import { fieldClasses, Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { EntryStatusPill } from '#/components/ui/status-pill'
import { entryUiStatus } from '#/features/golive/entry-live-state'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import type {
  LinkCheckResult,
  LinkHeading,
  LinkTargetOption,
} from '#/server/content/link-targets'
import { isEntryLinkAnchor } from '#/server/richtext/allowlist'
import { richTextHeadings } from '#/server/richtext/entry-links'

import { buildLinkRows, parseLinkInput, stepRow } from './link-options'
import type { LinkRow, LinkSearchData } from './link-options'
import { entryLinkAttrs, plainLinkAttrs, setLinkMark } from './link-mark'
import type { LinkMarkAttrs } from './link-mark'
import { useLinkHeadings, useLinkSearch } from './use-link-targets'

/** Whose link the field edits: the site, the entry being edited and its language. */
export type LinkContext = {
  siteId: string
  /** Null for site content sections (globals). */
  entryId: string | null
  /** The language being edited; null on a single-language site. */
  locale: string | null
  devSite: boolean
}

/** The link under the cursor when the field opened. */
export type LinkCurrent = {
  href: string
  entryId: string | null
  anchor: string | null
  collection: string | null
}

/** What the field starts from: the selection it applies to and the link in it. */
export type LinkSession = {
  from: number
  to: number
  current: LinkCurrent | null
}

const CUSTOM_SECTION = '__custom__'

function optionId(listboxId: string, rowId: string) {
  return `${listboxId}-${rowId}`
}

/** The visible title and the small detail line of a row. */
function rowLabel(row: LinkRow): { title: string; detail: string | null } {
  if (row.kind === 'entry') {
    const detail = `${row.entry.path}${row.anchor ? `#${row.anchor}` : ''}`
    return {
      title: row.resolved
        ? m.editor_link_links_to({ title: row.entry.title })
        : row.entry.title,
      detail,
    }
  }
  if (row.kind === 'heading') {
    return {
      title: row.heading.text,
      detail: row.entry
        ? `${row.entry.path}#${row.heading.id}`
        : `#${row.heading.id}`,
    }
  }
  if (row.kind === 'custom') {
    return { title: m.editor_link_custom({ href: row.href }), detail: null }
  }
  return { title: m.editor_link_hint_invalid(), detail: null }
}

/**
 * The link field of the rich text popover (docs/design/rich-text-links.md,
 * decision 13): one input with suggestions. The rules are in link-options.ts;
 * this component shows the rows, applies the chosen one to the editor and,
 * for an entry link, offers the section.
 */
export function LinkPicker({
  editor,
  context,
  session,
  checks,
  onDone,
}: {
  editor: Editor
  context: LinkContext
  session: LinkSession
  /** The checks of the links in this text: they describe the link being edited. */
  checks: LinkCheckResult[] | undefined
  onDone: () => void
}) {
  const { siteId, locale, devSite } = context
  const listboxId = React.useId()
  const [input, setInput] = React.useState('')
  const [picked, setPicked] = React.useState<string | null>(null)
  const [current, setCurrent] = React.useState<LinkCurrent | null>(
    session.current,
  )
  const [range, setRange] = React.useState({
    from: session.from,
    to: session.to,
  })
  // An existing link opens collapsed to its chip; Change reopens the search.
  const [changing, setChanging] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (changing) inputRef.current?.focus()
  }, [changing])
  const debounced = useDebouncedValue(input, 180)
  const mode = React.useMemo(() => parseLinkInput(input), [input])
  const serverMode = React.useMemo(() => parseLinkInput(debounced), [debounced])
  const live = useReleaseStatus(siteId).liveMembership

  // The recent pages, for the empty field. Cached, so reopening is instant.
  const recent = useLinkSearch({
    siteId,
    query: '',
    locale,
    limit: 5,
    enabled: mode.kind === 'empty',
  })
  // Pages for everything else, asked with the debounced text.
  const searching = serverMode.kind !== 'empty' && serverMode.kind !== 'anchor'
  const search = useLinkSearch({
    siteId,
    query: serverMode.text,
    locale,
    limit: 8,
    enabled: searching,
  })
  const searchData: LinkSearchData | null =
    mode.kind === 'empty'
      ? (recent.data ?? null)
      : searching
        ? (search.data ?? null)
        : null

  // `word#…`: the sections of the best matching entry.
  const sectionTop =
    serverMode.kind === 'sections' ? search.data?.entries[0] : undefined
  const sectionHeadings = useLinkHeadings({
    siteId,
    entryId: sectionTop?.entryId,
    locale,
    enabled: serverMode.kind === 'sections',
  })
  const sectionEntry = React.useMemo(
    () =>
      sectionTop && sectionHeadings.data
        ? { entry: sectionTop, headings: sectionHeadings.data.headings }
        : null,
    [sectionTop, sectionHeadings.data],
  )

  // `#…`: the sections of the page being edited, from its live document.
  const pageHeadings = React.useMemo<LinkHeading[]>(
    () => (mode.kind === 'anchor' ? richTextHeadings(editor.getJSON()) : []),
    [editor, mode.kind],
  )

  const { rows, enabled, preselected } = React.useMemo(
    () =>
      buildLinkRows({
        mode,
        search: searchData,
        sectionEntry,
        pageHeadings,
      }),
    [mode, searchData, sectionEntry, pageHeadings],
  )
  const activeId =
    picked !== null && enabled.includes(picked) ? picked : preselected
  const activeRow = rows.find((row) => row.id === activeId) ?? null

  /* ---------------------------------------------------------------------
     Applying to the editor
  --------------------------------------------------------------------- */

  // Commands here do not focus the editor. Focusing it moves focus out of the
  // popover, which closes the popover; the callers focus the editor when they
  // are done (see onDone).
  function applyMark(attrs: LinkMarkAttrs, text: string) {
    const inserted = setLinkMark(editor, range, attrs, text)
    if (inserted) setRange(inserted)
  }

  function applyPlain(href: string) {
    applyMark(plainLinkAttrs(href), href)
  }

  function applyEntry(entry: LinkTargetOption, anchor: string | null) {
    const href = `${entry.path}${anchor ? `#${anchor}` : ''}`
    const attrs = entryLinkAttrs(href, entry.entryId, entry.collection, anchor)
    applyMark(attrs, entry.title)
    setCurrent({
      href,
      entryId: entry.entryId,
      anchor,
      collection: entry.collection,
    })
  }

  function choose(row: LinkRow) {
    // Rows of an answer for other text, and hints, cannot be chosen.
    if (row.kind === 'hint' || !enabled.includes(row.id)) return
    if (row.kind === 'custom') {
      applyPlain(row.href)
      onDone()
      return
    }
    if (row.kind === 'heading') {
      if (row.entry) applyEntry(row.entry, row.heading.id)
      else applyPlain(`#${row.heading.id}`)
      onDone()
      return
    }
    // An entry stays in the field, as a chip with its section.
    applyEntry(row.entry, row.anchor)
    setInput('')
    setPicked(null)
    setChanging(false)
  }

  function removeLink() {
    editor
      .chain()
      .setTextSelection(range)
      .extendMarkRange('link')
      .unsetLink()
      .run()
    onDone()
  }

  /* ---------------------------------------------------------------------
     The chip and the section of the link being edited
  --------------------------------------------------------------------- */

  const currentCheck = current?.entryId
    ? checks?.find(
        (check) =>
          check.entryId === current.entryId &&
          (check.anchor ?? null) === (current.anchor ?? null),
      )
    : undefined
  const currentTarget = currentCheck?.target ?? null
  const currentGone = currentCheck?.state === 'gone'
  const showChip = current !== null && !changing
  const sections = useLinkHeadings({
    siteId,
    entryId: current?.entryId,
    locale,
    enabled: showChip && Boolean(current.entryId) && !currentGone,
  })
  const sectionIds = new Set(
    (sections.data ? sections.data.headings : []).map((h) => h.id),
  )
  const anchorNow = current?.anchor ?? null
  const [customOpen, setCustomOpen] = React.useState(false)
  const sectionCustom =
    customOpen ||
    (sections.isSuccess && anchorNow !== null && !sectionIds.has(anchorNow))
  const [anchorDraft, setAnchorDraft] = React.useState(anchorNow ?? '')
  const [sectionError, setSectionError] = React.useState<string | null>(null)
  const pagePath =
    currentTarget?.path ??
    sections.data?.path ??
    current?.href.split('#')[0] ??
    ''

  function setSection(anchor: string | null) {
    if (!current?.entryId) return
    const href = `${pagePath}${anchor ? `#${anchor}` : ''}`
    editor
      .chain()
      .setTextSelection(range)
      .extendMarkRange('link')
      .updateAttributes('link', {
        href,
        entryId: current.entryId,
        collection: current.collection,
        anchor,
      })
      .run()
    setCurrent({ ...current, href, anchor })
  }

  function onSectionSelect(value: string) {
    setSectionError(null)
    if (value === '') {
      setCustomOpen(false)
      setSection(null)
      return
    }
    if (value === CUSTOM_SECTION) {
      setCustomOpen(true)
      setAnchorDraft(anchorNow && !sectionIds.has(anchorNow) ? anchorNow : '')
      return
    }
    setCustomOpen(false)
    setSection(value)
  }

  function onAnchorDraft(value: string) {
    setAnchorDraft(value)
    const trimmed = value.trim()
    if (trimmed === '') {
      setSectionError(null)
      return
    }
    if (!isEntryLinkAnchor(trimmed)) {
      setSectionError(m.editor_link_section_invalid())
      return
    }
    setSectionError(null)
    setSection(trimmed)
  }

  const uiStatus =
    currentTarget && !currentGone
      ? entryUiStatus(
          {
            id: currentTarget.entryId,
            status: currentTarget.status,
            slug: currentTarget.mainSlug,
            publishedSlug: currentTarget.publishedSlug,
            updatedAt: '',
          },
          live,
          devSite,
        )
      : null

  /* ---------------------------------------------------------------------
     Keys
  --------------------------------------------------------------------- */

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setPicked(stepRow(enabled, activeId, event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      // An empty field with nothing picked changes nothing: Remove removes.
      if (activeRow) choose(activeRow)
    }
  }

  // Only while the first answer is on its way; a newer one keeps the old rows.
  const loading =
    mode.kind === 'empty'
      ? recent.isFetching && !recent.data
      : mode.kind !== 'anchor' && search.isFetching && !search.data

  return (
    <div className="grid gap-3" data-testid="link-picker">
      {showChip ? (
        <div className="grid gap-2">
          <div
            className="flex min-w-0 items-center gap-2 rounded-[10px] border border-border-default bg-background-subtle px-2.5 py-2"
            data-testid="link-chip"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
              data-testid="link-chip-info"
              onClick={() => setChanging(true)}
            >
              {current.entryId ? (
                <FileText className="size-4 shrink-0 text-icon-accent" />
              ) : (
                <LinkSimple className="size-4 shrink-0 text-icon-muted" />
              )}
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-callout font-medium text-text-primary">
                  {current.entryId
                    ? (currentTarget?.title ?? current.href)
                    : current.href}
                </span>
                <span className="truncate font-mono text-caption text-text-muted">
                  {current.href}
                </span>
              </span>
              {uiStatus ? (
                <EntryStatusPill status={uiStatus} size="sm" />
              ) : null}
            </button>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              data-testid="link-change"
              onClick={() => setChanging(true)}
            >
              {m.editor_link_change()}
            </Button>
          </div>
          {currentGone ? (
            <p
              className="text-callout text-text-error"
              role="status"
              data-testid="link-chip-gone"
            >
              {m.editor_link_dead_page()}
            </p>
          ) : null}
          {current.entryId && !currentGone ? (
            <div className="grid gap-1.5" data-testid="link-section-field">
              <Label htmlFor="rich-text-link-section">
                {m.editor_link_section()}
              </Label>
              <select
                id="rich-text-link-section"
                data-testid="link-section-select"
                className={cn(fieldClasses, 'h-9')}
                value={
                  anchorNow === null
                    ? ''
                    : sectionCustom
                      ? CUSTOM_SECTION
                      : anchorNow
                }
                onChange={(event) => onSectionSelect(event.target.value)}
              >
                <option value="">{m.editor_link_section_none()}</option>
                {(sections.data?.headings ?? []).map((heading) => (
                  <option key={heading.id} value={heading.id}>
                    {heading.text}
                  </option>
                ))}
                <option value={CUSTOM_SECTION}>
                  {m.editor_link_section_custom()}
                </option>
              </select>
              {sectionCustom ? (
                <Input
                  id="rich-text-link-anchor"
                  data-testid="link-section-custom"
                  aria-label={m.editor_link_section_id()}
                  placeholder={m.editor_link_section_placeholder()}
                  value={anchorDraft}
                  aria-invalid={sectionError ? true : undefined}
                  onChange={(event) => onAnchorDraft(event.target.value)}
                />
              ) : null}
              {sectionError ? (
                <p className="text-callout text-text-error" role="alert">
                  {sectionError}
                </p>
              ) : null}
              {currentCheck?.state === 'missing-section' ? (
                <p
                  className="text-callout text-text-error"
                  role="status"
                  data-testid="link-section-gone"
                >
                  {m.editor_link_dead_section()}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {showChip ? null : (
        <div className="grid gap-1.5">
          <Label htmlFor="rich-text-link-url">{m.editor_link_url()}</Label>
          <Input
            ref={inputRef}
            id="rich-text-link-url"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeId ? optionId(listboxId, activeId) : undefined
            }
            autoComplete="off"
            placeholder={m.editor_link_search_placeholder()}
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
              setPicked(null)
            }}
            onKeyDown={onKeyDown}
            data-testid="rich-text-link-input"
          />
          <p className="text-caption font-normal text-text-muted">
            {m.editor_link_opens_new_tab()}
          </p>
        </div>
      )}

      {showChip || mode.kind !== 'empty' || rows.length === 0 ? null : (
        <p className="text-caption font-medium text-text-muted">
          {m.editor_link_recent()}
        </p>
      )}

      <ul
        id={listboxId}
        role="listbox"
        aria-label={m.editor_link_url()}
        data-testid="link-suggestions"
        className={cn(
          'grid max-h-72 gap-0.5 overflow-y-auto',
          (rows.length === 0 || showChip) && 'hidden',
        )}
      >
        {rows.map((row) => {
          const label = rowLabel(row)
          const active = row.id === activeId
          const testId =
            row.kind === 'entry'
              ? `link-suggestion-entry-${row.entry.entryId}`
              : row.kind === 'heading'
                ? `link-suggestion-heading-${row.heading.id}`
                : row.kind === 'custom'
                  ? 'link-suggestion-custom'
                  : 'link-suggestion-hint'
          const entryStatus =
            row.kind === 'entry'
              ? entryUiStatus(
                  {
                    id: row.entry.entryId,
                    status: row.entry.status,
                    slug: row.entry.mainSlug,
                    publishedSlug: row.entry.publishedSlug,
                    updatedAt: '',
                  },
                  live,
                  devSite,
                )
              : null
          const isHint = row.kind === 'hint'
          const chooseable = enabled.includes(row.id)
          return (
            <li
              key={row.id}
              id={optionId(listboxId, row.id)}
              role="option"
              aria-selected={active}
              aria-disabled={!chooseable || undefined}
              data-testid={testId}
              data-active={active || undefined}
              onMouseMove={() => {
                if (chooseable && picked !== row.id) setPicked(row.id)
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(row)}
              className={cn(
                'flex min-w-0 items-center gap-2.5 rounded-[8px] px-2.5 py-2',
                isHint
                  ? 'cursor-default text-callout text-text-muted'
                  : chooseable
                    ? 'cursor-pointer'
                    : 'cursor-default opacity-60',
                active &&
                  chooseable &&
                  !isHint &&
                  'bg-accent-soft text-accent-text',
              )}
            >
              {isHint ? null : row.kind === 'heading' ? (
                <Hash className="size-4 shrink-0 text-icon-muted" />
              ) : row.kind === 'entry' ? (
                <FileText className="size-4 shrink-0 text-icon-muted" />
              ) : (
                <LinkSimple className="size-4 shrink-0 text-icon-muted" />
              )}
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span
                  className={cn(
                    'text-callout font-medium text-text-primary',
                    isHint ? 'font-normal text-text-muted' : 'truncate',
                  )}
                >
                  {label.title}
                </span>
                {label.detail ? (
                  <span className="truncate font-mono text-caption font-normal text-text-muted">
                    {label.detail}
                  </span>
                ) : null}
              </span>
              {row.kind === 'entry' ? (
                <span className="hidden shrink-0 text-caption text-text-muted sm:inline">
                  {row.entry.collectionLabel}
                </span>
              ) : null}
              {entryStatus ? (
                <EntryStatusPill status={entryStatus} size="sm" />
              ) : null}
            </li>
          )
        })}
      </ul>
      {loading && !showChip ? (
        <p
          className="text-caption font-normal text-text-muted"
          aria-live="polite"
        >
          {m.editor_loading()}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {current ? (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            data-testid="rich-text-link-remove"
            onClick={removeLink}
          >
            <LinkBreak />
            {m.editor_remove()}
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          size="sm"
          data-testid="rich-text-link-done"
          onClick={onDone}
        >
          {m.editor_link_done()}
        </Button>
      </div>
    </div>
  )
}
