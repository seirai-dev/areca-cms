import { describe, expect, it } from 'vitest'

import type { Field } from '#/lib/types'

import { toEntrySummary } from './entry-summary.ts'
import type { EntrySummarySource } from './entry-summary.ts'

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'heroImage', label: 'Hero', type: 'image' },
]

function source(overrides: Partial<EntrySummarySource>): EntrySummarySource {
  const now = new Date('2026-11-01T10:00:00Z')
  return {
    id: 'e1',
    slug: 'first',
    status: 'draft',
    draftData: {},
    publishedData: null,
    publishedSlug: null,
    createdAt: now,
    updatedAt: now,
    scheduledAt: null,
    publishedAt: null,
    updatedBy: 'u1',
    updatedByName: 'Ada',
    ...overrides,
  }
}

describe('toEntrySummary', () => {
  it('reads title and cover from the draft, and keeps the draft out of the summary', () => {
    const summary = toEntrySummary({
      collectionKey: 'articles',
      fields,
      languages: null,
      requiredLanguages: [],
      row: source({ draftData: { title: 'Hello', heroImage: 'asset-9' } }),
    })
    expect(summary).toMatchObject({
      id: 'e1',
      collectionKey: 'articles',
      title: 'Hello',
      cover: 'asset-9',
      editedSinceReady: false,
      coverage: null,
      updatedByName: 'Ada',
    })
    expect(summary).not.toHaveProperty('draftData')
    expect(summary).not.toHaveProperty('publishedData')
  })

  it('falls back to the slug for a blank title and to null for an empty cover', () => {
    const summary = toEntrySummary({
      collectionKey: 'articles',
      fields,
      languages: null,
      requiredLanguages: [],
      row: source({ draftData: { title: '  ', heroImage: '' } }),
    })
    expect(summary.title).toBe('first')
    expect(summary.cover).toBeNull()
  })

  it('flags an entry edited since ready only when published and the draft differs', () => {
    const base = { title: 'A' }
    const edited = toEntrySummary({
      collectionKey: 'articles',
      fields,
      languages: null,
      requiredLanguages: [],
      row: source({
        status: 'published',
        draftData: { title: 'B' },
        publishedData: base,
      }),
    })
    const same = toEntrySummary({
      collectionKey: 'articles',
      fields,
      languages: null,
      requiredLanguages: [],
      row: source({
        status: 'published',
        draftData: { title: 'A' },
        publishedData: base,
      }),
    })
    expect(edited.editedSinceReady).toBe(true)
    expect(same.editedSinceReady).toBe(false)
  })

  it('computes coverage only on a multilingual site', () => {
    const multi = toEntrySummary({
      collectionKey: 'articles',
      fields,
      languages: { main: 'en', all: ['en', 'nl'] },
      requiredLanguages: ['nl'],
      row: source({ draftData: { title: 'Hello' } }),
    })
    expect(multi.coverage).toHaveLength(2)
    expect(multi.coverage?.[1]).toMatchObject({ locale: 'nl', required: true })
  })
})
