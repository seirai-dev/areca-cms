import { describe, expect, it } from 'vitest'

import { globalsAsEntryLists } from '#/lib/globals'
import type { SnapshotEntry, SnapshotGlobal } from '#/lib/types'
import { resolveEntrySeo } from '#/lib/seo'

import {
  comparisonSnapshot,
  diffLanguages,
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

/** An entry whose main view is `en` and whose Dutch view is shipped too. */
function localizedSnap(nlTitle: string, nlSlug = 'hallo'): SnapshotEntry {
  return {
    id: 'a',
    slug: 'hello',
    publishedAt: '2026-01-01T00:00:00.000Z',
    data: { title: 'Hello' },
    locale: 'en',
    locales: {
      en: { slug: 'hello', data: { title: 'Hello' } },
      nl: { slug: nlSlug, data: { title: nlTitle } },
    },
  }
}

describe('translation-only changes', () => {
  it('counts a secondary-language copy edit as an update', () => {
    const diff = diffSnapshotCollections(
      { articles: [localizedSnap('Hallo wereld')] },
      { articles: [localizedSnap('Hallo')] },
    )
    expect(diff.updates.map((item) => item.id)).toEqual(['a'])
    expect(diff.updates[0]).not.toHaveProperty('locales')
  })

  it('counts a secondary-language slug edit as an update', () => {
    const diff = diffSnapshotCollections(
      { articles: [localizedSnap('Hallo', 'nieuw')] },
      { articles: [localizedSnap('Hallo')] },
    )
    expect(diff.updates.map((item) => item.id)).toEqual(['a'])
  })

  it('counts a language that starts or stops shipping as an update', () => {
    const withoutDutch: SnapshotEntry = {
      ...localizedSnap('Hallo'),
      locales: { en: { slug: 'hello', data: { title: 'Hello' } } },
    }
    expect(
      diffSnapshotCollections(
        { articles: [localizedSnap('Hallo')] },
        { articles: [withoutDutch] },
      ).updates,
    ).toHaveLength(1)
    expect(
      diffSnapshotCollections(
        { articles: [withoutDutch] },
        { articles: [localizedSnap('Hallo')] },
      ).updates,
    ).toHaveLength(1)
  })

  it('ignores an unchanged secondary language', () => {
    expect(
      diffSnapshotCollections(
        { articles: [localizedSnap('Hallo')] },
        { articles: [localizedSnap('Hallo')] },
      ).updates,
    ).toEqual([])
  })

  it('counts a section whose only change is its Dutch view', () => {
    const section = (nlTitle: string): SnapshotGlobal => ({
      id: 'g1',
      publishedAt: '2026-01-01T00:00:00.000Z',
      data: { title: 'Welcome' },
      locale: 'en',
      locales: {
        en: { data: { title: 'Welcome' } },
        nl: { data: { title: nlTitle } },
      },
    })
    const diff = diffSnapshotCollections(
      globalsAsEntryLists({ home: section('Welkom thuis') }),
      globalsAsEntryLists({ home: section('Welkom') }),
    )
    expect(diff.updates.map((item) => item.collectionKey)).toEqual(['home'])
  })
})

describe('diffLanguages', () => {
  const bilingual = { main: 'en', all: ['en', 'nl'] }

  it('is null when the language set and main language are unchanged', () => {
    expect(diffLanguages(bilingual, bilingual)).toBeNull()
    expect(diffLanguages(null, null)).toBeNull()
  })

  it('reports an added language', () => {
    expect(
      diffLanguages({ main: 'en', all: ['en', 'nl', 'de'] }, bilingual),
    ).toEqual({ added: ['de'], removed: [], mainChanged: null })
  })

  it('reports a removed language', () => {
    expect(
      diffLanguages(bilingual, { main: 'en', all: ['en', 'nl', 'de'] }),
    ).toEqual({
      added: [],
      removed: ['de'],
      mainChanged: null,
    })
  })

  it('reports a main-language change, keeping the set when it is unchanged', () => {
    expect(diffLanguages({ main: 'nl', all: ['nl', 'en'] }, bilingual)).toEqual(
      {
        added: [],
        removed: [],
        mainChanged: { from: 'en', to: 'nl' },
      },
    )
  })

  it('reports enabling languages on a single-language site as additions', () => {
    expect(diffLanguages(bilingual, null)).toEqual({
      added: ['en', 'nl'],
      removed: [],
      mainChanged: null,
    })
  })

  it('treats a one-language setting as no multilingual setting', () => {
    expect(diffLanguages({ main: 'en', all: ['en'] }, null)).toBeNull()
  })
})

describe('pendingCountFromDiff', () => {
  it('counts a language change as one pending item', () => {
    expect(
      pendingCountFromDiff({
        candidateOk: true,
        hasBaseline: true,
        adds: 0,
        updates: 0,
        removals: 0,
        languages: true,
      }),
    ).toBe(1)
  })

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
