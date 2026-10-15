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
  { key: 'website', label: 'Website', type: 'url' },
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
      website: 'https://example.com',
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

  it('requires title and slug even in partial mode, but allows empty richtext', () => {
    const emptyIdentity = validateEntryData(
      allFields,
      { title: '', slug: '' },
      { mode: 'partial' },
    )
    expect(emptyIdentity.ok).toBe(false)
    if (!emptyIdentity.ok) {
      const paths = emptyIdentity.errors.map((e) => e.path)
      expect(paths).toEqual(expect.arrayContaining(['title', 'slug']))
    }

    const emptyRich = validateEntryData(
      allFields,
      { title: 'Hi', slug: 'hi' },
      { mode: 'partial' },
    )
    expect(emptyRich.ok).toBe(true)
  })

  it('accepts a missing required text, textarea or slug in partial mode', () => {
    // Drafts may be incomplete: a translation can be saved while the main
    // language is still empty (the value is absent, not blank).
    const fields: Field[] = [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'summary', label: 'Summary', type: 'textarea', required: true },
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
    ]
    const missing = validateEntryData(fields, {}, { mode: 'partial' })
    expect(missing.ok).toBe(true)

    const partial = validateEntryData(
      fields,
      { title: 'Only the title' },
      { mode: 'partial' },
    )
    expect(partial.ok).toBe(true)
  })

  it('still requires them when missing in strict mode', () => {
    const fields: Field[] = [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'summary', label: 'Summary', type: 'textarea', required: true },
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
    ]
    const result = validateEntryData(fields, {}, { mode: 'strict' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    const paths = result.errors.map((e) => e.path)
    expect(paths).toEqual(
      expect.arrayContaining(['title', 'summary', 'slug']),
    )
  })

  it('rejects empty richtext on publish', () => {
    const result = validateEntryData(
      allFields,
      {
        title: 'Hi',
        slug: 'hi',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
      { mode: 'strict' },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'content')).toBe(true)
    }
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

    const website = validateEntryData(
      allFields,
      { website: 'not-a-url' },
      { mode: 'partial' },
    )
    expect(website.ok).toBe(false)
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

    expect(
      validateEntryData(allFields, {
        title: 'Hello',
        slug: 'hello',
        content: sampleRichText,
        website: 'javascript:alert(1)',
      }).ok,
    ).toBe(false)
  })

  it('rejects a date that is before its after field', () => {
    const fields: Field[] = [
      { key: 'opensAt', label: 'Opens', type: 'date', required: true },
      {
        key: 'closesAt',
        label: 'Closes',
        type: 'date',
        required: true,
        after: 'opensAt',
      },
    ]
    const ok = validateEntryData(fields, {
      opensAt: '2026-01-01',
      closesAt: '2026-01-10',
    })
    expect(ok.ok).toBe(true)

    const bad = validateEntryData(fields, {
      opensAt: '2026-01-10',
      closesAt: '2026-01-01',
    })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'closesAt',
          message: 'Must be on or after opensAt',
        }),
      ]),
    )
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
      website: null,
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
