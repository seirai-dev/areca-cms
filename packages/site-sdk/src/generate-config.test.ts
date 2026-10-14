import { describe, expect, it } from 'vitest'
import { generateConfigSource } from './generate-config.js'
import type { SiteContentConfig } from './types.js'

const demoConfig: SiteContentConfig = {
  siteKey: 'acme-site',
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
        { key: 'heroImage', label: 'Hero image', type: 'image' },
        { key: 'publishedAt', label: 'Published at', type: 'datetime' },
        { key: 'category', label: 'Category', type: 'select', options: ['news', 'updates'] },
      ],
    },
  },
}

describe('generateConfigSource', () => {
  it('matches the demo-site config byte for byte', () => {
    expect(generateConfigSource(demoConfig)).toBe(
      `import { defineSiteContent } from '@areca-cms/site-sdk'

export default defineSiteContent({
  siteKey: 'acme-site',
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
        { key: 'heroImage', label: 'Hero image', type: 'image' },
        { key: 'publishedAt', label: 'Published at', type: 'datetime' },
        {
          key: 'category',
          label: 'Category',
          type: 'select',
          options: ['news', 'updates'],
        },
      ],
    },
  },
})
`,
    )
  })

  it('omits undefined optional properties', () => {
    const source = generateConfigSource({
      siteKey: 'demo',
      collections: {
        pages: {
          route: '/$slug',
          fields: [{ key: 'title', label: 'Title', type: 'text' }],
        },
      },
    })
    expect(source).toContain('      route: \'/$slug\',\n      fields: [')
    expect(source).not.toContain('label:\n')
    expect(source).not.toContain('undefined')
    expect(source).toContain("{ key: 'title', label: 'Title', type: 'text' },")
  })

  it('emits every optional field property when defined', () => {
    const source = generateConfigSource({
      siteKey: 'demo',
      collections: {
        events: {
          route: '/events/$slug',
          label: 'Events',
          fields: [
            {
              key: 'endsAt',
              label: 'Ends at',
              type: 'datetime',
              required: false,
              description: 'Must be after the start',
              after: 'startsAt',
            },
            { key: 'venue', label: 'Venue', type: 'reference', collection: 'venues' },
          ],
        },
      },
    })
    expect(source).toContain("required: false,")
    expect(source).toContain("description: 'Must be after the start',")
    expect(source).toContain("after: 'startsAt',")
    expect(source).toContain("collection: 'venues'")
  })

  it('quotes keys that are not valid identifiers', () => {
    const source = generateConfigSource({
      siteKey: 'demo',
      collections: {
        'blog-posts': {
          route: '/blog/$slug',
          fields: [{ key: 'og:title', label: 'OG title', type: 'text' }],
        },
        valid_$key1: { route: '/x/$slug', fields: [] },
      },
    })
    expect(source).toContain("    'blog-posts': {")
    expect(source).toContain("{ key: 'og:title', label: 'OG title', type: 'text' },")
    expect(source).toContain('    valid_$key1: {')
    expect(source).toContain('      fields: [],')
  })

  it('escapes quotes and newlines in strings', () => {
    const source = generateConfigSource({
      siteKey: 'demo',
      collections: {
        a: {
          route: '/a/$slug',
          label: "Al's \\ stuff",
          fields: [{ key: 'x', label: 'X', type: 'text', description: 'line1\nline2' }],
        },
      },
    })
    expect(source).toContain("label: 'Al\\'s \\\\ stuff',")
    expect(source).toContain("description: 'line1\\nline2' }")
  })

  it('sorts collections by key and preserves field order', () => {
    const source = generateConfigSource({
      siteKey: 'demo',
      collections: {
        zebra: { route: '/z/$slug', fields: [] },
        apple: {
          route: '/a/$slug',
          fields: [
            { key: 'b', label: 'B', type: 'text' },
            { key: 'a', label: 'A', type: 'text' },
          ],
        },
      },
    })
    expect(source.indexOf('apple:')).toBeLessThan(source.indexOf('zebra:'))
    expect(source.indexOf("key: 'b'")).toBeLessThan(source.indexOf("key: 'a'"))
  })

  it('handles an empty collections map', () => {
    expect(generateConfigSource({ siteKey: 'demo', collections: {} })).toBe(
      `import { defineSiteContent } from '@areca-cms/site-sdk'

export default defineSiteContent({
  siteKey: 'demo',
  collections: {},
})
`,
    )
  })

  it('keeps every generated line within 80 columns unless a single value is longer', () => {
    const source = generateConfigSource(demoConfig)
    for (const line of source.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80)
    }
  })
})

describe('generateConfigSource: globals', () => {
  const withGlobals: SiteContentConfig = {
    siteKey: 'acme-site',
    collections: {},
    globals: {
      companyInfo: {
        label: 'Company info',
        fields: [
          { key: 'email', label: 'Email', type: 'text', required: true, group: 'Contact' },
        ],
      },
      homePage: {
        label: 'Home page',
        seo: true,
        previewPath: '/about',
        fields: [{ key: 'heroTitle', label: 'Hero title', type: 'text' }],
      },
    },
  }

  it('writes a globals block with each section, its group and its seo and previewPath', () => {
    const source = generateConfigSource(withGlobals)
    expect(source).toContain('  globals: {\n')
    expect(source).toContain("    companyInfo: {\n      label: 'Company info',\n")
    expect(source).toContain("{ key: 'email', label: 'Email', type: 'text', required: true, group: 'Contact' },")
    expect(source).toContain("    homePage: {\n      label: 'Home page',\n      seo: true,\n      previewPath: '/about',\n")
  })

  it('writes the globals block after the collections block', () => {
    const source = generateConfigSource(withGlobals)
    expect(source.indexOf('  collections:')).toBeLessThan(source.indexOf('  globals: {'))
  })

  it('omits the globals block when there are no globals', () => {
    expect(generateConfigSource({ ...withGlobals, globals: {} })).not.toContain('globals')
    expect(generateConfigSource({ siteKey: 'demo', collections: {} })).not.toContain('globals')
  })

  it('sorts globals by key', () => {
    const source = generateConfigSource({
      ...withGlobals,
      globals: {
        zeta: { fields: [] },
        alpha: { fields: [] },
      },
    })
    expect(source.indexOf('    alpha: {')).toBeLessThan(source.indexOf('    zeta: {'))
  })
})
