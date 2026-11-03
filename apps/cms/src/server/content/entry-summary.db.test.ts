import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection, entry } from '#/db/schema'
import { entryCoverage } from '#/lib/content/entry-coverage'
import { isEditedSinceReady } from '#/lib/content/edited-since-ready'
import { entryTitle, firstImageAssetId } from '#/lib/content/utils'
import type { EntryData, EntryStatus } from '#/lib/types'

import {
  countEntriesByCollection,
  listEntries,
  listEntrySummaries,
} from './entries.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestGlobal,
  createTestSite,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function insertEntry(input: {
  siteId: string
  collectionId: string
  slug: string
  status: EntryStatus
  draftData: EntryData
  publishedData?: EntryData | null
  publishedSlug?: string | null
  updatedBy?: string | null
}) {
  const row = (
    await db
      .insert(entry)
      .values({
        siteId: input.siteId,
        collectionId: input.collectionId,
        slug: input.slug,
        status: input.status,
        draftData: input.draftData,
        publishedData: input.publishedData ?? null,
        publishedSlug: input.publishedSlug ?? null,
        updatedBy: input.updatedBy ?? null,
      })
      .returning()
  ).at(0)
  if (!row) throw new Error('Failed to insert entry')
  return row
}

describe.skipIf(!hasDb)('listEntrySummaries', () => {
  it('returns the same rows, order and total as listEntries, with the shared helpers computed on the server and no content', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      const base = {
        heroImage: '',
        excerpt: '',
        body: { type: 'doc', content: [] },
      }
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: 'alpha',
        status: 'published',
        draftData: { ...base, title: 'Alpha', heroImage: 'asset-1' },
        publishedData: { ...base, title: 'Alpha', heroImage: 'asset-1' },
        publishedSlug: 'alpha',
        updatedBy: ctx.actor.id,
      })
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: 'beta',
        status: 'published',
        draftData: { ...base, title: 'Beta changed' },
        publishedData: { ...base, title: 'Beta' },
        publishedSlug: 'beta',
      })
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: 'gamma',
        status: 'draft',
        draftData: { ...base, title: '   ', heroImage: '' },
      })

      const summaries = await listEntrySummaries(ctx.site.id, 'articles')
      const full = await listEntries(ctx.site.id, 'articles')
      expect(summaries.total).toBe(full.total)
      expect(summaries.items.map((item) => item.id)).toEqual(
        full.items.map((item) => item.id),
      )

      for (const item of summaries.items) {
        const row = full.items.find((candidate) => candidate.id === item.id)!
        expect(item.title).toBe(entryTitle(row.draftData, col.fields, row.slug))
        expect(item.cover).toBe(firstImageAssetId(row.draftData, col.fields))
        expect(item.editedSinceReady).toBe(isEditedSinceReady(row))
        expect(item.coverage).toBeNull()
        expect(item.collectionKey).toBe('articles')
        expect(item).not.toHaveProperty('draftData')
        expect(item).not.toHaveProperty('publishedData')
        expect(item).not.toHaveProperty('originBaseline')
        expect(item).not.toHaveProperty('scheduledData')
      }

      const bySlug = Object.fromEntries(
        summaries.items.map((item) => [item.slug, item]),
      )
      expect(bySlug.alpha.title).toBe('Alpha')
      expect(bySlug.alpha.cover).toBe('asset-1')
      expect(bySlug.alpha.editedSinceReady).toBe(false)
      expect(bySlug.alpha.updatedByName).toBe('Test Actor')
      expect(bySlug.beta.editedSinceReady).toBe(true)
      expect(bySlug.gamma.title).toBe('gamma')
      expect(bySlug.gamma.cover).toBeNull()
      expect(bySlug.gamma.editedSinceReady).toBe(false)
    })
  })

  it('keeps the total exact past the last page, and applies search the same way', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      const data = (title: string): EntryData => ({
        title,
        excerpt: '',
        body: { type: 'doc', content: [] },
      })
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: 'one',
        status: 'draft',
        draftData: data('One'),
      })
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: 'two',
        status: 'draft',
        draftData: data('Needle'),
      })

      const past = await listEntrySummaries(ctx.site.id, 'articles', {
        offset: 10,
        limit: 1,
      })
      expect(past).toEqual({ items: [], total: 2 })

      const found = await listEntrySummaries(ctx.site.id, 'articles', {
        search: 'needle',
      })
      expect(found.total).toBe(1)
      expect(found.items.map((item) => item.slug)).toEqual(['two'])
    })
  })

  it('computes language coverage on a multilingual site, and leaves it null otherwise', async () => {
    const ctx = await createTestSite({
      languages: { main: 'en', all: ['en', 'nl'] },
    })
    try {
      const col = await createTestCollection(ctx.site.id, {
        requiredLanguages: ['nl'],
      })
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: 'multi',
        status: 'draft',
        draftData: {
          title: 'Multi',
          excerpt: '',
          body: { type: 'doc', content: [] },
        },
      })
      const summary = await listEntrySummaries(ctx.site.id, 'articles')
      const full = await listEntries(ctx.site.id, 'articles')
      expect(summary.items[0].coverage).toEqual(
        entryCoverage(
          full.items[0].draftData,
          col.fields,
          { main: 'en', all: ['en', 'nl'] },
          ['nl'],
        ),
      )
      expect(summary.items[0].coverage).toHaveLength(2)
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)('countEntriesByCollection', () => {
  it('counts every entry of each collection in one grouped read, leaving out sections and other sites', async () => {
    await withTestSite(async (ctx) => {
      const articles = await createTestCollection(ctx.site.id)
      await createTestCollection(ctx.site.id, { key: 'news' })
      const legacy = await createTestCollection(ctx.site.id, { key: 'legacy' })
      await db
        .update(collection)
        .set({ enabled: false })
        .where(eq(collection.id, legacy.id))
      await createTestGlobal(ctx.site.id)

      const data: EntryData = {
        title: 'x',
        excerpt: '',
        body: { type: 'doc', content: [] },
      }
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: articles.id,
        slug: 'a1',
        status: 'published',
        draftData: data,
        publishedData: data,
        publishedSlug: 'a1',
      })
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: articles.id,
        slug: 'a2',
        status: 'archived',
        draftData: data,
      })
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: legacy.id,
        slug: 'l1',
        status: 'draft',
        draftData: data,
      })

      const other = await createTestSite()
      try {
        const otherArticles = await createTestCollection(other.site.id)
        for (const slug of ['o1', 'o2', 'o3', 'o4', 'o5']) {
          await insertEntry({
            siteId: other.site.id,
            collectionId: otherArticles.id,
            slug,
            status: 'draft',
            draftData: data,
          })
        }

        const all = await countEntriesByCollection(ctx.site.id)
        expect(all).toEqual({ articles: 2, news: 0, legacy: 1 })

        const visible = await countEntriesByCollection(ctx.site.id, {
          enabledOnly: true,
        })
        expect(visible).toEqual({ articles: 2, news: 0 })

        const theirs = await countEntriesByCollection(other.site.id)
        expect(theirs).toEqual({ articles: 5 })
      } finally {
        await cleanupTestSite(other)
      }
    })
  })
})
