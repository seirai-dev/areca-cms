import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import { env } from '#/env'
import { createTestCollection, withTestSite } from '#/server/content/test-utils'
import { GET } from '#/routes/api/assets/file/$prefix/$filename'

import {
  AssetValidationError,
  AssetInUseError,
  assetUrl,
  deleteAsset,
  listAssets,
  resolveAssetValue,
  storageKeyFromRequest,
  uploadAsset,
} from './index.ts'

describe('storageKeyFromRequest', () => {
  it('reads the full two-segment key from the request pathname', () => {
    const key =
      '0a3d59c0-78d9-41be-a114-425fdc9c851c/b0b6e32c-74f3-4641-a2d2-36de7ca73366.png'
    const request = new Request(`http://localhost/api/assets/file/${key}`)
    expect(storageKeyFromRequest(request)).toBe(key)
  })
})

describe('asset validation', () => {
  it('rejects SVG before storage or database access', async () => {
    await expect(
      uploadAsset({
        organizationId: 'org',
        file: {
          buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          filename: 'unsafe.svg',
          mimeType: 'image/svg+xml',
        },
        actorId: 'user',
      }),
    ).rejects.toBeInstanceOf(AssetValidationError)
  })
})

describe.skipIf(!process.env.DATABASE_URL || !process.env.S3_ENDPOINT)(
  'assets',
  () => {
    it('uploads a png, resolves it, lists it, and deletes it', async () =>
      withTestSite(async (ctx) => {
        const org = ctx.org
        const member = { userId: ctx.actor.id }
        const orgSite = ctx.site
        const orgCollection = await createTestCollection(ctx.site.id)

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
          organizationId: org.id,
          file: {
            buffer,
            filename: 'red-rect.png',
            mimeType: 'image/png',
          },
          actorId: member.userId,
          altText: 'A red rectangle',
        })

        try {
          expect(uploaded.width).toBe(12)
          expect(uploaded.height).toBe(8)
          expect(uploaded.storageKey).toMatch(
            new RegExp(`^${org.id}/[0-9a-f-]{36}\\.png$`),
          )
          expect(uploaded.mimeType).toBe('image/png')

          const resolved = await resolveAssetValue(uploaded.id, org.id)
          expect(resolved).toEqual({
            url: `${env.APP_URL}/api/assets/file/${uploaded.storageKey}`,
            width: 12,
            height: 8,
            alt: 'A red rectangle',
            mimeType: 'image/png',
          })
          expect(assetUrl(uploaded)).toBe(resolved!.url)

          const listed = await listAssets(org.id, {
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
          expect(fileRes.headers.get('Access-Control-Allow-Origin')).toBe('*')
          expect(fileRes.headers.get('Cross-Origin-Resource-Policy')).toBe(
            'cross-origin',
          )
          expect(fileRes.headers.get('X-Content-Type-Options')).toBe('nosniff')
          const served = Buffer.from(await fileRes.arrayBuffer())
          expect(served.equals(buffer)).toBe(true)

          const [orgId] = uploaded.storageKey.split('/')
          const fileResFromUrl = await GET({
            request: new Request(
              `http://localhost/api/assets/file/${uploaded.storageKey}`,
            ),
            params: { _splat: orgId },
          })
          expect(fileResFromUrl.status).toBe(200)
          expect(fileResFromUrl.headers.get('Content-Type')).toMatch(
            /image\/png/,
          )
          const servedFromUrl = Buffer.from(await fileResFromUrl.arrayBuffer())
          expect(servedFromUrl.equals(buffer)).toBe(true)

          const [throwaway] = await db
            .insert(entry)
            .values({
              siteId: orgSite.id,
              collectionId: orgCollection.id,
              slug: `asset-test-${crypto.randomUUID()}`,
              status: 'draft',
              draftData: { heroImage: uploaded.id },
            })
            .returning()
          expect(throwaway).toBeDefined()

          await expect(deleteAsset(uploaded.id, org.id)).rejects.toBeInstanceOf(
            AssetInUseError,
          )

          await db.delete(entry).where(eq(entry.id, throwaway.id))

          await deleteAsset(uploaded.id, org.id)
          expect(await resolveAssetValue(uploaded.id, org.id)).toBeNull()

          const missing = await GET({
            request: new Request(
              `http://localhost/api/assets/file/${uploaded.storageKey}`,
            ),
            params: { _splat: uploaded.storageKey },
          })
          expect(missing.status).toBe(404)
        } catch (err) {
          try {
            await deleteAsset(uploaded.id, org.id)
          } catch {
            // already deleted or still referenced
          }
          throw err
        }
      }))
  },
)
