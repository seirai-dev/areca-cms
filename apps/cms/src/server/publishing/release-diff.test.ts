import { describe, expect, it } from 'vitest'

import type { SnapshotEntry } from '#/lib/types'
import { resolveEntrySeo } from '#/lib/seo'

import {
  comparisonSnapshot,
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

function seoSnap(
  publishedAt = '2026-01-01T00:00:00.000Z',
  customJsonLd?: Record<string, unknown>,
): SnapshotEntry {
  return {
    ...snap('a', 'hello', { title: 'Hello' }, publishedAt),
    seo: resolveEntrySeo({
      seo: {
        title: 'SEO title',
        jsonLd: customJsonLd ? JSON.stringify(customJsonLd) : undefined,
        faq: [{ question: 'Question?', answer: 'Answer.' }],
      },
      title: 'Hello',
      fallbackDescription: null,
      url: 'https://example.test/hello',
      site: { name: 'Example', url: 'https://example.test' },
      ogImage: null,
      heroImage: null,
      datePublished: publishedAt,
      dateModified: publishedAt,
    }),
  }
}

describe('diffSnapshotCollections', () => {
  it('ignores resolved SEO defaults for untouched legacy entries', () => {
    const candidate = seoSnap()
    const legacy = snap('a', 'hello', { title: 'Hello' })
    expect(
      diffSnapshotCollections({ articles: [candidate] }, { articles: [legacy] })
        .updates,
    ).toEqual([])
  })

  it('includes newly approved SEO when the live baseline predates SEO', () => {
    const candidate = seoSnap('2026-02-01T00:00:00.000Z')
    const legacy = snap('a', 'hello', { title: 'Hello' })
    expect(
      diffSnapshotCollections({ articles: [candidate] }, { articles: [legacy] })
        .updates,
    ).toEqual([
      {
        id: 'a',
        slug: 'hello',
        collectionKey: 'articles',
        data: { title: 'Hello' },
      },
    ])
  })

  it('ignores generated publish dates when both snapshots have SEO', () => {
    expect(
      diffSnapshotCollections(
        { articles: [seoSnap('2026-02-01T00:00:00.000Z')] },
        { articles: [seoSnap()] },
      ).updates,
    ).toEqual([])
  })

  it('includes SEO-only edits when both snapshots have SEO', () => {
    const candidate = seoSnap()
    candidate.seo = { ...candidate.seo!, title: 'Changed SEO title' }
    expect(
      diffSnapshotCollections(
        { articles: [candidate] },
        { articles: [seoSnap()] },
      ).updates.map((item) => item.id),
    ).toEqual(['a'])
  })

  it.each(['datePublished', 'dateModified'])(
    'preserves editor-supplied JSON-LD %s changes',
    (field) => {
      const custom = {
        '@type': 'Article',
        datePublished: '2020-01-01',
        dateModified: '2020-01-02',
      }
      expect(
        diffSnapshotCollections(
          {
            articles: [
              seoSnap(undefined, { ...custom, [field]: '2026-02-01' }),
            ],
          },
          { articles: [seoSnap(undefined, custom)] },
        ).updates.map((item) => item.id),
      ).toEqual(['a'])
    },
  )

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

describe('release comparison mode', () => {
  it('uses latest demo after production mode is changed to demo', () => {
    const live = { snapshot: { publicationId: 'production' } }
    const demo = { snapshot: { publicationId: 'latest-demo' } }
    expect(
      comparisonSnapshot('demo', live as never, demo as never)?.publicationId,
    ).toBe('latest-demo')
    expect(comparisonSnapshot('demo', live as never, null)).toBeNull()
    expect(
      comparisonSnapshot('production', live as never, demo as never)
        ?.publicationId,
    ).toBe('production')
  })
})
