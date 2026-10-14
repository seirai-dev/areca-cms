import { assertType, describe, expectTypeOf, it } from 'vitest'
import type {
  AnyEntry,
  CollectionKey,
  ContentSchema,
  Entry,
  EntryData,
  FieldKey,
  FieldValue,
  Href,
  ImageValue,
  ReferenceValue,
  RegisteredSchema,
  RichTextValue,
  RoutePath,
  SeoMeta,
} from './index.js'
import { schema } from './test-fixtures/schema.js'

type S = typeof schema

declare const anyEntry: AnyEntry<S>

/** One field per row of the value table, required and optional. */
const valueSchema = {
  notes: {
    key: 'notes',
    label: 'Notes',
    route: '/notes/$slug',
    fields: {
      text: { key: 'text', type: 'text', required: true },
      optionalText: { key: 'optional-text', type: 'text', required: false },
      textarea: { key: 'textarea', type: 'textarea', required: true },
      optionalTextarea: { key: 'optional-textarea', type: 'textarea', required: false },
      url: { key: 'url', type: 'url', required: true },
      optionalUrl: { key: 'optional-url', type: 'url', required: false },
      slug: { key: 'slug', type: 'slug', required: true },
      optionalSlug: { key: 'optional-slug', type: 'slug', required: false },
      select: { key: 'select', type: 'select', required: true, options: ['a', 'b'] },
      optionalSelect: {
        key: 'optional-select',
        type: 'select',
        required: false,
        options: ['a', 'b'],
      },
      plainSelect: { key: 'plain-select', type: 'select', required: true },
      optionalPlainSelect: { key: 'optional-plain-select', type: 'select', required: false },
      date: { key: 'date', type: 'date', required: true },
      optionalDate: { key: 'optional-date', type: 'date', required: false },
      datetime: { key: 'datetime', type: 'datetime', required: true },
      optionalDatetime: { key: 'optional-datetime', type: 'datetime', required: false },
      number: { key: 'number', type: 'number', required: true },
      optionalNumber: { key: 'optional-number', type: 'number', required: false },
      boolean: { key: 'boolean', type: 'boolean', required: true },
      optionalBoolean: { key: 'optional-boolean', type: 'boolean', required: false },
      image: { key: 'image', type: 'image', required: true },
      optionalImage: { key: 'optional-image', type: 'image', required: false },
      reference: { key: 'reference', type: 'reference', required: true, collection: 'authors' },
      optionalReference: {
        key: 'optional-reference',
        type: 'reference',
        required: false,
        collection: 'authors',
      },
      richtext: { key: 'richtext', type: 'richtext', required: true },
      optionalRichtext: { key: 'optional-richtext', type: 'richtext', required: false },
    },
  },
  authors: {
    key: 'authors',
    label: 'Authors',
    route: '/authors/$slug',
    fields: {
      slug: { key: 'slug', type: 'slug', required: true },
    },
  },
} as const

type V = typeof valueSchema

describe('FieldValue: required fields', () => {
  it('maps each type to its value shape', () => {
    expectTypeOf<FieldValue<'notes', 'text', V>>().toEqualTypeOf<string>()
    expectTypeOf<FieldValue<'notes', 'textarea', V>>().toEqualTypeOf<string>()
    expectTypeOf<FieldValue<'notes', 'url', V>>().toEqualTypeOf<string>()
    expectTypeOf<FieldValue<'notes', 'slug', V>>().toEqualTypeOf<string>()
    expectTypeOf<FieldValue<'notes', 'select', V>>().toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<FieldValue<'notes', 'plainSelect', V>>().toEqualTypeOf<string>()
    expectTypeOf<FieldValue<'notes', 'date', V>>().toEqualTypeOf<string>()
    expectTypeOf<FieldValue<'notes', 'datetime', V>>().toEqualTypeOf<string>()
    expectTypeOf<FieldValue<'notes', 'number', V>>().toEqualTypeOf<number>()
    expectTypeOf<FieldValue<'notes', 'boolean', V>>().toEqualTypeOf<boolean>()
    expectTypeOf<FieldValue<'notes', 'image', V>>().toEqualTypeOf<ImageValue>()
    expectTypeOf<FieldValue<'notes', 'reference', V>>().toEqualTypeOf<ReferenceValue<'authors'>>()
    expectTypeOf<FieldValue<'notes', 'richtext', V>>().toEqualTypeOf<RichTextValue>()
  })
})

describe('FieldValue: optional fields', () => {
  it('adds null, undefined and the empty-string shapes the CMS can send', () => {
    expectTypeOf<FieldValue<'notes', 'optionalText', V>>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalTextarea', V>>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalUrl', V>>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalSlug', V>>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalSelect', V>>().toEqualTypeOf<
      'a' | 'b' | '' | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalPlainSelect', V>>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalDate', V>>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalDatetime', V>>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalNumber', V>>().toEqualTypeOf<
      number | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalBoolean', V>>().toEqualTypeOf<
      boolean | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalImage', V>>().toEqualTypeOf<
      ImageValue | '' | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalReference', V>>().toEqualTypeOf<
      ReferenceValue<'authors'> | '' | null | undefined
    >()
    expectTypeOf<FieldValue<'notes', 'optionalRichtext', V>>().toEqualTypeOf<
      RichTextValue | '' | null | undefined
    >()
  })
})

describe('FieldValue on the generated fixture schema', () => {
  it('types the blog post fields', () => {
    expectTypeOf<FieldValue<'blogPosts', 'title', S>>().toEqualTypeOf<string>()
    expectTypeOf<FieldValue<'blogPosts', 'category', S>>().toEqualTypeOf<
      'news' | 'guides' | '' | null | undefined
    >()
    expectTypeOf<FieldValue<'blogPosts', 'author', S>>().toEqualTypeOf<
      ReferenceValue<'authors'> | '' | null | undefined
    >()
    expectTypeOf<FieldValue<'blogPosts', 'editor', S>>().toEqualTypeOf<ReferenceValue<'authors'>>()
    expectTypeOf<FieldValue<'blogPosts', 'featured', S>>().toEqualTypeOf<boolean>()
    expectTypeOf<FieldValue<'blogPosts', 'price', S>>().toEqualTypeOf<number | null | undefined>()
    expectTypeOf<FieldValue<'blogPosts', 'publishedOn', S>>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<FieldValue<'blogPosts', 'body', S>>().toEqualTypeOf<RichTextValue>()
  })
})

describe('Entry', () => {
  it('has the envelope fields and a collection literal', () => {
    expectTypeOf<Entry<'blogPosts', S>['id']>().toEqualTypeOf<string>()
    expectTypeOf<Entry<'blogPosts', S>['slug']>().toEqualTypeOf<string>()
    expectTypeOf<Entry<'blogPosts', S>['publishedAt']>().toEqualTypeOf<string | null>()
    expectTypeOf<Entry<'blogPosts', S>['collection']>().toEqualTypeOf<'blogPosts'>()
    expectTypeOf<Entry<'blogPosts', S>['seo']>().toEqualTypeOf<SeoMeta | undefined>()
  })

  it('types data as EntryData with camelCase keys', () => {
    expectTypeOf<Entry<'blogPosts', S>['data']>().toEqualTypeOf<EntryData<'blogPosts', S>>()
    expectTypeOf<keyof EntryData<'blogPosts', S>>().toEqualTypeOf<
      | 'slug'
      | 'title'
      | 'coverImage'
      | 'category'
      | 'author'
      | 'editor'
      | 'price'
      | 'featured'
      | 'publishedOn'
      | 'body'
    >()
    expectTypeOf<EntryData<'blogPosts', S>['title']>().toEqualTypeOf<string>()
  })
})

describe('keys', () => {
  it('lists collection keys', () => {
    expectTypeOf<CollectionKey<S>>().toEqualTypeOf<'blogPosts' | 'authors' | 'pages'>()
  })

  it('lists field keys of one collection', () => {
    expectTypeOf<FieldKey<'authors', S>>().toEqualTypeOf<'slug' | 'name' | 'bio' | 'website'>()
  })
})

describe('AnyEntry', () => {
  it('discriminates on collection', () => {
    if (anyEntry.collection === 'authors') {
      expectTypeOf(anyEntry).toEqualTypeOf<Entry<'authors', S>>()
    }
    if (anyEntry.collection === 'blogPosts') {
      expectTypeOf(anyEntry).toEqualTypeOf<Entry<'blogPosts', S>>()
    }
  })
})

describe('ReferenceValue', () => {
  it('carries the target collection key', () => {
    expectTypeOf<ReferenceValue<'authors'>>().toEqualTypeOf<{
      collection: 'authors'
      slug: string
      id: string
    }>()
  })
})

describe('routes', () => {
  it('replaces $slug with a template literal', () => {
    expectTypeOf<RoutePath<'/blog/$slug'>>().toEqualTypeOf<`/blog/${string}`>()
    expectTypeOf<RoutePath<'/$slug'>>().toEqualTypeOf<`/${string}`>()
  })

  it('keeps a plain string route as string', () => {
    expectTypeOf<RoutePath<string>>().toEqualTypeOf<string>()
  })

  it('derives Href from the collection route', () => {
    expectTypeOf<Href<'blogPosts', S>>().toEqualTypeOf<`/blog/${string}`>()
    expectTypeOf<Href<'authors', S>>().toEqualTypeOf<`/authors/${string}`>()
    expectTypeOf<Href<string, ContentSchema>>().toEqualTypeOf<string>()
  })
})

describe('unregistered fallback', () => {
  it('falls back to the loose ContentSchema when nothing is registered', () => {
    expectTypeOf<RegisteredSchema>().toEqualTypeOf<ContentSchema>()
  })

  it('uses string keys and unknown values, never never', () => {
    expectTypeOf<CollectionKey>().toEqualTypeOf<string>()
    expectTypeOf<FieldKey<string>>().toEqualTypeOf<string>()
    expectTypeOf<FieldValue<string, string>>().toEqualTypeOf<unknown>()
    expectTypeOf<Entry<string>['collection']>().toEqualTypeOf<string>()
    expectTypeOf<Entry<string>['data']>().not.toBeNever()
    expectTypeOf<AnyEntry>().not.toBeNever()
    expectTypeOf<Href<string>>().toEqualTypeOf<string>()
  })
})
