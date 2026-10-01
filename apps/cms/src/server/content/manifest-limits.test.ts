import { describe, expect, it } from 'vitest'

import {
  MANIFEST_MAX_BYTES,
  MANIFEST_MAX_COLLECTIONS,
  MAX_FIELDS_PER_COLLECTION,
} from '#/lib/content-limits'
import { postSitesManifest } from '#/routes/api/sites/manifest'

import { withTestSite } from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('manifest POST limits', () => {
  it('rejects oversize, too many, and unknown properties; never caches', async () => {
    await withTestSite(async (fixtures) => {
      const post = (body: string, headers: Record<string, string> = {}) =>
        postSitesManifest(
          new Request('http://cms.test/api/sites/manifest', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${fixtures.schemaToken}`,
              'Content-Type': 'application/json',
              ...headers,
            },
            body,
          }),
        )
      const col = (fieldCount = 1) => ({
        route: '/x',
        fields: Array.from({ length: fieldCount }, (_, i) => ({
          key: `f${i}`,
          label: 'F',
          type: 'text',
        })),
      })

      const oversize = await post(
        JSON.stringify({
          collections: {
            a: { ...col(), label: 'x'.repeat(MANIFEST_MAX_BYTES) },
          },
        }),
      )
      expect(oversize.status).toBe(413)
      expect(oversize.headers.get('cache-control')).toBe('no-store')

      // Lying Content-Length is still caught by the bounded reader.
      const stream = new Request('http://cms.test/api/sites/manifest', {
        method: 'POST',
        headers: { Authorization: `Bearer ${fixtures.schemaToken}` },
        body: 'x'.repeat(MANIFEST_MAX_BYTES + 1),
      })
      expect((await postSitesManifest(stream)).status).toBe(413)

      const many = Object.fromEntries(
        Array.from({ length: MANIFEST_MAX_COLLECTIONS + 1 }, (_, i) => [
          `c${i}`,
          col(),
        ]),
      )
      expect((await post(JSON.stringify({ collections: many }))).status).toBe(
        400,
      )

      const wide = await post(
        JSON.stringify({
          collections: { a: col(MAX_FIELDS_PER_COLLECTION + 1) },
        }),
      )
      expect(wide.status).toBe(400)

      expect(
        (await post(JSON.stringify({ collections: {}, extra: 1 }))).status,
      ).toBe(400)
      expect(
        (
          await post(
            JSON.stringify({ collections: { a: { ...col(), bogus: true } } }),
          )
        ).status,
      ).toBe(400)

      const ok = await post(JSON.stringify({ collections: { a: col() } }))
      expect(ok.status).toBe(200)
      expect(ok.headers.get('cache-control')).toBe('no-store')
    })
  })
})
