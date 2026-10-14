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

  it.each(['articles', 'resolved', 'previewText'])('accepts %s', (name) => {
    expect(isReservedCollectionKey(name)).toBe(false)
  })
})
