import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import type { Field } from '#/lib/types'

import {
  createEntry,
  publishEntry,
  scheduleEntry,
} from './entries.ts'
import { buildSnapshot } from './snapshot.ts'
import {
  createTestCollection,
  sampleRichText,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const authorFields: Field[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
]

const articleWithAuthor: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'author', label: 'Author', type: 'reference', collection: 'authors' },
]

describe.skipIf(!hasDb)('buildSnapshot', () => {
  it('produces a deterministic hash and includes a scheduled-due entry', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)

      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Published',
          slug: `pub-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)

      const scheduled = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Due soon',
          slug: `due-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await scheduleEntry(
        scheduled.id,
        '2020-01-01T00:00:00.000Z',
        'UTC',
        ctx.actor.id,
      )

      const first = await buildSnapshot(ctx.site.id)
      const second = await buildSnapshot(ctx.site.id)
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      if (!first.ok || !second.ok) return

      expect(first.hash).toBe(second.hash)
      expect(first.snapshot.hash).toBe(first.hash)
      expect(first.snapshot.publicationId).toBe('')
      expect(first.snapshot.siteKey).toBe(ctx.site.slug)
      expect(first.snapshot.collections.articles).toHaveLength(2)
      expect(
        first.snapshot.collections.articles?.map((item) => item.slug).sort(),
      ).toEqual([`due-${ctx.suffix}`, `pub-${ctx.suffix}`].sort())

      const published = first.snapshot.collections.articles?.find(
        (item) => item.slug === `pub-${ctx.suffix}`,
      )
      expect(published?.data.body).toMatchObject({
        json: expect.anything(),
        html: expect.any(String),
        markdown: expect.any(String),
      })
    })
  })

  it('errors on a route slug collision', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
      })
      await createTestCollection(ctx.site.id, {
        key: 'notes',
        routePattern: '/blog/$slug',
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'body', label: 'Body', type: 'richtext', required: true },
        ],
      })

      const sharedSlug = `clash-${ctx.suffix}`
      const article = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'A', slug: sharedSlug, body: sampleRichText },
        actorId: ctx.actor.id,
      })
      await publishEntry(article.id, ctx.actor.id)

      const note = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'notes',
        data: { title: 'N', slug: sharedSlug, body: sampleRichText },
        actorId: ctx.actor.id,
      })
      await publishEntry(note.id, ctx.actor.id)

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors.some((err) => err.includes('Route collision'))).toBe(
        true,
      )
    })
  })

  it('errors when a reference points at an unpublished entry', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, {
        key: 'authors',
        routePattern: '/authors/$slug',
        fields: authorFields,
      })
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        fields: articleWithAuthor,
      })

      const author = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'authors',
        data: { name: 'Ada', slug: `ada-${ctx.suffix}` },
        actorId: ctx.actor.id,
      })

      const articleData = {
        title: 'With author',
        slug: `ref-${ctx.suffix}`,
        body: sampleRichText,
        author: author.id,
      }
      const article = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: articleData,
        actorId: ctx.actor.id,
      })
      await db
        .update(entry)
        .set({
          status: 'published',
          publishedData: articleData,
          publishedAt: new Date(),
        })
        .where(eq(entry.id, article.id))

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(
        result.errors.some((err) =>
          err.includes('referenced entry is not in the snapshot'),
        ),
      ).toBe(true)

      await publishEntry(author.id, ctx.actor.id)
      const ok = await buildSnapshot(ctx.site.id)
      expect(ok.ok).toBe(true)
      if (!ok.ok) return
      const snapEntry = ok.snapshot.collections.articles?.[0]
      expect(snapEntry?.data.author).toEqual({
        collection: 'authors',
        slug: `ada-${ctx.suffix}`,
        id: author.id,
      })
    })
  })
})
