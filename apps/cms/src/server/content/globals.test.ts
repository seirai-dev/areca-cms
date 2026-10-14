// Assumed API (apps/cms/src/server/content/globals.ts unless noted). Tests are the contract.
//   upsertGlobal(siteId, { key, label, fields, seo?, previewPath?, enabled? }, actorId?)
//     -> collection row with kind 'global', seoEnabled, previewPath, routePattern ''
//        creates the row and its single '$global' entry in one transaction;
//        re-upserting keeps the same collection id and entry id.
//   getGlobal(siteId, key) -> row | null
//   listGlobals(siteId, { enabledOnly? } = {}) -> kind 'global' rows only
//   setGlobalEnabled(siteId, key, enabled, actorId) -> row
//   deleteGlobal(siteId, key, actorId) -> archives entity 'collection' (+ entry, revisions)
//   discardGlobalDraft(siteId, key, actorId) -> entry row (draft reset to ready data,
//     draftVersion + 1, revision note 'discard'; refused when never ready)
//   Existing functions must refuse sections: createEntry, listEntries (by section key),
//   unpublishEntry, archiveEntry, deleteEntry. listCollections returns collections only.
//   syncManifest(siteId, { collections, globals? }) also syncs sections; a push without
//   `globals` disables them (content kept). upsertCollection rejects reference fields
//   that target a section key; upsertGlobal rejects reference fields that target a section.
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  collection,
  deletedContentArchive,
  entry,
  entryRevision,
} from '#/db/schema'
import { SEO_KEY } from '#/lib/seo'

import {
  listCollections,
  syncManifest,
  upsertCollection,
} from './collections.ts'
import {
  archiveEntry,
  createEntry,
  deleteEntry,
  listEntries,
  publishEntry,
  restoreRevision,
  scheduleEntry,
  unpublishEntry,
  updateDraft,
} from './entries.ts'
import {
  deleteGlobal,
  discardGlobalDraft,
  getGlobal,
  listGlobals,
  setGlobalEnabled,
  upsertGlobal,
} from './globals.ts'
import {
  createTestCollection,
  globalFields,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const companyInfo = {
  key: 'companyInfo',
  label: 'Company info',
  fields: globalFields(),
}

const future = () => new Date(Date.now() + 86_400_000).toISOString()

/** The one `$global` entry of a section. */
async function sectionEntry(globalId: string) {
  const [row] = await db
    .select()
    .from(entry)
    .where(eq(entry.collectionId, globalId))
  if (!row) throw new Error('section entry missing')
  return row
}

describe.skipIf(!hasDb)('site content globals (server layer)', () => {
  it('creates the section and its single $global entry in one step', async () => {
    await withTestSite(async (ctx) => {
      const global = await upsertGlobal(
        ctx.site.id,
        { ...companyInfo, seo: false, enabled: true },
        ctx.actor.id,
      )

      expect(global).toMatchObject({
        key: 'companyInfo',
        label: 'Company info',
        kind: 'global',
        routePattern: '',
        seoEnabled: false,
        enabled: true,
      })
      const rows = await db
        .select()
        .from(collection)
        .where(eq(collection.siteId, ctx.site.id))
      expect(rows.map((row) => row.key)).toEqual(['companyInfo'])
      const entries = await db
        .select()
        .from(entry)
        .where(eq(entry.collectionId, global.id))
      expect(entries).toEqual([
        expect.objectContaining({
          siteId: ctx.site.id,
          slug: '$global',
          status: 'draft',
        }),
      ])
    })
  })

  it('stores the SEO opt-in and preview path, and rejects an invalid preview path', async () => {
    await withTestSite(async (ctx) => {
      const home = await upsertGlobal(
        ctx.site.id,
        {
          key: 'homePage',
          label: 'Home page',
          fields: [
            {
              key: 'headline',
              label: 'Headline',
              type: 'text',
              required: true,
            },
          ],
          seo: true,
          previewPath: '/',
        },
        ctx.actor.id,
      )
      expect(home).toMatchObject({ seoEnabled: true, previewPath: '/' })

      for (const previewPath of [
        'about',
        '/about?draft=1',
        '/about#team',
        `/${'a'.repeat(512)}`,
      ]) {
        await expect(
          upsertGlobal(
            ctx.site.id,
            {
              key: 'aboutPage',
              label: 'About',
              fields: globalFields(),
              previewPath,
            },
            ctx.actor.id,
          ),
        ).rejects.toThrow()
      }
    })
  })

  it('keeps the same section and entry when the fields are updated', async () => {
    await withTestSite(async (ctx) => {
      const first = await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)
      const [before] = await db
        .select()
        .from(entry)
        .where(eq(entry.collectionId, first.id))

      const second = await upsertGlobal(
        ctx.site.id,
        {
          key: 'companyInfo',
          label: 'Contact details',
          fields: [
            ...globalFields(),
            { key: 'address', label: 'Address', type: 'textarea' },
          ],
        },
        ctx.actor.id,
      )

      expect(second.id).toBe(first.id)
      expect(second.label).toBe('Contact details')
      const entries = await db
        .select()
        .from(entry)
        .where(eq(entry.collectionId, first.id))
      expect(entries.map((row) => row.id)).toEqual([before?.id])
    })
  })

  it('rejects a section key a collection already uses, and a collection key a section uses', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await expect(
        upsertGlobal(
          ctx.site.id,
          { key: 'articles', label: 'Articles', fields: globalFields() },
          ctx.actor.id,
        ),
      ).rejects.toThrow()

      await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)
      await expect(
        upsertCollection(
          ctx.site.id,
          {
            key: 'companyInfo',
            label: 'Company',
            routePattern: '/company/$slug',
            fields: [{ key: 'title', label: 'Title', type: 'text' }],
          },
          ctx.actor.id,
        ),
      ).rejects.toThrow()

      const rows = await db
        .select()
        .from(collection)
        .where(eq(collection.siteId, ctx.site.id))
      expect(rows.map((row) => row.key).sort()).toEqual([
        'articles',
        'companyInfo',
      ])
      expect(rows.find((row) => row.key === 'companyInfo')?.kind).toBe('global')
    })
  })

  it.each(['globals', 'resolve', 'href', 'preview'])(
    'rejects the reserved section key %s',
    async (key) => {
      await withTestSite(async (ctx) => {
        await expect(
          upsertGlobal(
            ctx.site.id,
            { key, label: 'Reserved', fields: globalFields() },
            ctx.actor.id,
          ),
        ).rejects.toThrow()
      })
    },
  )

  it('deletes a section with its entry and archives the authoring history', async () => {
    await withTestSite(async (ctx) => {
      const global = await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)
      const created = await sectionEntry(global.id)
      await updateDraft(
        created.id,
        { email: 'archive@x.test' },
        ctx.actor.id,
        created.draftVersion,
      )

      await deleteGlobal(ctx.site.id, 'companyInfo', ctx.actor.id)

      expect(
        await db.select().from(collection).where(eq(collection.id, global.id)),
      ).toEqual([])
      expect(
        await db.select().from(entry).where(eq(entry.id, created.id)),
      ).toEqual([])
      const archived = await db
        .select()
        .from(deletedContentArchive)
        .where(
          and(
            eq(deletedContentArchive.organizationId, ctx.org.id),
            eq(deletedContentArchive.entityType, 'collection'),
            eq(deletedContentArchive.entityId, global.id),
          ),
        )
      expect(archived).toHaveLength(1)
      expect(archived[0]?.data).toMatchObject({
        entries: [expect.objectContaining({ id: created.id, slug: '$global' })],
      })
    })
  })

  it('disabling a section hides it from editors but keeps its content; enabling restores it', async () => {
    await withTestSite(async (ctx) => {
      const global = await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)
      const created = await sectionEntry(global.id)
      await updateDraft(
        created.id,
        { email: 'kept@x.test' },
        ctx.actor.id,
        created.draftVersion,
      )

      await setGlobalEnabled(ctx.site.id, 'companyInfo', false, ctx.actor.id)
      expect(
        (await listGlobals(ctx.site.id, { enabledOnly: true })).map(
          (row) => row.key,
        ),
      ).not.toContain('companyInfo')
      expect((await listGlobals(ctx.site.id)).map((row) => row.key)).toContain(
        'companyInfo',
      )
      expect((await sectionEntry(global.id)).draftData).toMatchObject({
        email: 'kept@x.test',
      })

      await setGlobalEnabled(ctx.site.id, 'companyInfo', true, ctx.actor.id)
      expect(
        (await listGlobals(ctx.site.id, { enabledOnly: true })).map(
          (row) => row.key,
        ),
      ).toContain('companyInfo')
    })
  })

  it('keeps sections and collections apart in their list functions', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)

      const collections = await listCollections(ctx.site.id)
      expect(collections.map((row) => row.key)).toEqual(['articles'])
      const enabledCollections = await listCollections(ctx.site.id, {
        enabledOnly: true,
      })
      expect(enabledCollections.map((row) => row.key)).toEqual(['articles'])

      const globals = await listGlobals(ctx.site.id)
      expect(globals.map((row) => row.key)).toEqual(['companyInfo'])
      expect(await getGlobal(ctx.site.id, 'articles')).toBeNull()
    })
  })

  it('refuses collection-entry operations on a section', async () => {
    await withTestSite(async (ctx) => {
      const global = await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)
      const sectionRow = await sectionEntry(global.id)

      await expect(
        createEntry({
          siteId: ctx.site.id,
          collectionKey: 'companyInfo',
          data: { email: 'new@x.test' },
          actorId: ctx.actor.id,
        }),
      ).rejects.toThrow()
      await expect(listEntries(ctx.site.id, 'companyInfo')).rejects.toThrow()

      await updateDraft(
        sectionRow.id,
        { email: 'ready@x.test' },
        ctx.actor.id,
        sectionRow.draftVersion,
      )
      await publishEntry(sectionRow.id, ctx.actor.id)

      await expect(
        unpublishEntry(sectionRow.id, ctx.actor.id),
      ).rejects.toThrow()
      await expect(archiveEntry(sectionRow.id, ctx.actor.id)).rejects.toThrow()
      await expect(deleteEntry(sectionRow.id, ctx.actor.id)).rejects.toThrow()

      const after = await sectionEntry(global.id)
      expect(after).toMatchObject({ status: 'published', slug: '$global' })
      expect(after.publishedData).toMatchObject({ email: 'ready@x.test' })
    })
  })

  it('discards the draft back to the ready data and records a discard revision', async () => {
    await withTestSite(async (ctx) => {
      const global = await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)
      const first = await sectionEntry(global.id)
      await updateDraft(
        first.id,
        { email: 'ready@x.test' },
        ctx.actor.id,
        first.draftVersion,
      )
      await publishEntry(first.id, ctx.actor.id)
      const ready = await sectionEntry(global.id)
      await updateDraft(
        first.id,
        { email: 'changed@x.test' },
        ctx.actor.id,
        ready.draftVersion,
      )

      await discardGlobalDraft(ctx.site.id, 'companyInfo', ctx.actor.id)

      const after = await sectionEntry(global.id)
      expect(after.draftData).toMatchObject({ email: 'ready@x.test' })
      expect(after.draftVersion).toBe(ready.draftVersion + 2)
      expect(after.status).toBe('published')
      expect(after.publishedData).toMatchObject({ email: 'ready@x.test' })
      const discards = await db
        .select()
        .from(entryRevision)
        .where(
          and(
            eq(entryRevision.entryId, first.id),
            eq(entryRevision.note, 'discard'),
          ),
        )
      expect(discards).toHaveLength(1)
      expect(discards[0]?.data).toMatchObject({ email: 'ready@x.test' })
    })
  })

  it('discards to the scheduled data while a change is scheduled', async () => {
    await withTestSite(async (ctx) => {
      const global = await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)
      const row = await sectionEntry(global.id)
      await updateDraft(
        row.id,
        { email: 'v1@x.test' },
        ctx.actor.id,
        row.draftVersion,
      )
      await publishEntry(row.id, ctx.actor.id)
      const v1 = await sectionEntry(global.id)
      await updateDraft(
        row.id,
        { email: 'v2@x.test' },
        ctx.actor.id,
        v1.draftVersion,
      )
      const v2 = await sectionEntry(global.id)
      await scheduleEntry(row.id, future(), 'UTC', ctx.actor.id)
      const scheduled = await sectionEntry(global.id)
      expect(scheduled.status).toBe('scheduled')
      await updateDraft(
        row.id,
        { email: 'v3@x.test' },
        ctx.actor.id,
        v2.draftVersion,
      )

      await discardGlobalDraft(ctx.site.id, 'companyInfo', ctx.actor.id)

      const after = await sectionEntry(global.id)
      expect(after.draftData).toMatchObject({ email: 'v2@x.test' })
      expect(after.status).toBe('scheduled')
    })
  })

  it('refuses to discard a section that was never marked ready', async () => {
    await withTestSite(async (ctx) => {
      const global = await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)
      const row = await sectionEntry(global.id)
      await updateDraft(
        row.id,
        { email: 'draft@x.test' },
        ctx.actor.id,
        row.draftVersion,
      )
      const before = await sectionEntry(global.id)

      await expect(
        discardGlobalDraft(ctx.site.id, 'companyInfo', ctx.actor.id),
      ).rejects.toThrow()

      const after = await sectionEntry(global.id)
      expect(after.draftData).toMatchObject({ email: 'draft@x.test' })
      expect(after.draftVersion).toBe(before.draftVersion)
    })
  })

  it('lets a section reference a collection, but not a section or another section', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)

      const referencing = (target: string) => [
        {
          key: 'featured',
          label: 'Featured',
          type: 'reference' as const,
          collection: target,
        },
      ]

      await expect(
        upsertGlobal(
          ctx.site.id,
          {
            key: 'homePage',
            label: 'Home page',
            fields: referencing('articles'),
          },
          ctx.actor.id,
        ),
      ).resolves.toMatchObject({ key: 'homePage' })

      await expect(
        upsertGlobal(
          ctx.site.id,
          {
            key: 'aboutPage',
            label: 'About',
            fields: referencing('companyInfo'),
          },
          ctx.actor.id,
        ),
      ).rejects.toThrow()
      await expect(
        upsertGlobal(
          ctx.site.id,
          { key: 'aboutPage', label: 'About', fields: referencing('homePage') },
          ctx.actor.id,
        ),
      ).rejects.toThrow()

      await expect(
        upsertCollection(
          ctx.site.id,
          {
            key: 'news',
            label: 'News',
            routePattern: '/news/$slug',
            fields: [
              { key: 'title', label: 'Title', type: 'text' },
              ...referencing('companyInfo'),
            ],
          },
          ctx.actor.id,
        ),
      ).rejects.toThrow()
    })
  })

  it('refuses $seo in a draft while the section has SEO off, and keeps the draft as it was', async () => {
    await withTestSite(async (ctx) => {
      const global = await upsertGlobal(ctx.site.id, companyInfo, ctx.actor.id)
      const row = await sectionEntry(global.id)

      await expect(
        updateDraft(
          row.id,
          { email: 'seo@x.test', [SEO_KEY]: { title: 'Not allowed' } },
          ctx.actor.id,
          row.draftVersion,
        ),
      ).rejects.toThrow()

      const after = await sectionEntry(global.id)
      expect(after.draftData).not.toHaveProperty(SEO_KEY)
      expect(after.draftVersion).toBe(row.draftVersion)
    })
  })

  it('strips $seo from the draft when SEO is switched off, and leaves the ready SEO alone', async () => {
    await withTestSite(async (ctx) => {
      const home = {
        ...companyInfo,
        key: 'homePage',
        label: 'Home page',
        seo: true,
      }
      const global = await upsertGlobal(ctx.site.id, home, ctx.actor.id)
      const row = await sectionEntry(global.id)
      await updateDraft(
        row.id,
        { email: 'ready@x.test', [SEO_KEY]: { title: 'Ready SEO' } },
        ctx.actor.id,
        row.draftVersion,
      )
      await publishEntry(row.id, ctx.actor.id)
      const ready = await sectionEntry(global.id)
      await updateDraft(
        row.id,
        { email: 'draft@x.test', [SEO_KEY]: { title: 'Draft SEO' } },
        ctx.actor.id,
        ready.draftVersion,
      )

      await upsertGlobal(ctx.site.id, { ...home, seo: false }, ctx.actor.id)

      const after = await sectionEntry(global.id)
      expect(after.draftData).toMatchObject({ email: 'draft@x.test' })
      expect(after.draftData).not.toHaveProperty(SEO_KEY)
      expect(after.publishedData).toMatchObject({
        [SEO_KEY]: { title: 'Ready SEO' },
      })
    })
  })

  it('restores a revision that has $seo into a section with SEO off as a skipped field', async () => {
    await withTestSite(async (ctx) => {
      const home = {
        ...companyInfo,
        key: 'homePage',
        label: 'Home page',
        seo: true,
      }
      const global = await upsertGlobal(ctx.site.id, home, ctx.actor.id)
      const row = await sectionEntry(global.id)
      await updateDraft(
        row.id,
        { email: 'seo@x.test', [SEO_KEY]: { title: 'Old SEO' } },
        ctx.actor.id,
        row.draftVersion,
      )
      const revisions = await db
        .select()
        .from(entryRevision)
        .where(eq(entryRevision.entryId, row.id))
      const withSeo = revisions.find(
        (revision) => revision.data && SEO_KEY in revision.data,
      )
      expect(withSeo).toBeDefined()

      await upsertGlobal(ctx.site.id, { ...home, seo: false }, ctx.actor.id)
      const current = await sectionEntry(global.id)
      const restored = await restoreRevision(
        row.id,
        withSeo!.id,
        ctx.actor.id,
        current.draftVersion,
      )

      expect(restored.skippedFields).toEqual([
        expect.objectContaining({ key: SEO_KEY }),
      ])
      const after = await sectionEntry(global.id)
      expect(after.draftData).not.toHaveProperty(SEO_KEY)
      expect(after.draftData).toMatchObject({ email: 'seo@x.test' })
    })
  })

  it('syncs sections from the manifest; a push without globals disables them and keeps content', async () => {
    await withTestSite(async (ctx) => {
      await syncManifest(ctx.site.id, {
        collections: {},
        globals: {
          companyInfo: { label: 'Company info', fields: globalFields() },
        },
      })
      const created = await getGlobal(ctx.site.id, 'companyInfo')
      expect(created).toMatchObject({ enabled: true, label: 'Company info' })
      const row = await sectionEntry(created!.id)
      await updateDraft(
        row.id,
        { email: 'kept@x.test' },
        ctx.actor.id,
        row.draftVersion,
      )

      await syncManifest(ctx.site.id, {
        collections: {},
        globals: { companyInfo: { label: 'Contact', fields: globalFields() } },
      })
      const updated = await getGlobal(ctx.site.id, 'companyInfo')
      expect(updated).toMatchObject({
        id: created!.id,
        label: 'Contact',
        enabled: true,
      })

      await syncManifest(ctx.site.id, { collections: {} })
      const disabled = await getGlobal(ctx.site.id, 'companyInfo')
      expect(disabled).toMatchObject({ id: created!.id, enabled: false })
      expect((await sectionEntry(created!.id)).draftData).toMatchObject({
        email: 'kept@x.test',
      })
    })
  })

  it('rejects manifest sections with slug fields, reserved keys, or a key clash with a collection', async () => {
    await withTestSite(async (ctx) => {
      await expect(
        syncManifest(ctx.site.id, {
          collections: {},
          globals: {
            companyInfo: {
              label: 'Company info',
              fields: [{ key: 'slug', label: 'Slug', type: 'slug' }],
            },
          },
        }),
      ).rejects.toThrow()

      await expect(
        syncManifest(ctx.site.id, {
          collections: {},
          globals: {
            globals: { label: 'Reserved', fields: globalFields() },
          },
        }),
      ).rejects.toThrow()

      await expect(
        syncManifest(ctx.site.id, {
          collections: {
            articles: {
              route: '/blog/$slug',
              fields: [{ key: 'title', label: 'Title', type: 'text' }],
            },
          },
          globals: { articles: { label: 'Articles', fields: globalFields() } },
        }),
      ).rejects.toThrow()

      expect(await listGlobals(ctx.site.id)).toEqual([])
    })
  })
})
