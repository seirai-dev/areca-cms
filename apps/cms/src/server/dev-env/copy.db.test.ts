import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { COPY_CONFLICT_MESSAGE, COPY_UNLINKED_MESSAGE } from '#/lib/dev-env'
import { db } from '#/db'
import { collection, entry, entryRevision } from '#/db/schema'
import type { Field } from '#/lib/types'
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
      expect(about.warnings.join(' ')).toContain('Reference cleared')
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
