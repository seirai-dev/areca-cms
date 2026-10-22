import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { asset, collection, entry } from '#/db/schema'
import type { Field } from '#/lib/types'

import {
  createEntry,
  publishEntry,
  scheduleEntry,
  updateDraft,
} from './entries.ts'
import { listCollections } from './collections.ts'
import { buildSnapshot, buildPreviewEntry } from './snapshot.ts'
import {
  createTestCollection,
  dueScheduleIso,
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
      await scheduleEntry(scheduled.id, dueScheduleIso(), 'UTC', ctx.actor.id)

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

  it('moves $seo out of data into a resolved entry.seo', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { routePattern: '/blog/$slug' })
      const slug = `seo-${ctx.suffix}`
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Entry title',
          slug,
          body: sampleRichText,
          $seo: {
            description: 'Search snippet',
            noindex: true,
            faq: [{ question: 'Why?', answer: 'Because.' }],
          },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const item = result.snapshot.collections.articles?.[0]
      expect(item?.data).not.toHaveProperty('$seo')
      expect(item?.seo).toMatchObject({
        title: 'Entry title',
        description: 'Search snippet',
        canonicalUrl: `${new URL(ctx.site.productionUrl).origin}/blog/${slug}`,
        robots: { index: false, follow: true },
        faq: [{ question: 'Why?', answer: 'Because.' }],
      })
      expect(item?.seo?.jsonLd.map((node) => node['@type'])).toEqual([
        'Article',
        'FAQPage',
      ])

      const preview = await buildPreviewEntry(ctx.site.id, 'articles', slug)
      expect(preview?.data).not.toHaveProperty('$seo')
      expect(preview?.seo?.description).toBe('Search snippet')
    })
  })

  it('embeds the schema of every enabled collection, matching the manifest', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { routePattern: '/blog/$slug' })
      await createTestCollection(ctx.site.id, {
        key: 'notes',
        routePattern: '/notes/$slug',
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true },
        ],
      })
      await createTestCollection(ctx.site.id, {
        key: 'retired',
        routePattern: '/old/$slug',
      })
      await db
        .update(collection)
        .set({ enabled: false })
        .where(eq(collection.key, 'retired'))

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const enabled = await listCollections(ctx.site.id, { enabledOnly: true })
      const expected = Object.fromEntries(
        enabled.map((col) => [
          col.key,
          { route: col.routePattern, label: col.label, fields: col.fields },
        ]),
      )
      expect(Object.keys(result.snapshot.schema ?? {}).sort()).toEqual(
        Object.keys(result.snapshot.collections).sort(),
      )
      expect(result.snapshot.schema).toEqual(expected)
      expect(result.snapshot.schema?.notes?.fields[0]?.key).toBe('slug')
    })
  })

  it('keeps the hash independent of the schema', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { routePattern: '/blog/$slug' })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Stable',
          slug: `hash-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)

      const before = await buildSnapshot(ctx.site.id)
      expect(before.ok).toBe(true)
      if (!before.ok) return

      // A label change alters only the schema, not the published collections.
      await db
        .update(collection)
        .set({ label: 'Renamed articles' })
        .where(eq(collection.siteId, ctx.site.id))

      const after = await buildSnapshot(ctx.site.id)
      expect(after.ok).toBe(true)
      if (!after.ok) return

      expect(after.snapshot.collections).toEqual(before.snapshot.collections)
      expect(after.hash).toBe(before.hash)
      expect(after.snapshot.schema?.articles?.label).toBe('Renamed articles')
      expect(before.snapshot.schema?.articles?.label).toBe('Articles')
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
          publishedSlug: article.slug,
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

  it('errors when an image field points at a missing asset', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)

      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Missing hero',
          slug: `missing-hero-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)
      await db
        .update(entry)
        .set({
          publishedData: {
            ...created.draftData,
            heroImage: 'asset_does_not_exist',
          },
        })
        .where(eq(entry.id, created.id))

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors.some((err) => err.includes('asset not found'))).toBe(
        true,
      )
    })
  })
  it('keeps approved slug isolated and preserves the previous version until frozen schedule is due', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const original = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Approved',
          slug: `old-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(original.id, ctx.actor.id)
      const edited = await updateDraft(
        original.id,
        {
          ...original.draftData,
          title: 'Scheduled',
          slug: `scheduled-${ctx.suffix}`,
        },
        ctx.actor.id,
        original.draftVersion,
      )
      const unchanged = await buildSnapshot(ctx.site.id)
      expect(
        unchanged.ok && unchanged.snapshot.collections.articles[0]?.slug,
      ).toBe(original.slug)
      const scheduled = await scheduleEntry(
        original.id,
        '2099-01-01T00:00:00Z',
        'UTC',
        ctx.actor.id,
      )
      await updateDraft(
        original.id,
        {
          ...edited.draftData,
          title: 'Unapproved',
          slug: `draft-${ctx.suffix}`,
        },
        ctx.actor.id,
        edited.draftVersion,
      )
      const before = await buildSnapshot(ctx.site.id)
      expect(
        before.ok && before.snapshot.collections.articles[0]?.data.title,
      ).toBe('Approved')
      expect(before.ok && before.entryVersions).toEqual([])
      await db
        .update(entry)
        .set({ scheduledAt: new Date('2020-01-01') })
        .where(eq(entry.id, original.id))
      const due = await buildSnapshot(ctx.site.id)
      expect(due.ok && due.snapshot.collections.articles[0]?.slug).toBe(
        edited.slug,
      )
      expect(due.ok && due.snapshot.collections.articles[0]?.data.title).toBe(
        'Scheduled',
      )
      expect(due.ok && due.entryVersions).toEqual([
        { entryId: original.id, scheduledVersion: scheduled.scheduledVersion },
      ])
    })
  })

  it('rejects cross-site reference writes and suppresses legacy cross-site preview references', async () => {
    await withTestSite(async (first) =>
      withTestSite(async (second) => {
        await createTestCollection(first.site.id, { fields: articleWithAuthor })
        await createTestCollection(second.site.id, {
          key: 'authors',
          fields: authorFields,
        })
        const foreign = await createEntry({
          siteId: second.site.id,
          collectionKey: 'authors',
          data: { name: 'Foreign', slug: `foreign-${second.suffix}` },
          actorId: second.actor.id,
        })
        const data = {
          title: 'Article',
          slug: `safe-${first.suffix}`,
          body: sampleRichText,
          author: foreign.id,
        }
        await expect(
          createEntry({
            siteId: first.site.id,
            collectionKey: 'articles',
            data,
            actorId: first.actor.id,
          }),
        ).rejects.toThrow()
        const safe = await createEntry({
          siteId: first.site.id,
          collectionKey: 'articles',
          data: { ...data, author: null },
          actorId: first.actor.id,
        })
        await db
          .update(entry)
          .set({ draftData: data })
          .where(eq(entry.id, safe.id))
        const preview = await buildPreviewEntry(
          first.site.id,
          'articles',
          safe.slug,
        )
        expect(preview?.data.author).toBeNull()
      }),
    )
  })
  it('rejects foreign asset IDs on write and suppresses legacy foreign asset preview conversion', async () => {
    await withTestSite(async (first) =>
      withTestSite(async (second) => {
        await createTestCollection(first.site.id)
        const [foreign] = await db
          .insert(asset)
          .values({
            organizationId: second.org.id,
            storageKey: `${second.org.id}/foreign.png`,
            originalFilename: 'foreign.png',
            mimeType: 'image/png',
            size: 1,
          })
          .returning()
        const data = {
          title: 'Article',
          slug: `asset-${first.suffix}`,
          body: sampleRichText,
          heroImage: foreign.id,
        }
        await expect(
          createEntry({
            siteId: first.site.id,
            collectionKey: 'articles',
            data,
            actorId: first.actor.id,
          }),
        ).rejects.toThrow('Asset not found')
        const safe = await createEntry({
          siteId: first.site.id,
          collectionKey: 'articles',
          data: { ...data, heroImage: null },
          actorId: first.actor.id,
        })
        await db
          .update(entry)
          .set({ draftData: data })
          .where(eq(entry.id, safe.id))
        const preview = await buildPreviewEntry(
          first.site.id,
          'articles',
          safe.slug,
        )
        expect(preview?.data.heroImage).toBeNull()
        await db
          .update(entry)
          .set({
            status: 'published',
            publishedData: data,
            publishedSlug: safe.slug,
          })
          .where(eq(entry.id, safe.id))
        const snapshot = await buildSnapshot(first.site.id)
        expect(snapshot.ok).toBe(false)
      }),
    )
  })
  it('rejects and suppresses cross-tenant rich-text asset URLs in writes and legacy content', async () => {
    await withTestSite(async (first) =>
      withTestSite(async (second) => {
        await createTestCollection(first.site.id)
        const [foreign] = await db
          .insert(asset)
          .values({
            organizationId: second.org.id,
            storageKey: `${second.org.id}/embedded.png`,
            originalFilename: 'embedded.png',
            mimeType: 'image/png',
            size: 1,
          })
          .returning()
        const body = {
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: {
                src: `/api/assets/file/${foreign.storageKey}`,
                alt: 'Foreign',
              },
            },
          ],
        }
        const data = { title: 'Article', slug: `rich-${first.suffix}`, body }
        await expect(
          createEntry({
            siteId: first.site.id,
            collectionKey: 'articles',
            data,
            actorId: first.actor.id,
          }),
        ).rejects.toThrow('Embedded asset not found')
        const safe = await createEntry({
          siteId: first.site.id,
          collectionKey: 'articles',
          data: { ...data, body: sampleRichText },
          actorId: first.actor.id,
        })
        await expect(
          updateDraft(safe.id, data, first.actor.id, safe.draftVersion),
        ).rejects.toThrow('Embedded asset not found')
        await db
          .update(entry)
          .set({ draftData: data })
          .where(eq(entry.id, safe.id))
        const preview = await buildPreviewEntry(
          first.site.id,
          'articles',
          safe.slug,
        )
        expect(preview?.data.body).toBeNull()
        await db
          .update(entry)
          .set({
            status: 'published',
            publishedData: data,
            publishedSlug: safe.slug,
          })
          .where(eq(entry.id, safe.id))
        const snapshot = await buildSnapshot(first.site.id)
        expect(snapshot.ok).toBe(false)
      }),
    )
  })
})
