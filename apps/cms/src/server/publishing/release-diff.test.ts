import { describe, expect, it } from 'vitest'

import type { SnapshotEntry } from '#/lib/types'

import {
  diffSnapshotCollections,
  pendingCountFromDiff,
  stableJson,
} from './release-diff.ts'

function snap(
  id: string,
  slug: string,
  data: Record<string, unknown>,
  publishedAt = '2026-01-01T00:00:00.000Z',
): SnapshotEntry {
  return { id, slug, publishedAt, data }
}

describe('diffSnapshotCollections', () => {
  it('treats candidate-only entries as adds', () => {
    const { adds, updates, removals } = diffSnapshotCollections(
      { articles: [snap('a', 'hello', { title: 'Hello' })] },
      {},
    )
    expect(adds.map((item) => item.id)).toEqual(['a'])
    expect(updates).toEqual([])
    expect(removals).toEqual([])
  })

  it('treats live-only entries as removals', () => {
    const { adds, updates, removals } = diffSnapshotCollections(
      {},
      { articles: [snap('a', 'hello', { title: 'Hello' })] },
    )
    expect(removals.map((item) => item.id)).toEqual(['a'])
    expect(adds).toEqual([])
    expect(updates).toEqual([])
  })

  it('treats slug or data changes as updates, ignoring key order and publishedAt', () => {
    const live = {
      articles: [
        snap(
          'a',
          'hello',
          { title: 'Hello', n: 1 },
          '2020-01-01T00:00:00.000Z',
        ),
      ],
    }
    const sameData = diffSnapshotCollections(
      {
        articles: [
          snap(
            'a',
            'hello',
            { n: 1, title: 'Hello' },
            '2026-12-01T00:00:00.000Z',
          ),
        ],
      },
      live,
    )
    expect(sameData.adds).toEqual([])
    expect(sameData.updates).toEqual([])
    expect(sameData.removals).toEqual([])

    const slugChange = diffSnapshotCollections(
      { articles: [snap('a', 'renamed', { title: 'Hello', n: 1 })] },
      live,
    )
    expect(slugChange.updates.map((item) => item.slug)).toEqual(['renamed'])

    const dataChange = diffSnapshotCollections(
      { articles: [snap('a', 'hello', { title: 'Goodbye', n: 1 })] },
      live,
    )
    expect(dataChange.updates.map((item) => item.id)).toEqual(['a'])
  })
})

describe('pendingCountFromDiff', () => {
  it('counts adds, updates, and removals when the candidate built', () => {
    expect(
      pendingCountFromDiff({
        candidateOk: true,
        hasBaseline: true,
        adds: 1,
        updates: 2,
        removals: 3,
      }),
    ).toBe(6)
  })

  it('is not up to date when the candidate failed and a live baseline exists', () => {
    expect(
      pendingCountFromDiff({
        candidateOk: false,
        hasBaseline: true,
        adds: 0,
        updates: 0,
        removals: 0,
      }),
    ).toBe(1)
  })

  it('stays at zero when nothing is live and the candidate failed', () => {
    expect(
      pendingCountFromDiff({
        candidateOk: false,
        hasBaseline: false,
        adds: 0,
        updates: 0,
        removals: 0,
      }),
    ).toBe(0)
  })
})

describe('stableJson', () => {
  it('is order-insensitive for objects', () => {
    expect(stableJson({ b: 2, a: 1 })).toBe(stableJson({ a: 1, b: 2 }))
  })
})
