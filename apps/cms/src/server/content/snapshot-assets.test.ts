import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { asset, entry, entryRevision } from '#/db/schema'
import { assetUsage, loadAssetLookup, resolveAssetValue } from '#/server/assets'
import {
  richTextAssetsAuthorized,
  richTextAssetsAuthorizedFrom,
} from '#/server/assets/richtext-ownership'

import { buildSnapshot } from './snapshot.ts'
import {
  createTestCollection,
  createTestSite,
  cleanupTestSite,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

function image(src: string) {
  return { type: 'image', attrs: { src } }
}
function doc(...content: unknown[]) {
  return { type: 'doc', content }
}

async function makeAsset(organizationId: string, name: string) {
  const [row] = await db
    .insert(asset)
    .values({
      organizationId,
      storageKey: `${organizationId}/${name}.png`,
      originalFilename: `${name}.png`,
      mimeType: 'image/png',
      size: 4,
      width: 10,
      height: 20,
      altText: `alt ${name}`,
    })
    .returning()
  return row
}

async function publishRaw(
  siteId: string,
  collectionId: string,
  slug: string,
  data: Record<string, unknown>,
) {
  const [row] = await db
    .insert(entry)
    .values({
      siteId,
      collectionId,
      slug,
      status: 'published',
      draftData: data,
      publishedData: data,
      publishedSlug: slug,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    })
    .returning()
  return row
}

describe.skipIf(!hasDb)('snapshot asset resolution (batched)', () => {
  it('resolves image fields and embedded rich-text assets like the per-asset path', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const [col] = await db.query.collection.findMany({
        where: (c, { eq }) => eq(c.siteId, ctx.site.id),
      })
      const hero = await makeAsset(ctx.org.id, 'hero')
      const inline = await makeAsset(ctx.org.id, 'inline')
      await publishRaw(ctx.site.id, col.id, 'one', {
        title: 'One',
        slug: 'one',
        body: doc(image(`/api/assets/file/${inline.storageKey}`)),
        heroImage: hero.id,
      })

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const [item] = result.snapshot.collections.articles
      expect(item.data.heroImage).toEqual(
        await resolveAssetValue(hero.id, ctx.org.id),
      )
      expect(JSON.stringify(item.data.body)).toContain(
        `/api/assets/file/${inline.storageKey}`,
      )
    })
  })

  it('rejects assets from another organization (image field and rich text)', async () => {
    const other = await createTestSite()
    try {
      await withTestSite(async (ctx) => {
        await createTestCollection(ctx.site.id)
        const [col] = await db.query.collection.findMany({
          where: (c, { eq }) => eq(c.siteId, ctx.site.id),
        })
        const foreign = await makeAsset(other.org.id, 'foreign')
        await publishRaw(ctx.site.id, col.id, 'a', {
          title: 'A',
          slug: 'a',
          body: doc({
            type: 'paragraph',
            content: [{ type: 'text', text: 'hi' }],
          }),
          heroImage: foreign.id,
        })
        await publishRaw(ctx.site.id, col.id, 'b', {
          title: 'B',
          slug: 'b',
          body: doc(image(`/api/assets/file/${foreign.storageKey}`)),
        })
        const result = await buildSnapshot(ctx.site.id)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.errors).toEqual(
          expect.arrayContaining([
            'articles/a: heroImage: asset not found',
            'articles/b: body: embedded asset not found in this organization',
          ]),
        )
      })
    } finally {
      await cleanupTestSite(other)
    }
  })

  it('uses a constant number of queries regardless of the number of assets', async () => {
    const counts: number[] = []
    for (const entries of [2, 12]) {
      await withTestSite(async (ctx) => {
        await createTestCollection(ctx.site.id)
        const [col] = await db.query.collection.findMany({
          where: (c, { eq }) => eq(c.siteId, ctx.site.id),
        })
        for (let i = 0; i < entries; i++) {
          const hero = await makeAsset(ctx.org.id, `hero-${i}`)
          const inline = await makeAsset(ctx.org.id, `inline-${i}`)
          await publishRaw(ctx.site.id, col.id, `e-${i}`, {
            title: `E ${i}`,
            slug: `e-${i}`,
            body: doc(image(`/api/assets/file/${inline.storageKey}`)),
            heroImage: hero.id,
          })
        }
        let selects = 0
        const counting = {
          select: ((...args: unknown[]) => {
            selects++
            return (db.select as (...a: unknown[]) => unknown)(...args)
          }) as typeof db.select,
        }
        const result = await buildSnapshot(ctx.site.id, counting)
        expect(result.ok).toBe(true)
        counts.push(selects)
      })
    }
    expect(counts[1]).toBe(counts[0])
  })

  it('richTextAssetsAuthorizedFrom agrees with the per-asset check', async () => {
    await withTestSite(async (ctx) => {
      const mine = await makeAsset(ctx.org.id, 'mine')
      const lookup = await loadAssetLookup(ctx.org.id, {
        ids: [],
        storageKeys: [mine.storageKey, `${ctx.org.id}/missing.png`],
      })
      const samples: unknown[] = [
        null,
        'text',
        doc(),
        doc(image(`/api/assets/file/${mine.storageKey}`)),
        doc(image(`https://cdn.example/api/assets/file/${mine.storageKey}`)),
        doc(image(`/api/assets/file/${encodeURIComponent(mine.storageKey)}`)),
        doc(image(`/api/assets/file/${ctx.org.id}/missing.png`)),
        doc(image('https://elsewhere.example/a.png')),
        doc(image('http://[bad')),
        doc({
          type: 'paragraph',
          content: [image(`/api/assets/file/${mine.storageKey}`)],
        }),
        doc({
          type: 'paragraph',
          content: [image(`/api/assets/file/${ctx.org.id}/missing.png`)],
        }),
        [
          doc(image(`/api/assets/file/${mine.storageKey}`)),
          doc(image('http://[bad')),
        ],
      ]
      for (const sample of samples) {
        expect(richTextAssetsAuthorizedFrom(sample, lookup)).toBe(
          await richTextAssetsAuthorized(sample, ctx.org.id),
        )
      }
    })
  })
})

describe.skipIf(!hasDb)('asset usage pre-filter', () => {
  it('counts exact, URL and percent-encoded references and ignores unrelated rows', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const [col] = await db.query.collection.findMany({
        where: (c, { eq }) => eq(c.siteId, ctx.site.id),
      })
      const used = await makeAsset(ctx.org.id, 'used')
      const unused = await makeAsset(ctx.org.id, 'unused')
      const byId = await publishRaw(ctx.site.id, col.id, 'by-id', {
        title: 'x',
        slug: 'by-id',
        heroImage: used.id,
      })
      const byUrl = await publishRaw(ctx.site.id, col.id, 'by-url', {
        title: 'x',
        slug: 'by-url',
        body: doc(
          image(`https://old.example/api/assets/file/${used.storageKey}`),
        ),
      })
      await publishRaw(ctx.site.id, col.id, 'plain', {
        title: 'unrelated 100%',
        slug: 'plain',
      })
      await db.insert(entryRevision).values({
        entryId: byId.id,
        data: {
          body: doc(
            image(`/api/assets/file/${encodeURIComponent(used.storageKey)}`),
          ),
        },
      })
      void byUrl
      // 2 entries + 1 percent-encoded revision reference the asset.
      expect(await assetUsage(used.id, ctx.org.id)).toBe(3)
      expect(await assetUsage(unused.id, ctx.org.id)).toBe(0)
    })
  })
})
