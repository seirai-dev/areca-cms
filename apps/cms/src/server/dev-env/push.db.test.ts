import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  collection,
  deletedContentArchive,
  entry,
  publication,
  site,
} from '#/db/schema'
import type { Field, SiteLanguages } from '#/lib/types'
import { setSiteLanguages } from '#/server/admin/site-languages'
import { upsertCollection } from '#/server/content/collections'
import {
  archiveEntry,
  createEntry,
  deleteEntry,
  getEntry,
  publishEntry,
  updateDraft,
} from '#/server/content/entries'
import { ConflictError } from '#/server/content/errors'
import { createTestCollection, withTestSite } from '#/server/content/test-utils'

import { forkDevEnvironment } from './fork'
import { loadPlan } from './load-plan'
import { PLAN_CHANGED_MESSAGE, pushDevEnvironment } from './push'

const hasDb = Boolean(process.env.DATABASE_URL)

const postFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
  { key: 'related', label: 'Related', type: 'reference', collection: 'posts' },
]

const caseFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
]

type Ctx = Parameters<Parameters<typeof withTestSite>[0]>[0]

/** Production: `posts` with two ready entries (`home` has an excerpt) and a schema-only collection. */
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
  const row = await entryRow(siteId, collectionKey, slug)
  if (!row) throw new Error(`no entry ${collectionKey}/${slug}`)
  const current = await getEntry(row.id)
  await updateDraft(row.id, data, actorId, current!.draftVersion)
  if (options.publish) await publishEntry(row.id, actorId)
}

async function push(
  actorId: string,
  devId: string,
  options: { exclude?: string[]; apply?: string[] } = {},
) {
  const plan = await loadPlan(db, devId)
  return pushDevEnvironment(
    { id: actorId },
    {
      devSiteId: devId,
      planHash: plan.planHash,
      exclude: options.exclude ?? [],
      apply: options.apply ?? [],
      goLive: false,
    },
  )
}

describe.skipIf(!hasDb)('development environment: push', () => {
  it('pushes a new collection before its entry, then the plan is empty', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await createTestCollection(devId, {
        key: 'cases',
        fields: caseFields,
        routePattern: '/cases/$slug',
      })
      const created = await createEntry({
        siteId: devId,
        collectionKey: 'cases',
        data: { title: 'Case A', slug: 'case-a' },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)

      const plan = await loadPlan(db, devId)
      expect(plan.items.map((item) => item.kind)).toEqual([
        'schema.add',
        'entry.new',
      ])

      const result = await push(ctx.actor.id, devId)
      expect(result.counts).toMatchObject({ schema: 1, new: 1, skipped: 0 })
      expect(result.warnings).toEqual([])

      const pushed = await entryRow(ctx.site.id, 'cases', 'case-a')
      expect(pushed?.status).toBe('published')
      expect(pushed?.publishedData).toMatchObject({ title: 'Case A' })

      const after = await loadPlan(db, devId)
      expect(after.items).toEqual([])
    })
  })

  it('removes a dropped field only when applied, archiving its values first', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await upsertCollection(
        devId,
        {
          key: 'posts',
          label: 'Articles',
          routePattern: '/posts/$slug',
          fields: postFields.filter((field) => field.key !== 'excerpt'),
          confirmDropFields: ['excerpt'],
        },
        ctx.actor.id,
      )

      const plan = await loadPlan(db, devId)
      const schemaItem = plan.items.find((item) => item.id === 'schema:posts')
      expect(schemaItem).toMatchObject({
        attention: 'drops-content',
        summary: { droppedFields: [{ key: 'excerpt', values: 1 }] },
      })

      // Dev's purge also changes its home entry; keep that out of this test.
      const homeItem = `entry:${await devEntryId(devId, 'posts', 'home')}`
      await push(ctx.actor.id, devId, { exclude: [homeItem] })
      const skippedFields = (
        await db
          .select({ fields: collection.fields })
          .from(collection)
          .where(
            and(
              eq(collection.siteId, ctx.site.id),
              eq(collection.key, 'posts'),
            ),
          )
      )[0].fields
      expect(skippedFields.map((field) => field.key)).toContain('excerpt')

      const applied = await push(ctx.actor.id, devId, {
        apply: ['schema:posts'],
        exclude: [homeItem],
      })
      expect(applied.counts.schema).toBe(1)
      const afterFields = (
        await db
          .select({ fields: collection.fields })
          .from(collection)
          .where(
            and(
              eq(collection.siteId, ctx.site.id),
              eq(collection.key, 'posts'),
            ),
          )
      )[0].fields
      expect(afterFields.map((field) => field.key)).not.toContain('excerpt')

      const archived = await db
        .select({ id: deletedContentArchive.id })
        .from(deletedContentArchive)
        .where(
          and(
            eq(deletedContentArchive.organizationId, ctx.org.id),
            eq(deletedContentArchive.entityType, 'collection'),
          ),
        )
      expect(archived.length).toBeGreaterThan(0)
    })
  })

  it('mirrors a ready dev version and draft, and a draft-only dev entry leaves production ready alone', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await editEntry(
        devId,
        'posts',
        'home',
        { title: 'Home v2', slug: 'home', excerpt: 'Intro' },
        ctx.actor.id,
        { publish: true },
      )
      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About draft', slug: 'about' },
        ctx.actor.id,
      )
      await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'Draft only', slug: 'draft-only' },
        actorId: ctx.actor.id,
      })

      await push(ctx.actor.id, devId)

      const home = await entryRow(ctx.site.id, 'posts', 'home')
      expect(home?.status).toBe('published')
      expect(home?.publishedData).toMatchObject({ title: 'Home v2' })
      expect(home?.draftData).toMatchObject({ title: 'Home v2' })

      const about = await entryRow(ctx.site.id, 'posts', 'about')
      expect(about?.draftData).toMatchObject({ title: 'About draft' })
      expect(about?.publishedData).toMatchObject({ title: 'About v1' })

      const draftOnly = await entryRow(ctx.site.id, 'posts', 'draft-only')
      expect(draftOnly?.status).toBe('draft')
      expect(draftOnly?.publishedData).toBeNull()
      expect(draftOnly?.draftData).toMatchObject({ title: 'Draft only' })
    })
  })

  it('maps a reference to a new entry, and clears one to an entry that was not pushed', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      const b = await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'B', slug: 'b' },
        actorId,
      })
      await publishEntry(b.id, actorId)
      const a = await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'A', slug: 'a', related: b.id },
        actorId,
      })
      await publishEntry(a.id, actorId)
      const d = await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'D', slug: 'd' },
        actorId,
      })
      await publishEntry(d.id, actorId)
      await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'C', slug: 'c', related: d.id },
        actorId,
      })

      const result = await push(actorId, devId, {
        exclude: [`entry:${d.id}`],
      })

      const pushedA = await entryRow(ctx.site.id, 'posts', 'a')
      const pushedB = await entryRow(ctx.site.id, 'posts', 'b')
      expect(pushedA?.status).toBe('published')
      expect(pushedA?.publishedData).toMatchObject({ related: pushedB?.id })
      expect(pushedA?.draftData).toMatchObject({ related: pushedB?.id })

      const pushedC = await entryRow(ctx.site.id, 'posts', 'c')
      expect(pushedC?.draftData).not.toHaveProperty('related')
      expect(result.warnings).toEqual([
        expect.objectContaining({
          field: 'related',
          devTargetId: d.id,
        }),
      ])
    })
  })

  it('re-points a copied reference at its dev twin, and pushes it back as the production id', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const actorId = ctx.actor.id
      const prodAbout = await entryRow(ctx.site.id, 'posts', 'about')
      const prodHome = await entryRow(ctx.site.id, 'posts', 'home')
      await editEntry(
        ctx.site.id,
        'posts',
        'home',
        {
          title: 'Home v1',
          slug: 'home',
          excerpt: 'Intro',
          related: prodAbout!.id,
        },
        actorId,
        { publish: true },
      )
      const devId = await fork(ctx)

      // The fork holds the dev twin of `about`, so the dev entry can be saved.
      const devAbout = await devEntryId(devId, 'posts', 'about')
      await editEntry(
        devId,
        'posts',
        'home',
        {
          title: 'Home dev',
          slug: 'home',
          excerpt: 'Intro',
          related: devAbout,
        },
        actorId,
      )
      await push(actorId, devId)

      const pushed = await entryRow(ctx.site.id, 'posts', 'home')
      expect(pushed?.draftData).toMatchObject({
        title: 'Home dev',
        related: prodAbout!.id,
      })
      expect(prodHome?.id).toBe(pushed?.id)
      expect((await loadPlan(db, devId)).items).toEqual([])
    })
  })

  it('archives the production entry when the dev entry is archived', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const devHome = await devEntryId(devId, 'posts', 'home')
      const before = await entryRow(ctx.site.id, 'posts', 'home')
      await archiveEntry(devHome, ctx.actor.id)

      const result = await push(ctx.actor.id, devId)
      expect(result.counts.archived).toBe(1)

      const after = await entryRow(ctx.site.id, 'posts', 'home')
      expect(after?.status).toBe('archived')
      expect(after?.contentVersion).toBeGreaterThan(before!.contentVersion)
    })
  })

  it('skips a conflict by default and overwrites production when applied', async () => {
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

      const plan = await loadPlan(db, devId)
      const aboutId = `entry:${await devEntryId(devId, 'posts', 'about')}`
      expect(plan.items.find((item) => item.id === aboutId)?.attention).toBe(
        'conflict',
      )

      const skipped = await push(actorId, devId)
      expect(skipped.counts.skipped).toBeGreaterThanOrEqual(1)
      expect(
        (await entryRow(ctx.site.id, 'posts', 'about'))?.draftData,
      ).toMatchObject({ title: 'About prod' })

      await push(actorId, devId, { apply: [aboutId] })
      expect(
        (await entryRow(ctx.site.id, 'posts', 'about'))?.draftData,
      ).toMatchObject({ title: 'About dev' })
    })
  })

  it('recreates a production entry deleted after the fork as a draft when applied', async () => {
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
        { publish: true },
      )
      const prodAbout = await entryRow(ctx.site.id, 'posts', 'about')
      await deleteEntry(prodAbout!.id, actorId)

      const plan = await loadPlan(db, devId)
      const aboutItem = plan.items.find((item) =>
        item.label.startsWith('"about"'),
      )
      expect(aboutItem?.attention).toBe('deleted-in-production')

      await push(actorId, devId, { apply: [aboutItem!.id] })
      const recreated = await entryRow(ctx.site.id, 'posts', 'about')
      expect(recreated?.status).toBe('draft')
      expect(recreated?.publishedData).toBeNull()
      expect(recreated?.draftData).toMatchObject({ title: 'About dev' })
    })
  })

  it('never applies an entry scheduled in production', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await editEntry(
        devId,
        'posts',
        'home',
        { title: 'Home dev', slug: 'home', excerpt: 'Intro' },
        ctx.actor.id,
      )
      const prodHome = await entryRow(ctx.site.id, 'posts', 'home')
      await db
        .update(entry)
        .set({ scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
        .where(eq(entry.id, prodHome!.id))

      const plan = await loadPlan(db, devId)
      const homeItem = plan.items.find((item) => item.attention === 'scheduled')
      expect(homeItem).toBeDefined()

      const result = await push(ctx.actor.id, devId, { apply: [homeItem!.id] })
      expect(result.written.map((row) => row.itemId)).not.toContain(
        homeItem!.id,
      )
      expect(
        (await entryRow(ctx.site.id, 'posts', 'home'))?.draftData,
      ).toMatchObject({ title: 'Home v1' })
    })
  })

  it('refuses a stale plan when dev changed after the plan, and when production saved a draft', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await editEntry(
        devId,
        'posts',
        'home',
        { title: 'Home dev', slug: 'home', excerpt: 'Intro' },
        actorId,
      )
      const stale = await loadPlan(db, devId)

      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About dev', slug: 'about' },
        actorId,
      )
      await expect(
        pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: stale.planHash,
            exclude: [],
            apply: [],
            goLive: false,
          },
        ),
      ).rejects.toThrow(ConflictError)
      await expect(
        pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: stale.planHash,
            exclude: [],
            apply: [],
            goLive: false,
          },
        ),
      ).rejects.toThrow(PLAN_CHANGED_MESSAGE)

      const planned = await loadPlan(db, devId)
      await editEntry(
        ctx.site.id,
        'posts',
        'home',
        { title: 'Home prod draft', slug: 'home', excerpt: 'Intro' },
        actorId,
      )
      await expect(
        pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: planned.planHash,
            exclude: [],
            apply: [],
            goLive: false,
          },
        ),
      ).rejects.toThrow(PLAN_CHANGED_MESSAGE)
      expect(
        (await entryRow(ctx.site.id, 'posts', 'home'))?.draftData,
      ).toMatchObject({ title: 'Home prod draft' })
    })
  })

  it('keeps the production ready version and lists the warning when the ready version fails strict validation', async () => {
    await withTestSite(async (ctx) => {
      const actorId = ctx.actor.id
      await setSiteLanguages(
        ctx.site.id,
        { main: 'en', all: ['en', 'nl'] } satisfies SiteLanguages,
        actorId,
      )
      await createTestCollection(ctx.site.id, {
        key: 'posts',
        fields: postFields,
        routePattern: '/posts/$slug',
        requiredLanguages: ['nl'],
      })
      const devId = await fork(ctx)
      // Dev stops requiring Dutch, so a dev entry without it is ready in dev.
      await upsertCollection(
        devId,
        {
          key: 'posts',
          label: 'Articles',
          routePattern: '/posts/$slug',
          fields: postFields,
          requiredLanguages: [],
        },
        actorId,
      )
      await createEntry({
        siteId: devId,
        collectionKey: 'posts',
        data: { title: 'English only', slug: 'english-only' },
        actorId,
      })
      await editEntry(
        devId,
        'posts',
        'english-only',
        { title: 'English only', slug: 'english-only' },
        actorId,
        { publish: true },
      )

      const result = await push(actorId, devId, {
        exclude: ['schema:posts'],
      })
      const pushed = await entryRow(ctx.site.id, 'posts', 'english-only')
      expect(pushed?.status).toBe('draft')
      expect(pushed?.publishedData).toBeNull()
      expect(pushed?.draftData).toMatchObject({ title: 'English only' })
      expect(result.warnings).toEqual([
        expect.objectContaining({
          message: expect.stringContaining('Ready version not pushed'),
        }),
      ])
    })
  })

  it('pushes a language change and the plan is then empty', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await setSiteLanguages(
        devId,
        { main: 'en', all: ['en', 'nl'] },
        ctx.actor.id,
      )

      const plan = await loadPlan(db, devId)
      expect(plan.items.map((item) => item.id)).toEqual(['languages'])

      await push(ctx.actor.id, devId)
      const prod = (
        await db.select().from(site).where(eq(site.id, ctx.site.id)).limit(1)
      ).at(0)
      expect(prod?.languages).toEqual({ main: 'en', all: ['en', 'nl'] })
      expect((await loadPlan(db, devId)).items).toEqual([])
    })
  })

  it('queues a demo publication with go live, and reports a refusal without a deployment target', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About dev', slug: 'about' },
        ctx.actor.id,
        { publish: true },
      )
      await db
        .update(site)
        .set({ publishingMode: 'demo', deploymentTarget: null })
        .where(eq(site.id, ctx.site.id))

      const plan = await loadPlan(db, devId)
      const result = await pushDevEnvironment(
        { id: ctx.actor.id },
        {
          devSiteId: devId,
          planHash: plan.planHash,
          exclude: [],
          apply: [],
          goLive: true,
        },
      )
      expect(result.publication?.ok).toBe(true)
      const queued = await db
        .select({ id: publication.id })
        .from(publication)
        .where(eq(publication.siteId, ctx.site.id))
      expect(queued.length).toBeGreaterThan(0)

      await db
        .update(site)
        .set({ publishingMode: 'production' })
        .where(eq(site.id, ctx.site.id))
      await editEntry(
        devId,
        'posts',
        'home',
        { title: 'Home next', slug: 'home', excerpt: 'Intro' },
        ctx.actor.id,
        { publish: true },
      )
      const refused = await pushDevEnvironment(
        { id: ctx.actor.id },
        {
          devSiteId: devId,
          planHash: (await loadPlan(db, devId)).planHash,
          exclude: [],
          apply: [],
          goLive: true,
        },
      )
      expect(refused.publication?.ok).toBe(false)
      expect(
        (await entryRow(ctx.site.id, 'posts', 'home'))?.publishedData,
      ).toMatchObject({ title: 'Home next' })
    })
  })

  it('serializes two pushes of the same plan: one writes, the other is refused', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About dev', slug: 'about' },
        ctx.actor.id,
        { publish: true },
      )
      const plan = await loadPlan(db, devId)
      const attempt = () =>
        pushDevEnvironment(
          { id: ctx.actor.id },
          {
            devSiteId: devId,
            planHash: plan.planHash,
            exclude: [],
            apply: [],
            goLive: false,
          },
        )
      const results = await Promise.allSettled([attempt(), attempt()])
      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0].reason).toBeInstanceOf(ConflictError)
    })
  })
})
