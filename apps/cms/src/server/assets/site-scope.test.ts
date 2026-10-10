import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { registerAssetTools } from '#/server/mcp/tools/assets'
import { registerEntryTools } from '#/server/mcp/tools/entries'
import type { McpActor } from '#/server/mcp/keys'
import type { ToolRegistry, ToolSpec } from '#/server/mcp/tool-kit'
import { db } from '#/db'
import { asset, entry, publication, site } from '#/db/schema'
import {
  createTestSite,
  createTestCollection,
  cleanupTestSite,
} from '#/server/content/test-utils'
import { siteAssets } from './site-scope'
import { listAssets } from './index'

// Own fixtures; never touches a seeded client's shared library.
describe.skipIf(!process.env.DATABASE_URL)('site AI media boundary', () => {
  it('allows referenced media and own AI uploads, hides another site uploads and arbitrary text IDs', async () => {
    const ctx = await createTestSite()
    try {
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
      const rows = await db
        .insert(asset)
        .values([
          {
            organizationId: ctx.org.id,
            storageKey: `${ctx.org.id}/shared.png`,
            originalFilename: 'Shared.png',
            mimeType: 'image/png',
            size: 1,
          },
          {
            organizationId: ctx.org.id,
            originSiteId: ctx.site.id,
            storageKey: `${ctx.org.id}/own.png`,
            originalFilename: 'Own.png',
            mimeType: 'image/png',
            size: 1,
          },
          {
            organizationId: ctx.org.id,
            originSiteId: sibling.id,
            storageKey: `${ctx.org.id}/other.png`,
            originalFilename: 'Other.png',
            mimeType: 'image/png',
            size: 1,
          },
        ])
        .returning()
      await db.insert(entry).values({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: 'page',
        draftData: { photo: rows[0].id, notes: rows[2].id },
      })
      expect(
        new Set(
          (await siteAssets(ctx.org.id, ctx.site.id)).map((row) => row.id),
        ),
      ).toEqual(new Set([rows[0].id, rows[1].id]))
      const actor: McpActor = {
        keyId: 'test',
        keyName: 'test',
        credential: 'key',
        userId: ctx.actor.id,
        userName: ctx.actor.name,
        siteId: ctx.site.id,
        siteSlug: ctx.site.slug,
        siteName: ctx.site.name,
        organizationId: ctx.org.id,
        role: 'owner',
        allowGoLive: false,
      }
      const tools = new Map<string, (input: unknown) => Promise<unknown>>()
      const registry = {
        add<T extends z.ZodObject>(spec: ToolSpec<T>) {
          tools.set(spec.name, (input) =>
            spec.run(spec.inputSchema.parse(input), actor),
          )
        },
      } as ToolRegistry
      registerAssetTools(registry)
      registerEntryTools(registry)
      const run = (name: string, input: unknown) => tools.get(name)!(input)
      for (const name of ['get_asset', 'update_asset_alt', 'delete_asset']) {
        await expect(
          run(name, { id: rows[2].id, altText: 'Forbidden' }),
        ).rejects.toThrow('available to this site')
      }
      await expect(
        run('create_entry', {
          collection: col.key,
          fields: { body: `![Other](/api/assets/file/${rows[2].storageKey})` },
        }),
      ).rejects.toThrow('not available to this site')
      const listed = (await run('list_assets', {})) as { assetId: string }[]
      expect(new Set(listed.map((row) => row.assetId))).toEqual(
        new Set([rows[0].id, rows[1].id]),
      )
      await expect(
        run('create_entry', {
          collection: col.key,
          fields: { photo: rows[2].id },
        }),
      ).rejects.toThrow('not available to this site')
      await expect(
        run('create_entry', {
          collection: col.key,
          fields: {},
          seo: { ogImage: rows[2].id },
        }),
      ).rejects.toThrow('not available to this site')
      await db
        .update(entry)
        .set({ draftData: {} })
        .where(eq(entry.collectionId, col.id))
      expect(
        (await siteAssets(ctx.org.id, ctx.site.id)).map((row) => row.id),
      ).toEqual([rows[1].id])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('grants retained resolved publication media but never plaintext IDs or JSON-LD strings', async () => {
    const ctx = await createTestSite()
    try {
      const rows = await db
        .insert(asset)
        .values(
          ['image', 'body', 'seo', 'foreign'].map((name) => ({
            organizationId: ctx.org.id,
            storageKey: `${ctx.org.id}/${name}.png`,
            originalFilename: `${name}.png`,
            mimeType: 'image/png',
            size: 1,
          })),
        )
        .returning()
      const media = (index: number) => ({
        url: `https://cms.test/api/assets/file/${rows[index].storageKey}`,
        mimeType: 'image/png',
        alt: '',
        width: null,
        height: null,
      })
      const publicationId = crypto.randomUUID()
      await db.insert(publication).values({
        id: publicationId,
        siteId: ctx.site.id,
        status: 'superseded',
        publishingMode: 'demo',
        snapshotHash: 'media-scope',
        snapshot: {
          publicationId,
          siteKey: ctx.site.slug,
          createdAt: new Date().toISOString(),
          hash: 'media-scope',
          collections: {
            removedCollection: [
              {
                id: crypto.randomUUID(),
                slug: 'old',
                publishedAt: null,
                data: {
                  photo: media(0),
                  body: {
                    json: {
                      type: 'doc',
                      content: [
                        { type: 'image', attrs: { src: media(1).url } },
                      ],
                    },
                    markdown: '',
                    html: '',
                  },
                  notes: rows[3].id,
                  otherNotes: media(3).url,
                },
                seo: {
                  openGraph: { image: media(2) },
                  twitter: { image: null },
                  jsonLd: [{ image: media(3).url, text: rows[3].id }],
                } as never,
              },
            ],
          },
        },
      })
      expect(
        new Set(
          (await siteAssets(ctx.org.id, ctx.site.id)).map((row) => row.id),
        ),
      ).toEqual(new Set(rows.slice(0, 3).map((row) => row.id)))
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('filters PDFs before pagination and reaches a third image page', async () => {
    const ctx = await createTestSite()
    try {
      await db.insert(asset).values(
        Array.from({ length: 135 }, (_, i) => ({
          organizationId: ctx.org.id,
          storageKey: `${ctx.org.id}/${i}.bin`,
          originalFilename: `File ${i}`,
          mimeType: i < 50 ? 'application/pdf' : 'image/png',
          size: 1,
        })),
      )
      const pages = await Promise.all(
        [0, 40, 80].map((offset) =>
          listAssets(ctx.org.id, { limit: 41, offset, imagesOnly: true }),
        ),
      )
      expect(pages.map((page) => page.length)).toEqual([41, 41, 5])
      expect(pages.flat().every((row) => row.mimeType === 'image/png')).toBe(
        true,
      )
      expect(
        new Set(pages.flatMap((page) => page.slice(0, 40)).map((row) => row.id))
          .size,
      ).toBe(85)
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
