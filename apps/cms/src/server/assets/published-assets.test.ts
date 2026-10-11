import { describe, expect, it } from 'vitest'

import { referencedStorageKeys } from './published-assets'

describe('referencedStorageKeys', () => {
  it('finds file URLs in fields, SEO, JSON-LD, Markdown and HTML', () => {
    const keys = referencedStorageKeys({
      articles: [
        {
          data: {
            hero: { url: 'https://cms.test/api/assets/file/org/a.png' },
            body: {
              markdown:
                '![x](https://old-cms.test/api/assets/file/org/b.jpg) [pdf](https://cms.test/api/assets/file/org/c.pdf).',
              html: '<img src="https://cms.test/api/assets/file/org/b.jpg">',
            },
          },
          seo: {
            jsonLd: [
              { image: ['https://cms.test/api/assets/file/org/d.webp'] },
            ],
          },
        },
      ],
    })
    expect([...keys].sort()).toEqual([
      'org/a.png',
      'org/b.jpg',
      'org/c.pdf',
      'org/d.webp',
    ])
  })

  it('ignores other URLs and partial matches', () => {
    expect(
      referencedStorageKeys([
        'https://images.test/photo.jpg',
        '/api/assets/file/',
        '/api/assets/file/no-extension',
        'https://cms.test/api/assets/upload',
      ]).size,
    ).toBe(0)
  })
})
