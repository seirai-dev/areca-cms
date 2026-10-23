import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { camelCollectionKeys, camelGlobalKeys } from './camel-case.js'
import { manifestFromConfig } from './config.js'
import { RESERVED_CONTENT_KEYS, RESERVED_IDENTIFIERS } from './identifiers.js'

const docs = readFileSync(
  fileURLToPath(new URL('../../../apps/docs/content/docs/sdk/errors-and-limits.mdx', import.meta.url)),
  'utf8',
)

/** The backticked names in the paragraph after the one that starts with `lead`. */
function namesAfter(lead: string): string[] {
  const start = docs.indexOf(lead)
  expect(start, lead).toBeGreaterThan(-1)
  const paragraph = docs.slice(start).split('\n\n')[1] ?? ''
  return [...paragraph.matchAll(/`([^`]+)`/g)].map((match) => match[1]!)
}

describe('errors and limits: reserved names', () => {
  it('lists every reserved identifier in the code, and nothing else', () => {
    expect([...namesAfter('No collection, site content section or field may use these names')].sort()).toEqual(
      [...RESERVED_IDENTIFIERS].sort(),
    )
  })

  it('lists every reserved content key in the code, and nothing else', () => {
    expect(
      [...namesAfter('A collection key or a site content key may not be one of these names')].sort(),
    ).toEqual([...RESERVED_CONTENT_KEYS].sort())
  })
})

describe('errors and limits: identifier messages', () => {
  // Each example is a real message for the input, and is quoted in the docs.
  const examples: Array<[string, () => unknown]> = [
    ['Unsafe collection or field identifier: manifest', () => camelCollectionKeys(['manifest'])],
    [
      'Collection "globals" uses the reserved name "globals". resolve, href, preview, globals, previewGlobals, in, languages and matchLocale are reserved.',
      () => camelCollectionKeys(['globals']),
    ],
    [
      'Global "preview-globals" uses the reserved name "previewGlobals". resolve, href, preview, globals, previewGlobals, in, languages and matchLocale are reserved.',
      () => camelGlobalKeys(['preview-globals']),
    ],
    ['Collection keys blog-posts and blog_posts both map to "blogPosts". Rename one of them.', () =>
      camelCollectionKeys(['blog-posts', 'blog_posts'])],
    ['Collection identifiers differ only by case: Articles, articles', () =>
      camelCollectionKeys(['Articles', 'articles'])],
    [
      'Duplicate field identifier: title',
      () =>
        manifestFromConfig({
          siteKey: 'acme',
          collections: {
            articles: {
              route: '/blog/$slug',
              fields: [
                { key: 'title', label: 'Title', type: 'text' },
                { key: 'title', label: 'Title again', type: 'text' },
              ],
            },
          },
        }),
    ],
  ]

  it.each(examples)('documents and produces "%s"', (message, thrower) => {
    expect(() => thrower()).toThrow(message)
    expect(docs).toContain(`\`${message}\``)
  })
})
