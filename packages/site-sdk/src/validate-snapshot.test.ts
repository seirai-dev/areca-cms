import { describe, expect, it } from 'vitest'
import { validateSnapshot } from './validate-snapshot.js'
import type { CollectionConfig, Snapshot } from './types.js'

const schema: Record<string, CollectionConfig> = {
  authors: {
    route: '/authors/$slug',
    label: 'Authors',
    fields: [
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
    ],
  },
  articles: {
    route: '/blog/$slug',
    label: 'Articles',
    fields: [
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'summary', label: 'Summary', type: 'textarea' },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'body', label: 'Body', type: 'richtext', required: true },
      { key: 'sidebar', label: 'Sidebar', type: 'richtext' },
      { key: 'cover-image', label: 'Cover image', type: 'image' },
      { key: 'published-on', label: 'Published on', type: 'date' },
      { key: 'starts-at', label: 'Starts at', type: 'datetime' },
      {
        key: 'category',
        label: 'Category',
        type: 'select',
        options: ['news', 'guides'],
      },
      { key: 'tag', label: 'Tag', type: 'select' },
      {
        key: 'author',
        label: 'Author',
        type: 'reference',
        collection: 'authors',
      },
      { key: 'featured', label: 'Featured', type: 'boolean', required: true },
      { key: 'promoted', label: 'Promoted', type: 'boolean' },
      { key: 'rating', label: 'Rating', type: 'number' },
    ],
  },
}

const richtext = {
  json: { type: 'doc' },
  markdown: 'Hi',
  document: { type: 'root', children: [] },
  html: '<p>Hi</p>',
}
const image = {
  url: 'https://cdn.test/a.jpg',
  width: 10,
  height: null,
  alt: 'Alt',
  mimeType: 'image/jpeg',
}
const validArticle: Record<string, unknown> = {
  slug: 'hello',
  title: 'Hello',
  summary: 'Intro',
  website: 'https://example.com',
  body: richtext,
  sidebar: richtext,
  'cover-image': image,
  'published-on': '2026-01-02',
  'starts-at': '2026-01-02T10:00:00+02:00',
  category: 'news',
  tag: 'anything',
  author: { collection: 'authors', slug: 'ada', id: 'a1' },
  featured: true,
  promoted: false,
  rating: 4.5,
}

function snapshotWith(
  articles: Record<string, unknown>[],
): Snapshot {
  return {
    publicationId: 'pub',
    siteKey: 'site',
    createdAt: '',
    hash: 'h',
    collections: {
      authors: [
        {
          id: 'a1',
          slug: 'ada',
          publishedAt: null,
          data: { slug: 'ada', name: 'Ada' },
        },
      ],
      articles: articles.map((data, index) => ({
        id: `e${index}`,
        slug: String(data.slug),
        publishedAt: null,
        data,
      })),
    },
  }
}

function articleSnapshot(patch: Record<string, unknown> = {}, remove: string[] = []) {
  const data: Record<string, unknown> = { ...validArticle, ...patch }
  for (const key of remove) delete data[key]
  return snapshotWith([data])
}

describe('validateSnapshot', () => {
  it('accepts a realistic snapshot covering all 12 field types', () => {
    expect(() => validateSnapshot(snapshotWith([validArticle]), schema)).not.toThrow()
  })

  it.each([
    ['required field missing', { }, ['title'], 'title'],
    ['required field null', { title: null }, [], 'title'],
    ['required field empty string', { title: '' }, [], 'title'],
    ['required richtext missing', {}, ['body'], 'body'],
    ['required boolean missing', {}, ['featured'], 'featured'],
    ['required boolean null', { featured: null }, [], 'featured'],
    ['text with a number', { title: 5 }, [], 'title'],
    ['textarea with a number', { summary: 3 }, [], 'summary'],
    ['url with a boolean', { website: false }, [], 'website'],
    ['number sent as a string', { rating: '4' }, [], 'rating'],
    ['boolean sent as a string', { featured: 'yes' }, [], 'featured'],
    ['date sent as a number', { 'published-on': 20260102 }, [], 'published-on'],
    ['richtext sent as a string', { body: 'text' }, [], 'body'],
    ['image sent as a string', { 'cover-image': 'https://cdn.test/a.jpg' }, [], 'cover-image'],
    ['NaN number', { rating: Number.NaN }, [], 'rating'],
    ['Infinite number', { rating: Number.POSITIVE_INFINITY }, [], 'rating'],
    ['select value not in options', { category: 'sports' }, [], 'category'],
    ['date not YYYY-MM-DD (no leading zeros)', { 'published-on': '2026-1-2' }, [], 'published-on'],
    ['date with a time part', { 'published-on': '2026-01-02T00:00:00Z' }, [], 'published-on'],
    ['unparsable datetime', { 'starts-at': 'not a date' }, [], 'starts-at'],
    ['image without the required shape', { 'cover-image': { url: '/a.jpg' } }, [], 'cover-image'],
    ['image with a string width', { 'cover-image': { ...image, width: '10' } }, [], 'cover-image'],
    [
      'image without alt',
      {
        'cover-image': {
          url: image.url,
          width: 10,
          height: null,
          mimeType: 'image/jpeg',
        },
      },
      [],
      'cover-image',
    ],
    ['reference to the wrong collection', { author: { collection: 'events', slug: 'x', id: 'e' } }, [], 'author'],
    ['reference without id', { author: { collection: 'authors', slug: 'ada' } }, [], 'author'],
    ['reference sent as a plain string', { author: 'ada' }, [], 'author'],
    ['richtext without html', { body: { ...richtext, html: undefined } }, [], 'body'],
    ['richtext with non-string markdown', { body: { ...richtext, markdown: 1 } }, [], 'body'],
    ['richtext without document', { body: { ...richtext, document: undefined } }, [], 'body'],
    ['richtext without json', { body: { ...richtext, json: undefined } }, [], 'body'],
    ['optional boolean sent as empty string', { promoted: '' }, [], 'promoted'],
    ['optional number sent as empty string', { rating: '' }, [], 'rating'],
    ['unknown data key', { surprise: 'x' }, [], 'surprise'],
  ])('rejects %s', (_label, patch, remove, field) => {
    const snapshot = articleSnapshot(patch, remove)
    expect(() => validateSnapshot(snapshot, schema)).toThrow(
      `articles/hello.${field}:`,
    )
  })

  it.each([
    ['summary null', { summary: null }, []],
    ['summary missing', {}, ['summary']],
    ['summary empty string', { summary: '' }, []],
    ['website empty string', { website: '' }, []],
    ['sidebar null', { sidebar: null }, []],
    ['sidebar missing', {}, ['sidebar']],
    ['sidebar empty string', { sidebar: '' }, []],
    ['image null', { 'cover-image': null }, []],
    ['image missing', {}, ['cover-image']],
    ['image empty string', { 'cover-image': '' }, []],
    ['date null', { 'published-on': null }, []],
    ['date empty string', { 'published-on': '' }, []],
    ['datetime empty string', { 'starts-at': '' }, []],
    ['datetime missing', {}, ['starts-at']],
    ['select empty string with options', { category: '' }, []],
    ['select null with options', { category: null }, []],
    ['select without options accepts any string', { tag: 'whatever' }, []],
    ['select without options accepts empty string', { tag: '' }, []],
    ['reference null', { author: null }, []],
    ['reference empty string', { author: '' }, []],
    ['reference missing', {}, ['author']],
    ['number null', { rating: null }, []],
    ['number missing', {}, ['rating']],
    ['boolean null', { promoted: null }, []],
    ['boolean missing', {}, ['promoted']],
    ['boolean false', { promoted: false }, []],
  ])('accepts an optional field: %s', (_label, patch, remove) => {
    expect(() =>
      validateSnapshot(articleSnapshot(patch, remove), schema),
    ).not.toThrow()
  })

  it('throws one error that lists every problem as collection/slug.field', () => {
    const snapshot = snapshotWith([
      { ...validArticle, title: 5 },
      { ...validArticle, slug: 'other', rating: Number.NaN },
    ])
    let caught: unknown
    try {
      validateSnapshot(snapshot, schema)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).toMatch(/articles\/hello\.title: \S/)
    expect(message).toMatch(/articles\/other\.rating: \S/)
  })

  it('caps the listed problems at 20', () => {
    const articles = Array.from({ length: 25 }, (_, index) => {
      const data: Record<string, unknown> = { ...validArticle, slug: `e${index}` }
      delete data.title
      return data
    })
    let caught: unknown
    try {
      validateSnapshot(snapshotWith(articles), schema)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message.split('articles/').length - 1).toBe(20)
    expect(message).toContain('articles/e0.title')
    expect(message).toContain('articles/e19.title')
    expect(message).not.toContain('articles/e20.')
  })
})
