import { describe, expect, it } from 'vitest'

import {
  isReservedCollectionKey,
  isSafeIdentifier,
} from './content-identifiers'

describe('isSafeIdentifier', () => {
  it.each(['title', 'blog-posts', 'cover_image', 'preview', 'href', 'resolve'])(
    'accepts %s (field keys may use these names)',
    (name) => {
      expect(isSafeIdentifier(name)).toBe(true)
    },
  )

  it('still rejects reserved object prototype names', () => {
    expect(isSafeIdentifier('constructor')).toBe(false)
  })
})

describe('isReservedCollectionKey', () => {
  it.each(['resolve', 'href', 'preview', 'Preview', 'HREF', 'RESOLVE'])(
    'rejects the collection key %s',
    (name) => {
      expect(isReservedCollectionKey(name)).toBe(true)
    },
  )

  it.each(['globals', 'Globals', 'GLOBALS'])(
    'rejects the collection key %s (reserved for site content)',
    (name) => {
      expect(isReservedCollectionKey(name)).toBe(true)
    },
  )

  // The SDK camelCases keys (`preview-globals` -> `previewGlobals`) before it
  // checks reserved names, so the CMS must reject the raw spellings too.
  it.each([
    'previewGlobals',
    'previewglobals',
    'PreviewGlobals',
    'preview-globals',
    'preview_globals',
    'Preview-Globals',
  ])(
    'rejects the collection key %s (reserved for the previewGlobals member)',
    (name) => {
      expect(isReservedCollectionKey(name)).toBe(true)
    },
  )

  // Content languages add members to the generated content object: `in()`,
  // `languages` and `matchLocale()`.
  it.each([
    'in',
    'IN',
    'languages',
    'Languages',
    'matchLocale',
    'match-locale',
    'MATCH_LOCALE',
  ])(
    'rejects the collection key %s (reserved for the content languages API)',
    (name) => {
      expect(isReservedCollectionKey(name)).toBe(true)
    },
  )

  it.each([
    'articles',
    'resolved',
    'previewText',
    'preview-text',
    'inbox',
    'languageNotes',
    'matchLocales',
  ])('accepts %s', (name) => {
    expect(isReservedCollectionKey(name)).toBe(false)
  })
})
