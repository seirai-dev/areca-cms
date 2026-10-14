import { describe, expect, it } from 'vitest'
import { validateCollectionDefinitions } from './collections'
import { isApprovedReferenceTarget, validateEntryData } from './validation'
import type { Field } from '#/lib/types'

describe('audit content validation regressions', () => {
  it.each([{}, '', { length: 0 }, { every: true }])(
    'rejects malformed rich text content %j without throwing',
    (content) => {
      const fields: Field[] = [{ key: 'body', label: 'Body', type: 'richtext' }]
      for (const mode of ['strict', 'partial'] as const) {
        const result = validateEntryData(
          fields,
          { body: { type: 'doc', content } },
          { mode },
        )
        expect(result.ok).toBe(false)
      }
    },
  )

  it('validates empty-document structure before allowing optional emptiness', () => {
    const fields: Field[] = [{ key: 'body', label: 'Body', type: 'richtext' }]
    expect(
      validateEntryData(fields, { body: { type: 'doc', content: [] } }).ok,
    ).toBe(true)
    expect(
      validateEntryData(fields, {
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: { length: 0 } }],
        },
      }).ok,
    ).toBe(false)
  })

  it.each([
    '2026-02-30T10:00:00Z',
    '2025-02-29T10:00:00Z',
    '2026-01-01T24:00:00Z',
  ])('rejects nonexistent calendar datetime %s', (value) => {
    expect(
      validateEntryData([{ key: 'at', label: 'At', type: 'datetime' }], {
        at: value,
      }).ok,
    ).toBe(false)
  })

  it.each(['2024-02-29T10:00:00Z', '2026-02-28T23:59:59.123+02:00'])(
    'preserves valid calendar dates and offsets %s',
    (value) => {
      expect(
        validateEntryData([{ key: 'at', label: 'At', type: 'datetime' }], {
          at: value,
        }).ok,
      ).toBe(true)
    },
  )

  it('allows a scheduled target retaining an approved version', () => {
    expect(
      isApprovedReferenceTarget({
        status: 'scheduled',
        publishedData: { title: 'Approved' },
        publishedSlug: 'approved',
      }),
    ).toBe(true)
    expect(
      isApprovedReferenceTarget({
        status: 'scheduled',
        publishedData: null,
        publishedSlug: null,
      }),
    ).toBe(false)
    expect(
      isApprovedReferenceTarget({
        status: 'draft',
        publishedData: { title: 'Old' },
        publishedSlug: 'old',
      }),
    ).toBe(false)
  })

  it('keeps mixed case but rejects collection filename collisions', () => {
    expect(() =>
      validateCollectionDefinitions([
        { key: 'Articles', fields: [] },
        { key: 'People', fields: [] },
      ]),
    ).not.toThrow()
    expect(() =>
      validateCollectionDefinitions([
        { key: 'Articles', fields: [] },
        { key: 'articles', fields: [] },
      ]),
    ).toThrow(/conflicts/)
  })

  it('rejects reserved content object names as collection keys only', () => {
    for (const key of ['preview', 'Href', 'resolve']) {
      expect(() =>
        validateCollectionDefinitions([{ key, fields: [] }]),
      ).toThrow(/reserved/)
    }
    expect(() =>
      validateCollectionDefinitions([
        {
          key: 'articles',
          fields: [{ key: 'preview', label: 'Preview', type: 'text' }],
        },
      ]),
    ).not.toThrow()
  })

  it('rejects references missing an enabled target', () => {
    const reference: Field = {
      key: 'author',
      label: 'Author',
      type: 'reference',
      collection: 'people',
    }
    expect(() =>
      validateCollectionDefinitions([{ key: 'articles', fields: [reference] }]),
    ).toThrow(/target collection/)
    expect(() =>
      validateCollectionDefinitions([
        { key: 'articles', fields: [reference] },
        { key: 'people', fields: [], enabled: false },
      ]),
    ).toThrow(/target collection/)
    expect(() =>
      validateCollectionDefinitions([
        { key: 'articles', fields: [reference] },
        { key: 'people', fields: [] },
      ]),
    ).not.toThrow()
  })

  it('rejects invalid date ordering dependencies', () => {
    const date: Field = {
      key: 'ends',
      label: 'Ends',
      type: 'date',
      after: 'starts',
    }
    expect(() =>
      validateCollectionDefinitions([{ key: 'events', fields: [date] }]),
    ).toThrow(/Date ordering/)
    expect(() =>
      validateCollectionDefinitions([
        {
          key: 'events',
          fields: [date, { key: 'starts', label: 'Starts', type: 'text' }],
        },
      ]),
    ).toThrow(/Date ordering/)
    expect(() =>
      validateCollectionDefinitions([
        {
          key: 'events',
          fields: [date, { key: 'starts', label: 'Starts', type: 'datetime' }],
        },
      ]),
    ).not.toThrow()
  })
})
