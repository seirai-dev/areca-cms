import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import type { EntryData, Field } from '#/lib/types'

import {
  dataReferencesEntry,
  listInboundReferences,
} from './inbound-references.ts'
import { createTestCollection, withTestSite } from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

describe('dataReferencesEntry', () => {
  it('matches a stored reference field id and ignores other keys', () => {
    expect(
      dataReferencesEntry({ author: 'abc', title: 'Post' }, ['author'], 'abc'),
    ).toBe(true)
    expect(
      dataReferencesEntry({ author: 'abc', title: 'Post' }, ['author'], 'nope'),
    ).toBe(false)
    expect(dataReferencesEntry({ title: 'abc' }, ['author'], 'abc')).toBe(false)
    expect(dataReferencesEntry(null, ['author'], 'abc')).toBe(false)
    expect(dataReferencesEntry(undefined, ['author'], 'abc')).toBe(false)
  })
})

describe.skipIf(!hasDb)('listInboundReferences', () => {
  it('includes an entry that stores the id on a reference field in draft', async () => {
    await withTestSite(async (ctx) => {
      const authors = await createTestCollection(ctx.site.id, {
        key: 'authors',
        routePattern: '/authors/$slug',
        fields: [
          { key: 'title', label: 'Name', type: 'text', required: true },
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
        ] satisfies Field[],
      })
      const articles = await createTestCollection(ctx.site.id, {
        key: 'articles',
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          {
            key: 'author',
            label: 'Author',
            type: 'reference',
            collection: 'authors',
          },
        ] satisfies Field[],
      })

      const [target] = await db
        .insert(entry)
        .values({
          siteId: ctx.site.id,
          collectionId: authors.id,
          slug: `ada-${ctx.suffix}`,
          status: 'published',
          draftData: { title: 'Ada', slug: `ada-${ctx.suffix}` },
          publishedData: { title: 'Ada', slug: `ada-${ctx.suffix}` },
          publishedSlug: `ada-${ctx.suffix}`,
        })
        .returning()
      const [referrer] = await db
        .insert(entry)
        .values({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: `post-${ctx.suffix}`,
          status: 'draft',
          draftData: {
            title: 'Notes',
            slug: `post-${ctx.suffix}`,
            author: target.id,
          } satisfies EntryData,
        })
        .returning()
      const [other] = await db
        .insert(entry)
        .values({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: `other-${ctx.suffix}`,
          status: 'draft',
          draftData: {
            title: 'Unrelated',
            slug: `other-${ctx.suffix}`,
          } satisfies EntryData,
        })
        .returning()

      const inbound = await listInboundReferences(target.id, false)
      expect(inbound.map((row) => row.id)).toEqual([referrer.id])
      expect(inbound[0]).toMatchObject({
        title: 'Notes',
        slug: `post-${ctx.suffix}`,
        collectionKey: 'articles',
        status: 'draft',
      })

      expect(await listInboundReferences(other.id, false)).toEqual([])
      expect(await listInboundReferences(referrer.id, false)).toEqual([])
    })
  })
})
