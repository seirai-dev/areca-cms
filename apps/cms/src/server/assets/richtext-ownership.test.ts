import { describe, expect, it } from 'vitest'
import { RICHTEXT_MAX_NODES } from '#/lib/content-limits'
import {
  richTextAssetRefs,
  richTextAssetsAuthorizedFrom,
} from './richtext-ownership'

describe('untrusted rich-text asset traversal', () => {
  it('rejects deeply nested input without overflowing the stack', () => {
    let value: unknown = {
      type: 'image',
      attrs: { src: '/api/assets/file/hidden.png' },
    }
    for (let i = 0; i < RICHTEXT_MAX_NODES + 1; i++)
      value = { content: [value] }
    expect(richTextAssetRefs(value).malformed).toBe(true)
    expect(
      richTextAssetsAuthorizedFrom(value, { byStorageKey: new Map() }),
    ).toBe(false)
  })

  it('preserves decoded image ownership checks and rejects malformed URLs', () => {
    const document = {
      content: [
        {
          type: 'image',
          attrs: { src: '/api/assets/file/folder%2Fimage.png' },
        },
      ],
    }
    expect(richTextAssetRefs(document)).toEqual({
      storageKeys: ['folder/image.png'],
      malformed: false,
    })
    expect(
      richTextAssetsAuthorizedFrom(document, {
        byStorageKey: new Map([['folder/image.png', {}]]),
      }),
    ).toBe(true)
    expect(
      richTextAssetRefs({
        type: 'image',
        attrs: { src: '/api/assets/file/%broken' },
      }).malformed,
    ).toBe(true)
  })
})
