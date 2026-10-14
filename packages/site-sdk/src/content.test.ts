import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArecaClient } from './client.js'
import { createContent } from './content.js'
import { pullContent, readContentManifest } from './pull.js'
import type { Snapshot } from './types.js'

// Generated shape: camel keys, raw `key` kept for the CMS.
const schema = {
  authors: {
    key: 'authors',
    label: 'Authors',
    route: '/authors/$slug',
    fields: {
      slug: { key: 'slug', type: 'slug', required: true },
      name: { key: 'name', type: 'text', required: true },
      favoritePost: {
        key: 'favorite-post',
        type: 'reference',
        required: false,
        collection: 'blogPosts',
      },
    },
  },
  blogPosts: {
    key: 'blog-posts',
    label: 'Blog posts',
    route: '/blog/$slug',
    fields: {
      slug: { key: 'slug', type: 'slug', required: true },
      title: { key: 'title', type: 'text', required: true },
      summary: { key: 'summary', type: 'textarea', required: false },
      rating: { key: 'rating', type: 'number', required: false },
      publishedOn: { key: 'published-on', type: 'date', required: false },
      startsAt: { key: 'starts-at', type: 'datetime', required: false },
      category: {
        key: 'category',
        type: 'select',
        required: false,
        options: ['news', 'guides'],
      },
      featured: { key: 'featured', type: 'boolean', required: true },
      coverImage: { key: 'cover-image', type: 'image', required: false },
      author: {
        key: 'author',
        type: 'reference',
        required: false,
        collection: 'authors',
      },
    },
  },
  pages: {
    key: 'pages',
    route: '/$slug',
    fields: {
      slug: { key: 'slug', type: 'slug', required: true },
    },
  },
} as const

const IMAGE = {
  url: 'https://cdn.test/alpha.jpg',
  width: 800,
  height: 600,
  alt: 'Alpha',
  mimeType: 'image/jpeg',
}

// Raw CMS shape, as published. Entries keep this file order: alpha, beta, gamma, delta.
function rawSnapshot(alphaTitle = 'Alpha Guide'): Snapshot {
  return {
    publicationId: 'pub-1',
    siteKey: 'site',
    createdAt: '2026-02-11T00:00:00.000Z',
    hash: 'h1',
    schema: {
      'blog-posts': {
        route: '/blog/$slug',
        label: 'Blog posts',
        fields: [
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'summary', label: 'Summary', type: 'textarea' },
          { key: 'rating', label: 'Rating', type: 'number' },
          { key: 'published-on', label: 'Published on', type: 'date' },
          { key: 'starts-at', label: 'Starts at', type: 'datetime' },
          {
            key: 'category',
            label: 'Category',
            type: 'select',
            options: ['news', 'guides'],
          },
          { key: 'featured', label: 'Featured', type: 'boolean', required: true },
          { key: 'cover-image', label: 'Cover image', type: 'image' },
          { key: 'author', label: 'Author', type: 'reference', collection: 'authors' },
        ],
      },
      authors: {
        route: '/authors/$slug',
        label: 'Authors',
        fields: [
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'name', label: 'Name', type: 'text', required: true },
          {
            key: 'favorite-post',
            label: 'Favorite post',
            type: 'reference',
            collection: 'blog-posts',
          },
        ],
      },
    },
    collections: {
      'blog-posts': [
        {
          id: 'p1',
          slug: 'alpha',
          publishedAt: '2026-02-10T07:00:00.000Z',
          data: {
            slug: 'alpha',
            title: alphaTitle,
            summary: 'Intro',
            rating: 4,
            'published-on': '2026-02-10',
            'starts-at': '2026-02-10T09:00:00+02:00',
            category: 'guides',
            featured: true,
            'cover-image': IMAGE,
            author: { collection: 'authors', slug: 'ada', id: 'a1' },
          },
        },
        {
          id: 'p2',
          slug: 'beta',
          publishedAt: '2026-01-05T12:00:00.000Z',
          data: {
            slug: 'beta',
            title: 'Beta News',
            summary: null,
            rating: 5,
            'published-on': '2026-01-05',
            'starts-at': '2026-01-05T12:00:00Z',
            category: 'news',
            featured: false,
            'cover-image': '',
            author: { collection: 'authors', slug: 'grace', id: 'a2' },
          },
        },
        {
          id: 'p3',
          slug: 'gamma',
          publishedAt: '2026-02-10T09:00:00.000Z',
          data: {
            slug: 'gamma',
            title: 'gamma update',
            summary: '',
            'published-on': '2026-02-10',
            'starts-at': '2026-02-10T08:00:00-01:00',
            featured: true,
            'cover-image': null,
          },
        },
        {
          id: 'p4',
          slug: 'delta',
          publishedAt: null,
          data: {
            slug: 'delta',
            title: 'Delta',
            rating: 0,
            'published-on': null,
            category: 'news',
            featured: true,
            author: { collection: 'authors', slug: 'nobody', id: 'missing' },
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
            name: 'Ada Lovelace',
            'favorite-post': { collection: 'blog-posts', slug: 'alpha', id: 'p1' },
          },
        },
        {
          id: 'a2',
          slug: 'grace',
          publishedAt: null,
          data: { slug: 'grace', name: 'grace hopper', 'favorite-post': '' },
        },
      ],
    },
  }
}

const directories: string[] = []
const previousFetch = globalThis.fetch
const previousPin = process.env.ARECA_SNAPSHOT_ID
const previousCwd = process.cwd()
let served: { snapshot?: unknown; preview?: unknown } = {}
let previewRequests: string[] = []

afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  globalThis.fetch = previousFetch
  process.chdir(previousCwd)
  served = {}
  previewRequests = []
  if (previousPin === undefined) delete process.env.ARECA_SNAPSHOT_ID
  else process.env.ARECA_SNAPSHOT_ID = previousPin
})

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'areca-content-'))
  directories.push(value)
  return value
}

/** Serves the CMS endpoints the SDK calls, from `served`. */
function fakeCms() {
  delete process.env.ARECA_SNAPSHOT_ID
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/sites/snapshot/current') {
      return Response.json(served.snapshot)
    }
    if (url.pathname === '/api/sites/preview') {
      previewRequests.push(url.search)
      return Response.json(served.preview)
    }
    return new Response('not found', { status: 404 })
  }
}

function clientFor() {
  return createArecaClient({ cmsUrl: 'https://cms.test', siteToken: 'site-token' })
}

async function publish(outDir: string, snapshot: Snapshot) {
  fakeCms()
  served.snapshot = snapshot
  return pullContent({ outDir, client: clientFor() })
}

async function setup() {
  const outDir = directory()
  await publish(outDir, rawSnapshot())
  return { outDir, content: createContent({ schema, dir: outDir }) }
}

function slugs(entries: { slug: string }[]): string[] {
  return entries.map((entry) => entry.slug)
}

describe('createContent: reads pulled content', () => {
  it('returns every entry in pulled (file) order by default', async () => {
    const { content } = await setup()
    expect(slugs(content.blogPosts.all())).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })

  it('tags each entry with its camel collection key', async () => {
    const { content } = await setup()
    expect(content.blogPosts.all().map((entry) => entry.collection)).toEqual([
      'blogPosts',
      'blogPosts',
      'blogPosts',
      'blogPosts',
    ])
    expect(content.authors.first()?.collection).toBe('authors')
  })

  it('camelizes data keys in reads', async () => {
    const { content } = await setup()
    const alpha = content.blogPosts.get('alpha')
    expect(alpha?.data).toMatchObject({
      title: 'Alpha Guide',
      publishedOn: '2026-02-10',
      startsAt: '2026-02-10T09:00:00+02:00',
      coverImage: IMAGE,
    })
    expect(alpha?.data).not.toHaveProperty('cover-image')
  })

  it('first, get and byId find entries and return undefined when missing', async () => {
    const { content } = await setup()
    expect(content.blogPosts.first()?.slug).toBe('alpha')
    expect(content.blogPosts.first({ where: { featured: false } })?.slug).toBe('beta')
    expect(content.blogPosts.first({ where: { title: 'nope' } })).toBeUndefined()
    expect(content.blogPosts.get('beta')?.data.title).toBe('Beta News')
    expect(content.blogPosts.get('nope')).toBeUndefined()
    expect(content.blogPosts.byId('p3')?.slug).toBe('gamma')
    expect(content.blogPosts.byId('missing')).toBeUndefined()
  })

  it('returns an empty list for a collection absent from the publication', async () => {
    const { content } = await setup()
    expect(content.pages.all()).toEqual([])
    expect(content.pages.first()).toBeUndefined()
    expect(content.pages.get('home')).toBeUndefined()
  })
})

describe('createContent: where', () => {
  it.each<[string, Record<string, unknown>, string[]]>([
    ['shorthand equality', { category: 'news' }, ['beta', 'delta']],
    ['explicit eq', { category: { eq: 'guides' } }, ['alpha']],
    ['ne on text', { title: { ne: 'Beta News' } }, ['alpha', 'gamma', 'delta']],
    ['ne on boolean', { featured: { ne: true } }, ['beta']],
    ['shorthand boolean', { featured: true }, ['alpha', 'gamma', 'delta']],
    ['shorthand number zero', { rating: 0 }, ['delta']],
    ['in', { category: { in: ['news', 'guides'] } }, ['alpha', 'beta', 'delta']],
    ['notIn', { title: { notIn: ['Beta News', 'Delta'] } }, ['alpha', 'gamma']],
    ['number gt', { rating: { gt: 4 } }, ['beta']],
    ['number gte', { rating: { gte: 4 } }, ['alpha', 'beta']],
    ['number lt', { rating: { lt: 4 } }, ['delta']],
    ['number lte', { rating: { lte: 0 } }, ['delta']],
    ['date gt', { publishedOn: { gt: '2026-02-01' } }, ['alpha', 'gamma']],
    ['date gte', { publishedOn: { gte: '2026-02-10' } }, ['alpha', 'gamma']],
    ['date lt', { publishedOn: { lt: '2026-02-10' } }, ['beta']],
    ['date lte', { publishedOn: { lte: '2026-02-10' } }, ['alpha', 'beta', 'gamma']],
    [
      'datetime gte with a Z offset compares instants',
      { startsAt: { gte: '2026-02-10T07:00:00Z' } },
      ['alpha', 'gamma'],
    ],
    [
      'datetime lte compares instants across offsets, not strings',
      { startsAt: { lte: '2026-02-10T08:00:00Z' } },
      ['alpha', 'beta'],
    ],
    ['contains is case-insensitive (upper query)', { title: { contains: 'UPDATE' } }, ['gamma']],
    ['contains is case-insensitive (lower query)', { title: { contains: 'guide' } }, ['alpha']],
    [
      'isNull true treats null, empty string and missing as null',
      { summary: { isNull: true } },
      ['beta', 'gamma', 'delta'],
    ],
    ['isNull false', { summary: { isNull: false } }, ['alpha']],
    ['isNull false on a reference', { author: { isNull: false } }, ['alpha', 'beta', 'delta']],
    ['isNull true on an image', { coverImage: { isNull: true } }, ['beta', 'gamma', 'delta']],
    ['keys are AND-ed', { category: 'news', featured: true }, ['delta']],
    ['keys are AND-ed with false', { category: 'news', featured: false }, ['beta']],
  ])('%s', async (_label, where, expected) => {
    const { content } = await setup()
    expect(slugs(content.blogPosts.all({ where }))).toEqual(expected)
  })
})

describe('createContent: orderBy, limit and offset', () => {
  it.each<[string, unknown, string[]]>([
    ['number asc, nulls last', { rating: 'asc' }, ['delta', 'alpha', 'beta', 'gamma']],
    ['number desc, nulls last', { rating: 'desc' }, ['beta', 'alpha', 'delta', 'gamma']],
    ['text asc', { title: 'asc' }, ['alpha', 'beta', 'delta', 'gamma']],
    ['text desc', { title: 'desc' }, ['gamma', 'delta', 'beta', 'alpha']],
    [
      'date asc, nulls last, ties keep file order',
      { publishedOn: 'asc' },
      ['beta', 'alpha', 'gamma', 'delta'],
    ],
    [
      'date desc, nulls last, ties keep file order',
      { publishedOn: 'desc' },
      ['alpha', 'gamma', 'beta', 'delta'],
    ],
    [
      'array tie-breaker (desc on title)',
      [{ publishedOn: 'desc' }, { title: 'desc' }],
      ['gamma', 'alpha', 'beta', 'delta'],
    ],
    [
      'array tie-breaker (asc on title)',
      [{ publishedOn: 'desc' }, { title: 'asc' }],
      ['alpha', 'gamma', 'beta', 'delta'],
    ],
  ])('%s', async (_label, orderBy, expected) => {
    const { content } = await setup()
    expect(slugs(content.blogPosts.all({ orderBy: orderBy as never }))).toEqual(expected)
  })

  it.each([['asc'], ['desc']] as const)(
    'sorts empty text last in %s order',
    async (direction) => {
      const { content } = await setup()
      const result = slugs(content.blogPosts.all({ orderBy: { summary: direction } }))
      // Only alpha has a summary, so it leads in both directions.
      expect(result[0]).toBe('alpha')
      expect(new Set(result.slice(1))).toEqual(new Set(['beta', 'gamma', 'delta']))
    },
  )

  it.each<[string, Record<string, number>, string[]]>([
    ['limit', { limit: 2 }, ['alpha', 'beta']],
    ['offset', { offset: 1 }, ['beta', 'gamma', 'delta']],
    ['offset and limit', { offset: 1, limit: 2 }, ['beta', 'gamma']],
    ['offset past the end', { offset: 10 }, []],
  ])('applies %s', async (_label, options, expected) => {
    const { content } = await setup()
    expect(slugs(content.blogPosts.all(options))).toEqual(expected)
  })

  it('applies limit after ordering', async () => {
    const { content } = await setup()
    expect(
      slugs(content.blogPosts.all({ orderBy: { rating: 'desc' }, limit: 2 })),
    ).toEqual(['beta', 'alpha'])
  })
})

describe('createContent: with', () => {
  it('expands a reference one level, keeping unresolvable as null and missing as undefined', async () => {
    const { content } = await setup()
    const [alpha, beta, gamma, delta] = content.blogPosts.all({
      with: { author: true },
    })
    expect(alpha?.data.author).toMatchObject({
      collection: 'authors',
      slug: 'ada',
      data: { name: 'Ada Lovelace' },
    })
    expect(beta?.data.author).toMatchObject({ slug: 'grace' })
    expect(gamma?.data.author).toBeUndefined()
    expect(delta?.data.author).toBeNull()
  })

  it('expands only one level', async () => {
    const { content } = await setup()
    const [ada] = content.authors.all({ with: { favoritePost: true } })
    expect(ada?.data.favoritePost).toMatchObject({ collection: 'blogPosts', slug: 'alpha' })
    expect(ada?.data.favoritePost?.data.author).toEqual({
      collection: 'authors',
      slug: 'ada',
      id: 'a1',
    })
  })

  it('turns an empty reference into null', async () => {
    const { content } = await setup()
    const grace = content.authors.get('grace')
    const [, expanded] = content.authors.all({ with: { favoritePost: true } })
    expect(grace?.data.favoritePost).toBe('')
    expect(expanded?.data.favoritePost).toBeNull()
  })

  it('does not mutate cached data', async () => {
    const { content } = await setup()
    content.blogPosts.all({ with: { author: true } })
    expect(content.blogPosts.get('alpha')?.data.author).toEqual({
      collection: 'authors',
      slug: 'ada',
      id: 'a1',
    })
  })
})

describe('createContent: resolve and href', () => {
  it('resolves a reference by id in the target collection', async () => {
    const { content } = await setup()
    expect(
      content.resolve({ collection: 'authors', slug: 'ada', id: 'a1' })?.data.name,
    ).toBe('Ada Lovelace')
    expect(
      content.resolve({ collection: 'authors', slug: 'ada', id: 'wrong' }),
    ).toBeNull()
  })

  it.each([null, '', undefined])('resolves %j to null', async (value) => {
    const { content } = await setup()
    expect(content.resolve(value as never)).toBeNull()
  })

  it('builds hrefs from entries, slugs and references', async () => {
    const { content } = await setup()
    const alpha = content.blogPosts.get('alpha')!
    expect(content.blogPosts.href(alpha)).toBe('/blog/alpha')
    expect(content.blogPosts.href('alpha')).toBe('/blog/alpha')
    expect(content.authors.href('ada')).toBe('/authors/ada')
    expect(content.href({ collection: 'authors', slug: 'ada', id: 'a1' })).toBe(
      '/authors/ada',
    )
    expect(content.href(alpha)).toBe('/blog/alpha')
  })

  it('URI-encodes slugs', async () => {
    const { content } = await setup()
    expect(content.blogPosts.href('a b/ü')).toBe('/blog/a%20b%2F%C3%BC')
    expect(
      content.href({ collection: 'blogPosts', slug: 'a b', id: 'x' }),
    ).toBe('/blog/a%20b')
  })
})

describe('createContent: caching and generations', () => {
  it('does not re-read a collection file within one generation', async () => {
    const { outDir, content } = await setup()
    const first = content.blogPosts.all()
    const { generation } = readContentManifest(outDir)
    // The cached read keeps working even when the file is gone.
    rmSync(join(outDir, '.publications', generation!, 'blogPosts.json'))
    expect(content.blogPosts.all()).toEqual(first)
  })

  it('picks up a new generation on the next call', async () => {
    const { outDir, content } = await setup()
    expect(content.blogPosts.get('alpha')?.data.title).toBe('Alpha Guide')
    await publish(outDir, rawSnapshot('Alpha v2'))
    expect(content.blogPosts.get('alpha')?.data.title).toBe('Alpha v2')
  })

  it('resolves dir against process.cwd() at call time', async () => {
    const { outDir } = await setup()
    const root = join(outDir, '..')
    process.chdir(root)
    const relative = outDir.slice(root.length + 1)
    const content = createContent({ schema, dir: relative })
    expect(slugs(content.blogPosts.all())).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })
})

describe('createContent: preview', () => {
  // The same schema with a required reference, so a draft can be missing one.
  const draftSchema = {
    ...schema,
    blogPosts: {
      ...schema.blogPosts,
      fields: {
        ...schema.blogPosts.fields,
        editor: { key: 'editor', type: 'reference', required: true, collection: 'authors' },
      },
    },
  } as const

  it('fetches the preview and returns the camelized entry narrowed by collection', async () => {
    fakeCms()
    served.preview = {
      collection: 'blog-posts',
      slug: 'alpha',
      entry: rawSnapshot().collections['blog-posts']![0],
    }
    const content = createContent({ schema, dir: directory() })
    const result = await content.preview('tok', { client: clientFor() })

    expect(previewRequests).toEqual(['?token=tok'])
    expect(result.collection).toBe('blogPosts')
    expect(result.slug).toBe('alpha')
    expect(result.complete).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.entry.collection).toBe('blogPosts')
    expect(result.entry.data).toMatchObject({
      title: 'Alpha Guide',
      coverImage: IMAGE,
      publishedOn: '2026-02-10',
    })
    expect(result.entry.data).not.toHaveProperty('cover-image')
  })

  it('rewrites reference targets in preview entries to camel keys', async () => {
    fakeCms()
    served.preview = {
      collection: 'authors',
      slug: 'ada',
      entry: rawSnapshot().collections.authors![0],
    }
    const content = createContent({ schema, dir: directory() })
    const result = await content.preview('tok', { client: clientFor() })
    expect(result.collection).toBe('authors')
    expect(result.entry.data).toMatchObject({
      favoritePost: { collection: 'blogPosts', slug: 'alpha', id: 'p1' },
    })
  })

  it('returns an incomplete draft with camel issue keys and the entry still camelized', async () => {
    fakeCms()
    served.preview = {
      collection: 'blog-posts',
      slug: 'draft',
      entry: {
        id: 'p9',
        slug: 'draft',
        publishedAt: null,
        data: {
          slug: 'draft',
          title: '',
          featured: true,
          'published-on': 'soon',
          'cover-image': null,
          author: null,
          editor: null,
        },
      },
    }
    const content = createContent({ schema: draftSchema, dir: directory() })
    const result = await content.preview('tok', { client: clientFor() })

    expect(result.collection).toBe('blogPosts')
    expect(result.complete).toBe(false)
    expect(result.issues).toEqual([
      'title: is required',
      'publishedOn: must be a YYYY-MM-DD date',
      'editor: is required',
    ])
    expect(result.entry.collection).toBe('blogPosts')
    expect(result.entry.data).toMatchObject({
      slug: 'draft',
      title: '',
      publishedOn: 'soon',
      coverImage: null,
      editor: null,
      featured: true,
    })
    expect(result.entry.data).not.toHaveProperty('published-on')
  })

  it('throws for a collection that is not in the schema', async () => {
    fakeCms()
    served.preview = { collection: 'mystery', slug: 'x', entry: rawSnapshot().collections['blog-posts']![0] }
    const content = createContent({ schema, dir: directory() })
    await expect(content.preview('tok', { client: clientFor() })).rejects.toThrow(
      /mystery/,
    )
  })
})

describe('createContent: globals', () => {
  // Generated shape of the site-content globals: camel keys, raw `key` kept for the CMS.
  const globalSchema = {
    companyInfo: {
      key: 'company-info',
      label: 'Company info',
      seo: false,
      fields: {
        email: { key: 'email', type: 'text', required: true },
        phoneNumber: { key: 'phone-number', type: 'text', required: false },
        logo: { key: 'logo', type: 'image', required: true },
      },
    },
    homePage: {
      key: 'home-page',
      label: 'Home page',
      seo: true,
      previewPath: '/',
      fields: {
        heroTitle: { key: 'hero-title', type: 'text', required: true },
      },
    },
  } as const

  const SEO = { title: 'Home | Acme' } as never

  function withGlobals(email = 'hi@acme.test'): Snapshot {
    return {
      ...rawSnapshot(),
      globalSchema: {
        'company-info': {
          label: 'Company info',
          seo: false,
          fields: [
            { key: 'email', label: 'Email', type: 'text', required: true },
            { key: 'phone-number', label: 'Phone number', type: 'text' },
            { key: 'logo', label: 'Logo', type: 'image', required: true },
          ],
        },
        'home-page': {
          label: 'Home page',
          seo: true,
          previewPath: '/',
          fields: [{ key: 'hero-title', label: 'Hero title', type: 'text', required: true }],
        },
      },
      globals: {
        'company-info': {
          id: 'g1',
          publishedAt: '2026-03-01T00:00:00.000Z',
          data: { email, 'phone-number': '+31 20 000', logo: IMAGE },
        },
        'home-page': {
          id: 'g2',
          publishedAt: null,
          data: { 'hero-title': 'Welcome' },
          seo: SEO,
        },
      },
    }
  }

  it('returns the pulled data of each global under its camel key', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })

    expect(content.globals.companyInfo.email).toBe('hi@acme.test')
    expect(content.globals.companyInfo.phoneNumber).toBe('+31 20 000')
    expect(content.globals.homePage.heroTitle).toBe('Welcome')
  })

  it('adds $seo only to globals with seo enabled', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })

    expect(content.globals.homePage.$seo).toEqual(SEO)
    expect(content.globals.companyInfo).not.toHaveProperty('$seo')
  })

  it('picks up a new generation on the next read', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals('first@acme.test'))
    const content = createContent({ schema, globalSchema, dir: outDir })
    expect(content.globals.companyInfo.email).toBe('first@acme.test')

    await publish(outDir, withGlobals('second@acme.test'))
    expect(content.globals.companyInfo.email).toBe('second@acme.test')
  })

  it('rejects globals as a collection name, like resolve, href and preview', () => {
    expect(() =>
      createContent({
        schema: { ...schema, globals: schema.pages } as unknown as typeof schema,
        dir: directory(),
      }),
    ).toThrow(/reserved/)
  })

  it('rejects previewGlobals as a collection name, since it is a content member', () => {
    expect(() =>
      createContent({
        schema: { ...schema, previewGlobals: schema.pages } as unknown as typeof schema,
        dir: directory(),
      }),
    ).toThrow(/reserved/)
  })

  it('previewGlobals overlays a valid draft and names the previewed section', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })
    fakeCms()
    served.preview = {
      kind: 'global',
      global: 'company-info',
      entry: {
        id: 'g1',
        publishedAt: null,
        data: { email: 'draft@acme.test', 'phone-number': '', logo: IMAGE },
      },
    }

    const preview = await content.previewGlobals('tok', { client: clientFor() })

    expect(previewRequests).toEqual(['?token=tok'])
    expect(preview.previewing).toBe('companyInfo')
    expect(preview.complete).toBe(true)
    expect(preview.issues).toEqual([])
    expect(preview.globals.companyInfo.email).toBe('draft@acme.test')
    expect(preview.globals.companyInfo.phoneNumber).toBe('')
    expect(preview.globals.homePage).toEqual(content.globals.homePage)
  })

  it('previewGlobals keeps the published section for an incomplete draft and lists the issues', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })
    fakeCms()
    served.preview = {
      kind: 'global',
      global: 'company-info',
      entry: {
        id: 'g1',
        publishedAt: null,
        data: { email: '', 'phone-number': '+31 99', logo: null },
      },
    }

    const preview = await content.previewGlobals('tok', { client: clientFor() })

    expect(preview.previewing).toBe('companyInfo')
    expect(preview.complete).toBe(false)
    expect(preview.issues).toEqual(['email: is required', 'logo: is required'])
    // The published section stays typed and readable: the required image is still an object.
    expect(preview.globals.companyInfo).toEqual(content.globals.companyInfo)
    expect(preview.globals.companyInfo.logo.url).toBe(IMAGE.url)
    expect(preview.globals.companyInfo.email).toBe('hi@acme.test')
    expect(preview.globals.homePage).toEqual(content.globals.homePage)
  })

  it('previewGlobals reports wrong field types under camel keys', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })
    fakeCms()
    served.preview = {
      kind: 'global',
      global: 'company-info',
      entry: {
        id: 'g1',
        publishedAt: null,
        data: { email: 'draft@acme.test', 'phone-number': 42, logo: IMAGE },
      },
    }

    const preview = await content.previewGlobals('tok', { client: clientFor() })

    expect(preview.complete).toBe(false)
    expect(preview.issues).toEqual(['phoneNumber: must be a string'])
    expect(preview.globals.companyInfo.email).toBe('hi@acme.test')
  })

  it('previewGlobals returns the published globals and no section for a falsy token without a request', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })
    fakeCms()

    for (const token of [null, undefined, '']) {
      expect(await content.previewGlobals(token, { client: clientFor() })).toEqual({
        globals: content.globals,
        previewing: null,
        complete: true,
        issues: [],
      })
    }
    expect(previewRequests).toEqual([])
  })

  it('previewGlobals ignores an entry preview token and returns the published globals', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })
    fakeCms()
    served.preview = {
      kind: 'entry',
      collection: 'blog-posts',
      slug: 'alpha',
      entry: rawSnapshot().collections['blog-posts']![0],
    }

    expect(await content.previewGlobals('tok', { client: clientFor() })).toEqual({
      globals: content.globals,
      previewing: null,
      complete: true,
      issues: [],
    })
    expect(previewRequests).toEqual(['?token=tok'])
  })

  it('previewGlobals overlays a valid PreviewResult without a request', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })
    fakeCms()
    const result = {
      kind: 'global' as const,
      global: 'company-info',
      entry: {
        id: 'g1',
        publishedAt: null,
        data: { email: 'draft@acme.test', 'phone-number': '', logo: IMAGE },
      },
    }

    const preview = await content.previewGlobals(result, { client: clientFor() })

    expect(previewRequests).toEqual([])
    expect(preview.previewing).toBe('companyInfo')
    expect(preview.complete).toBe(true)
    expect(preview.globals.companyInfo.email).toBe('draft@acme.test')
    expect(preview.globals.homePage).toEqual(content.globals.homePage)
  })

  it('previewGlobals falls back for an incomplete PreviewResult without a request', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })
    fakeCms()
    const result = {
      kind: 'global' as const,
      global: 'company-info',
      entry: { id: 'g1', publishedAt: null, data: { email: '', logo: null } },
    }

    const preview = await content.previewGlobals(result, { client: clientFor() })

    expect(previewRequests).toEqual([])
    expect(preview.complete).toBe(false)
    expect(preview.issues).toEqual(['email: is required', 'logo: is required'])
    expect(preview.globals.companyInfo.email).toBe('hi@acme.test')
  })

  it('previewGlobals returns the published globals for an entry PreviewResult without a request', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })
    fakeCms()
    const result = {
      kind: 'entry' as const,
      collection: 'blog-posts',
      slug: 'alpha',
      entry: rawSnapshot().collections['blog-posts']![0],
    }

    expect(await content.previewGlobals(result, { client: clientFor() })).toEqual({
      globals: content.globals,
      previewing: null,
      complete: true,
      issues: [],
    })
    expect(previewRequests).toEqual([])
  })

  it('preview() still returns the entry for a kind: entry response', async () => {
    const outDir = directory()
    await publish(outDir, withGlobals())
    const content = createContent({ schema, globalSchema, dir: outDir })
    fakeCms()
    served.preview = {
      kind: 'entry',
      collection: 'blog-posts',
      slug: 'alpha',
      entry: rawSnapshot().collections['blog-posts']![0],
    }

    const result = await content.preview('tok', { client: clientFor() })
    expect(result.collection).toBe('blogPosts')
    expect(result.entry.collection).toBe('blogPosts')
  })
})
