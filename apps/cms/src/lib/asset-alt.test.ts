import { describe, expect, it } from 'vitest'

import { isAltMissing } from './asset-alt'

const image = {
  mimeType: 'image/jpeg',
  altText: 'Main description',
  altI18n: { nl: 'Nederlandse beschrijving' },
}

describe('isAltMissing', () => {
  it('reads the main description for the main language', () => {
    expect(isAltMissing(image, 'en', 'en')).toBe(false)
    expect(isAltMissing({ ...image, altText: '  ' }, 'en', 'en')).toBe(true)
    expect(isAltMissing({ ...image, altText: null }, 'en', 'en')).toBe(true)
  })

  it('treats no language as the main language', () => {
    expect(isAltMissing(image, null, 'en')).toBe(false)
  })

  it('reads only the entry of another language', () => {
    expect(isAltMissing(image, 'nl', 'en')).toBe(false)
    expect(isAltMissing({ ...image, altI18n: {} }, 'nl', 'en')).toBe(true)
  })

  it('does not fall back to the main description', () => {
    // The main alt exists, but the Dutch one does not: missing in Dutch.
    expect(isAltMissing({ ...image, altI18n: {} }, 'nl', 'en')).toBe(true)
    expect(isAltMissing({ ...image, altI18n: { nl: ' ' } }, 'nl', 'en')).toBe(
      true,
    )
  })

  it('never counts non-images as missing', () => {
    expect(
      isAltMissing(
        { ...image, mimeType: 'application/pdf', altText: '' },
        'en',
        'en',
      ),
    ).toBe(false)
  })
})
