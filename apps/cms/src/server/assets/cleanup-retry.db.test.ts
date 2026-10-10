import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '#/db'
import { asset, branding, storageObjectDeletion } from '#/db/schema'
import { withTestSite } from '#/server/content/test-utils'
import {
  getBrandingRow,
  resetBranding,
  setBrandingImage,
} from '#/server/admin/branding'
import { uploadAsset } from './index'
import {
  beginObjectUpload,
  completeObjectUpload,
  drainStorageObjectDeletions,
} from './storage-cleanup'

const storage = vi.hoisted(() => ({
  put: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
}))
vi.mock('#/adapters', () => ({ getStorage: () => storage }))
beforeEach(() => {
  storage.put.mockReset()
  storage.delete.mockReset()
})
const png = () =>
  sharp({ create: { width: 2, height: 2, channels: 4, background: '#efefef' } })
    .png()
    .toBuffer()

describe('durable storage cleanup and branding uploads', () => {
  it('rejects registration after cleanup has claimed or removed its intent', async () => {
    await withTestSite(async (fixtures) => {
      for (const removed of [false, true]) {
        const key = `expired-${crypto.randomUUID()}`
        await beginObjectUpload(key)
        if (removed)
          await db
            .delete(storageObjectDeletion)
            .where(eq(storageObjectDeletion.storageKey, key))
        else
          await db
            .update(storageObjectDeletion)
            .set({ attempts: 1 })
            .where(eq(storageObjectDeletion.storageKey, key))
        try {
          await expect(
            db.transaction(async (tx) => {
              await tx.insert(asset).values({
                organizationId: fixtures.org.id,
                storageKey: key,
                originalFilename: 'expired.png',
                mimeType: 'image/png',
                size: 10,
              })
              await completeObjectUpload(tx, key)
            }),
          ).rejects.toThrow('Upload expired before registration; please retry')
          expect(
            await db.select().from(asset).where(eq(asset.storageKey, key)),
          ).toHaveLength(0)
        } finally {
          await db
            .delete(storageObjectDeletion)
            .where(eq(storageObjectDeletion.storageKey, key))
        }
      }
    })
  })

  it('rolls back a slow upload while cleanup is deleting the same object', async () => {
    await withTestSite(async (ctx) => {
      let releasePut!: () => void
      let releaseDelete!: () => void
      let announcePut!: (key: string) => void
      let announceDelete!: () => void
      const putStarted = new Promise<string>((resolve) => {
        announcePut = resolve
      })
      const deleteStarted = new Promise<void>((resolve) => {
        announceDelete = resolve
      })
      storage.put.mockImplementation(async (key: string) => {
        announcePut(key)
        await new Promise<void>((resolve) => {
          releasePut = resolve
        })
      })
      storage.delete.mockImplementation(async () => {
        announceDelete()
        await new Promise<void>((resolve) => {
          releaseDelete = resolve
        })
      })
      const upload = uploadAsset({
        organizationId: ctx.org.id,
        actorId: ctx.actor.id,
        file: {
          buffer: await png(),
          filename: 'slow.png',
          mimeType: 'image/png',
        },
      })
      const rejected = expect(upload).rejects.toThrow(
        'Upload expired before registration; please retry',
      )
      const key = await putStarted
      await db
        .update(storageObjectDeletion)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(eq(storageObjectDeletion.storageKey, key))
      const cleanup = drainStorageObjectDeletions(1, { storageKey: key })
      await deleteStarted
      releasePut()
      await rejected
      expect(
        await db.select().from(asset).where(eq(asset.storageKey, key)),
      ).toHaveLength(0)
      expect(storage.delete).toHaveBeenCalledTimes(1)
      releaseDelete()
      expect(await cleanup).toBe(1)
    })
  })

  it('retries at bounded delays and pauses after the initial attempt and three retries', async () => {
    const key = `cleanup-${crypto.randomUUID()}`
    storage.delete.mockRejectedValue(new Error('storage offline'))
    await db.insert(storageObjectDeletion).values({ storageKey: key })
    try {
      for (let attempt = 1; attempt <= 4; attempt++) {
        const started = Date.now()
        await drainStorageObjectDeletions(1, { storageKey: key })
        const [row] = await db
          .select()
          .from(storageObjectDeletion)
          .where(eq(storageObjectDeletion.storageKey, key))
        expect(row.attempts).toBe(attempt)
        if (attempt < 4) {
          expect(row.nextAttemptAt!.getTime() - started).toBeGreaterThanOrEqual(
            [60_000, 300_000, 900_000][attempt - 1],
          )
          await drainStorageObjectDeletions(1, { storageKey: key })
          expect(storage.delete).toHaveBeenCalledTimes(attempt)
          await db
            .update(storageObjectDeletion)
            .set({ nextAttemptAt: new Date(Date.now() - 1000) })
            .where(eq(storageObjectDeletion.storageKey, key))
        } else expect(row.nextAttemptAt).toBeNull()
      }
      await drainStorageObjectDeletions(1, { storageKey: key })
      expect(storage.delete).toHaveBeenCalledTimes(4)
      await db
        .update(storageObjectDeletion)
        .set({ attempts: 0 })
        .where(eq(storageObjectDeletion.storageKey, key))
      storage.delete.mockResolvedValue(undefined)
      expect(await drainStorageObjectDeletions(1, { storageKey: key })).toBe(1)
    } finally {
      await db
        .delete(storageObjectDeletion)
        .where(eq(storageObjectDeletion.storageKey, key))
    }
  })

  it('serializes concurrent cleanup claims', async () => {
    const key = `cleanup-${crypto.randomUUID()}`
    let finish!: () => void
    storage.delete.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    await db.insert(storageObjectDeletion).values({ storageKey: key })
    try {
      const first = drainStorageObjectDeletions(1, { storageKey: key })
      await vi.waitFor(() => expect(storage.delete).toHaveBeenCalledOnce())
      expect(await drainStorageObjectDeletions(1, { storageKey: key })).toBe(0)
      finish()
      expect(await first).toBe(1)
    } finally {
      await db
        .delete(storageObjectDeletion)
        .where(eq(storageObjectDeletion.storageKey, key))
    }
  })

  it('preserves a committed upload when its completion response was lost', async () => {
    await withTestSite(async (ctx) => {
      const key = `${ctx.org.id}/committed.png`
      await db.insert(asset).values({
        organizationId: ctx.org.id,
        storageKey: key,
        originalFilename: 'committed.png',
        mimeType: 'image/png',
        size: 1,
      })
      await db.insert(storageObjectDeletion).values({ storageKey: key })
      expect(await drainStorageObjectDeletions(1, { storageKey: key })).toBe(0)
      expect(storage.delete).not.toHaveBeenCalled()
      expect(
        await db
          .select()
          .from(storageObjectDeletion)
          .where(eq(storageObjectDeletion.storageKey, key)),
      ).toHaveLength(0)
    })
  })

  it('rejects misleading raster bytes before storing anything', async () => {
    await expect(
      uploadAsset({
        organizationId: 'org',
        actorId: 'actor',
        file: {
          buffer: await png(),
          filename: 'wrong.jpg',
          mimeType: 'image/jpeg',
        },
      }),
    ).rejects.toThrow(/valid image/)
    expect(storage.put).not.toHaveBeenCalled()
  })

  it('queues old branding objects durably when images are replaced or reset', async () => {
    await withTestSite(async (ctx) => {
      const previous = await getBrandingRow()
      const keys: string[] = []
      storage.delete.mockRejectedValue(new Error('storage offline'))
      try {
        await setBrandingImage(
          'logo',
          { buffer: await png(), mimeType: 'image/png' },
          ctx.actor.id,
        )
        keys.push(storage.put.mock.calls.at(-1)![0] as string)
        await setBrandingImage(
          'logo',
          { buffer: await png(), mimeType: 'image/png' },
          ctx.actor.id,
        )
        keys.push(storage.put.mock.calls.at(-1)![0] as string)
        expect((await getBrandingRow())?.logoKey).toBe(keys[1])
        expect(
          await db
            .select()
            .from(storageObjectDeletion)
            .where(eq(storageObjectDeletion.storageKey, keys[0])),
        ).toHaveLength(1)
        await resetBranding(ctx.actor.id)
        expect((await getBrandingRow())?.logoKey).toBeNull()
        expect(
          await db
            .select()
            .from(storageObjectDeletion)
            .where(eq(storageObjectDeletion.storageKey, keys[1])),
        ).toHaveLength(1)
      } finally {
        if (previous)
          await db
            .insert(branding)
            .values(previous)
            .onConflictDoUpdate({ target: branding.id, set: previous })
        else await db.delete(branding).where(eq(branding.id, 'default'))
        for (const key of [
          ...keys,
          previous?.logoKey,
          previous?.faviconKey,
        ].filter((item): item is string => Boolean(item)))
          await db
            .delete(storageObjectDeletion)
            .where(eq(storageObjectDeletion.storageKey, key))
      }
    })
  })

  it('compensates failed branding writes and persists cleanup during storage outages', async () => {
    storage.delete.mockRejectedValue(new Error('storage offline'))
    await expect(
      setBrandingImage(
        'logo',
        { buffer: await png(), mimeType: 'image/png' },
        'missing-actor',
      ),
    ).rejects.toThrow()
    const key = storage.put.mock.calls[0][0] as string
    try {
      const [pending] = await db
        .select()
        .from(storageObjectDeletion)
        .where(eq(storageObjectDeletion.storageKey, key))
      expect(pending.attempts).toBe(1)
      expect(pending.lastError).toContain('storage offline')
      expect(pending.nextAttemptAt).not.toBeNull()
    } finally {
      await db
        .delete(storageObjectDeletion)
        .where(eq(storageObjectDeletion.storageKey, key))
    }
  })
})
