import { describe, expect, it } from 'vitest'

import { assetThumbnail } from './utils'

const url = '/api/assets/file/org/a.png'

describe('assetThumbnail', () => {
  it('serves a file narrower than every copy as-is, with no srcset', () => {
    expect(
      assetThumbnail({ storageKey: 'org/a.png', width: 1 }, '240px'),
    ).toEqual({
      src: url,
    })
  })

  it('offers only smaller copies plus the original at its real width', () => {
    expect(
      assetThumbnail({ storageKey: 'org/a.png', width: 500 }, '240px'),
    ).toEqual({
      src: url,
      srcSet: `${url}?w=160 160w, ${url}?w=320 320w, ${url} 500w`,
      sizes: '240px',
    })
  })

  it('offers every copy for a large image', () => {
    expect(
      assetThumbnail({ storageKey: 'org/a.png', width: 4000 }, '240px'),
    ).toEqual({
      src: `${url}?w=640`,
      srcSet: `${url}?w=160 160w, ${url}?w=320 320w, ${url}?w=640 640w, ${url}?w=1280 1280w`,
      sizes: '240px',
    })
  })

  it('keeps every copy when the width is unknown', () => {
    expect(
      assetThumbnail({ storageKey: 'org/a.png', width: null }, '240px').srcSet,
    ).toContain('?w=1280 1280w')
  })
})
