import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection, entry, site } from '#/db/schema'
import type { SiteManifest } from '#/lib/types'

import { getCollection, syncManifest, upsertCollection } from './collections.ts'
import { withTestSite } from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const manifest: SiteManifest = {
  languages: { main: 'en', all: ['en', 'nl'] },
  collections: {
    posts: {
      route: '/posts/$slug',
      routes: { nl: '/berichten/$slug' },
      requiredLanguages: ['nl'],
      fields: [{ key: 'title', label: 'Title', type: 'text', required: true }],
    },
  },
  globals: {
    company: {
      label: 'Company',
      seo: true,
      previewPath: '/',
      fields: [{ key: 'name', label: 'Name', type: 'text' }],
    },
  },
}

/** Row versions of everything a push writes: any write changes one. */
async function rowVersions(siteId: string) {
  const sites = await db
    .select({ v: sql<string>`${site}.xmin::text` })
    .from(site)
    .where(eq(site.id, siteId))
  const collections = await db
    .select({ key: collection.key, v: sql<string>`${collection}.xmin::text` })
    .from(collection)
    .where(eq(collection.siteId, siteId))
    .orderBy(collection.key)
  const entries = await db
    .select({ id: entry.id, v: sql<string>`${entry}.xmin::text` })
    .from(entry)
    .where(eq(entry.siteId, siteId))
    .orderBy(entry.id)
  return { sites, collections, entries }
}

describe.skipIf(!hasDb)('manifest push without changes', () => {
  it('writes nothing when the manifest is already applied', async () => {
    await withTestSite(async (ctx) => {
      await syncManifest(ctx.site.id, manifest)
      const before = await rowVersions(ctx.site.id)
      await syncManifest(ctx.site.id, structuredClone(manifest))
      expect(await rowVersions(ctx.site.id)).toEqual(before)
    })
  })

  it('still restores a collection edited by hand', async () => {
    await withTestSite(async (ctx) => {
      await syncManifest(ctx.site.id, manifest)
      await upsertCollection(ctx.site.id, {
        key: 'posts',
        label: 'Edited',
        routePattern: '/edited/$slug',
        fields: manifest.collections.posts.fields,
        enabled: false,
      })
      await syncManifest(ctx.site.id, manifest)
      const row = await getCollection(ctx.site.id, 'posts')
      expect(row).toMatchObject({
        label: 'posts',
        routePattern: '/posts/$slug',
        enabled: true,
      })
    })
  })

  it('still disables a collection the manifest does not declare', async () => {
    await withTestSite(async (ctx) => {
      await syncManifest(ctx.site.id, manifest)
      await upsertCollection(ctx.site.id, {
        key: 'extra',
        label: 'Extra',
        routePattern: '/extra/$slug',
        fields: manifest.collections.posts.fields,
      })
      await syncManifest(ctx.site.id, manifest)
      expect((await getCollection(ctx.site.id, 'extra'))?.enabled).toBe(false)
    })
  })

  it('still restores languages changed since the push', async () => {
    await withTestSite(async (ctx) => {
      await syncManifest(ctx.site.id, manifest)
      await db
        .update(site)
        .set({ languages: { main: 'en', all: ['en'] } })
        .where(eq(site.id, ctx.site.id))
      await syncManifest(ctx.site.id, manifest)
      const row = (
        await db
          .select({ languages: site.languages })
          .from(site)
          .where(eq(site.id, ctx.site.id))
      ).at(0)
      expect(row?.languages).toEqual({ main: 'en', all: ['en', 'nl'] })
    })
  })

  it('still recreates a missing section entry', async () => {
    await withTestSite(async (ctx) => {
      await syncManifest(ctx.site.id, manifest)
      await db.delete(entry).where(eq(entry.siteId, ctx.site.id))
      await syncManifest(ctx.site.id, manifest)
      const rows = await db
        .select({ slug: entry.slug })
        .from(entry)
        .where(eq(entry.siteId, ctx.site.id))
      expect(rows).toEqual([{ slug: '$global' }])
    })
  })
})
