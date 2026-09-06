import { describe, expect, it } from 'vitest'

import type { Field } from '#/lib/types'

import { sampleRichText } from './test-utils.ts'
import { buildEntrySchema, validateEntryData } from './validation.ts'

const allFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'body', label: 'Body', type: 'textarea' },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'content', label: 'Content', type: 'richtext', required: true },
  { key: 'hero', label: 'Hero', type: 'image' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'publishedAt', label: 'Published', type: 'datetime' },
  {
    key: 'category',
    label: 'Category',
    type: 'select',
    options: ['news', 'updates'],
  },
  { key: 'author', label: 'Author', type: 'reference', collection: 'authors' },
  { key: 'featured', label: 'Featured', type: 'boolean' },
  { key: 'count', label: 'Count', type: 'number' },
]

describe('buildEntrySchema / validateEntryData', () => {
  it('accepts a valid payload for every field type', () => {
    const result = validateEntryData(allFields, {
      title: 'Hello',
      body: 'A longer text',
      slug: 'hello-world',
      content: sampleRichText,
      hero: 'asset_1',
      date: '2026-01-02',
      publishedAt: '2026-01-02T10:00:00.000Z',
      category: 'news',
      author: 'entry_1',
      featured: true,
      count: 3,
    })
    expect(result.ok).toBe(true)
  })

  it('rejects missing required fields in strict mode', () => {
    const result = validateEntryData(allFields, { body: 'only optional' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    const paths = result.errors.map((e) => e.path)
    expect(paths).toEqual(expect.arrayContaining(['title', 'slug', 'content']))
  })

  it('allows empty required fields in partial mode', () => {
    const result = validateEntryData(allFields, { title: '', slug: '' }, { mode: 'partial' })
    expect(result.ok).toBe(true)
  })

  it('still checks types and formats in partial mode', () => {
    const slug = validateEntryData(
      allFields,
      { slug: 'Not A Slug' },
      { mode: 'partial' },
    )
    expect(slug.ok).toBe(false)

    const date = validateEntryData(
      allFields,
      { date: '01/02/2026' },
      { mode: 'partial' },
    )
    expect(date.ok).toBe(false)

    const datetime = validateEntryData(
      allFields,
      { publishedAt: 'tomorrow' },
      { mode: 'partial' },
    )
    expect(datetime.ok).toBe(false)

    const select = validateEntryData(
      allFields,
      { category: 'sports' },
      { mode: 'partial' },
    )
    expect(select.ok).toBe(false)

    const featured = validateEntryData(
      allFields,
      { featured: 'yes' },
      { mode: 'partial' },
    )
    expect(featured.ok).toBe(false)

    const count = validateEntryData(
      allFields,
      { count: '3' },
      { mode: 'partial' },
    )
    expect(count.ok).toBe(false)
  })

  it('rejects invalid values per field type in strict mode', () => {
    expect(
      validateEntryData(allFields, {
        title: 'Hello',
        slug: 'Hello World',
        content: sampleRichText,
      }).ok,
    ).toBe(false)

    expect(
      validateEntryData(allFields, {
        title: 'Hello',
        slug: 'hello',
        content: { type: 'not-a-doc' },
      }).ok,
    ).toBe(false)

    expect(
      validateEntryData(allFields, {
        title: 'Hello',
        slug: 'hello',
        content: sampleRichText,
        date: '2026-13-40',
      }).ok,
    ).toBe(false)

    expect(
      validateEntryData(allFields, {
        title: 'Hello',
        slug: 'hello',
        content: sampleRichText,
        publishedAt: '2026-01-02',
      }).ok,
    ).toBe(false)

    expect(
      validateEntryData(allFields, {
        title: 'Hello',
        slug: 'hello',
        content: sampleRichText,
        category: 'nope',
      }).ok,
    ).toBe(false)

    expect(
      validateEntryData(allFields, {
        title: 'Hello',
        slug: 'hello',
        content: sampleRichText,
        featured: 'true',
      }).ok,
    ).toBe(false)

    expect(
      validateEntryData(allFields, {
        title: 'Hello',
        slug: 'hello',
        content: sampleRichText,
        count: '1',
      }).ok,
    ).toBe(false)
  })

  it('treats optional fields as nullable', () => {
    const result = validateEntryData(allFields, {
      title: 'Hello',
      slug: 'hello',
      content: sampleRichText,
      body: null,
      hero: null,
      date: null,
      publishedAt: null,
      category: null,
      author: null,
      featured: null,
      count: null,
    })
    expect(result.ok).toBe(true)
  })

  it('accepts ISO datetimes with an offset', () => {
    const result = validateEntryData(allFields, {
      title: 'Hello',
      slug: 'hello',
      content: sampleRichText,
      publishedAt: '2026-01-02T10:00:00+02:00',
    })
    expect(result.ok).toBe(true)
  })

  it('buildEntrySchema returns a parseable zod type', () => {
    const schema = buildEntrySchema([
      { key: 'title', label: 'Title', type: 'text', required: true },
    ])
    expect(schema.safeParse({ title: 'Hi' }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
  })
})
