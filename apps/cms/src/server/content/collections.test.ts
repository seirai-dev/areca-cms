import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, collection, entry, entryRevision } from '#/db/schema'

import { deleteCollection, listCollections } from './collections.ts'
import { createEntry } from './entries.ts'
import {
  createTestCollection,
  sampleRichText,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('collections', () => {
  it('lists disabled collections unless enabledOnly is requested', async () => {
    await withTestSite(async (ctx) => {
      const created = await createTestCollection(ctx.site.id)
      await db
        .update(collection)
        .set({ enabled: false })
        .where(eq(collection.id, created.id))

      const all = await listCollections(ctx.site.id)
      const enabled = await listCollections(ctx.site.id, { enabledOnly: true })

      expect(all.map((item) => item.id)).toContain(created.id)
      expect(enabled.map((item) => item.id)).not.toContain(created.id)
    })
  })

  it('deletes a collection with its entries and revision history', async () => {
    await withTestSite(async (ctx) => {
      const createdCollection = await createTestCollection(ctx.site.id)
      const createdEntry = await createEntry({
        siteId: ctx.site.id,
        collectionKey: createdCollection.key,
        data: {
          title: 'Delete me',
          slug: `delete-me-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })

      await deleteCollection(ctx.site.id, createdCollection.key, ctx.actor.id)

      const [remainingCollections, remainingEntries, remainingRevisions, logs] =
        await Promise.all([
          db
            .select()
            .from(collection)
            .where(eq(collection.id, createdCollection.id)),
          db.select().from(entry).where(eq(entry.id, createdEntry.id)),
          db
            .select()
            .from(entryRevision)
            .where(eq(entryRevision.entryId, createdEntry.id)),
          db
            .select()
            .from(auditLog)
            .where(
              and(
                eq(auditLog.siteId, ctx.site.id),
                eq(auditLog.action, 'collection.delete'),
              ),
            ),
        ])

      expect(remainingCollections).toHaveLength(0)
      expect(remainingEntries).toHaveLength(0)
      expect(remainingRevisions).toHaveLength(0)
      expect(logs).toEqual([
        expect.objectContaining({
          actorId: ctx.actor.id,
          targetId: createdCollection.id,
          meta: { key: createdCollection.key },
        }),
      ])
    })
  })
})
