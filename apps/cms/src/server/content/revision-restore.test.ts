import { describe, expect, it } from 'vitest'
import type { Field } from '#/lib/types'
import { prepareRevisionRestore } from './entries'

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'score', label: 'Score', type: 'number' },
  { key: 'category', label: 'Category', type: 'select', options: ['current'] },
  { key: 'url', label: 'Link', type: 'url' },
]

describe('revision compatibility', () => {
  it('keeps current values for changed types, removed options and invalid URLs', () => {
    const current = {
      title: 'Current',
      slug: 'current',
      score: 7,
      category: 'current',
      url: 'https://site.test/current',
    }
    const result = prepareRevisionRestore(
      fields,
      {
        title: 'Earlier',
        slug: 'earlier',
        score: 'old text',
        category: 'removed',
        url: 'javascript:alert(1)',
      },
      current,
    )
    expect(result.data).toEqual({
      ...current,
      title: 'Earlier',
      slug: 'earlier',
    })
    expect(result.skippedFields.map((field) => field.label)).toEqual([
      'Score',
      'Category',
      'Link',
    ])
  })
  it('preserves newly added current fields and reports old undeclared fields', () => {
    const result = prepareRevisionRestore(
      fields,
      { title: 'Earlier', removed: 'gone' },
      { title: 'Current', slug: 'current', score: 7 },
    )
    expect(result.data).toEqual({ title: 'Earlier', slug: 'current', score: 7 })
    expect(result.skippedFields).toContainEqual(
      expect.objectContaining({ key: 'removed' }),
    )
  })
  it('keeps both current dates when an incompatible old end date conflicts with the old start date', () => {
    const dates: Field[] = [
      { key: 'starts', label: 'Start', type: 'date' },
      { key: 'ends', label: 'End', type: 'date', after: 'starts' },
    ]
    const result = prepareRevisionRestore(
      dates,
      { starts: '2026-10-20', ends: 'not a date' },
      { starts: '2026-10-10', ends: '2026-10-15' },
    )
    expect(result.data).toEqual({ starts: '2026-10-10', ends: '2026-10-15' })
    expect(result.skippedFields.map((field) => field.key)).toEqual([
      'ends',
      'starts',
    ])
  })
  it('does not restore malformed rich text or invalid SEO', () => {
    const body = { type: 'doc', content: [] }
    const result = prepareRevisionRestore(
      [{ key: 'body', label: 'Body', type: 'richtext' }],
      { body: { type: 'doc', content: {} }, $seo: { title: 42 } },
      { body, $seo: { title: 'Current' } },
    )
    expect(result.data).toEqual({ body, $seo: { title: 'Current' } })
    expect(result.skippedFields.map((field) => field.key)).toEqual([
      'body',
      '$seo',
    ])
  })
})
