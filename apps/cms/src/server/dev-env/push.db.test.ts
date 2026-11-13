import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  collection,
  deletedContentArchive,
  entry,
  publication,
  site,
} from '#/db/schema'
import { SEO_KEY } from '#/lib/seo'
import type { Field, SiteLanguages } from '#/lib/types'
import { setSiteLanguages } from '#/server/admin/site-languages'
import { audit } from '#/server/audit'
import { assetAttachLock } from '#/server/assets/usage'
import {
  deleteCollection,
  upsertCollection,
} from '#/server/content/collections'
import {
  archiveEntry,
  createEntry,
  deleteEntry,
  getEntry,
  publishEntry,
  updateDraft,
} from '#/server/content/entries'
import { ConflictError } from '#/server/content/errors'
import { deleteGlobal, upsertGlobal } from '#/server/content/globals'
import {
  createTestCollection,
  createTestGlobal,
  globalFields,
  holdEntryLock,
  observe,
  waitForAdvisoryWaiter,
  withTestSite,
} from '#/server/content/test-utils'

import { forkDevEnvironment } from './fork'
import { getDevSiteSyncStatus, loadPlan } from './load-plan'
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

async function collectionIdOf(siteId: string, collectionKey: string) {
  const row = (
    await db
      .select({ id: collection.id })
      .from(collection)
      .where(
        and(eq(collection.siteId, siteId), eq(collection.key, collectionKey)),
      )
      .limit(1)
  ).at(0)
  if (!row) throw new Error(`no collection ${collectionKey}`)
  return row.id
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
          code: 'reference-cleared',
          params: expect.objectContaining({
            field: 'related',
            devTargetId: d.id,
          }),
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
      const aboutItem = plan.items.find((item) => item.title === 'About dev')
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

  it('keeps production values of a field removal that is not applied, in draft and ready', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await upsertCollection(
        devId,
        {
          key: 'posts',
          label: 'Articles',
          routePattern: '/posts/$slug',
          fields: postFields.filter((field) => field.key !== 'excerpt'),
          confirmDropFields: ['excerpt'],
        },
        actorId,
      )
      await editEntry(
        devId,
        'posts',
        'home',
        { title: 'Home v2', slug: 'home' },
        actorId,
        { publish: true },
      )
      const homeItem = `entry:${await devEntryId(devId, 'posts', 'home')}`

      const plan = await loadPlan(db, devId)
      expect(plan.items.find((item) => item.id === homeItem)).toMatchObject({
        dependsOn: ['schema:posts'],
        summary: expect.objectContaining({ preservedFields: ['excerpt'] }),
      })

      // Default decisions: the removal is skipped, the entry is ticked.
      await push(actorId, devId)
      const home = await entryRow(ctx.site.id, 'posts', 'home')
      expect(home?.draftData).toMatchObject({
        title: 'Home v2',
        excerpt: 'Intro',
      })
      expect(home?.publishedData).toMatchObject({
        title: 'Home v2',
        excerpt: 'Intro',
      })

      // Only the removal stays listed: the entry's other changes are pushed, and
      // the kept field is not a change of its own.
      const after = await loadPlan(db, devId)
      expect(after.items.map((item) => item.id)).toEqual(['schema:posts'])

      await push(actorId, devId, { apply: ['schema:posts'] })
      const applied = await entryRow(ctx.site.id, 'posts', 'home')
      expect(applied?.draftData).not.toHaveProperty('excerpt')
      expect(applied?.publishedData).not.toHaveProperty('excerpt')
      expect((await loadPlan(db, devId)).items).toEqual([])
    })
  })

  it('applies a populated field removal together with its affected entry', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await upsertCollection(
        devId,
        {
          key: 'posts',
          label: 'Articles',
          routePattern: '/posts/$slug',
          fields: postFields.filter((field) => field.key !== 'excerpt'),
          confirmDropFields: ['excerpt'],
        },
        actorId,
      )
      // An independent change to the same entry: it is written with the removal.
      await editEntry(
        devId,
        'posts',
        'home',
        { title: 'Home dev', slug: 'home' },
        actorId,
      )
      const plan = await loadPlan(db, devId)
      const prodHome = await entryRow(ctx.site.id, 'posts', 'home')
      expect(
        plan.items.find((item) => item.id === 'schema:posts')?.affectedEntries,
      ).toEqual([
        { id: prodHome!.id, contentVersion: prodHome!.contentVersion },
      ])

      const result = await push(actorId, devId, { apply: ['schema:posts'] })
      expect(result.counts.schema).toBe(1)
      expect(result.counts.changed).toBe(1)
      expect(result.warnings).toEqual([])
      const home = await entryRow(ctx.site.id, 'posts', 'home')
      expect(home?.draftData).toMatchObject({ title: 'Home dev' })
      expect(home?.draftData).not.toHaveProperty('excerpt')
      expect((await loadPlan(db, devId)).items).toEqual([])
    })
  })

  it('keeps a blank production value of a field removal that is not applied, and its baseline', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const actorId = ctx.actor.id
      // Production holds an empty excerpt: stored, but not content.
      await editEntry(
        ctx.site.id,
        'posts',
        'home',
        { title: 'Home v1', slug: 'home', excerpt: '' },
        actorId,
        { publish: true },
      )
      const devId = await fork(ctx)
      await upsertCollection(
        devId,
        {
          key: 'posts',
          label: 'Articles',
          routePattern: '/posts/$slug',
          fields: postFields.filter((field) => field.key !== 'excerpt'),
        },
        actorId,
      )
      await editEntry(
        devId,
        'posts',
        'home',
        { title: 'Home v2', slug: 'home' },
        actorId,
        { publish: true },
      )
      const homeItem = `entry:${await devEntryId(devId, 'posts', 'home')}`
      expect(
        (await loadPlan(db, devId)).items.find((item) => item.id === homeItem),
      ).toMatchObject({
        summary: expect.objectContaining({ preservedFields: ['excerpt'] }),
      })

      // Skip the removal explicitly: a removal whose only values are blank is not
      // flagged, so it would otherwise be applied by default.
      await push(actorId, devId, { exclude: ['schema:posts'] })
      const home = await entryRow(ctx.site.id, 'posts', 'home')
      expect(home?.draftData).toMatchObject({ title: 'Home v2', excerpt: '' })
      expect(home?.publishedData).toMatchObject({
        title: 'Home v2',
        excerpt: '',
      })
      // The kept field's baseline is not advanced: its blank value is the old one.
      const devHome = await entryRow(devId, 'posts', 'home')
      expect(devHome?.originBaseline?.data).toHaveProperty('excerpt', '')
      expect(devHome?.originBaseline?.publishedData).toHaveProperty(
        'excerpt',
        '',
      )
      expect((await loadPlan(db, devId)).items.map((item) => item.id)).toEqual([
        'schema:posts',
      ])

      // Applying the removal does not purge a blank value (only content is purged,
      // as in the CMS), and the entry settles: nothing is listed again.
      await push(actorId, devId, { apply: ['schema:posts'] })
      const applied = await entryRow(ctx.site.id, 'posts', 'home')
      expect(applied?.draftData).toMatchObject({ title: 'Home v2' })
      expect((await loadPlan(db, devId)).items).toEqual([])
    })
  })

  // Blank values production stores for a removed field. Key presence keeps each
  // one in draft, ready and baseline; the purge is not run until the removal is
  // applied. An empty list or object is not a valid textarea value, so the
  // strict check refuses the ready mirror: production keeps its ready version
  // and the push lists that as a warning.
  const blankStored: Array<
    [string, Record<string, unknown>, string[], unknown, boolean]
  > = [
    ['null', { excerpt: null }, ['excerpt'], null, true],
    ['an empty list', { excerpt: [] }, ['excerpt'], [], false],
    ['an empty object', { excerpt: {} }, ['excerpt'], {}, false],
    [
      'a blank Dutch value',
      { $i18n: { nl: { excerpt: '' } } },
      ['$i18n', 'nl', 'excerpt'],
      '',
      true,
    ],
  ]

  it.each(blankStored)(
    'keeps a production %s of a field removal that is not applied, in draft, ready and baseline',
    async (_label, stored, path, value, readyMirrors) => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await setSiteLanguages(
          ctx.site.id,
          { main: 'en', all: ['en', 'nl'] },
          actorId,
        )
        await seedProduction(ctx)
        // Stored as is: an ordinary save would strip a null or an empty value.
        const home = await entryRow(ctx.site.id, 'posts', 'home')
        await db
          .update(entry)
          .set({
            draftData: { title: 'Home v1', slug: 'home', ...stored },
            publishedData: { title: 'Home v1', slug: 'home', ...stored },
          })
          .where(eq(entry.id, home!.id))
        const devId = await fork(ctx)
        await upsertCollection(
          devId,
          {
            key: 'posts',
            label: 'Articles',
            routePattern: '/posts/$slug',
            fields: postFields.filter((field) => field.key !== 'excerpt'),
          },
          actorId,
        )
        await editEntry(
          devId,
          'posts',
          'home',
          { title: 'Home v2', slug: 'home' },
          actorId,
          { publish: true },
        )
        const homeItem = `entry:${await devEntryId(devId, 'posts', 'home')}`
        expect(
          (await loadPlan(db, devId)).items.find(
            (item) => item.id === homeItem,
          ),
        ).toMatchObject({
          summary: expect.objectContaining({ preservedFields: ['excerpt'] }),
        })

        const pushResult = await push(actorId, devId, {
          exclude: ['schema:posts'],
        })
        const pushed = await entryRow(ctx.site.id, 'posts', 'home')
        expect(pushed?.draftData).toMatchObject({ title: 'Home v2' })
        expect(pushed?.draftData).toHaveProperty(path, value)
        expect(pushed?.publishedData).toMatchObject({
          title: readyMirrors ? 'Home v2' : 'Home v1',
        })
        expect(pushed?.publishedData).toHaveProperty(path, value)
        expect(pushResult.warnings).toHaveLength(readyMirrors ? 0 : 1)
        // The baseline keeps the stored value, so the removal stays listed.
        const devHome = await entryRow(devId, 'posts', 'home')
        expect(devHome?.originBaseline?.data).toHaveProperty(path, value)
        expect(devHome?.originBaseline?.publishedData).toHaveProperty(
          path,
          value,
        )
        // A refused ready mirror stays listed, with the removal.
        expect(
          (await loadPlan(db, devId)).items.map((item) => item.id),
        ).toEqual(readyMirrors ? ['schema:posts'] : ['schema:posts', homeItem])

        // Applying the removal purges the value, so the ready mirror passes and
        // the entry settles.
        await push(actorId, devId, { apply: ['schema:posts'] })
        const applied = await entryRow(ctx.site.id, 'posts', 'home')
        expect(applied?.draftData).toMatchObject({ title: 'Home v2' })
        expect(applied?.publishedData).toMatchObject({ title: 'Home v2' })
        expect((await loadPlan(db, devId)).items).toEqual([])
      })
    },
  )

  it('pushes turning SEO off on a section, and refuses it when production changed the section after planning', async () => {
    await withTestSite(async (ctx) => {
      const actorId = ctx.actor.id
      await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
        fields: globalFields(),
        seoEnabled: true,
      })
      const devId = await fork(ctx)
      await upsertGlobal(
        devId,
        {
          key: 'companyInfo',
          label: 'Company info',
          fields: globalFields(),
          seo: false,
        },
        actorId,
      )
      const section = await entryRow(ctx.site.id, 'companyInfo', '$global')
      const plan = await loadPlan(db, devId)
      expect(
        plan.items.find((item) => item.id === 'schema:companyInfo'),
      ).toMatchObject({
        attention: null,
        affectedEntries: [
          { id: section!.id, contentVersion: section!.contentVersion },
        ],
      })

      // Production adds SEO after the plan: the push must not strip it unseen.
      await updateDraft(
        section!.id,
        { email: 'a@x.test', [SEO_KEY]: { title: 'Added in production' } },
        actorId,
        section!.draftVersion,
      )
      await expect(
        pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: plan.planHash,
            exclude: [],
            apply: [],
            goLive: false,
          },
        ),
      ).rejects.toThrow(PLAN_CHANGED_MESSAGE)
      const kept = await entryRow(ctx.site.id, 'companyInfo', '$global')
      expect(kept?.draftData).toMatchObject({
        [SEO_KEY]: { title: 'Added in production' },
      })

      // A normal SEO-off push goes through and strips the draft's SEO.
      await push(actorId, devId)
      const after = await entryRow(ctx.site.id, 'companyInfo', '$global')
      expect(after?.draftData).not.toHaveProperty(SEO_KEY)
      expect((await loadPlan(db, devId)).items).toEqual([])
    })
  })

  it('pushes a main-language change together with the entries it stamps', async () => {
    await withTestSite(async (ctx) => {
      const actorId = ctx.actor.id
      await setSiteLanguages(
        ctx.site.id,
        { main: 'en', all: ['en', 'nl'] },
        actorId,
      )
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await setSiteLanguages(devId, { main: 'nl', all: ['en', 'nl'] }, actorId)
      // A draft: a ready version is not complete in the new main language yet.
      await editEntry(
        devId,
        'posts',
        'home',
        { title: 'Home dev', slug: 'home', excerpt: 'Intro' },
        actorId,
      )

      const plan = await loadPlan(db, devId)
      expect(plan.items.find((item) => item.id === 'languages')).toMatchObject({
        attention: 'main-language',
      })

      const result = await push(actorId, devId, {
        apply: ['languages'],
      })
      // The stamped ready versions are not complete in the new main language:
      // production keeps its ready versions and says so. Nothing else is refused.
      expect(
        result.warnings.every((warning) =>
          warning.message.startsWith('Ready version not pushed'),
        ),
      ).toBe(true)
      const prod = (
        await db.select().from(site).where(eq(site.id, ctx.site.id)).limit(1)
      ).at(0)
      expect(prod?.languages).toEqual({ main: 'nl', all: ['en', 'nl'] })
      const home = await entryRow(ctx.site.id, 'posts', 'home')
      expect(home?.draftData).toMatchObject({ title: 'Home dev' })
      expect(
        (await loadPlan(db, devId)).items.map((item) => item.id),
      ).not.toContain('languages')
    })
  })

  it('refuses a main-language push when an entry it stamps, not in the push, changed in production after planning', async () => {
    await withTestSite(async (ctx) => {
      const actorId = ctx.actor.id
      await setSiteLanguages(
        ctx.site.id,
        { main: 'en', all: ['en', 'nl'] },
        actorId,
      )
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await setSiteLanguages(devId, { main: 'nl', all: ['en', 'nl'] }, actorId)
      await editEntry(
        devId,
        'posts',
        'home',
        { title: 'Home dev', slug: 'home', excerpt: 'Intro' },
        actorId,
      )
      const homeItem = `entry:${await devEntryId(devId, 'posts', 'home')}`
      const plan = await loadPlan(db, devId)
      // About is not in the plan (dev did not change it), but the stamp rewrites it.
      const about = await entryRow(ctx.site.id, 'posts', 'about')
      expect(
        plan.items.find((item) => item.id === 'languages')?.affectedEntries,
      ).toEqual(
        expect.arrayContaining([
          { id: about!.id, contentVersion: about!.contentVersion },
        ]),
      )

      await editEntry(
        ctx.site.id,
        'posts',
        'about',
        { title: 'About prod', slug: 'about' },
        actorId,
      )

      await expect(
        pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: plan.planHash,
            exclude: [homeItem],
            apply: ['languages'],
            goLive: false,
          },
        ),
      ).rejects.toThrow(PLAN_CHANGED_MESSAGE)
      const prod = (
        await db.select().from(site).where(eq(site.id, ctx.site.id)).limit(1)
      ).at(0)
      expect(prod?.languages).toEqual({ main: 'en', all: ['en', 'nl'] })
      expect(await entryRow(ctx.site.id, 'posts', 'about')).toMatchObject({
        draftData: expect.objectContaining({ title: 'About prod' }),
      })
    })
  })

  it('keeps an entry this push did not write in step with production after a main-language stamp', async () => {
    await withTestSite(async (ctx) => {
      const actorId = ctx.actor.id
      await setSiteLanguages(
        ctx.site.id,
        { main: 'en', all: ['en', 'nl'] },
        actorId,
      )
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await setSiteLanguages(devId, { main: 'nl', all: ['en', 'nl'] }, actorId)
      // About changed in dev, but the push leaves it out.
      await editEntry(
        devId,
        'posts',
        'about',
        { title: 'About dev', slug: 'about' },
        actorId,
      )
      const aboutItem = `entry:${await devEntryId(devId, 'posts', 'about')}`

      await push(actorId, devId, {
        exclude: [aboutItem],
        apply: ['languages'],
      })
      // The stamp moved About's version in production, but that is ours, not a conflict.
      const after = await loadPlan(db, devId)
      expect(after.items.find((item) => item.id === aboutItem)).toMatchObject({
        attention: null,
      })
      expect(after.items.map((item) => item.id)).not.toContain('languages')
      const about = await entryRow(ctx.site.id, 'posts', 'about')
      expect(about?.draftData).toMatchObject({ title: 'About v1' })
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
        { publish: true },
      )
      const plan = await loadPlan(db, devId)
      // Holds the lock only, so nothing else (a row lock) can hold the push back.
      const save = await holdEntryLock(ctx.site.organizationId)
      const attempt = observe(
        pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: plan.planHash,
            exclude: [],
            apply: [],
            goLive: false,
          },
        ),
      )
      expect(await attempt.settledAfterWait()).toBe(false)
      save.release()
      await save.done

      const result = await attempt.outcome
      if (!result.ok) throw new Error(String(result.error))
      expect(result.value.counts.changed).toBe(1)
    })
  })

  it('refuses a localized URL that an entry save took while the push waited', async () => {
    await withTestSite(async (ctx) => {
      const actorId = ctx.actor.id
      await setSiteLanguages(
        ctx.site.id,
        { main: 'en', all: ['en', 'nl'] },
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
      const plan = await loadPlan(db, devId)
      const postsId = await collectionIdOf(ctx.site.id, 'posts')

      // An ordinary save takes the URL and holds the lock until it commits.
      const save = await holdEntryLock(ctx.site.organizationId, async (tx) => {
        await tx.insert(entry).values({
          siteId: ctx.site.id,
          collectionId: postsId,
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
      })
      const attempt = observe(
        pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: plan.planHash,
            exclude: [],
            apply: [],
            goLive: false,
          },
        ),
      )
      expect(await attempt.settledAfterWait()).toBe(false)
      save.release()
      await save.done

      const result = await attempt.outcome
      if (result.ok) throw new Error('the push should have been refused')
      expect((result.error as Error).message).toBe(PLAN_CHANGED_MESSAGE)
      expect(await entryRow(ctx.site.id, 'posts', 'contact')).toBeUndefined()
    })
  })

  it('finishes an entry save that writes its audit row while a push waits for the asset lock', async () => {
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
        { publish: true },
      )
      const plan = await loadPlan(db, devId)
      const home = await entryRow(ctx.site.id, 'posts', 'home')
      const orgId = ctx.site.organizationId

      // An ordinary save takes the asset lock first. The push then takes the
      // organization and site rows and waits for that lock. The save writes its
      // entry and audit row while the push waits: the audit row's foreign keys
      // need KEY SHARE on the organization and site rows. With FOR UPDATE on
      // those rows the two transactions deadlock (40P01); with FOR NO KEY UPDATE
      // both finish.
      const attempt = await db.transaction(async (tx) => {
        await assetAttachLock(tx, orgId)
        const pushed = observe(
          pushDevEnvironment(
            { id: actorId },
            {
              devSiteId: devId,
              planHash: plan.planHash,
              exclude: [],
              apply: [],
              goLive: false,
            },
          ),
        )
        await waitForAdvisoryWaiter(`assets:${orgId}`)
        await tx
          .update(entry)
          .set({
            draftData: { title: 'Home v2', slug: 'home' },
            draftVersion: sql`${entry.draftVersion} + 1`,
            contentVersion: sql`${entry.contentVersion} + 1`,
          })
          .where(eq(entry.id, home!.id))
        await audit(
          {
            organizationId: orgId,
            siteId: ctx.site.id,
            actorId,
            action: 'entry.update',
            targetType: 'entry',
            targetId: home!.id,
          },
          tx,
        )
        return pushed
      })

      const result = await attempt.outcome
      if (!result.ok) throw new Error(String(result.error))
      expect(result.value.counts.changed).toBe(1)
      // The push saw the save as committed: its own plan is empty afterwards,
      // the save's draft is kept, and the push wrote the dev entry it planned.
      expect(await entryRow(ctx.site.id, 'posts', 'home')).toMatchObject({
        draftData: { title: 'Home v2', slug: 'home' },
      })
      expect(await entryRow(ctx.site.id, 'posts', 'about')).toMatchObject({
        publishedData: { title: 'About dev' },
      })
      const audits = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.targetId, home!.id),
            eq(auditLog.action, 'entry.update'),
          ),
        )
      expect(audits).toHaveLength(1)
      expect((await loadPlan(db, devId)).items).toEqual([])
    })
  })

  it('refuses a removal whose affected production entry changed after planning', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await upsertCollection(
        devId,
        {
          key: 'posts',
          label: 'Articles',
          routePattern: '/posts/$slug',
          fields: postFields.filter((field) => field.key !== 'excerpt'),
          confirmDropFields: ['excerpt'],
        },
        actorId,
      )
      const planned = await loadPlan(db, devId)
      await editEntry(
        ctx.site.id,
        'posts',
        'home',
        { title: 'Home prod', slug: 'home', excerpt: 'Intro' },
        actorId,
      )

      expect(
        planned.items.find((item) => item.id === 'schema:posts')
          ?.affectedEntries,
      ).toEqual([
        {
          id: (await entryRow(ctx.site.id, 'posts', 'home'))!.id,
          contentVersion: expect.any(Number),
        },
      ])

      // The push still carries the plan the agency reviewed.
      await expect(
        pushDevEnvironment(
          { id: actorId },
          {
            devSiteId: devId,
            planHash: planned.planHash,
            exclude: [],
            apply: ['schema:posts'],
            goLive: false,
          },
        ),
      ).rejects.toThrow(PLAN_CHANGED_MESSAGE)
      // Refused before any write: production keeps its field and value.
      const home = await entryRow(ctx.site.id, 'posts', 'home')
      expect(home?.draftData).toMatchObject({
        title: 'Home prod',
        excerpt: 'Intro',
      })
    })
  })

  it('disables and archives a collection removed in dev, and keeps its rows', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await deleteCollection(devId, 'posts', actorId)

      const plan = await loadPlan(db, devId)
      expect(
        plan.items.find((item) => item.id === 'schema:posts'),
      ).toMatchObject({
        kind: 'schema.remove',
        attention: 'drops-content',
      })
      const before = await entryRow(ctx.site.id, 'posts', 'home')

      await push(actorId, devId, { apply: ['schema:posts'] })

      const col = (
        await db
          .select()
          .from(collection)
          .where(
            and(
              eq(collection.siteId, ctx.site.id),
              eq(collection.key, 'posts'),
            ),
          )
      ).at(0)
      expect(col?.enabled).toBe(false)
      const after = await entryRow(ctx.site.id, 'posts', 'home')
      expect(after?.status).toBe('archived')
      expect(after?.contentVersion).toBeGreaterThan(before!.contentVersion)
      expect(after?.draftData).toMatchObject({ title: 'Home v1' })

      // Disabled in production is the same as absent in dev: nothing comes back.
      expect((await loadPlan(db, devId)).items).toEqual([])
      expect((await getDevSiteSyncStatus(devId)).productionChanges).toBe(0)
    })
  })

  it('disables and archives a section removed in dev, and keeps its row', async () => {
    await withTestSite(async (ctx) => {
      await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        fields: globalFields(),
      })
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await deleteGlobal(devId, 'companyInfo', actorId)

      const plan = await loadPlan(db, devId)
      expect(
        plan.items.find((item) => item.id === 'schema:companyInfo'),
      ).toMatchObject({
        kind: 'schema.remove',
      })

      await push(actorId, devId, { apply: ['schema:companyInfo'] })

      const section = (
        await db
          .select()
          .from(collection)
          .where(
            and(
              eq(collection.siteId, ctx.site.id),
              eq(collection.key, 'companyInfo'),
            ),
          )
      ).at(0)
      expect(section?.enabled).toBe(false)
      const sectionEntry = await entryRow(ctx.site.id, 'companyInfo', '$global')
      expect(sectionEntry?.status).toBe('archived')
      expect((await loadPlan(db, devId)).items).toEqual([])
      expect((await getDevSiteSyncStatus(devId)).productionChanges).toBe(0)
    })
  })

  it('pushes a new collection that references another new collection, whatever the order', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      await createTestCollection(devId, {
        key: 'zAuthors',
        fields: caseFields,
        routePattern: '/authors/$slug',
      })
      await createTestCollection(devId, {
        key: 'articles',
        fields: [
          ...caseFields,
          {
            key: 'author',
            label: 'Author',
            type: 'reference',
            collection: 'zAuthors',
          },
        ],
        routePattern: '/articles/$slug',
      })

      const plan = await loadPlan(db, devId)
      expect(plan.items.map((item) => item.id)).toEqual([
        'schema:articles',
        'schema:zAuthors',
      ])

      const result = await push(ctx.actor.id, devId)
      expect(result.counts.schema).toBe(2)
      expect(result.warnings).toEqual([])
      const pushed = (
        await db
          .select({ key: collection.key, enabled: collection.enabled })
          .from(collection)
          .where(eq(collection.siteId, ctx.site.id))
      ).filter((row) => row.key === 'articles' || row.key === 'zAuthors')
      expect(pushed).toEqual(
        expect.arrayContaining([
          { key: 'articles', enabled: true },
          { key: 'zAuthors', enabled: true },
        ]),
      )
      expect((await loadPlan(db, devId)).items).toEqual([])
    })
  })

  it('does not list an entry whose only difference is a kept field, and applying the removal leaves the plan empty', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      // The removal alone purges the dev home entry's excerpt: no other change.
      await upsertCollection(
        devId,
        {
          key: 'posts',
          label: 'Articles',
          routePattern: '/posts/$slug',
          fields: postFields.filter((field) => field.key !== 'excerpt'),
          confirmDropFields: ['excerpt'],
        },
        actorId,
      )
      expect((await loadPlan(db, devId)).items.map((item) => item.id)).toEqual([
        'schema:posts',
      ])

      await push(actorId, devId)
      expect((await loadPlan(db, devId)).items.map((item) => item.id)).toEqual([
        'schema:posts',
      ])
      const kept = await entryRow(ctx.site.id, 'posts', 'home')
      expect(kept?.draftData).toMatchObject({ excerpt: 'Intro' })

      await push(actorId, devId, { apply: ['schema:posts'] })
      const applied = await entryRow(ctx.site.id, 'posts', 'home')
      expect(applied?.draftData).not.toHaveProperty('excerpt')
      expect(applied?.publishedData).not.toHaveProperty('excerpt')
      expect((await loadPlan(db, devId)).items).toEqual([])
    })
  })

  it('blocks a removal that would archive a scheduled production entry', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const devId = await fork(ctx)
      const actorId = ctx.actor.id
      await upsertCollection(
        devId,
        {
          key: 'posts',
          label: 'Articles',
          routePattern: '/posts/$slug',
          fields: postFields.filter((field) => field.key !== 'excerpt'),
          confirmDropFields: ['excerpt'],
        },
        actorId,
      )
      const prodHome = await entryRow(ctx.site.id, 'posts', 'home')
      await db
        .update(entry)
        .set({ scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
        .where(eq(entry.id, prodHome!.id))

      const plan = await loadPlan(db, devId)
      expect(
        plan.items.find((item) => item.id === 'schema:posts'),
      ).toMatchObject({
        attention: 'scheduled',
        summary: expect.objectContaining({ scheduledTitles: ['Home v1'] }),
      })

      const result = await push(actorId, devId, { apply: ['schema:posts'] })
      expect(result.written.map((row) => row.itemId)).not.toContain(
        'schema:posts',
      )
      const col = (
        await db
          .select({ fields: collection.fields })
          .from(collection)
          .where(
            and(
              eq(collection.siteId, ctx.site.id),
              eq(collection.key, 'posts'),
            ),
          )
      ).at(0)
      expect(col?.fields.map((field) => field.key)).toContain('excerpt')
    })
  })
})

describe.skipIf(!hasDb)(
  'development environment: push sections and URLs',
  () => {
    it('lists a section made again in dev as a conflict, and overwrites production only when applied', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await createTestGlobal(ctx.site.id, {
          key: 'companyInfo',
          fields: globalFields(),
        })
        const devId = await fork(ctx)
        await deleteGlobal(devId, 'companyInfo', actorId)
        await createTestGlobal(devId, {
          key: 'companyInfo',
          fields: globalFields(),
        })
        const devSection = await entryRow(devId, 'companyInfo', '$global')
        const current = await getEntry(devSection!.id)
        await updateDraft(
          devSection!.id,
          { email: 'dev@example.test' },
          actorId,
          current!.draftVersion,
        )
        const itemId = `entry:${devSection!.id}`

        const plan = await loadPlan(db, devId)
        expect(plan.items.find((item) => item.id === itemId)).toMatchObject({
          attention: 'conflict',
        })

        await push(actorId, devId)
        expect(
          (await entryRow(ctx.site.id, 'companyInfo', '$global'))?.draftData,
        ).not.toHaveProperty('email')

        await push(actorId, devId, { apply: [itemId] })
        expect(
          (await entryRow(ctx.site.id, 'companyInfo', '$global'))?.draftData,
        ).toMatchObject({ email: 'dev@example.test' })
      })
    })

    it('never applies a section made again in dev while production has it scheduled', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await createTestGlobal(ctx.site.id, {
          key: 'companyInfo',
          fields: globalFields(),
        })
        const devId = await fork(ctx)
        await deleteGlobal(devId, 'companyInfo', actorId)
        await createTestGlobal(devId, {
          key: 'companyInfo',
          fields: globalFields(),
        })
        const devSection = await entryRow(devId, 'companyInfo', '$global')
        const current = await getEntry(devSection!.id)
        await updateDraft(
          devSection!.id,
          { email: 'dev@example.test' },
          actorId,
          current!.draftVersion,
        )
        const prodSection = await entryRow(
          ctx.site.id,
          'companyInfo',
          '$global',
        )
        await db
          .update(entry)
          .set({ scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
          .where(eq(entry.id, prodSection!.id))
        const itemId = `entry:${devSection!.id}`

        const plan = await loadPlan(db, devId)
        expect(plan.items.find((item) => item.id === itemId)?.attention).toBe(
          'scheduled',
        )
        const result = await push(actorId, devId, { apply: [itemId] })
        expect(result.written.map((row) => row.itemId)).not.toContain(itemId)
        expect(
          (await entryRow(ctx.site.id, 'companyInfo', '$global'))?.draftData,
        ).not.toHaveProperty('email')
      })
    })

    it('lists a new entry whose URL a production entry already uses as slug-taken, and never applies it', async () => {
      await withTestSite(async (ctx) => {
        await seedProduction(ctx)
        const devId = await fork(ctx)
        const actorId = ctx.actor.id
        await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'posts',
          data: { title: 'Contact page', slug: 'contact' },
          actorId,
        })
        const fresh = await createEntry({
          siteId: devId,
          collectionKey: 'posts',
          data: { title: 'Contact', slug: 'contact' },
          actorId,
        })
        const itemId = `entry:${fresh.id}`

        const plan = await loadPlan(db, devId)
        expect(plan.items.find((item) => item.id === itemId)).toMatchObject({
          attention: 'slug-taken',
          summary: {
            slugCollisions: [{ slug: 'contact', collidesWith: 'Contact page' }],
          },
        })

        const result = await push(actorId, devId, { apply: [itemId] })
        expect(result.written.map((row) => row.itemId)).not.toContain(itemId)
        expect(await entryRow(ctx.site.id, 'posts', 'contact')).toMatchObject({
          draftData: { title: 'Contact page' },
        })
      })
    })

    it('flags a changed entry whose localized URL production uses for another entry, and does not apply it', async () => {
      await withTestSite(async (ctx) => {
        await seedProduction(ctx)
        const devId = await fork(ctx)
        const actorId = ctx.actor.id
        await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'posts',
          data: { title: 'Contact page', slug: 'contact' },
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
        const aboutId = `entry:${await devEntryId(devId, 'posts', 'about')}`

        const plan = await loadPlan(db, devId)
        expect(plan.items.find((item) => item.id === aboutId)).toMatchObject({
          attention: 'slug-taken',
          summary: {
            slugCollisions: [
              { locale: 'nl', slug: 'contact', collidesWith: 'Contact page' },
            ],
          },
        })

        const result = await push(actorId, devId, { apply: [aboutId] })
        expect(result.written.map((row) => row.itemId)).not.toContain(aboutId)
        expect(
          (await entryRow(ctx.site.id, 'posts', 'about'))?.draftData,
        ).toMatchObject({ title: 'About v1' })
      })
    })

    it('refuses a push whose URL collision appeared after the dry run', async () => {
      await withTestSite(async (ctx) => {
        await seedProduction(ctx)
        const devId = await fork(ctx)
        const actorId = ctx.actor.id
        await createEntry({
          siteId: devId,
          collectionKey: 'posts',
          data: { title: 'Fresh', slug: 'fresh' },
          actorId,
        })
        const plan = await loadPlan(db, devId)
        await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'posts',
          data: { title: 'Prod fresh', slug: 'fresh' },
          actorId,
        })

        await expect(
          pushDevEnvironment(
            { id: actorId },
            {
              devSiteId: devId,
              planHash: plan.planHash,
              exclude: [],
              apply: [],
              goLive: false,
            },
          ),
        ).rejects.toThrow(PLAN_CHANGED_MESSAGE)
        expect(
          (await entryRow(ctx.site.id, 'posts', 'fresh'))?.draftData,
        ).toMatchObject({ title: 'Prod fresh' })
      })
    })
  },
)

describe.skipIf(!hasDb)(
  'development environment: push results carry the collection kind',
  () => {
    it('reports a section as a global and an entry as a collection, so the screen links each to its page', async () => {
      await withTestSite(async (ctx) => {
        const actorId = ctx.actor.id
        await seedProduction(ctx)
        await createTestGlobal(ctx.site.id, {
          key: 'companyInfo',
          fields: globalFields(),
        })
        const devId = await fork(ctx)
        const section = await entryRow(devId, 'companyInfo', '$global')
        const current = await getEntry(section!.id)
        await updateDraft(
          section!.id,
          { email: 'hello@example.test' },
          actorId,
          current!.draftVersion,
        )
        await createEntry({
          siteId: devId,
          collectionKey: 'posts',
          data: { title: 'Hello', slug: 'hello' },
          actorId,
        })

        const result = await push(actorId, devId)
        const sectionRow = result.written.find(
          (row) => row.itemId === `entry:${section!.id}`,
        )
        expect(sectionRow).toMatchObject({
          productionId: expect.any(String),
          collectionKind: 'global',
        })
        const entryWritten = result.written.find(
          (row) => row.collectionKind === 'collection',
        )
        expect(entryWritten?.productionId).toEqual(expect.any(String))
      })
    })
  },
)
