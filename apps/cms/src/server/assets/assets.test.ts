import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  collection,
  entry,
  membership,
  organization,
  site,
} from '#/db/schema'
import { env } from '#/env'
import { GET } from '#/routes/api/assets/file/$'

import {
  AssetInUseError,
  assetUrl,
  deleteAsset,
  listAssets,
  resolveAssetValue,
  uploadAsset,
} from './index.ts'

describe.skipIf(!process.env.DATABASE_URL || !process.env.S3_ENDPOINT)(
  'assets',
  () => {
    it('uploads a png, resolves it, lists it, and deletes it', async () => {
      const [org] = await db
        .select()
        .from(organization)
        .where(eq(organization.slug, 'acme'))
        .limit(1)
      expect(org).toBeDefined()

      const [member] = await db
        .select()
        .from(membership)
        .where(eq(membership.organizationId, org!.id))
        .limit(1)
      expect(member).toBeDefined()

      const [orgSite] = await db
        .select()
        .from(site)
        .where(eq(site.organizationId, org!.id))
        .limit(1)
      expect(orgSite).toBeDefined()

      const [orgCollection] = await db
        .select()
        .from(collection)
        .where(eq(collection.siteId, orgSite!.id))
        .limit(1)
      expect(orgCollection).toBeDefined()

      const buffer = await sharp({
        create: {
          width: 12,
          height: 8,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer()

      const uploaded = await uploadAsset({
        organizationId: org!.id,
        file: {
          buffer,
          filename: 'red-rect.png',
          mimeType: 'image/png',
        },
        actorId: member!.userId,
        altText: 'A red rectangle',
      })

      try {
        expect(uploaded.width).toBe(12)
        expect(uploaded.height).toBe(8)
        expect(uploaded.storageKey).toMatch(
          new RegExp(`^${org!.id}/[0-9a-f-]{36}\\.png$`),
        )
        expect(uploaded.mimeType).toBe('image/png')

        const resolved = await resolveAssetValue(uploaded.id)
        expect(resolved).toEqual({
          url: `${env.APP_URL}/api/assets/file/${uploaded.storageKey}`,
          width: 12,
          height: 8,
          alt: 'A red rectangle',
          mimeType: 'image/png',
        })
        expect(assetUrl(uploaded)).toBe(resolved!.url)

        const listed = await listAssets(org!.id, {
          search: 'red-rect',
          limit: 20,
          offset: 0,
        })
        expect(listed.some((row) => row.id === uploaded.id)).toBe(true)

        const fileRes = await GET({
          request: new Request(
            `http://localhost/api/assets/file/${uploaded.storageKey}`,
          ),
          params: { _splat: uploaded.storageKey },
        })
        expect(fileRes.status).toBe(200)
        expect(fileRes.headers.get('Content-Type')).toMatch(/image\/png/)
        expect(fileRes.headers.get('Cache-Control')).toBe(
          'public, max-age=31536000, immutable',
        )
        const served = Buffer.from(await fileRes.arrayBuffer())
        expect(served.equals(buffer)).toBe(true)

        const [throwaway] = await db
          .insert(entry)
          .values({
            siteId: orgSite!.id,
            collectionId: orgCollection!.id,
            slug: `asset-test-${crypto.randomUUID()}`,
            status: 'draft',
            draftData: { heroImage: uploaded.id },
          })
          .returning()
        expect(throwaway).toBeDefined()

        await expect(deleteAsset(uploaded.id)).rejects.toBeInstanceOf(
          AssetInUseError,
        )

        await db.delete(entry).where(eq(entry.id, throwaway!.id))

        await deleteAsset(uploaded.id)
        expect(await resolveAssetValue(uploaded.id)).toBeNull()

        const missing = await GET({
          request: new Request(
            `http://localhost/api/assets/file/${uploaded.storageKey}`,
          ),
          params: { _splat: uploaded.storageKey },
        })
        expect(missing.status).toBe(404)
      } catch (err) {
        try {
          await deleteAsset(uploaded.id)
        } catch {
          // already deleted or still referenced
        }
        throw err
      }
    })
  },
)
