import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { COPY_CONFLICT_MESSAGE, COPY_UNLINKED_MESSAGE } from '#/lib/dev-env'
import { db } from '#/db'
import { collection, entry, entryRevision } from '#/db/schema'
import type { Field, SiteLanguages } from '#/lib/types'
import { setSiteLanguages } from '#/server/admin/site-languages'
import { upsertCollection } from '#/server/content/collections'
import {
  createEntry,
  getEntry,
  publishEntry,
  updateDraft,
} from '#/server/content/entries'
import {
  createTestCollection,
  createTestGlobal,
  holdEntryLock,
  observe,
  withTestSite,
} from '#/server/content/test-utils'

import { copyEntryToProduction } from './copy'
import { forkDevEnvironment } from './fork'
import { loadPlan } from './load-plan'

const hasDb = Boolean(process.env.DATABASE_URL)

const postFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
  { key: 'related', label: 'Related', type: 'reference', collection: 'posts' },
]

const sectionFields: Field[] = [
  { key: 'email', label: 'Email', type: 'text', required: true },
]

type Ctx = Parameters<Parameters<typeof withTestSite>[0]>[0]

/** Production: `posts` with two ready entries, `home` and `about`. */
async function seedProduction(ctx: Ctx) {
  const actorId = ctx.actor.id
  await createTestCollection(ctx.site.id, {
    key: 'posts',
    fields: postFields,
    routePattern: '/posts/$slug',
  })
  const home = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'posts',
    data: { title: 'Home v1', slug: 'home', excerpt: 'Intro' },
    actorId,
  })
  await publishEntry(home.id, actorId)
  const about = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'posts',
    data: { title: 'About v1', slug: 'about' },
    actorId,
  })
  await publishEntry(about.id, actorId)
}

async function fork(ctx: Ctx) {
  const result = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
  return result.id
}

async function entryRow(siteId: string, collectionKey: string, slug: string) {
  const rows = await db
    .select({ entry })
    .from(entry)
    .innerJoin(collection, eq(collection.id, entry.collectionId))
    .where(
      and(
        eq(entry.siteId, siteId),
        eq(collection.key, collectionKey),
        eq(entry.slug, slug),
      ),
    )
    .limit(1)
  return rows.at(0)?.entry
}

async function devEntryId(devId: string, collectionKey: string, slug: string) {
  const row = await entryRow(devId, collectionKey, slug)
  if (!row) throw new Error(`no dev entry ${collectionKey}/${slug}`)
  return row.id
}

/** Edits a draft, optionally marking it ready, in one call. */
async function editEntry(
  siteId: string,
  collectionKey: string,
  slug: string,
  data: Record<string, unknown>,
  actorId: string,
  options: { publish?: boolean } = {},
) {
  const id = await devEntryId(siteId, collectionKey, slug)
  const current = await getEntry(id)
  await updateDraft(id, data, actorId, current!.draftVersion)
  if (options.publish) await publishEntry(id, actorId)
}

function copy(
  actorId: string,
  devEntry: string,
  options: { markReady?: boolean; overwrite?: boolean } = {},
) {
  return copyEntryToProduction(
    { id: actorId },
    { devEntryId: devEntry, ...options },
  )
}

describe.skipIf(!hasDb)('development environment: copy to production', () => {
  it('refuses a collection whose schema differs from production', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await upsertCollection(
        devId,
        {
          key: 'posts',
          label: 'Articles',
          routePattern: '/posts/$slug',
          fields: [
            ...postFields,
            { key: 'subtitle', label: 'Subtitle', type: 'text' },
          ],
        },
        ctx.actor.id,
      )
      const aboutId = await devEntryId(devId, 'posts', 'about')
      await expect(copy(ctx.actor.id, aboutId)).rejects.toThrow(
        'Push the schema first.',
      )
    })
  })

  it('copies a forked entry as the production draft and leaves the live version alone', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About dev', slug: 'about' },
        actorId,
      )
      const aboutDev = await devEntryId(devId, 'posts', 'about')

      const result = await copy(actorId, aboutDev)
      expect(result.created).toBe(false)
      expect(result.warnings).toEqual([])

      const prod = await entryRow(ctx.site.id, 'posts', 'about')
      expect(prod?.id).toBe(result.productionId)
      expect(prod?.draftData).toMatchObject({ title: 'About dev' })
      expect(prod?.status).toBe('published')
      expect(prod?.publishedData).toMatchObject({ title: 'About v1' })

      const revisions = await db
        .select({ note: entryRevision.note })
        .from(entryRevision)
        .where(eq(entryRevision.entryId, result.productionId))
      expect(revisions.map((row) => row.note)).toContain('before dev push')

      // The baseline is the copied content, so the push plan no longer lists it.
      const plan = await loadPlan(db, devId)
      expect(plan.items.map((item) => item.id)).not.toContain(
        `entry:${aboutDev}`,
      )
    })
  })

  it('makes the dev ready version production ready with markReady', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About ready', slug: 'about' },
        ctx.actor.id,
        { publish: true },
      )

      const result = await copy(
        ctx.actor.id,
        await devEntryId(devId, 'posts', 'about'),
        {
          markReady: true,
        },
      )
      expect(result.warnings).toEqual([])
      const prod = await entryRow(ctx.site.id, 'posts', 'about')
      expect(prod?.status).toBe('published')
      expect(prod?.publishedData).toMatchObject({ title: 'About ready' })
      expect(prod?.draftData).toMatchObject({ title: 'About ready' })
    })
  })

  it('creates a new production draft for an entry created in dev', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const created = await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'Fresh', slug: 'fresh' },
        actorId: ctx.actor.id,
      })

      const result = await copy(ctx.actor.id, created.id)
      expect(result.created).toBe(true)
      const prod = await entryRow(ctx.site.id, 'posts', 'fresh')
      expect(prod?.id).toBe(result.productionId)
      expect(prod?.status).toBe('draft')
      expect(prod?.draftData).toMatchObject({ title: 'Fresh' })

      const devRow = await getEntry(created.id)
      expect(devRow?.originEntryId).toBe(result.productionId)
    })
  })

  it('refuses a slug that an unrelated production entry already uses', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'posts',
        data: { title: 'Contact', slug: 'contact' },
        actorId: ctx.actor.id,
      })
      const aboutDev = await devEntryId(devId, 'posts', 'about')
      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About dev', slug: 'contact' },
        ctx.actor.id,
      )

      await expect(copy(ctx.actor.id, aboutDev)).rejects.toThrow(
        'already has an entry with the slug "contact"',
      )
    })
  })

  it('refuses a production change since the fork until overwrite is passed', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About dev', slug: 'about' },
        actorId,
      )
      await editEntry(
        ctx.site.id,
        'posts',
        'about',
        { title: 'About prod', slug: 'about' },
        actorId,
      )
      const aboutDev = await devEntryId(devId, 'posts', 'about')

      await expect(copy(actorId, aboutDev)).rejects.toThrow(
        COPY_CONFLICT_MESSAGE,
      )
      expect(
        (await entryRow(ctx.site.id, 'posts', 'about'))?.draftData,
      ).toMatchObject({
        title: 'About prod',
      })

      const result = await copy(actorId, aboutDev, { overwrite: true })
      expect(result.created).toBe(false)
      expect(
        (await entryRow(ctx.site.id, 'posts', 'about'))?.draftData,
      ).toMatchObject({
        title: 'About dev',
      })
    })
  })

  it('refuses a same-slug production entry that is not linked to the dev entry until overwrite', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'Dev fresh', slug: 'fresh' },
        actorId,
      })
      await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'posts',
        data: { title: 'Prod fresh', slug: 'fresh' },
        actorId,
      })
      const devFresh = await devEntryId(devId, 'posts', 'fresh')

      await expect(copy(actorId, devFresh)).rejects.toThrow(
        COPY_UNLINKED_MESSAGE,
      )
      const result = await copy(actorId, devFresh, { overwrite: true })
      expect(result.created).toBe(false)
      expect(
        (await entryRow(ctx.site.id, 'posts', 'fresh'))?.draftData,
      ).toMatchObject({
        title: 'Dev fresh',
      })
    })
  })

  it('maps references to production ids and clears one to an entry production does not have', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      const homeDev = await devEntryId(devId, 'posts', 'home')
      const lonely = await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'Lonely', slug: 'lonely' },
        actorId,
      })
      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About dev', slug: 'about', related: lonely.id },
        actorId,
      )
      const fresh = await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'Fresh', slug: 'fresh', related: homeDev },
        actorId,
      })

      const about = await copy(
        actorId,
        await devEntryId(devId, 'posts', 'about'),
      )
      expect(about.clearedReferences).toEqual([
        { field: 'related', devTargetId: lonely.id },
      ])
      expect(about.warnings).toEqual([
        expect.objectContaining({
          code: 'reference-cleared',
          params: expect.objectContaining({ field: 'related' }),
        }),
      ])
      expect(
        (await entryRow(ctx.site.id, 'posts', 'about'))?.draftData,
      ).not.toHaveProperty('related')

      const freshCopy = await copy(actorId, fresh.id)
      const homeProd = await entryRow(ctx.site.id, 'posts', 'home')
      expect(freshCopy.clearedReferences).toEqual([])
      expect(
        (await entryRow(ctx.site.id, 'posts', 'fresh'))?.draftData,
      ).toMatchObject({
        related: homeProd?.id,
      })
    })
  })

  it('copies a section into its production section entry', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        fields: sectionFields,
      })
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      const devSection = await entryRow(devId, 'companyInfo', '$global')
      expect(devSection).toBeDefined()
      const current = await getEntry(devSection!.id)
      await updateDraft(
        devSection!.id,
        { email: 'dev@example.test' },
        actorId,
        current!.draftVersion,
      )

      const result = await copy(actorId, devSection!.id)
      expect(result.created).toBe(false)
      const prodSection = await entryRow(ctx.site.id, 'companyInfo', '$global')
      expect(prodSection?.id).toBe(result.productionId)
      expect(prodSection?.draftData).toMatchObject({
        email: 'dev@example.test',
      })
    })
  })

  it('refuses an archived dev entry', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const aboutDev = await devEntryId(devId, 'posts', 'about')
      await db
        .update(entry)
        .set({ status: 'archived' })
        .where(eq(entry.id, aboutDev))

      await expect(copy(ctx.actor.id, aboutDev)).rejects.toThrow(
        'Archived in development',
      )
    })
  })

  it('does not copy an entry that is not in a development environment', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const prodAbout = await entryRow(ctx.site.id, 'posts', 'about')
      await expect(copy(ctx.actor.id, prodAbout!.id)).rejects.toThrow()
    })
  })
})

describe.skipIf(!hasDb)(
  'development environment: copy URLs, ready and self-references',
  () => {
    it('refuses a localized URL that another production entry already uses, with a clear message', async () => {
      await withTestSite(async (ctx) => {
        await seedProduction(ctx)
        const devId = await fork(ctx)
        const actorId = ctx.actor.id
        await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'posts',
          data: { title: 'Contact', slug: 'contact' },
          actorId,
        })
        await setSiteLanguages(
          devId,
          { main: 'en', all: ['en', 'nl'] } satisfies SiteLanguages,
          actorId,
        )
        await editEntry(
          devId,
          'posts',
          'about',
          {
            title: 'About dev',
            slug: 'about',
            $i18n: { nl: { $slug: 'contact' } },
          },
          actorId,
        )
        const aboutDev = await devEntryId(devId, 'posts', 'about')

        await expect(copy(actorId, aboutDev)).rejects.toThrow(
          "The Dutch URL 'contact' is already used by 'Contact' in production.",
        )
        // Overwrite does not change a URL collision.
        await expect(
          copy(actorId, aboutDev, { overwrite: true }),
        ).rejects.toThrow('already used by')
        expect(
          (await entryRow(ctx.site.id, 'posts', 'about'))?.draftData,
        ).toMatchObject({ title: 'About v1' })
      })
    })

    it('waits for an entry save that holds the asset lock before it reads the URLs and writes', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await seedProduction(ctx)
        const devId = await fork(ctx)
        await editEntry(
          devId,
          'posts',
          'about',
          { title: 'About dev', slug: 'about' },
          actorId,
        )
        // Holds the lock only, so nothing else (a row lock) can hold the copy back.
        const save = await holdEntryLock(ctx.site.organizationId)
        const attempt = observe(
          copy(actorId, await devEntryId(devId, 'posts', 'about')),
        )
        expect(await attempt.settledAfterWait()).toBe(false)
        save.release()
        await save.done

        const result = await attempt.outcome
        if (!result.ok) throw new Error(String(result.error))
        expect(result.value.created).toBe(false)
      })
    })

    it('refuses a URL that an entry save took while the copy waited', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await setSiteLanguages(
          ctx.site.id,
          { main: 'en', all: ['en', 'nl'] } satisfies SiteLanguages,
          actorId,
        )
        await seedProduction(ctx)
        const devId = await fork(ctx)
        await createEntry({
          siteId: devId,
          collectionKey: 'posts',
          data: {
            title: 'Contact',
            slug: 'contact',
            $i18n: { nl: { $slug: 'contact' } },
          },
          actorId,
        })
        const posts = (
          await db
            .select({ id: collection.id })
            .from(collection)
            .where(
              and(
                eq(collection.siteId, ctx.site.id),
                eq(collection.key, 'posts'),
              ),
            )
            .limit(1)
        ).at(0)!

        // An ordinary save takes the Dutch URL and holds the lock until it commits.
        const save = await holdEntryLock(
          ctx.site.organizationId,
          async (tx) => {
            await tx.insert(entry).values({
              siteId: ctx.site.id,
              collectionId: posts.id,
              slug: 'other',
              status: 'draft',
              draftData: {
                title: 'Other',
                slug: 'other',
                $i18n: { nl: { $slug: 'contact' } },
              },
              createdBy: actorId,
              updatedBy: actorId,
            })
          },
        )
        const attempt = observe(
          copy(actorId, await devEntryId(devId, 'posts', 'contact')),
        )
        expect(await attempt.settledAfterWait()).toBe(false)
        save.release()
        await save.done

        const result = await attempt.outcome
        if (result.ok) throw new Error('the copy should have been refused')
        expect((result.error as Error).message).toContain(
          "already used by 'Other' in production",
        )
        expect(await entryRow(ctx.site.id, 'posts', 'contact')).toBeUndefined()
      })
    })

    it('with markReady, makes the copied draft (not the dev ready version) the production ready version', async () => {
      await withTestSite(async (ctx) => {
        await seedProduction(ctx)
        const devId = await fork(ctx)
        const actorId = ctx.actor.id
        await editEntry(
          devId,
          'posts',
          'about',
          { title: 'About draft', slug: 'about' },
          actorId,
        )

        const result = await copy(
          actorId,
          await devEntryId(devId, 'posts', 'about'),
          { markReady: true },
        )
        expect(result.warnings).toEqual([])
        const prod = await entryRow(ctx.site.id, 'posts', 'about')
        expect(prod?.status).toBe('published')
        expect(prod?.publishedData).toMatchObject({ title: 'About draft' })
        expect(prod?.draftData).toMatchObject({ title: 'About draft' })
      })
    })

    it('copies the draft but keeps the production ready version when the draft fails strict validation', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await createTestCollection(ctx.site.id, {
          key: 'guides',
          fields: [
            { key: 'title', label: 'Title', type: 'text', required: true },
            { key: 'slug', label: 'Slug', type: 'slug', required: true },
            { key: 'summary', label: 'Summary', type: 'text', required: true },
          ],
          routePattern: '/guides/$slug',
        })
        const guide = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'guides',
          data: { title: 'Guide', slug: 'guide', summary: 'Old summary' },
          actorId,
        })
        await publishEntry(guide.id, actorId)
        const devId = await fork(ctx)
        // The draft drops the required summary: a draft may, a ready version may not.
        await editEntry(
          devId,
          'guides',
          'guide',
          { title: 'Guide dev', slug: 'guide' },
          actorId,
        )

        const result = await copy(
          actorId,
          await devEntryId(devId, 'guides', 'guide'),
          { markReady: true },
        )
        expect(result.warnings).toEqual([
          expect.objectContaining({
            code: 'ready-not-copied',
            message: expect.stringContaining(
              'Ready version not copied, production keeps its previous ready version',
            ),
          }),
        ])
        const prod = await entryRow(ctx.site.id, 'guides', 'guide')
        expect(prod?.draftData).toMatchObject({ title: 'Guide dev' })
        expect(prod?.status).toBe('published')
        expect(prod?.publishedData).toMatchObject({
          title: 'Guide',
          summary: 'Old summary',
        })
      })
    })

    it('maps a self-reference to the production entry it is copied onto, when that entry was not forked', async () => {
      await withTestSite(async (ctx) => {
        await seedProduction(ctx)
        const devId = await fork(ctx)
        const actorId = ctx.actor.id
        // Production gets the entry after the fork, so dev has no link to it.
        await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'posts',
          data: { title: 'Contact v1', slug: 'contact' },
          actorId,
        })
        const devContact = await createEntry({
          siteId: devId,
          collectionKey: 'posts',
          data: { title: 'Contact dev', slug: 'contact' },
          actorId,
        })
        const current = await getEntry(devContact.id)
        await updateDraft(
          devContact.id,
          { title: 'Contact dev', slug: 'contact', related: devContact.id },
          actorId,
          current!.draftVersion,
        )

        await expect(copy(actorId, devContact.id)).rejects.toThrow(
          COPY_UNLINKED_MESSAGE,
        )
        const result = await copy(actorId, devContact.id, { overwrite: true })
        expect(result.created).toBe(false)
        expect(result.clearedReferences).toEqual([])
        const prod = await entryRow(ctx.site.id, 'posts', 'contact')
        expect(prod?.id).toBe(result.productionId)
        expect(prod?.draftData).toMatchObject({
          title: 'Contact dev',
          related: result.productionId,
        })
      })
    })
  },
)
