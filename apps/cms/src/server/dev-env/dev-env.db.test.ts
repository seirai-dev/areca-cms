import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  collection,
  entry,
  entryRevision,
  environmentPush,
  site,
} from '#/db/schema'
import type { Field } from '#/lib/types'
import { deleteSite } from '#/server/admin/sites'
import { assetMutationLock } from '#/server/assets/usage'
import { getSitesSnapshotCurrent } from '#/routes/api/sites/snapshot/current'
import {
  createEntry,
  deleteEntry,
  getEntry,
  publishEntry,
  updateDraft,
} from '#/server/content/entries'
import { ConflictError } from '#/server/content/errors'
import {
  cleanupTestSite,
  createTestCollection,
  createTestGlobal,
  createTestSite,
  observe,
  waitForAdvisoryWaiter,
  withTestSite,
} from '#/server/content/test-utils'
import { authenticateSite } from '#/server/content/site-auth'

import { deleteDevEnvironment } from './delete'
import { forkDevEnvironment } from './fork'
import { refreshDevEnvironment } from './refresh'
import { getDevEnvironmentStatus } from './status'

const hasDb = Boolean(process.env.DATABASE_URL)

const articleFields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
]

const sectionFields: Field[] = [
  { key: 'email', label: 'Email', type: 'text', required: true },
]

const optionalSectionFields: Field[] = [
  { key: 'note', label: 'Note', type: 'text' },
]

function bearer(path: string, token: string) {
  return new Request(`http://localhost:3000${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

/**
 * A production site with: a ready entry, a ready entry with a newer unpublished
 * draft, a draft-only entry, an archived entry, a disabled collection, a ready
 * section, and a never-ready optional section.
 */
async function seedProduction(ctx: Awaited<ReturnType<typeof createTestSite>>) {
  const actor = { id: ctx.actor.id }
  await createTestCollection(ctx.site.id, {
    key: 'articles',
    fields: articleFields,
    routePattern: '/blog/$slug',
  })
  await createTestCollection(ctx.site.id, {
    key: 'legacy',
    fields: articleFields,
    routePattern: '/legacy/$slug',
  })
  await db
    .update(collection)
    .set({ enabled: false })
    .where(
      and(eq(collection.siteId, ctx.site.id), eq(collection.key, 'legacy')),
    )

  const ready = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: { title: 'Ready v1', slug: 'ready' },
    actorId: actor.id,
  })
  await publishEntry(ready.id, actor.id)

  const edited = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: { title: 'Edited v1', slug: 'edited' },
    actorId: actor.id,
  })
  await publishEntry(edited.id, actor.id)
  const editedNow = await getEntry(edited.id)
  await updateDraft(
    edited.id,
    { title: 'Edited draft', slug: 'edited' },
    actor.id,
    editedNow!.draftVersion,
  )

  await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: { title: 'Draft only', slug: 'draft-only' },
    actorId: actor.id,
  })

  const archived = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: { title: 'Archived', slug: 'archived' },
    actorId: actor.id,
  })
  await publishEntry(archived.id, actor.id)
  await db
    .update(entry)
    .set({ status: 'archived' })
    .where(eq(entry.id, archived.id))

  const company = await createTestGlobal(ctx.site.id, {
    key: 'companyInfo',
    fields: sectionFields,
  })
  await db
    .update(entry)
    .set({
      status: 'published',
      publishedData: { email: 'hello@example.test' },
      publishedSlug: '$global',
    })
    .where(eq(entry.id, company.entry.id))

  await createTestGlobal(ctx.site.id, {
    key: 'footer',
    fields: optionalSectionFields,
  })

  return { readyId: ready.id, editedId: edited.id, archivedId: archived.id }
}

async function devEntries(devSiteId: string) {
  return db
    .select({
      slug: entry.slug,
      status: entry.status,
      draftData: entry.draftData,
      publishedData: entry.publishedData,
      publishedSlug: entry.publishedSlug,
      contentVersion: entry.contentVersion,
      originEntryId: entry.originEntryId,
      originContentVersion: entry.originContentVersion,
      originBaseline: entry.originBaseline,
      collectionKey: collection.key,
      id: entry.id,
    })
    .from(entry)
    .innerJoin(collection, eq(collection.id, entry.collectionId))
    .where(eq(entry.siteId, devSiteId))
}

async function devSiteRow(id: string) {
  return (await db.select().from(site).where(eq(site.id, id)).limit(1)).at(0)
}

describe.skipIf(!hasDb)('development environment: fork', () => {
  it('copies enabled and disabled collections and sections with their columns', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      await db
        .update(site)
        .set({
          languages: { main: 'en', all: ['en', 'nl'] },
          aiPrompt: 'Write briefly.',
        })
        .where(eq(site.id, ctx.site.id))

      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
      const dev = await devSiteRow(fork.id)
      expect(dev).toBeDefined()
      expect(dev!.environment).toBe('development')
      expect(dev!.parentSiteId).toBe(ctx.site.id)
      expect(dev!.publishingMode).toBe('demo')
      expect(dev!.deploymentTarget).toBeNull()
      expect(dev!.productionUrl).toBe('http://localhost:3000')
      expect(dev!.languages).toEqual({ main: 'en', all: ['en', 'nl'] })
      expect(dev!.aiPrompt).toBe('Write briefly.')
      expect(dev!.lastForkedAt).not.toBeNull()
      expect(fork.slug).toBe(`${ctx.site.slug}-dev`)

      const devCollections = await db
        .select()
        .from(collection)
        .where(eq(collection.siteId, fork.id))
      expect(devCollections.map((c) => c.key).sort()).toEqual([
        'articles',
        'companyInfo',
        'footer',
        'legacy',
      ])
      const legacy = devCollections.find((c) => c.key === 'legacy')
      expect(legacy?.enabled).toBe(false)
      const company = devCollections.find((c) => c.key === 'companyInfo')
      expect(company?.kind).toBe('global')
      expect(company?.fields).toEqual(sectionFields)

      expect(dev!.schemaBaseline?.collections.map((c) => c.key).sort()).toEqual(
        ['articles', 'companyInfo', 'footer', 'legacy'],
      )
      expect(dev!.schemaBaseline?.languages).toEqual({
        main: 'en',
        all: ['en', 'nl'],
      })
    })
  })

  it('copies only ready content, sets origin fields, and writes one fork revision each', async () => {
    await withTestSite(async (ctx) => {
      const ids = await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
      const rows = await devEntries(fork.id)

      const articles = rows
        .filter((row) => row.collectionKey === 'articles')
        .map((row) => row.slug)
        .sort()
      expect(articles).toEqual(['edited', 'ready'])
      expect(rows.some((row) => row.slug === 'draft-only')).toBe(false)
      expect(rows.some((row) => row.slug === 'archived')).toBe(false)

      const edited = rows.find((row) => row.slug === 'edited')!
      expect(edited.status).toBe('published')
      expect(edited.publishedData).toEqual({
        title: 'Edited v1',
        slug: 'edited',
      })
      // The unpublished production draft is not copied.
      expect(edited.draftData).toEqual({ title: 'Edited v1', slug: 'edited' })
      expect(edited.contentVersion).toBe(1)
      expect(edited.originEntryId).toBe(ids.editedId)
      const prodEdited = await getEntry(ids.editedId)
      expect(edited.originContentVersion).toBe(prodEdited!.contentVersion)
      expect(edited.originBaseline).toEqual({
        slug: 'edited',
        data: { title: 'Edited v1', slug: 'edited' },
        publishedSlug: 'edited',
        publishedData: { title: 'Edited v1', slug: 'edited' },
        status: 'published',
      })

      const revisions = await db
        .select({ note: entryRevision.note, kind: entryRevision.kind })
        .from(entryRevision)
        .where(eq(entryRevision.entryId, edited.id))
      expect(revisions).toEqual([{ note: 'fork', kind: 'milestone' }])

      const sections = rows.filter((row) => row.collectionKey !== 'articles')
      const companyRow = sections.find(
        (row) => row.collectionKey === 'companyInfo',
      )!
      expect(companyRow.status).toBe('published')
      expect(companyRow.draftData).toEqual({ email: 'hello@example.test' })
      const footerRow = sections.find((row) => row.collectionKey === 'footer')!
      expect(footerRow.status).toBe('draft')
      expect(footerRow.draftData).toEqual({})
      expect(footerRow.publishedData).toBeNull()
    })
  })

  it('issues site, schema and preview credentials that work', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)

      const byBuild = await authenticateSite(
        bearer('/api/sites/snapshot/current', fork.token),
      )
      expect(byBuild?.id).toBe(fork.id)
      const bySchema = await authenticateSite(
        bearer('/api/sites/manifest', fork.schemaToken),
        'schema',
      )
      expect(bySchema?.id).toBe(fork.id)
      expect(fork.previewSecret).toMatch(/^[0-9a-f]{64}$/)
      // The production token does not open the dev env, and vice versa.
      const productionByDevToken = await authenticateSite(
        bearer('/api/sites/snapshot/current', ctx.token),
      )
      expect(productionByDevToken?.id).toBe(ctx.site.id)
    })
  })

  it('refuses a second fork and a fork of a dev env', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
      await expect(
        forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id),
      ).rejects.toBeInstanceOf(ConflictError)
      await expect(
        forkDevEnvironment({ id: ctx.actor.id }, fork.id),
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })

  it('takes the next free slug when <slug>-dev is taken', async () => {
    await withTestSite(async (ctx) => {
      const other = await createTestSite()
      try {
        await db
          .update(site)
          .set({ slug: `${ctx.site.slug}-dev` })
          .where(eq(site.id, other.site.id))
        const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
        expect(fork.slug).toBe(`${ctx.site.slug}-dev-2`)
      } finally {
        await cleanupTestSite(other)
      }
    })
  })

  it('records the fork in the push history and the audit log', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
      const status = await getDevEnvironmentStatus(ctx.site.id)
      expect(status?.id).toBe(fork.id)
      expect(status?.history[0]).toMatchObject({
        kind: 'fork',
        counts: { collections: 2, sections: 2, entries: 2 },
      })
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.siteId, ctx.site.id),
            eq(auditLog.action, 'dev_env.fork'),
          ),
        )
      expect(audit.targetId).toBe(fork.id)
    })
  })
})

describe.skipIf(!hasDb)(
  'development environment: reset from production',
  () => {
    it('replaces dev content and keeps tokens, name and preview URL', async () => {
      await withTestSite(async (ctx) => {
        await seedProduction(ctx)
        const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
        await db
          .update(site)
          .set({ name: 'Renamed dev', productionUrl: 'http://localhost:4000' })
          .where(eq(site.id, fork.id))
        const before = await devSiteRow(fork.id)

        // Dev-only work, and a production change after the fork.
        await createEntry({
          siteId: fork.id,
          collectionKey: 'articles',
          data: { title: 'Dev only', slug: 'dev-only' },
          actorId: ctx.actor.id,
        })
        await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: { title: 'Later', slug: 'later' },
          actorId: ctx.actor.id,
        }).then((created) => publishEntry(created.id, ctx.actor.id))

        const result = await refreshDevEnvironment(
          { id: ctx.actor.id },
          fork.id,
        )
        // Two articles and two sections forked, plus the dev-only entry.
        expect(result.discardedEntries).toBe(5)

        const rows = await devEntries(fork.id)
        const slugs = rows
          .filter((row) => row.collectionKey === 'articles')
          .map((row) => row.slug)
          .sort()
        expect(slugs).toEqual(['edited', 'later', 'ready'])

        const after = await devSiteRow(fork.id)
        expect(after!.name).toBe('Renamed dev')
        expect(after!.productionUrl).toBe('http://localhost:4000')
        expect(after!.tokenHash).toBe(before!.tokenHash)
        expect(after!.previewSecret).toBe(before!.previewSecret)
        expect(after!.lastForkedAt!.getTime()).toBeGreaterThanOrEqual(
          before!.lastForkedAt!.getTime(),
        )

        const pushes = await db
          .select({ kind: environmentPush.kind })
          .from(environmentPush)
          .where(eq(environmentPush.productionSiteId, ctx.site.id))
        expect(pushes.map((p) => p.kind).sort()).toEqual(['fork', 'refresh'])
      })
    })

    it('waits for a dev entry save that holds the asset lock, then resets without a deadlock', async () => {
      await withTestSite(async (ctx) => {
        await seedProduction(ctx)
        const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
        const actorId = ctx.actor.id
        const orgId = ctx.site.organizationId
        const devReady = (await devEntries(fork.id)).find(
          (row) => row.slug === 'ready',
        )!

        // An ordinary dev save: the asset lock first, then the entry row, then
        // its autosave revision. The reset starts while the save is paused.
        const attempt = await db.transaction(async (tx) => {
          await assetMutationLock(tx, orgId)
          await tx
            .update(entry)
            .set({
              draftData: { title: 'Ready dev', slug: 'ready' },
              draftVersion: sql`${entry.draftVersion} + 1`,
              contentVersion: sql`${entry.contentVersion} + 1`,
              updatedBy: actorId,
            })
            .where(eq(entry.id, devReady.id))
          const reset = observe(
            refreshDevEnvironment({ id: actorId }, fork.id),
          )
          // The reset must queue behind the save, before it deletes anything.
          await waitForAdvisoryWaiter(`assets:${orgId}`)
          await tx
            .update(entryRevision)
            .set({ data: { title: 'Ready dev', slug: 'ready' } })
            .where(eq(entryRevision.entryId, devReady.id))
          return reset
        })

        const result = await attempt.outcome
        if (!result.ok) throw new Error(String(result.error))
        expect(result.value.discardedEntries).toBeGreaterThan(0)

        const rows = await devEntries(fork.id)
        const readyAfter = rows.find((row) => row.slug === 'ready')
        expect(readyAfter?.publishedData).toMatchObject({ title: 'Ready v1' })
        expect(readyAfter?.draftData).not.toMatchObject({ title: 'Ready dev' })
      })
    })
  },
)

describe.skipIf(!hasDb)('development environment: delete', () => {
  it('removes the dev env, its entries, collections and revisions', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)

      await deleteDevEnvironment({ id: ctx.actor.id }, fork.id)

      expect(await devSiteRow(fork.id)).toBeUndefined()
      expect(await devEntries(fork.id)).toEqual([])
      const leftover = await db
        .select({ id: collection.id })
        .from(collection)
        .where(eq(collection.siteId, fork.id))
      expect(leftover).toEqual([])
      const revisions = await db
        .select({ id: entryRevision.id })
        .from(entryRevision)
        .innerJoin(entry, eq(entry.id, entryRevision.entryId))
        .where(eq(entry.siteId, fork.id))
      expect(revisions).toEqual([])
      expect(await getDevEnvironmentStatus(ctx.site.id)).toBeNull()

      const [audit] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.siteId, ctx.site.id),
            eq(auditLog.action, 'dev_env.delete'),
          ),
        )
      expect(audit).toBeDefined()
      // The production site is untouched.
      expect((await devEntries(ctx.site.id)).length).toBeGreaterThan(0)
    })
  })

  it('waits for a dev entry save that holds the asset lock, then deletes without a deadlock', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
      const actorId = ctx.actor.id
      const orgId = ctx.site.organizationId
      const devReady = (await devEntries(fork.id)).find(
        (row) => row.slug === 'ready',
      )!

      const attempt = await db.transaction(async (tx) => {
        await assetMutationLock(tx, orgId)
        await tx
          .update(entry)
          .set({
            draftData: { title: 'Ready dev', slug: 'ready' },
            draftVersion: sql`${entry.draftVersion} + 1`,
            contentVersion: sql`${entry.contentVersion} + 1`,
            updatedBy: actorId,
          })
          .where(eq(entry.id, devReady.id))
        const deletion = observe(deleteDevEnvironment({ id: actorId }, fork.id))
        await waitForAdvisoryWaiter(`assets:${orgId}`)
        await tx
          .update(entryRevision)
          .set({ data: { title: 'Ready dev', slug: 'ready' } })
          .where(eq(entryRevision.entryId, devReady.id))
        return deletion
      })

      const result = await attempt.outcome
      if (!result.ok) throw new Error(String(result.error))
      expect(await devSiteRow(fork.id)).toBeUndefined()
      expect(await devEntries(fork.id)).toEqual([])
    })
  })

  it('deletes the dev env when its production site is deleted', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)

      await deleteSite(ctx.site.id, ctx.actor.id)

      expect(await devSiteRow(ctx.site.id)).toBeUndefined()
      expect(await devSiteRow(fork.id)).toBeUndefined()
      expect(await devEntries(fork.id)).toEqual([])
    })
  })

  it('archives a forked dev entry on delete, and deletes a dev-created one', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
      const rows = await devEntries(fork.id)
      const forked = rows.find((row) => row.slug === 'ready')!
      const before = forked.contentVersion

      await deleteEntry(forked.id, ctx.actor.id)
      const archived = await getEntry(forked.id)
      expect(archived?.status).toBe('archived')
      expect(archived?.contentVersion).toBe(before + 1)
      expect(archived?.originEntryId).toBe(forked.originEntryId)

      const created = await createEntry({
        siteId: fork.id,
        collectionKey: 'articles',
        data: { title: 'Dev made', slug: 'dev-made' },
        actorId: ctx.actor.id,
      })
      await deleteEntry(created.id, ctx.actor.id)
      expect(await getEntry(created.id)).toBeNull()
    })
  })
})

describe.skipIf(!hasDb)('development environment: live pull', () => {
  it('serves the ready dev content with publicationId null', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
      // A dev-only change that is ready in dev appears in the pull.
      const devOnly = await createEntry({
        siteId: fork.id,
        collectionKey: 'articles',
        data: { title: 'Dev ready', slug: 'dev-ready' },
        actorId: ctx.actor.id,
      })
      await publishEntry(devOnly.id, ctx.actor.id)

      const response = await getSitesSnapshotCurrent(
        bearer('/api/sites/snapshot/current', fork.token),
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        publicationId: string | null
        collections: Record<string, { slug: string; title: string }[]>
        globals?: Record<string, unknown>
      }
      expect(body.publicationId).toBeNull()
      const slugs = body.collections.articles.map((item) => item.slug).sort()
      expect(slugs).toEqual(['dev-ready', 'edited', 'ready'])
      expect(body.collections.legacy).toBeUndefined()
      expect(Object.keys(body.globals ?? {})).toContain('companyInfo')
    })
  })

  it('refuses a pinned publication with 400', async () => {
    await withTestSite(async (ctx) => {
      await seedProduction(ctx)
      const fork = await forkDevEnvironment({ id: ctx.actor.id }, ctx.site.id)
      const response = await getSitesSnapshotCurrent(
        bearer('/api/sites/snapshot/current?publicationId=abc123', fork.token),
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error:
          'Development environments have no releases. Pull without a publication id.',
      })
    })
  })
})
