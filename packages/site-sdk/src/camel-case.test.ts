import { describe, expect, it } from 'vitest'
import { camelizeSnapshot, toCamelKey } from './camel-case.js'
import type { CollectionConfig, SeoMeta, Snapshot } from './types.js'

function messageOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the call to throw')
}

describe('toCamelKey', () => {
  it.each([
    ['blog-posts', 'blogPosts'],
    ['cover_image', 'coverImage'],
    ['title', 'title'],
    ['heroImage', 'heroImage'],
    ['a-b-c', 'aBC'],
    ['cover-image_url', 'coverImageUrl'],
    ['blog--posts', 'blogPosts'],
    ['trailing-', 'trailing'],
    ['a', 'a'],
  ])('maps %s to %s', (raw, camel) => {
    expect(toCamelKey(raw)).toBe(camel)
  })

  it('keeps already camel-cased keys unchanged', () => {
    expect(toCamelKey('blogPosts')).toBe('blogPosts')
    expect(toCamelKey('heroImage')).toBe('heroImage')
  })
})

const seo = { title: 'Hello | Site' } as unknown as SeoMeta
const image = {
  url: 'https://cdn.test/a.jpg',
  width: 10,
  height: 20,
  alt: 'A',
  mimeType: 'image/jpeg',
}

const schema: Record<string, CollectionConfig> = {
  'blog-posts': {
    route: '/blog/$slug',
    label: 'Blog posts',
    fields: [
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'cover-image', label: 'Cover image', type: 'image' },
      { key: 'published-on', label: 'Published on', type: 'date' },
      {
        key: 'author',
        label: 'Author',
        type: 'reference',
        collection: 'authors',
      },
    ],
  },
  authors: {
    route: '/authors/$slug',
    label: 'Authors',
    fields: [
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      {
        key: 'best-post',
        label: 'Best post',
        type: 'reference',
        collection: 'blog-posts',
      },
    ],
  },
}

function snapshotFixture(): Snapshot {
  return {
    publicationId: 'pub',
    siteKey: 'site',
    createdAt: '2026-01-01T00:00:00.000Z',
    hash: 'h',
    collections: {
      'blog-posts': [
        {
          id: 'p1',
          slug: 'hello',
          publishedAt: '2026-01-02T00:00:00.000Z',
          seo,
          data: {
            slug: 'hello',
            title: 'Hello',
            'cover-image': image,
            'published-on': '2026-01-02',
            author: { collection: 'authors', slug: 'ada', id: 'a1' },
          },
        },
        {
          id: 'p2',
          slug: 'empty',
          publishedAt: null,
          data: {
            slug: 'empty',
            title: 'Empty',
            'cover-image': '',
            author: '',
          },
        },
      ],
      authors: [
        {
          id: 'a1',
          slug: 'ada',
          publishedAt: null,
          data: {
            slug: 'ada',
            name: 'Ada',
            'best-post': { collection: 'blog-posts', slug: 'hello', id: 'p1' },
          },
        },
      ],
    },
  }
}

describe('camelizeSnapshot', () => {
  it('camelizes file-level collection keys and adds collection to every entry', () => {
    const { collections } = camelizeSnapshot(snapshotFixture(), schema)
    expect(Object.keys(collections).sort()).toEqual(['authors', 'blogPosts'])
    expect(collections.blogPosts.map((entry) => entry.collection)).toEqual([
      'blogPosts',
      'blogPosts',
    ])
    expect(collections.authors[0]?.collection).toBe('authors')
  })

  it('camelizes data keys', () => {
    const { collections } = camelizeSnapshot(snapshotFixture(), schema)
    const [hello] = collections.blogPosts
    expect(hello?.data).toMatchObject({
      slug: 'hello',
      title: 'Hello',
      coverImage: image,
      publishedOn: '2026-01-02',
    })
    expect(hello?.data).not.toHaveProperty('cover-image')
    expect(hello?.data).not.toHaveProperty('published-on')
    expect(collections.authors[0]?.data).toHaveProperty('bestPost')
  })

  it('rewrites reference collection targets to camel keys, and keeps empty references', () => {
    const { collections } = camelizeSnapshot(snapshotFixture(), schema)
    expect(collections.blogPosts[0]?.data.author).toEqual({
      collection: 'authors',
      slug: 'ada',
      id: 'a1',
    })
    expect(collections.authors[0]?.data.bestPost).toEqual({
      collection: 'blogPosts',
      slug: 'hello',
      id: 'p1',
    })
    expect(collections.blogPosts[1]?.data.author).toBe('')
    expect(collections.blogPosts[1]?.data.coverImage).toBe('')
  })

  it('leaves seo, id, slug and publishedAt untouched', () => {
    const { collections } = camelizeSnapshot(snapshotFixture(), schema)
    const [hello, empty] = collections.blogPosts
    expect(hello).toMatchObject({
      id: 'p1',
      slug: 'hello',
      publishedAt: '2026-01-02T00:00:00.000Z',
      seo,
    })
    expect(empty).toMatchObject({ id: 'p2', slug: 'empty', publishedAt: null })
    expect(empty).not.toHaveProperty('seo')
  })

  it('does not mutate the snapshot it receives', () => {
    const snapshot = snapshotFixture()
    const before = structuredClone(snapshot)
    camelizeSnapshot(snapshot, schema)
    expect(snapshot).toEqual(before)
  })

  it('keeps a collection key that only contains a dash in the camel form', () => {
    const { collections } = camelizeSnapshot(
      {
        ...snapshotFixture(),
        collections: { 'href-link': [] },
      },
      { 'href-link': { route: '/$slug', fields: [] } },
    )
    expect(Object.keys(collections)).toEqual(['hrefLink'])
  })

  it.each(['resolve', 'href', 'preview'])(
    'rejects the reserved collection name %s',
    (name) => {
      const message = messageOf(() =>
        camelizeSnapshot(
          { ...snapshotFixture(), collections: { [name]: [] } },
          { [name]: { route: '/$slug', fields: [] } },
        ),
      )
      expect(message).toContain(name)
    },
  )

  it('rejects reserved collection names case-insensitively', () => {
    expect(() =>
      camelizeSnapshot(
        { ...snapshotFixture(), collections: { Preview: [] } },
        { Preview: { route: '/$slug', fields: [] } },
      ),
    ).toThrow(/Preview/)
  })

  it('accepts reserved words as field keys', () => {
    const { collections } = camelizeSnapshot(
      {
        ...snapshotFixture(),
        collections: {
          'blog-posts': [
            {
              id: 'p',
              slug: 's',
              publishedAt: null,
              data: { resolve: 'a', href: 'b', preview: 'c' },
            },
          ],
        },
      },
      {
        'blog-posts': {
          route: '/blog/$slug',
          fields: [
            { key: 'resolve', label: 'R', type: 'text' },
            { key: 'href', label: 'H', type: 'text' },
            { key: 'preview', label: 'P', type: 'text' },
          ],
        },
      },
    )
    expect(collections.blogPosts[0]?.data).toMatchObject({
      resolve: 'a',
      href: 'b',
      preview: 'c',
    })
  })

  it('rejects collection keys that map to the same camel key, naming both raw keys', () => {
    const message = messageOf(() =>
      camelizeSnapshot(
        {
          ...snapshotFixture(),
          collections: { 'blog-posts': [], blog_posts: [] },
        },
        {
          'blog-posts': { route: '/$slug', fields: [] },
          blog_posts: { route: '/$slug', fields: [] },
        },
      ),
    )
    expect(message).toContain('blog-posts')
    expect(message).toContain('blog_posts')
  })

  it('rejects field keys that map to the same camel key, naming both raw keys', () => {
    const message = messageOf(() =>
      camelizeSnapshot(
        {
          ...snapshotFixture(),
          collections: {
            'blog-posts': [
              { id: 'p', slug: 's', publishedAt: null, data: {} },
            ],
          },
        },
        {
          'blog-posts': {
            route: '/blog/$slug',
            fields: [
              { key: 'cover-image', label: 'A', type: 'image' },
              { key: 'coverImage', label: 'B', type: 'image' },
            ],
          },
        },
      ),
    )
    expect(message).toContain('cover-image')
    expect(message).toContain('coverImage')
  })

  it('rejects camel collection keys that differ only by case', () => {
    expect(() =>
      camelizeSnapshot(
        {
          ...snapshotFixture(),
          collections: { Articles: [], articles: [] },
        },
        {
          Articles: { route: '/$slug', fields: [] },
          articles: { route: '/$slug', fields: [] },
        },
      ),
    ).toThrow(/only by case/)
  })
})
