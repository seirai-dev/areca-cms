import { describe, expect, it } from 'vitest'
import { assetReferencePattern, referencesAsset } from './usage'

const asset = { id: 'asset-id', storageKey: 'org/image.png' }
describe('retained asset references', () => {
  it('detects IDs and legacy rich-text URLs in retained structured content', () => {
    expect(referencesAsset({ hero: asset.id }, asset)).toBe(true)
    expect(
      referencesAsset(
        {
          content: [
            {
              type: 'image',
              attrs: { src: 'https://old-host/api/assets/file/org/image.png' },
            },
          ],
        },
        asset,
      ),
    ).toBe(true)
    expect(
      referencesAsset(
        {
          data: {
            image: { url: 'https://cms/api/assets/file/org%2Fimage.png' },
          },
        },
        asset,
      ),
    ).toBe(true)
  })
  it('does not treat similar IDs or URL keys as references', () => {
    expect(
      referencesAsset(
        {
          text: 'asset-id-other',
          url: 'https://cms/api/assets/file/org/image.png-other',
        },
        asset,
      ),
    ).toBe(false)
    expect(
      referencesAsset(
        { url: 'https://cms/api/assets/file/other/image.png' },
        asset,
      ),
    ).toBe(false)
  })
  it('still detects URLs that only match after parsing rewrites them', () => {
    for (const url of [
      'https://cms/api/assets/file/org/ima\tge.png',
      'https://cms/api/assets/file/org\\image.png',
      'https://cms/api/assets/file/org/%69mage.png',
      '/api/assets/file/org/./image.png',
    ]) {
      expect(referencesAsset({ url }, asset)).toBe(true)
    }
    expect(referencesAsset({ url: 'https://cms/unrelated' }, asset)).toBe(false)
  })
})

describe('asset reference pre-filter pattern', () => {
  // The pattern only uses syntax that JavaScript and PostgreSQL regexes read
  // the same way, and JSON.stringify escapes strings like jsonb::text does.
  const keeps = (value: unknown) =>
    new RegExp(assetReferencePattern([asset]) ?? '').test(JSON.stringify(value))

  it('keeps every document that references the asset', () => {
    for (const url of [
      'https://cms/api/assets/file/org/image.png',
      'https://cms/api/assets/file/org%2Fimage.png',
      'https://cms/api/assets/file/org/ima\tge.png',
      'https://cms/api/assets/file/org/ima\r\nge.png',
      'https://cms/api/assets/file/org\\image.png',
      'https://cms/api/assets/file/org/%69mage.png',
      'https://cms/api/assets/file/org/image%2Epng',
      'https://cms/api/assets/file/org/image%2epng',
      '/api/assets/file/org/./image.png',
    ]) {
      expect(referencesAsset({ url }, asset)).toBe(true)
      expect(keeps({ url })).toBe(true)
    }
    expect(keeps({ hero: asset.id })).toBe(true)
    expect(keeps({ key: asset.storageKey })).toBe(true)
  })

  it('drops documents that only contain a percent sign or a backslash', () => {
    expect(keeps({ title: 'Up to 50% off', path: 'C:\\temp' })).toBe(false)
    expect(keeps({ url: 'https://cms/api/assets/file/org/other.png' })).toBe(
      false,
    )
    expect(keeps({ text: 'imageXpng' })).toBe(false)
  })

  it('gives up (keeps every row) on ids or key segments with other characters', () => {
    expect(
      assetReferencePattern([{ id: 'a b', storageKey: 'org/image.png' }]),
    ).toBeNull()
    expect(
      assetReferencePattern([{ id: 'a', storageKey: 'org/my image.png' }]),
    ).toBeNull()
    expect(assetReferencePattern([])).toBeNull()
  })
})
