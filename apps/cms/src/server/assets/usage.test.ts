import { describe, expect, it } from 'vitest'
import { referencesAsset } from './usage'

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
