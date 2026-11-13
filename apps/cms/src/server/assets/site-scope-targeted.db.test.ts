import { and, eq, inArray } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { db } from '#/db'
import {
  asset,
  collection,
  entry,
  entryRevision,
  publication,
  site,
} from '#/db/schema'
import { SEO_KEY } from '#/lib/seo'
import type { EntryData, Field, SnapshotGlobal } from '#/lib/types'
import { withTestSite, createTestCollection } from '#/server/content/test-utils'
import type { McpActor } from '#/server/mcp/keys'
import { assetLookupFor } from '#/server/mcp/tools/entries'
import { loadAssetLookup } from './index'
import type { Asset } from './index'
import { richTextAssetRefs } from './richtext-ownership'
import { siteAssets, siteAssetsAmong } from './site-scope'

/** The previous implementation, kept as the oracle: it read the whole site into memory. */
async function legacySiteAssets(
  organizationId: string,
  siteId: string,
): Promise<Asset[]> {
  const [collections, entries, uploads, publications] = await Promise.all([
    db.select().from(collection).where(eq(collection.siteId, siteId)),
    db.select().from(entry).where(eq(entry.siteId, siteId)),
    db
      .select()
      .from(asset)
      .where(
        and(
          eq(asset.organizationId, organizationId),
          eq(asset.originSiteId, siteId),
        ),
      ),
    db
      .select({ snapshot: publication.snapshot })
      .from(publication)
      .where(eq(publication.siteId, siteId)),
  ])
  const ids = new Set<string>()
  const storageKeys = new Set<string>()
  const fieldsByKey = new Map(collections.map((row) => [row.id, row.fields]))
  const collect = (fields: Field[], data: EntryData | null) => {
    if (!data) return
    for (const field of fields) {
      const value = data[field.key]
      if (field.type === 'image' && typeof value === 'string' && value)
        ids.add(value)
      if (field.type === 'richtext') {
        for (const key of richTextAssetRefs(value).storageKeys)
          storageKeys.add(key)
      }
    }
    const seo = data[SEO_KEY] as { ogImage?: unknown } | undefined
    if (typeof seo?.ogImage === 'string' && seo.ogImage) ids.add(seo.ogImage)
  }
  for (const row of entries) {
    const fields = fieldsByKey.get(row.collectionId) ?? []
    collect(fields, row.draftData)
    collect(fields, row.publishedData)
    collect(fields, row.scheduledData)
  }
  if (entries.length) {
    const revisions = await db
      .select()
      .from(entryRevision)
      .where(
        inArray(
          entryRevision.entryId,
          entries.map((row) => row.id),
        ),
      )
    const entryById = new Map(entries.map((row) => [row.id, row]))
    for (const revision of revisions) {
      const owner = entryById.get(revision.entryId)
      if (owner)
        collect(fieldsByKey.get(owner.collectionId) ?? [], revision.data)
    }
  }
  const collectImage = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const image = value as { url?: unknown; mimeType?: unknown }
    if (typeof image.url !== 'string' || typeof image.mimeType !== 'string')
      return
    for (const key of richTextAssetRefs({
      type: 'image',
      attrs: { src: image.url },
    }).storageKeys)
      storageKeys.add(key)
  }
  const collectPublished = (row: {
    data: Record<string, unknown>
    seo?: SnapshotGlobal['seo']
  }) => {
    for (const value of Object.values(row.data)) {
      collectImage(value)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const richText = value as { json?: { type?: unknown } | null }
        if (richText.json?.type === 'doc') {
          for (const key of richTextAssetRefs(richText.json).storageKeys)
            storageKeys.add(key)
        }
      }
    }
    collectImage(row.seo?.openGraph.image)
    collectImage(row.seo?.twitter.image)
  }
  for (const { snapshot } of publications) {
    for (const rows of Object.values(snapshot.collections)) {
      for (const row of rows) collectPublished(row)
    }
    for (const global of Object.values(snapshot.globals ?? {})) {
      collectPublished(global)
    }
  }
  const lookup = await loadAssetLookup(organizationId, {
    ids: [...ids],
    storageKeys: [...storageKeys],
  })
  const visible = new Map<string, Asset>(uploads.map((row) => [row.id, row]))
  for (const row of lookup.byId.values()) visible.set(row.id, row)
  return [...visible.values()].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
  )
}

const doc = (...content: unknown[]) => ({ type: 'doc', content })
const image = (src: string) => ({ type: 'image', attrs: { src } })
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

describe.skipIf(!process.env.DATABASE_URL)(
  'site media scope with targeted queries',
  () => {
    it('answers exactly like the whole-site scan, for the full list and for each asset', async () => {
      await withTestSite(async (ctx) => {
        const [sibling] = await db
          .insert(site)
          .values({
            organizationId: ctx.org.id,
            name: 'Sibling',
            slug: crypto.randomUUID(),
            tokenHash: crypto.randomUUID(),
            productionUrl: 'https://sibling.test',
            previewSecret: crypto.randomUUID(),
          })
          .returning()
        const col = await createTestCollection(ctx.site.id, {
          fields: [
            { key: 'photo', label: 'Photo', type: 'image' },
            { key: 'notes', label: 'Notes', type: 'text' },
            { key: 'body', label: 'Body', type: 'richtext' },
          ],
        })
        const siblingCol = await createTestCollection(sibling.id, {
          fields: [{ key: 'photo', label: 'Photo', type: 'image' }],
        })
        const names = [
          'draft',
          'published',
          'scheduled',
          'og',
          'revision-photo',
          'revision-body',
          'encoded',
          'tabbed',
          'old-release',
          'old-release-body',
          'old-release-og',
          'global',
          'text-only',
          'jsonld',
          'sibling-only',
          'unused',
          'percent',
        ]
        const rows = await db
          .insert(asset)
          .values([
            ...names.map((name) => ({
              organizationId: ctx.org.id,
              storageKey: `${ctx.org.id}/${crypto.randomUUID()}.png`,
              originalFilename: `${name}.png`,
              mimeType: 'image/png',
              size: 1,
            })),
            {
              organizationId: ctx.org.id,
              originSiteId: ctx.site.id,
              storageKey: `${ctx.org.id}/${crypto.randomUUID()}.png`,
              originalFilename: 'own.png',
              mimeType: 'image/png',
              size: 1,
            },
            {
              organizationId: ctx.org.id,
              originSiteId: sibling.id,
              storageKey: `${ctx.org.id}/${crypto.randomUUID()}.png`,
              originalFilename: 'sibling-upload.png',
              mimeType: 'image/png',
              size: 1,
            },
          ])
          .returning()
        const by = (name: string) =>
          rows.find((row) => row.originalFilename === `${name}.png`)!
        const url = (name: string) =>
          `https://cms.test/api/assets/file/${by(name).storageKey}`
        const media = (name: string) => ({
          url: url(name),
          mimeType: 'image/png',
          alt: '',
          width: null,
          height: null,
        })
        const [current] = await db
          .insert(entry)
          .values({
            siteId: ctx.site.id,
            collectionId: col.id,
            slug: 'page',
            draftData: {
              photo: by('draft').id,
              notes: `${by('text-only').id} and 100% of ${url('percent')}`,
              body: doc(paragraph('Save 50% today')),
              [SEO_KEY]: { ogImage: by('og').id },
            },
            publishedData: { photo: by('published').id },
            scheduledData: { photo: by('scheduled').id },
          })
          .returning()
        const tail = by('encoded').storageKey.split('/')[1]
        const encodedTail = tail.replace(/./g, (char) =>
          char === '.' ? '%2E' : char,
        )
        await db.insert(entryRevision).values([
          { entryId: current.id, data: { photo: by('revision-photo').id } },
          {
            entryId: current.id,
            data: { body: doc(image(url('revision-body'))) },
          },
          {
            entryId: current.id,
            data: {
              body: doc(
                image(`/api/assets/file/${ctx.org.id}%2F${encodedTail}`),
              ),
            },
          },
          {
            entryId: current.id,
            data: {
              body: doc(
                image(
                  `https://cms.test/api/assets/file/${by('tabbed').storageKey.replace('.png', '.p\tng')}`,
                ),
              ),
            },
          },
        ])
        await db.insert(entry).values({
          siteId: sibling.id,
          collectionId: siblingCol.id,
          slug: 'sibling',
          draftData: { photo: by('sibling-only').id },
        })
        const publicationId = crypto.randomUUID()
        await db.insert(publication).values({
          id: publicationId,
          siteId: ctx.site.id,
          status: 'superseded',
          publishingMode: 'demo',
          snapshotHash: 'scope',
          snapshot: {
            publicationId,
            siteKey: ctx.site.slug,
            createdAt: new Date().toISOString(),
            hash: 'scope',
            collections: {
              removed: [
                {
                  id: crypto.randomUUID(),
                  slug: 'old',
                  publishedAt: null,
                  data: {
                    photo: media('old-release'),
                    body: {
                      json: doc(image(url('old-release-body'))),
                      markdown: '',
                      html: '',
                    },
                    notes: by('text-only').id,
                  },
                  seo: {
                    openGraph: { image: media('old-release-og') },
                    twitter: { image: null },
                    jsonLd: [{ image: url('jsonld') }],
                  } as never,
                },
              ],
            },
            globals: {
              home: {
                id: crypto.randomUUID(),
                publishedAt: null,
                data: { hero: media('global') },
              },
            },
          },
        })

        const legacy = await legacySiteAssets(ctx.org.id, ctx.site.id)
        const visible = new Set(legacy.map((row) => row.id))
        expect(
          [...visible].sort(),
          'fixture grants what the old scan granted',
        ).toEqual(
          rows
            .filter(
              (row) =>
                ![
                  'text-only.png',
                  'jsonld.png',
                  'sibling-only.png',
                  'unused.png',
                  'percent.png',
                  'sibling-upload.png',
                ].includes(row.originalFilename),
            )
            .map((row) => row.id)
            .sort(),
        )
        expect(
          (await siteAssets(ctx.org.id, ctx.site.id)).map((row) => row.id),
        ).toEqual(legacy.map((row) => row.id))
        for (const row of rows) {
          const byId = await siteAssetsAmong(ctx.org.id, ctx.site.id, {
            ids: [row.id],
            storageKeys: [],
          })
          const byKey = await siteAssetsAmong(ctx.org.id, ctx.site.id, {
            ids: [],
            storageKeys: [row.storageKey],
          })
          expect(
            byId.map((item) => item.id),
            row.originalFilename,
          ).toEqual(visible.has(row.id) ? [row.id] : [])
          expect(
            byKey.map((item) => item.id),
            row.originalFilename,
          ).toEqual(visible.has(row.id) ? [row.id] : [])
        }
        const all = await siteAssetsAmong(ctx.org.id, ctx.site.id, {
          ids: rows.map((row) => row.id),
          storageKeys: [],
        })
        expect(new Set(all.map((row) => row.id))).toEqual(visible)
      })
    })

    it('runs no query for a write without assets', async () => {
      await withTestSite(async (ctx) => {
        const actor = {
          organizationId: ctx.org.id,
          siteId: ctx.site.id,
        } as McpActor
        const select = vi.spyOn(db, 'select')
        const execute = vi.spyOn(db, 'execute')
        try {
          const lookup = await assetLookupFor(
            actor,
            [
              { key: 'title', label: 'Title', type: 'text' },
              { key: 'body', label: 'Body', type: 'richtext' },
              { key: 'photo', label: 'Photo', type: 'image' },
            ],
            { title: 'Hello', body: 'Plain **Markdown**, 100% text.' },
            { title: 'SEO' },
          )
          expect(lookup.byId.size).toBe(0)
          expect(select).not.toHaveBeenCalled()
          expect(execute).not.toHaveBeenCalled()
        } finally {
          select.mockRestore()
          execute.mockRestore()
        }
      })
    })
  },
)
