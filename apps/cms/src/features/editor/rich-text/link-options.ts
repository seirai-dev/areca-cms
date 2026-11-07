import type {
  LinkHeading,
  LinkTargetOption,
} from '#/server/content/link-targets'
import { isAllowedLinkHref } from '#/server/richtext/allowlist'

/**
 * The rules of the editor's one link field (docs/design/rich-text-links.md,
 * decision 13). Pure: what the field types decides which rows are shown and
 * which row Enter takes. The React field only renders the rows and asks the
 * server for the data they need.
 */

/** What the field typed means. Every mode but `empty` keeps the trimmed text. */
export type LinkMode =
  | { kind: 'empty'; text: '' }
  /** `#…`: the sections of the page being edited. */
  | { kind: 'anchor'; text: string; anchor: string }
  /** `word#…`: the sections of the best matching entry. */
  | { kind: 'sections'; text: string; word: string; filter: string }
  /** `/…`: a site path, optionally with a `#section`. */
  | { kind: 'path'; text: string; path: string; anchor: string | null }
  /** Looks like an address: a scheme, `mailto:` or a dot. */
  | { kind: 'address'; text: string }
  | { kind: 'words'; text: string }

/**
 * Looks like an address rather than words: it has a scheme (`https:`,
 * `mailto:`) or a dot (`example.com`). Such input preselects the custom link.
 */
export function looksLikeAddress(text: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(text) || text.includes('.')
}

export function parseLinkInput(raw: string): LinkMode {
  const text = raw.trim()
  if (text === '') return { kind: 'empty', text: '' }
  if (text.startsWith('#')) {
    return { kind: 'anchor', text, anchor: text.slice(1).trim() }
  }
  if (text.startsWith('/') && !text.startsWith('//')) {
    const hash = text.indexOf('#')
    if (hash === -1) return { kind: 'path', text, path: text, anchor: null }
    return {
      kind: 'path',
      text,
      path: text.slice(0, hash),
      anchor: text.slice(hash + 1).trim() || null,
    }
  }
  if (looksLikeAddress(text)) return { kind: 'address', text }
  const hash = text.indexOf('#')
  if (hash > 0) {
    const word = text.slice(0, hash).trim()
    if (word !== '') {
      return {
        kind: 'sections',
        text,
        word,
        filter: text.slice(hash + 1).trim(),
      }
    }
  }
  return { kind: 'words', text }
}

/**
 * The href the custom row stands for, or null when the input cannot be a
 * link. A bare domain gets `https://` (the rule the link field always had);
 * a scheme, `/`, `#` or `?` is kept as typed. An own-domain URL keeps its
 * site path (`ownPath`). Every candidate is checked with the allowlist.
 */
export function customLinkHref(
  mode: LinkMode,
  ownPath: string | null,
): string | null {
  if (mode.kind === 'empty' || mode.kind === 'sections') return null
  const text = mode.text
  let href: string
  if (ownPath !== null) {
    href = ownPath
  } else if (mode.kind === 'anchor') {
    href = `#${mode.anchor}`
  } else if (
    mode.kind === 'path' ||
    /^[a-z]+:/i.test(text) ||
    /^[/#?.]/.test(text)
  ) {
    href = text
  } else {
    href = `https://${text}`
  }
  return isAllowedLinkHref(href) ? href : null
}

/** One row of the field. Hints are shown, never chosen. */
export type LinkRow =
  | {
      kind: 'entry'
      id: string
      entry: LinkTargetOption
      /** The section the row links to; null for the whole page. */
      anchor: string | null
      /** The typed path or URL is this entry's address. */
      resolved: boolean
    }
  | {
      kind: 'heading'
      id: string
      heading: LinkHeading
      /** Set for a section of an entry (an entry link); null for `#section` of this page. */
      entry: LinkTargetOption | null
    }
  | { kind: 'custom'; id: string; href: string }
  | { kind: 'hint'; id: string }

export type LinkSearchData = {
  entries: LinkTargetOption[]
  resolved: { entry: LinkTargetOption; anchor: string | null } | null
  ownPath: string | null
}

export type LinkRowsInput = {
  mode: LinkMode
  /** The server's answer for the mode, when it was asked. */
  search: LinkSearchData | null
  /** `sections` mode: the best matching entry and its headings. */
  sectionEntry: { entry: LinkTargetOption; headings: LinkHeading[] } | null
  /** `anchor` mode: the headings of the page being edited (live document). */
  pageHeadings: LinkHeading[]
}

export type LinkRows = {
  rows: LinkRow[]
  /** The row Enter takes when nothing else is picked. */
  preselected: string | null
}

export const CUSTOM_ROW_ID = 'custom'
export const HINT_ROW_ID = 'hint'

export function entryRowId(entryId: string) {
  return `entry-${entryId}`
}

export function headingRowId(headingId: string) {
  return `heading-${headingId}`
}

function sectionMatches(heading: LinkHeading, filter: string) {
  if (filter === '') return true
  const needle = filter.toLowerCase()
  return (
    heading.text.toLowerCase().includes(needle) ||
    heading.id.toLowerCase().includes(needle)
  )
}

/**
 * The rows for the typed input and the row Enter takes. A custom row comes
 * last when the input is a valid link, a disabled hint when it is not. What
 * the input looks like decides the preselection (decision 13).
 */
export function buildLinkRows(input: LinkRowsInput): LinkRows {
  const { mode, search, sectionEntry, pageHeadings } = input

  if (mode.kind === 'empty') {
    // Nothing typed: the recent pages. No custom row, nothing preselected.
    const rows: LinkRow[] = (search?.entries ?? []).map((entry) => ({
      kind: 'entry',
      id: entryRowId(entry.entryId),
      entry,
      anchor: null,
      resolved: false,
    }))
    return { rows, preselected: null }
  }

  if (mode.kind === 'anchor') {
    const rows: LinkRow[] = pageHeadings
      .filter((heading) => sectionMatches(heading, mode.anchor))
      .map((heading) => ({
        kind: 'heading',
        id: headingRowId(heading.id),
        heading,
        entry: null,
      }))
    const firstHeading = rows[0]?.id ?? null
    const href = customLinkHref(mode, null)
    if (href !== null) rows.push({ kind: 'custom', id: CUSTOM_ROW_ID, href })
    else rows.push({ kind: 'hint', id: HINT_ROW_ID })
    // `#faq` looks like an address: its custom row (the same in-page link) is
    // preselected. A lone `#` has no custom link, so the first section is.
    const preselected =
      href !== null && mode.anchor !== '' ? CUSTOM_ROW_ID : firstHeading
    return { rows, preselected }
  }

  if (mode.kind === 'sections') {
    // `word#…`: the best entry, then its sections. Never a custom link.
    const rows: LinkRow[] = []
    if (sectionEntry) {
      rows.push({
        kind: 'entry',
        id: entryRowId(sectionEntry.entry.entryId),
        entry: sectionEntry.entry,
        anchor: null,
        resolved: false,
      })
      for (const heading of sectionEntry.headings) {
        if (!sectionMatches(heading, mode.filter)) continue
        rows.push({
          kind: 'heading',
          id: headingRowId(heading.id),
          heading,
          entry: sectionEntry.entry,
        })
      }
    }
    rows.push({ kind: 'hint', id: HINT_ROW_ID })
    // The hint is always last, so there is always a row to preselect.
    const preselected = (rows.find((row) => row.kind === 'heading') ?? rows[0])
      .id
    return { rows, preselected }
  }

  // Paths and addresses: a typed path or own-domain URL that is an entry's
  // address comes first and is preselected; other matches follow; the custom
  // link is last. Words: the best match is preselected; the custom link is
  // the fallback when nothing matches.
  const rows: LinkRow[] = []
  const resolved = search?.resolved ?? null
  if (resolved) {
    rows.push({
      kind: 'entry',
      id: entryRowId(resolved.entry.entryId),
      entry: resolved.entry,
      anchor: resolved.anchor,
      resolved: true,
    })
  }
  for (const entry of search?.entries ?? []) {
    if (resolved && entry.entryId === resolved.entry.entryId) continue
    rows.push({
      kind: 'entry',
      id: entryRowId(entry.entryId),
      entry,
      anchor: null,
      resolved: false,
    })
  }
  const href = customLinkHref(mode, search?.ownPath ?? null)
  if (href !== null) rows.push({ kind: 'custom', id: CUSTOM_ROW_ID, href })
  else rows.push({ kind: 'hint', id: HINT_ROW_ID })

  const customId = href !== null ? CUSTOM_ROW_ID : null
  let preselected: string | null
  if (resolved) preselected = entryRowId(resolved.entry.entryId)
  else if (mode.kind === 'words') {
    preselected = rows.find((row) => row.kind === 'entry')?.id ?? customId
  } else preselected = customId
  return { rows, preselected }
}

/** Rows that can be chosen (the arrow keys and Enter reach these). */
export function selectableRows(rows: LinkRow[]): LinkRow[] {
  return rows.filter((row) => row.kind !== 'hint')
}

/**
 * The row an arrow key moves to, wrapping around. A missing `current` starts
 * at the first row going down and at the last going up.
 */
export function stepRow(
  rows: LinkRow[],
  current: string | null,
  direction: 1 | -1,
): string | null {
  const choices = selectableRows(rows)
  if (choices.length === 0) return null
  const index = choices.findIndex((row) => row.id === current)
  if (index === -1) {
    return direction === 1 ? choices[0].id : choices[choices.length - 1].id
  }
  return choices[(index + direction + choices.length) % choices.length].id
}
