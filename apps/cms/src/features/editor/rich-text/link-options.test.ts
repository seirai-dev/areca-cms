import { describe, expect, it } from 'vitest'

import type {
  LinkHeading,
  LinkTargetOption,
} from '#/server/content/link-targets'

import {
  buildLinkRows,
  customLinkHref,
  looksLikeAddress,
  parseLinkInput,
  stepRow,
} from './link-options'
import type { LinkRow, LinkSearchData } from './link-options'

function entry(id: string, title: string, path: string): LinkTargetOption {
  return {
    entryId: id,
    collection: 'articles',
    collectionLabel: 'Articles',
    title,
    slug: path.split('/').pop() ?? '',
    mainSlug: path.split('/').pop() ?? '',
    publishedSlug: null,
    status: 'published',
    path,
  }
}

const ethiopia = entry('e-1', 'Coffee from Ethiopia', '/blog/ethiopia')
const kenya = entry('e-2', 'Coffee from Kenya', '/blog/kenya')
const headings = [
  { id: 'origin', text: 'Origin', level: 2 },
  { id: 'taste', text: 'Taste notes', level: 2 },
]

/** A server answer; `query` defaults to the typed text, so it is the answer for it. */
type SearchInput = Omit<LinkSearchData, 'query'> & { query?: string }

function rowsFor(
  raw: string,
  extra: {
    search?: SearchInput
    sectionEntry?: { entry: LinkTargetOption; headings: LinkHeading[] }
    pageHeadings?: LinkHeading[]
  } = {},
) {
  const mode = parseLinkInput(raw)
  return buildLinkRows({
    mode,
    search: extra.search ? { query: mode.text, ...extra.search } : null,
    sectionEntry: extra.sectionEntry ?? null,
    pageHeadings: extra.pageHeadings ?? [],
  })
}

function ids(rows: LinkRow[]) {
  return rows.map((row) => row.id)
}

describe('parseLinkInput', () => {
  it('reads empty, anchor, path, address, sections and words', () => {
    expect(parseLinkInput('   ')).toEqual({ kind: 'empty', text: '' })
    expect(parseLinkInput('#faq')).toEqual({
      kind: 'anchor',
      text: '#faq',
      anchor: 'faq',
    })
    expect(parseLinkInput('/journal/x#faq')).toEqual({
      kind: 'path',
      text: '/journal/x#faq',
      path: '/journal/x',
      anchor: 'faq',
    })
    expect(parseLinkInput('/journal/x')).toMatchObject({
      kind: 'path',
      path: '/journal/x',
      anchor: null,
    })
    expect(parseLinkInput('google.com')).toEqual({
      kind: 'address',
      text: 'google.com',
    })
    expect(parseLinkInput('mailto:hi@example.nl')).toMatchObject({
      kind: 'address',
    })
    expect(parseLinkInput('ethiopia#')).toEqual({
      kind: 'sections',
      text: 'ethiopia#',
      word: 'ethiopia',
      filter: '',
    })
    expect(parseLinkInput('goo')).toEqual({ kind: 'words', text: 'goo' })
  })

  it('treats a double slash as text, not a path', () => {
    expect(parseLinkInput('//evil.example')).toMatchObject({ kind: 'address' })
  })

  it('recognises address-like input', () => {
    expect(looksLikeAddress('google.com')).toBe(true)
    expect(looksLikeAddress('https://x')).toBe(true)
    expect(looksLikeAddress('goo')).toBe(false)
  })
})

describe('customLinkHref', () => {
  it('adds https to a bare domain, as the field always did', () => {
    expect(customLinkHref(parseLinkInput('google.com'), null)).toBe(
      'https://google.com',
    )
    expect(customLinkHref(parseLinkInput('goo'), null)).toBe('https://goo')
  })

  it('keeps schemes, paths and anchors as typed', () => {
    expect(customLinkHref(parseLinkInput('https://a.nl/x'), null)).toBe(
      'https://a.nl/x',
    )
    expect(customLinkHref(parseLinkInput('mailto:hi@a.nl'), null)).toBe(
      'mailto:hi@a.nl',
    )
    expect(customLinkHref(parseLinkInput('/coffees'), null)).toBe('/coffees')
    expect(customLinkHref(parseLinkInput('#faq'), null)).toBe('#faq')
  })

  it('is null for input that cannot be a link', () => {
    expect(customLinkHref(parseLinkInput('coffee beans'), null)).toBeNull()
    expect(customLinkHref(parseLinkInput('#'), null)).toBeNull()
    expect(
      customLinkHref(parseLinkInput('javascript:alert(1)'), null),
    ).toBeNull()
    expect(customLinkHref(parseLinkInput('?q=1'), null)).toBeNull()
    expect(customLinkHref(parseLinkInput('ethiopia#'), null)).toBeNull()
    expect(customLinkHref(parseLinkInput(''), null)).toBeNull()
  })

  it('keeps an own-domain URL as its site path', () => {
    expect(customLinkHref(parseLinkInput('https://www.a.nl/x#y'), '/x#y')).toBe(
      '/x#y',
    )
  })
})

describe('buildLinkRows', () => {
  it('shows only the custom row for words that match nothing', () => {
    const { rows, preselected } = rowsFor('goo', {
      search: { entries: [], resolved: null, ownPath: null },
    })
    expect(ids(rows)).toEqual(['custom'])
    expect(rows[0]).toEqual({
      kind: 'custom',
      id: 'custom',
      href: 'https://goo',
    })
    expect(preselected).toBe('custom')
  })

  it('preselects the custom row for a domain even when entries match', () => {
    const { rows, preselected } = rowsFor('google.com', {
      search: { entries: [ethiopia], resolved: null, ownPath: null },
    })
    expect(ids(rows)).toEqual(['entry-e-1', 'custom'])
    expect(preselected).toBe('custom')
  })

  it('preselects the best matching entry for plain words, with no custom row while one matches', () => {
    const { rows, preselected } = rowsFor('ethiopia', {
      search: { entries: [ethiopia, kenya], resolved: null, ownPath: null },
    })
    expect(ids(rows)).toEqual(['entry-e-1', 'entry-e-2'])
    expect(preselected).toBe('entry-e-1')
  })

  it('offers the custom link for plain words only when no entry matches', () => {
    const none = rowsFor('goo', {
      search: { entries: [], resolved: null, ownPath: null },
    })
    expect(ids(none.rows)).toEqual(['custom'])
    expect(none.preselected).toBe('custom')
    const some = rowsFor('goo', {
      search: { entries: [ethiopia], resolved: null, ownPath: null },
    })
    expect(ids(some.rows)).toEqual(['entry-e-1'])
  })

  it('keeps the custom link last for an address, next to matching entries', () => {
    const { rows } = rowsFor('ethiopia.nl', {
      search: { entries: [ethiopia], resolved: null, ownPath: null },
    })
    expect(ids(rows)).toEqual(['entry-e-1', 'custom'])
  })

  it('makes a typed path that is an entry address the first row, preselected', () => {
    const { rows, preselected } = rowsFor('/blog/ethiopia#origin', {
      search: {
        entries: [kenya],
        resolved: { entry: ethiopia, anchor: 'origin' },
        ownPath: null,
      },
    })
    expect(rows[0]).toMatchObject({
      kind: 'entry',
      id: 'entry-e-1',
      anchor: 'origin',
      resolved: true,
    })
    expect(ids(rows)).toEqual(['entry-e-1', 'entry-e-2', 'custom'])
    expect(preselected).toBe('entry-e-1')
  })

  it('keeps a path that matches nothing as a plain custom link', () => {
    const { rows, preselected } = rowsFor('/coffees', {
      search: { entries: [], resolved: null, ownPath: null },
    })
    expect(ids(rows)).toEqual(['custom'])
    expect(preselected).toBe('custom')
  })

  it('lists the sections of this page for #, and preselects the first one', () => {
    const { rows, preselected } = rowsFor('#', { pageHeadings: headings })
    expect(ids(rows)).toEqual(['heading-origin', 'heading-taste', 'hint'])
    expect(preselected).toBe('heading-origin')
  })

  it('filters the sections for #…, and keeps the anchor as the custom row', () => {
    const { rows, preselected } = rowsFor('#tas', { pageHeadings: headings })
    expect(ids(rows)).toEqual(['heading-taste', 'custom'])
    expect(rows[1]).toEqual({ kind: 'custom', id: 'custom', href: '#tas' })
    expect(preselected).toBe('custom')
  })

  it('lists the sections of the best entry for word#', () => {
    const { rows, preselected } = rowsFor('ethiopia#', {
      search: { entries: [ethiopia], resolved: null, ownPath: null },
      sectionEntry: { entry: ethiopia, headings },
    })
    expect(ids(rows)).toEqual([
      'entry-e-1',
      'heading-origin',
      'heading-taste',
      'hint',
    ])
    expect(rows[1]).toMatchObject({ kind: 'heading', entry: ethiopia })
    expect(preselected).toBe('heading-origin')
  })

  it('offers only a hint when the input is not a link and nothing matches', () => {
    const { rows, preselected } = rowsFor('coffee beans', {
      search: { entries: [], resolved: null, ownPath: null },
    })
    expect(ids(rows)).toEqual(['hint'])
    expect(preselected).toBeNull()
  })

  it('lists the recent pages for empty input, with no custom row', () => {
    const { rows, preselected } = rowsFor('', {
      search: { entries: [ethiopia, kenya], resolved: null, ownPath: null },
    })
    expect(ids(rows)).toEqual(['entry-e-1', 'entry-e-2'])
    expect(preselected).toBeNull()
  })

  it('uses the own-domain path for the custom row when a URL is typed', () => {
    const { rows, preselected } = rowsFor('https://www.a.nl/blog/ethiopia', {
      search: {
        entries: [],
        resolved: { entry: ethiopia, anchor: null },
        ownPath: '/blog/ethiopia',
      },
    })
    expect(ids(rows)).toEqual(['entry-e-1', 'custom'])
    expect(rows[1]).toEqual({
      kind: 'custom',
      id: 'custom',
      href: '/blog/ethiopia',
    })
    expect(preselected).toBe('entry-e-1')
  })
})

describe('answers that belong to another text', () => {
  it('does not let an older answer be chosen or replace the typed link', () => {
    const { rows, enabled, preselected, pending } = rowsFor(
      'https://example.com',
      {
        search: {
          query: '/blog/ethiopia',
          entries: [ethiopia],
          resolved: { entry: ethiopia, anchor: null },
          ownPath: '/blog/ethiopia',
        },
      },
    )
    expect(pending).toBe(true)
    expect(enabled).toEqual(['custom'])
    expect(preselected).toBe('custom')
    expect(rows.find((row) => row.kind === 'custom')).toEqual({
      kind: 'custom',
      id: 'custom',
      href: 'https://example.com',
    })
  })

  it('waits for the answer to plain words before anything can be chosen', () => {
    const { enabled, preselected } = rowsFor('goo', {
      search: {
        query: 'g',
        entries: [ethiopia],
        resolved: null,
        ownPath: null,
      },
    })
    expect(enabled).toEqual([])
    expect(preselected).toBeNull()
  })

  it('waits for the answer to a typed path, which is not a custom link yet', () => {
    const { enabled, preselected } = rowsFor('/blog/ethiopia', {
      search: {
        query: '/blog/ethi',
        entries: [],
        resolved: null,
        ownPath: null,
      },
    })
    expect(enabled).toEqual([])
    expect(preselected).toBeNull()
  })

  it('uses the answer once it is for the typed text', () => {
    const { enabled, preselected, pending } = rowsFor('ethiopia', {
      search: {
        query: 'ethiopia',
        entries: [ethiopia],
        resolved: null,
        ownPath: null,
      },
    })
    expect(pending).toBe(false)
    expect(enabled).toEqual(['entry-e-1'])
    expect(preselected).toBe('entry-e-1')
  })
})

describe('stepRow', () => {
  const { enabled } = rowsFor('#', { pageHeadings: headings })
  it('moves through the enabled rows and wraps around', () => {
    expect(stepRow(enabled, null, 1)).toBe('heading-origin')
    expect(stepRow(enabled, null, -1)).toBe('heading-taste')
    expect(stepRow(enabled, 'heading-taste', 1)).toBe('heading-origin')
    expect(stepRow(enabled, 'heading-origin', -1)).toBe('heading-taste')
  })

  it('has nothing to move to without enabled rows', () => {
    expect(stepRow(rowsFor('coffee beans').enabled, null, 1)).toBeNull()
  })
})
