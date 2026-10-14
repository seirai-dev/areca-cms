import { assertType, describe, expectTypeOf, it } from 'vitest'
import type {
  Entry,
  ImageValue,
  OrderBy,
  QueryOptions,
  QueryResult,
  ReferenceValue,
  Where,
} from './index.js'
import { schema } from './test-fixtures/schema.js'

type S = typeof schema

describe('Where: equality and select options', () => {
  it('accepts a declared select option', () => {
    assertType<Where<'blogPosts', S>>({ category: 'news' })
    assertType<Where<'blogPosts', S>>({ category: { in: ['news'] } })
    assertType<Where<'blogPosts', S>>({ category: { notIn: ['guides'] } })
  })

  it('rejects a value that is not a select option', () => {
    // @ts-expect-error 'nope' is not one of the category options
    assertType<Where<'blogPosts', S>>({ category: 'nope' })
    // @ts-expect-error 'nope' is not one of the category options
    assertType<Where<'blogPosts', S>>({ category: { in: ['nope'] } })
  })
})

describe('Where: numbers and dates', () => {
  it('accepts comparison operators on number and date fields', () => {
    assertType<Where<'blogPosts', S>>({ price: { gte: 10 } })
    assertType<Where<'blogPosts', S>>({ price: { lt: 5, gt: 1 } })
    assertType<Where<'blogPosts', S>>({ publishedOn: { gte: '2026-01-01' } })
    assertType<Where<'blogPosts', S>>({ price: { eq: 10, ne: 11 } })
  })

  it('rejects comparison operators with the wrong value type', () => {
    // @ts-expect-error gte compares numbers, not strings
    assertType<Where<'blogPosts', S>>({ price: { gte: 'ten' } })
  })

  it('rejects comparison operators on text fields', () => {
    // @ts-expect-error gte is not offered for text
    assertType<Where<'blogPosts', S>>({ title: { gte: 'x' } })
  })
})

describe('Where: text operators', () => {
  it('accepts contains and equality on text fields', () => {
    assertType<Where<'blogPosts', S>>({ title: 'x' })
    assertType<Where<'blogPosts', S>>({ title: { contains: 'x' } })
    assertType<Where<'blogPosts', S>>({ title: { in: ['x', 'y'] } })
    assertType<Where<'blogPosts', S>>({ title: { ne: 'x' } })
  })

  it('rejects contains on non-text fields', () => {
    // @ts-expect-error contains is only offered for text, textarea, url and slug
    assertType<Where<'blogPosts', S>>({ price: { contains: 'x' } })
  })
})

describe('Where: booleans', () => {
  it('accepts a direct boolean and eq', () => {
    assertType<Where<'blogPosts', S>>({ featured: true })
    assertType<Where<'blogPosts', S>>({ featured: { eq: false } })
  })

  it('rejects isNull on a required field', () => {
    // @ts-expect-error featured is required, so isNull is not offered
    assertType<Where<'blogPosts', S>>({ featured: { isNull: true } })
  })
})

describe('Where: isNull', () => {
  it('accepts isNull on optional fields of any kind', () => {
    assertType<Where<'blogPosts', S>>({ coverImage: { isNull: true } })
    assertType<Where<'blogPosts', S>>({ coverImage: { isNull: false } })
    assertType<Where<'blogPosts', S>>({ author: { isNull: false } })
    assertType<Where<'blogPosts', S>>({ publishedOn: { isNull: true } })
  })

  it('rejects isNull on required fields', () => {
    // @ts-expect-error title is required
    assertType<Where<'blogPosts', S>>({ title: { isNull: true } })
    // @ts-expect-error editor is a required reference
    assertType<Where<'blogPosts', S>>({ editor: { isNull: true } })
    // @ts-expect-error body is required richtext
    assertType<Where<'blogPosts', S>>({ body: { isNull: true } })
  })
})

describe('Where: references and images', () => {
  it('rejects a bare string as a reference value', () => {
    // @ts-expect-error a reference is matched by ReferenceValue or isNull, not a string
    assertType<Where<'blogPosts', S>>({ author: 'x' })
  })

  it('rejects equality operators on images', () => {
    // @ts-expect-error images only support isNull
    assertType<Where<'blogPosts', S>>({ coverImage: { contains: 'x' } })
  })
})

describe('Where: keys', () => {
  it('rejects unknown field keys', () => {
    // @ts-expect-error there is no field called nope
    assertType<Where<'blogPosts', S>>({ nope: 'x' })
  })

  it('rejects raw CMS field keys', () => {
    // @ts-expect-error where uses camelCase keys
    assertType<Where<'blogPosts', S>>({ 'cover-image': { isNull: true } })
  })

  it('accepts any key on the loose unregistered schema', () => {
    assertType<Where<string>>({ anything: 'x' })
  })
})

describe('OrderBy', () => {
  it('accepts sortable fields in object form', () => {
    assertType<OrderBy<'blogPosts', S>>({ title: 'asc' })
    assertType<OrderBy<'blogPosts', S>>({ publishedOn: 'desc' })
    assertType<OrderBy<'blogPosts', S>>({ price: 'desc' })
    assertType<OrderBy<'blogPosts', S>>({ featured: 'asc' })
    assertType<OrderBy<'blogPosts', S>>({ category: 'asc' })
  })

  it('accepts an array of tie-breakers', () => {
    assertType<OrderBy<'blogPosts', S>>([{ featured: 'desc' }, { title: 'asc' }])
  })

  it('rejects fields that cannot be sorted', () => {
    // @ts-expect-error body is richtext and cannot be sorted
    assertType<OrderBy<'blogPosts', S>>({ body: 'asc' })
    // @ts-expect-error coverImage is an image and cannot be sorted
    assertType<OrderBy<'blogPosts', S>>({ coverImage: 'asc' })
    // @ts-expect-error author is a reference and cannot be sorted
    assertType<OrderBy<'blogPosts', S>>({ author: 'asc' })
    // @ts-expect-error body cannot be a tie-breaker either
    assertType<OrderBy<'blogPosts', S>>([{ title: 'asc' }, { body: 'asc' }])
  })

  it('rejects an unknown direction', () => {
    // @ts-expect-error the direction is asc or desc
    assertType<OrderBy<'blogPosts', S>>({ title: 'up' })
  })
})

describe('QueryOptions', () => {
  it('accepts limit and offset', () => {
    assertType<QueryOptions<'blogPosts', S>>({ limit: 10, offset: 20 })
  })

  it('accepts with only for reference fields', () => {
    assertType<NonNullable<QueryOptions<'blogPosts', S>['with']>>({ author: true })
    assertType<NonNullable<QueryOptions<'blogPosts', S>['with']>>({ editor: true })
  })

  it('rejects with on non-reference fields and with false', () => {
    // @ts-expect-error title is not a reference
    assertType<NonNullable<QueryOptions<'blogPosts', S>['with']>>({ title: true })
    // @ts-expect-error coverImage is an image, not a reference
    assertType<NonNullable<QueryOptions<'blogPosts', S>['with']>>({ coverImage: true })
    // @ts-expect-error expansion is opt-in with true
    assertType<NonNullable<QueryOptions<'blogPosts', S>['with']>>({ author: false })
  })
})

describe('QueryResult', () => {
  it('keeps the collection literal', () => {
    expectTypeOf<QueryResult<'blogPosts', {}, S>['collection']>().toEqualTypeOf<'blogPosts'>()
  })

  it('leaves data unchanged without with', () => {
    expectTypeOf<QueryResult<'blogPosts', {}, S>['data']['author']>().toEqualTypeOf<
      ReferenceValue<'authors'> | '' | null | undefined
    >()
    expectTypeOf<QueryResult<'blogPosts', {}, S>['data']['title']>().toEqualTypeOf<string>()
  })

  it('expands an optional reference to Entry | null | undefined', () => {
    type R = QueryResult<'blogPosts', { with: { author: true } }, S>
    expectTypeOf<R['data']['author']>().toEqualTypeOf<Entry<'authors', S> | null | undefined>()
    expectTypeOf<R['data']['title']>().toEqualTypeOf<string>()
    expectTypeOf<R['data']['coverImage']>().toEqualTypeOf<ImageValue | '' | null | undefined>()
    expectTypeOf<R['data']['editor']>().toEqualTypeOf<ReferenceValue<'authors'>>()
  })

  it('expands a required reference to Entry | null', () => {
    type R = QueryResult<'blogPosts', { with: { editor: true } }, S>
    expectTypeOf<R['data']['editor']>().toEqualTypeOf<Entry<'authors', S> | null>()
    expectTypeOf<R['data']['author']>().toEqualTypeOf<
      ReferenceValue<'authors'> | '' | null | undefined
    >()
  })
})
