import { deleteOrganization } from '#/server/admin/organizations'
import { deleteSite } from '#/server/admin/sites'
import { createEntry, deleteEntry, updateDraft } from '#/server/content/entries'
import { deleteCollection } from '#/server/content/collections'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { db, pool } from '#/db'
import {
  asset,
  deletedContentArchive,
  entry,
  entryRevision,
  organization,
  publication,
  storageObjectDeletion,
} from '#/db/schema'
import {
  articleFields,
  createTestCollection,
  sampleRichText,
  withTestSite,
} from '#/server/content/test-utils'
import {
  AssetInUseError,
  assetUsage,
  deleteAsset,
  drainStorageObjectDeletions,
  uploadAsset,
} from './index'

const storage = vi.hoisted(() => ({
  put: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
}))
vi.mock('#/adapters', () => ({ getStorage: () => storage }))

describe.skipIf(!process.env.DATABASE_URL)(
  'retained assets and compensation',
  () => {
    it('protects rich-text-only revisions and snapshots after entry deletion', async () => {
      await withTestSite(async (ctx) => {
        const col = await createTestCollection(ctx.site.id)
        const [image] = await db
          .insert(asset)
          .values({
            organizationId: ctx.org.id,
            storageKey: `${ctx.org.id}/history.png`,
            originalFilename: 'history.png',
            mimeType: 'image/png',
            size: 4,
          })
          .returning()
        const imageData = {
          body: {
            type: 'doc',
            content: [
              {
                type: 'image',
                attrs: {
                  src: `https://old-host/api/assets/file/${image.storageKey}`,
                },
              },
            ],
          },
        }
        const [record] = await db
          .insert(entry)
          .values({
            siteId: ctx.site.id,
            collectionId: col.id,
            slug: 'retained',
            draftData: {},
          })
          .returning()
        await db
          .insert(entryRevision)
          .values({ entryId: record.id, data: imageData })
        expect(await assetUsage(image.id, ctx.org.id)).toBe(1)
        await expect(deleteAsset(image.id, ctx.org.id)).rejects.toBeInstanceOf(
          AssetInUseError,
        )
        const pubId = crypto.randomUUID()
        await db.insert(publication).values({
          id: pubId,
          siteId: ctx.site.id,
          status: 'live',
          snapshotHash: 'test',
          snapshot: {
            publicationId: pubId,
            siteKey: ctx.site.slug,
            createdAt: new Date().toISOString(),
            hash: 'test',
            collections: {
              articles: [
                {
                  id: record.id,
                  slug: 'retained',
                  publishedAt: null,
                  data: imageData,
                },
              ],
            },
          },
        })
        await db.delete(entry).where(eq(entry.id, record.id))
        await expect(deleteAsset(image.id, ctx.org.id)).rejects.toBeInstanceOf(
          AssetInUseError,
        )
        await db.delete(publication).where(eq(publication.id, pubId))
        storage.delete.mockRejectedValueOnce(
          new Error('temporary storage outage'),
        )
        await deleteAsset(image.id, ctx.org.id)
        expect(
          await db.select().from(asset).where(eq(asset.id, image.id)),
        ).toHaveLength(0)
        expect(
          await db
            .select()
            .from(storageObjectDeletion)
            .where(eq(storageObjectDeletion.storageKey, image.storageKey)),
        ).toHaveLength(1)
        await db
          .update(storageObjectDeletion)
          .set({ nextAttemptAt: new Date(Date.now() - 1000) })
          .where(eq(storageObjectDeletion.storageKey, image.storageKey))
        await drainStorageObjectDeletions()
        expect(
          await db
            .select()
            .from(storageObjectDeletion)
            .where(eq(storageObjectDeletion.storageKey, image.storageKey)),
        ).toHaveLength(0)
      })
    })

    it('compensates the object when the asset database insert fails', async () => {
      storage.put.mockClear()
      storage.delete.mockClear()
      await expect(
        uploadAsset({
          organizationId: 'missing-org',
          actorId: 'missing-user',
          file: {
            buffer: Buffer.from('pdf'),
            filename: 'file.pdf',
            mimeType: 'application/pdf',
          },
        }),
      ).rejects.toThrow()
      expect(storage.put).toHaveBeenCalledOnce()
      expect(storage.delete).toHaveBeenCalledWith(
        storage.put.mock.calls[0][0],
        { signal: undefined },
      )
    })
    it('retains assets used by deleted entry, collection, and site histories', async () => {
      await withTestSite(async (ctx) => {
        await createTestCollection(ctx.site.id)
        const [image] = await db
          .insert(asset)
          .values({
            organizationId: ctx.org.id,
            storageKey: `${ctx.org.id}/deleted-history.png`,
            originalFilename: 'history.png',
            mimeType: 'image/png',
            size: 4,
          })
          .returning()
        const data = {
          title: 'Old draft',
          slug: 'old-draft',
          body: {
            type: 'doc',
            content: [
              ...sampleRichText.content,
              {
                type: 'image',
                attrs: {
                  src: `https://legacy-host/api/assets/file/${image.storageKey}`,
                },
              },
            ],
          },
        }
        const record = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data,
          actorId: ctx.actor.id,
        })
        await updateDraft(
          record.id,
          { ...data, body: sampleRichText },
          ctx.actor.id,
          record.draftVersion,
        )
        await deleteEntry(record.id, ctx.actor.id)
        expect(
          await db.select().from(entry).where(eq(entry.id, record.id)),
        ).toHaveLength(0)
        expect(
          (
            await db
              .select()
              .from(deletedContentArchive)
              .where(eq(deletedContentArchive.entityId, record.id))
          )[0]?.data.revisions,
        ).toBeTruthy()
        await expect(deleteAsset(image.id, ctx.org.id)).rejects.toBeInstanceOf(
          AssetInUseError,
        )
        const collectionRecord = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: { ...data, slug: 'collection-history' },
          actorId: ctx.actor.id,
        })
        await deleteCollection(ctx.site.id, 'articles', ctx.actor.id)
        expect(
          await db
            .select()
            .from(entry)
            .where(eq(entry.id, collectionRecord.id)),
        ).toHaveLength(0)
        expect(
          (
            await db
              .select()
              .from(deletedContentArchive)
              .where(eq(deletedContentArchive.organizationId, ctx.org.id))
          ).map((row) => row.entityType),
        ).toContain('collection')
        await deleteSite(ctx.site.id, ctx.actor.id)
        expect(
          (
            await db
              .select()
              .from(deletedContentArchive)
              .where(eq(deletedContentArchive.entityId, ctx.site.id))
          )[0]?.entityType,
        ).toBe('site')
        await expect(deleteAsset(image.id, ctx.org.id)).rejects.toBeInstanceOf(
          AssetInUseError,
        )
      })
    })

    it('serializes concurrent attachment and deletion at the organization lock', async () => {
      await withTestSite(async (ctx) => {
        const col = await createTestCollection(ctx.site.id, {
          fields: articleFields(),
        })
        const [image] = await db
          .insert(asset)
          .values({
            organizationId: ctx.org.id,
            storageKey: `${ctx.org.id}/race.png`,
            originalFilename: 'race.png',
            mimeType: 'image/png',
            size: 4,
          })
          .returning()
        const connection = await pool.connect()
        try {
          await connection.query('BEGIN')
          const {
            rows: [{ pid }],
          } = await connection.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid',
          )
          await connection.query(
            'SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))',
            [`assets:${ctx.org.id}`],
          )
          await connection.query(
            'INSERT INTO entry (id,site_id,collection_id,slug,draft_data) VALUES ($1,$2,$3,$4,$5)',
            [
              crypto.randomUUID(),
              ctx.site.id,
              col.id,
              'race',
              JSON.stringify({
                title: 'Retained',
                slug: 'race',
                body: sampleRichText,
                heroImage: image.id,
              }),
            ],
          )
          const deleting = deleteAsset(image.id, ctx.org.id).then(
            () => null,
            (error: unknown) => error,
          )
          let blocked = false
          for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
            const state = await pool.query<{ blocked: boolean }>(
              'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
              [pid],
            )
            blocked = state.rows[0].blocked
            if (!blocked) await new Promise((resolve) => setTimeout(resolve, 5))
          }
          expect(blocked).toBe(true)
          await connection.query('COMMIT')
          expect(await deleting).toBeInstanceOf(AssetInUseError)
          expect(
            await db.select().from(asset).where(eq(asset.id, image.id)),
          ).toHaveLength(1)
        } finally {
          await connection.query('ROLLBACK')
          connection.release()
        }
      })
    })

    it('counts usage without waiting for a transaction that holds the organization asset lock', async () => {
      await withTestSite(async (ctx) => {
        const [image] = await db
          .insert(asset)
          .values({
            organizationId: ctx.org.id,
            storageKey: `${ctx.org.id}/busy.png`,
            originalFilename: 'busy.png',
            mimeType: 'image/png',
            size: 4,
          })
          .returning()
        const connection = await pool.connect()
        try {
          await connection.query('BEGIN')
          await connection.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`assets:${ctx.org.id}`],
          )
          const counted = await Promise.race([
            assetUsage(image.id, ctx.org.id),
            new Promise((resolve) => setTimeout(() => resolve('blocked'), 2000)),
          ])
          expect(counted).toBe(0)
        } finally {
          await connection.query('ROLLBACK')
          connection.release()
        }
      })
    })

    it('keeps organization object cleanup retryable after organization and archives are deleted', async () => {
      await withTestSite(async (ctx) => {
        const key = `${ctx.org.id}/org-cleanup.pdf`
        await db.insert(asset).values({
          organizationId: ctx.org.id,
          storageKey: key,
          originalFilename: 'cleanup.pdf',
          mimeType: 'application/pdf',
          size: 4,
        })
        await deleteSite(ctx.site.id, ctx.actor.id)
        storage.delete.mockRejectedValueOnce(new Error('storage unavailable'))
        await deleteOrganization(ctx.org.id, ctx.actor.id)
        expect(
          await db
            .select()
            .from(organization)
            .where(eq(organization.id, ctx.org.id)),
        ).toHaveLength(0)
        expect(
          await db
            .select()
            .from(deletedContentArchive)
            .where(eq(deletedContentArchive.organizationId, ctx.org.id)),
        ).toHaveLength(0)
        expect(
          await db
            .select()
            .from(storageObjectDeletion)
            .where(eq(storageObjectDeletion.storageKey, key)),
        ).toHaveLength(1)
        await db
          .update(storageObjectDeletion)
          .set({ nextAttemptAt: new Date(Date.now() - 1000) })
          .where(eq(storageObjectDeletion.storageKey, key))
        await drainStorageObjectDeletions()
        expect(storage.delete).toHaveBeenCalledWith(key, { signal: undefined })
        expect(
          await db
            .select()
            .from(storageObjectDeletion)
            .where(eq(storageObjectDeletion.storageKey, key)),
        ).toHaveLength(0)
      })
    })
  },
)
