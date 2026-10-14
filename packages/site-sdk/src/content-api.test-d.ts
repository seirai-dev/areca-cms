import { describe, expectTypeOf, it } from 'vitest'
import { createContent } from './content.js'
import type { Content, Entry, Href } from './index.js'
import { readContent } from './pull.js'
import { schema } from './test-fixtures/schema.js'

type S = typeof schema

declare const content: Content<typeof schema>

/** The preview return type, without naming the internal union. */
type Preview = Awaited<ReturnType<typeof content.preview>>

declare const preview: Preview

describe('createContent', () => {
  it('returns the Content type for the schema', () => {
    expectTypeOf(createContent({ schema, dir: 'out' })).toEqualTypeOf<Content<typeof schema>>()
  })
})

describe('collection api: reads', () => {
  it('all() returns entries of the collection', () => {
    expectTypeOf(content.blogPosts.all()).toEqualTypeOf<Entry<'blogPosts', S>[]>()
  })

  it('first(), get() and byId() may return undefined', () => {
    expectTypeOf(content.blogPosts.first()).toEqualTypeOf<Entry<'blogPosts', S> | undefined>()
    expectTypeOf(content.blogPosts.get('hello')).toEqualTypeOf<Entry<'blogPosts', S> | undefined>()
    expectTypeOf(content.blogPosts.byId('id')).toEqualTypeOf<Entry<'blogPosts', S> | undefined>()
  })

  it('all() with a where clause still returns typed entries', () => {
    const posts = content.blogPosts.all({ where: { category: 'news' } })
    expectTypeOf(posts).toEqualTypeOf<Entry<'blogPosts', S>[]>()
  })

  it('all() with with: expands the reference on each entry', () => {
    const posts = content.blogPosts.all({ with: { author: true } })
    expectTypeOf(posts[0]!.data.author).toEqualTypeOf<Entry<'authors', S> | null | undefined>()
  })

  it('rejects unknown collections and fields', () => {
    // @ts-expect-error there is no collection called nope
    content.nope
    // @ts-expect-error the raw CMS key is not exposed
    content['blog-posts']
    // @ts-expect-error there is no where field called nope
    content.blogPosts.all({ where: { nope: 'x' } })
  })
})

describe('resolve', () => {
  it('resolves an optional reference to Entry | null', () => {
    const post = content.blogPosts.first()!
    expectTypeOf(content.resolve(post.data.author)).toEqualTypeOf<Entry<'authors', S> | null>()
  })

  it('resolves a required reference to Entry | null', () => {
    const post = content.blogPosts.first()!
    expectTypeOf(content.resolve(post.data.editor)).toEqualTypeOf<Entry<'authors', S> | null>()
  })

  it('resolves empty and missing references to null', () => {
    expectTypeOf(content.resolve(null)).toEqualTypeOf<null>()
    expectTypeOf(content.resolve(undefined)).toEqualTypeOf<null>()
    expectTypeOf(content.resolve('')).toEqualTypeOf<null>()
  })
})

describe('href', () => {
  it('builds the target route from a reference', () => {
    const post = content.blogPosts.first()!
    expectTypeOf(content.href(post.data.editor)).toEqualTypeOf<`/authors/${string}`>()
  })

  it('builds the route from an entry of the collection', () => {
    const post = content.blogPosts.first()!
    expectTypeOf(content.blogPosts.href(post)).toEqualTypeOf<`/blog/${string}`>()
    expectTypeOf(content.blogPosts.href(post)).toEqualTypeOf<Href<'blogPosts', S>>()
  })

  it('accepts a slug string on the collection helper', () => {
    expectTypeOf(content.authors.href('ada')).toEqualTypeOf<`/authors/${string}`>()
  })
})

describe('preview', () => {
  it('narrows entry on collection', () => {
    if (preview.collection === 'authors') {
      expectTypeOf(preview.entry).toEqualTypeOf<Entry<'authors', S>>()
    }
  })

  it('narrows entry in a switch', () => {
    switch (preview.collection) {
      case 'blogPosts':
        expectTypeOf(preview.entry).toEqualTypeOf<Entry<'blogPosts', S>>()
        break
      case 'authors':
        expectTypeOf(preview.entry).toEqualTypeOf<Entry<'authors', S>>()
        break
      case 'pages':
        expectTypeOf(preview.entry).toEqualTypeOf<Entry<'pages', S>>()
        break
    }
  })
})

describe('readContent on the loose default schema', () => {
  it('returns entries without an explicit generic', () => {
    expectTypeOf(readContent('dir', 'x')).toEqualTypeOf<Entry<'x'>[]>()
  })
})
