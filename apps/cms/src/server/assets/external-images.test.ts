import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { asset } from '#/db/schema'
import type { Field } from '#/lib/types'
import { withTestSite } from '#/server/content/test-utils'

import {
  hasExternalImages,
  importExternalImages,
  resetExternalImageFailures,
} from './external-images'
import { RemoteFetchError } from './remote'

const hasDb = Boolean(process.env.DATABASE_URL)

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'body', label: 'Body', type: 'richtext' },
]

function image(src: string) {
  return { type: 'image', attrs: { src, alt: 'x' } }
}
function doc(...content: unknown[]) {
  return { type: 'doc', content }
}

afterEach(() => resetExternalImageFailures())

describe('hasExternalImages', () => {
  it('only counts http(s) images outside the asset library', () => {
    expect(
      hasExternalImages(fields, {
        body: doc(
          image('/api/assets/file/org/a.png'),
          image('https://cms.test/api/assets/file/org/b.png'),
        ),
      }),
    ).toBe(false)
    expect(
      hasExternalImages(fields, {
        title: 'https://images.test/a.png',
        body: doc({
          type: 'paragraph',
          content: [image('https://images.test/a.png')],
        }),
      }),
    ).toBe(true)
  })
})

describe.skipIf(!hasDb)('importExternalImages', () => {
  function fakeUpload(organizationId: string) {
    return vi.fn(async (input: { url: string; sourceUrl?: string }) => {
      const name = crypto.randomUUID()
      const [row] = await db
        .insert(asset)
        .values({
          organizationId,
          storageKey: `${organizationId}/${name}.png`,
          originalFilename: 'photo.png',
          mimeType: 'image/png',
          size: 4,
          sourceUrl: input.sourceUrl,
        })
        .returning()
      return row
    })
  }

  it('copies external images once per source URL and rewrites every use', async () => {
    await withTestSite(async (ctx) => {
      const upload = fakeUpload(ctx.org.id)
      const original = {
        title: 'T',
        body: doc(
          image('https://images.test/a.png'),
          { type: 'paragraph', content: [image('https://images.test/a.png')] },
          image('/api/assets/file/kept.png'),
        ),
      }
      const snapshot = JSON.stringify(original)
      const first = await importExternalImages(
        {
          organizationId: ctx.org.id,
          originSiteId: ctx.site.id,
          actorId: null,
          fields,
          data: original,
        },
        { upload },
      )
      expect(upload).toHaveBeenCalledTimes(1)
      expect(first.imported).toBe(2)
      expect(first.warnings).toEqual([])
      expect(JSON.stringify(original)).toBe(snapshot)
      const [row] = await db
        .select()
        .from(asset)
        .where(eq(asset.sourceUrl, 'https://images.test/a.png'))
      const body = JSON.stringify(first.data.body)
      expect(body).toContain(`"/api/assets/file/${row.storageKey}"`)
      expect(body).toContain('"/api/assets/file/kept.png"')
      expect(body).not.toContain('images.test')

      // A later save of the same URL reuses the library copy.
      const second = await importExternalImages(
        { organizationId: ctx.org.id, actorId: null, fields, data: original },
        { upload },
      )
      expect(upload).toHaveBeenCalledTimes(1)
      expect(second.data).toEqual(first.data)
    })
  })

  it('keeps the external URL, warns, and does not retry right away', async () => {
    await withTestSite(async (ctx) => {
      const upload = vi.fn(async () => {
        throw new RemoteFetchError('The download timed out')
      })
      const data = { body: doc(image('https://images.test/missing.png')) }
      const input = {
        organizationId: ctx.org.id,
        actorId: null,
        fields,
        data,
      }
      const result = await importExternalImages(input, { upload })
      expect(result.imported).toBe(0)
      expect(result.data).toBe(data)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('https://images.test/missing.png')
      expect(result.warnings[0]).toContain('The download timed out')

      const again = await importExternalImages(input, { upload })
      expect(upload).toHaveBeenCalledTimes(1)
      expect(again.warnings).toEqual(result.warnings)
    })
  })
})
