import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from '#/db'
import { collection, entryRevision } from '#/db/schema'
import type { Field } from '#/lib/types'
import {
  getCollection,
  listCollections,
  syncManifest,
  upsertCollection,
} from './collections'
import {
  createEntry,
  publishEntry,
  restoreRevision,
  scheduleEntry,
} from './entries'
import { buildPreviewEntry, buildSnapshot } from './snapshot'
import { createTestCollection, withTestSite } from './test-utils'

const basic: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
]
const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('audit content database regressions', () => {
  it('rejects case-fold collisions with retained collections and leaves the schema unchanged', async () => {
    await withTestSite(async (ctx) => {
      await upsertCollection(ctx.site.id, {
        key: 'Articles',
        label: 'Articles',
        routePattern: '/blog/$slug',
        fields: basic,
      })
      await expect(
        syncManifest(ctx.site.id, {
          collections: { articles: { route: '/other/$slug', fields: basic } },
        }),
      ).rejects.toThrow(/conflicts/)
      const current = await listCollections(ctx.site.id)
      expect(current.map((item) => item.key)).toEqual(['Articles'])
      expect(current[0]?.enabled).toBe(true)
      await expect(
        upsertCollection(ctx.site.id, {
          key: 'articles',
          label: 'Other',
          routePattern: '/',
          fields: basic,
        }),
      ).rejects.toThrow(/conflicts/)
    })
  })
  it('rejects disabling a referenced collection atomically', async () => {
    await withTestSite(async (ctx) => {
      const articles = {
        route: '/blog/$slug',
        fields: [
          ...basic,
          {
            key: 'author',
            label: 'Author',
            type: 'reference',
            collection: 'authors',
          } as Field,
        ],
      }
      await syncManifest(ctx.site.id, {
        collections: {
          authors: { route: '/authors/$slug', fields: basic },
          articles,
        },
      })
      await expect(
        syncManifest(ctx.site.id, { collections: { articles } }),
      ).rejects.toThrow(/target collection/)
      expect((await getCollection(ctx.site.id, 'authors'))?.enabled).toBe(true)
      await expect(
        upsertCollection(ctx.site.id, {
          key: 'authors',
          label: 'Authors',
          routePattern: '/authors/$slug',
          fields: basic,
          enabled: false,
        }),
      ).rejects.toThrow(/target collection/)
      expect((await getCollection(ctx.site.id, 'authors'))?.enabled).toBe(true)
    })
  })
  it('rejects different route patterns resolving to the same page URL', async () => {
    await withTestSite(async (ctx) => {
      for (const [key, routePattern] of [
        ['articles', '/blog/$slug'],
        ['pages', '/blog'],
      ] as const) {
        await createTestCollection(ctx.site.id, {
          key,
          routePattern,
          fields: basic,
        })
        const created = await createEntry({
          siteId: ctx.site.id,
          collectionKey: key,
          data: { title: key, slug: 'same-page' },
          actorId: ctx.actor.id,
        })
        await publishEntry(created.id, ctx.actor.id)
      }
      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.errors).toContainEqual(
          expect.stringMatching(
            /same-page.*articles\/same-page.*pages\/same-page.*slug or content type route/,
          ),
        )
    })
  })
  it('allows approving a reference to a scheduled target retaining its approved version', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { key: 'authors', fields: basic })
      await createTestCollection(ctx.site.id, {
        fields: [
          ...basic,
          {
            key: 'author',
            label: 'Author',
            type: 'reference',
            collection: 'authors',
          },
        ],
      })
      const author = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'authors',
        data: { title: 'Author', slug: 'author' },
        actorId: ctx.actor.id,
      })
      await publishEntry(author.id, ctx.actor.id)
      await scheduleEntry(
        author.id,
        new Date(Date.now() + 3_600_000).toISOString(),
        'UTC',
        ctx.actor.id,
      )
      const article = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Article', slug: 'article', author: author.id },
        actorId: ctx.actor.id,
      })
      await expect(
        publishEntry(article.id, ctx.actor.id),
      ).resolves.toMatchObject({ status: 'published' })
      expect((await buildSnapshot(ctx.site.id)).ok).toBe(true)
    })
  })
  it('exports only currently declared fields in both preview and snapshot', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id, {
        fields: [...basic, { key: 'legacy', label: 'Legacy', type: 'text' }],
      })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Title', slug: 'title', legacy: 'old' },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)
      await db
        .update(collection)
        .set({ fields: basic })
        .where(eq(collection.id, col.id))
      expect(
        (await buildPreviewEntry(ctx.site.id, 'articles', 'title'))?.data,
      ).not.toHaveProperty('legacy')
      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (result.ok)
        expect(
          result.snapshot.collections.articles[0]?.data,
        ).not.toHaveProperty('legacy')
    })
  })
  it('restores compatible fields, keeps current incompatible values and reports skipped fields', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, {
        fields: [...basic, { key: 'score', label: 'Score', type: 'number' }],
      })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Current', slug: 'current', score: 7 },
        actorId: ctx.actor.id,
      })
      const [revision] = await db
        .insert(entryRevision)
        .values({
          entryId: created.id,
          data: {
            title: 'Earlier',
            slug: 'current',
            score: 'old text',
            removed: 'gone',
          },
          createdBy: ctx.actor.id,
          note: 'legacy',
        })
        .returning()
      const restored = await restoreRevision(
        created.id,
        revision.id,
        ctx.actor.id,
        created.draftVersion,
      )
      expect(restored.draftData).toEqual({
        title: 'Earlier',
        slug: 'current',
        score: 7,
      })
      expect(restored.skippedFields.map((field) => field.key)).toEqual([
        'score',
        'removed',
      ])
      expect(restored.skippedFields[0]?.label).toBe('Score')
      expect(restored.draftVersion).toBe(created.draftVersion + 1)
      expect(restored.status).toBe('draft')
    })
  })
  it('waits for a schema mutation and restores against the committed current schema', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id, {
        fields: [...basic, { key: 'score', label: 'Score', type: 'text' }],
      })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Current', slug: 'current', score: 'current text' },
        actorId: ctx.actor.id,
      })
      const [revision] = await db
        .insert(entryRevision)
        .values({
          entryId: created.id,
          data: { title: 'Earlier', slug: 'current', score: 'historical text' },
          createdBy: ctx.actor.id,
          note: 'before schema change',
        })
        .returning()
      const blocker = await pool.connect()
      let restore: ReturnType<typeof restoreRevision> | undefined
      try {
        await blocker.query('BEGIN')
        await blocker.query('SELECT id FROM site WHERE id=$1 FOR UPDATE', [
          ctx.site.id,
        ])
        const pid = (
          await blocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')
        ).rows[0].pid
        restore = restoreRevision(
          created.id,
          revision.id,
          ctx.actor.id,
          created.draftVersion,
        )
        await expect
          .poll(async () => {
            const waiting = await pool.query(
              'SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
              [pid],
            )
            return waiting.rowCount
          })
          .toBeGreaterThan(0)
        await blocker.query(
          'UPDATE collection SET fields=$1::jsonb WHERE id=$2',
          [
            JSON.stringify([
              ...basic,
              { key: 'score', label: 'Score', type: 'number' },
            ]),
            col.id,
          ],
        )
        await blocker.query(
          'UPDATE entry SET draft_data=$1::jsonb WHERE id=$2',
          [
            JSON.stringify({ title: 'Current', slug: 'current', score: 7 }),
            created.id,
          ],
        )
        await blocker.query('COMMIT')
        const result = await restore
        expect(result.draftData).toEqual({
          title: 'Earlier',
          slug: 'current',
          score: 7,
        })
        expect(result.skippedFields.map((field) => field.key)).toEqual([
          'score',
        ])
      } finally {
        await blocker.query('ROLLBACK')
        blocker.release()
        if (restore) await restore.catch(() => {})
      }
    })
  })
})
