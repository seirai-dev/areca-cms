import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { site } from '#/db/schema'
import type { Field } from '#/lib/types'

import {
  archiveEntry,
  cancelSchedule,
  createEntry,
  getEntry,
  listRevisions,
  publishEntry,
  restoreRevision,
  scheduleEntry,
  unpublishEntry,
  updateDraft,
} from './entries'
import { discardGlobalDraft, getGlobalEntry, upsertGlobal } from './globals'
import { createTestCollection, globalFields, withTestSite } from './test-utils'

const hasDb = Boolean(process.env.DATABASE_URL)

const basic: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
]

const future = () => new Date(Date.now() + 86_400_000).toISOString()

async function contentVersionOf(id: string) {
  const row = await getEntry(id)
  if (!row) throw new Error('entry missing')
  return row.contentVersion
}

/** Asserts that `run` bumps the entry's content_version by exactly one. */
async function expectBump(id: string, run: () => Promise<unknown>) {
  const before = await contentVersionOf(id)
  await run()
  expect(await contentVersionOf(id)).toBe(before + 1)
}

describe.skipIf(!hasDb)('entry content_version', () => {
  it('starts at 1 on create', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { fields: basic })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'A', slug: 'a' },
        actorId: ctx.actor.id,
      })
      expect(await contentVersionOf(created.id)).toBe(1)
    })
  })

  it('bumps on draft update', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { fields: basic })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'A', slug: 'a' },
        actorId: ctx.actor.id,
      })
      const current = await getEntry(created.id)
      await expectBump(created.id, () =>
        updateDraft(
          created.id,
          { title: 'B', slug: 'b' },
          ctx.actor.id,
          current!.draftVersion,
        ),
      )
    })
  })

  it('bumps on publish, unpublish and archive', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { fields: basic })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'A', slug: 'a' },
        actorId: ctx.actor.id,
      })
      await expectBump(created.id, () => publishEntry(created.id, ctx.actor.id))
      await expectBump(created.id, () =>
        unpublishEntry(created.id, ctx.actor.id),
      )
      await expectBump(created.id, () => archiveEntry(created.id, ctx.actor.id))
    })
  })

  it('bumps on schedule and cancel schedule', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { fields: basic })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'A', slug: 'a' },
        actorId: ctx.actor.id,
      })
      await expectBump(created.id, () =>
        scheduleEntry(created.id, future(), 'UTC', ctx.actor.id),
      )
      await expectBump(created.id, () =>
        cancelSchedule(created.id, ctx.actor.id),
      )
    })
  })

  it('bumps on restore revision', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id, { fields: basic })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'A', slug: 'a' },
        actorId: ctx.actor.id,
      })
      const edited = await updateDraft(
        created.id,
        { title: 'B', slug: 'b' },
        ctx.actor.id,
        (await getEntry(created.id))!.draftVersion,
      )
      const { items } = await listRevisions(created.id)
      const oldest = items.at(-1)
      expect(oldest).toBeDefined()
      await expectBump(created.id, () =>
        restoreRevision(
          created.id,
          oldest!.id,
          ctx.actor.id,
          edited.draftVersion,
        ),
      )
    })
  })

  it('bumps on a site content section update', async () => {
    await withTestSite(async (ctx) => {
      await upsertGlobal(
        ctx.site.id,
        { key: 'companyInfo', label: 'Company info', fields: globalFields() },
        ctx.actor.id,
      )
      const section = await getGlobalEntry(ctx.site.id, 'companyInfo')
      const row = section!.entry
      await expectBump(row.id, () =>
        updateDraft(
          row.id,
          { email: 'info@example.test' },
          ctx.actor.id,
          row.draftVersion,
        ),
      )
    })
  })

  it('bumps on discard of a section draft', async () => {
    await withTestSite(async (ctx) => {
      await upsertGlobal(
        ctx.site.id,
        { key: 'companyInfo', label: 'Company info', fields: globalFields() },
        ctx.actor.id,
      )
      const section = await getGlobalEntry(ctx.site.id, 'companyInfo')
      const row = section!.entry
      await updateDraft(
        row.id,
        { email: 'ready@example.test' },
        ctx.actor.id,
        row.draftVersion,
      )
      await publishEntry(row.id, ctx.actor.id)
      await updateDraft(
        row.id,
        { email: 'draft@example.test' },
        ctx.actor.id,
        (await getEntry(row.id))!.draftVersion,
      )
      await expectBump(row.id, () =>
        discardGlobalDraft(ctx.site.id, 'companyInfo', ctx.actor.id),
      )
    })
  })
})

async function expectConstraint(
  run: () => Promise<unknown>,
  constraint: string | RegExp,
) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).not.toBeNull()
  const cause = (error as { cause?: { constraint?: string } }).cause
  const reported = cause?.constraint ?? String(error)
  if (typeof constraint === 'string') {
    expect(reported).toContain(constraint)
  } else {
    expect(reported).toMatch(constraint)
  }
}

describe.skipIf(!hasDb)('development environment site constraints', () => {
  it('refuses a development site without a parent, a production mode, or a deployment target', async () => {
    await withTestSite(async (ctx) => {
      const base = {
        organizationId: ctx.org.id,
        tokenHash: crypto.randomUUID(),
        previewSecret: crypto.randomUUID(),
        productionUrl: 'http://localhost:3000',
      }
      const insertSite = (values: Partial<typeof site.$inferInsert>) => {
        const suffix = crypto.randomUUID()
        return db
          .insert(site)
          .values({
            ...base,
            tokenHash: crypto.randomUUID(),
            name: `Dev ${suffix}`,
            slug: `dev-${suffix}`,
            ...values,
          })
          .returning()
      }

      await expectConstraint(
        () =>
          insertSite({ environment: 'development', publishingMode: 'demo' }),
        // A development site without a parent breaks both checks.
        /site_environment_(parent|production)_check/,
      )
      await expectConstraint(
        () =>
          insertSite({
            environment: 'development',
            parentSiteId: ctx.site.id,
            publishingMode: 'production',
          }),
        'site_environment_production_check',
      )
      await expectConstraint(
        () =>
          insertSite({
            environment: 'development',
            parentSiteId: ctx.site.id,
            publishingMode: 'demo',
            deploymentTarget: {
              provider: 'dokploy',
              applicationId: 'app-1',
              healthCheckUrl: 'https://example.test/health',
            },
          }),
        'site_environment_production_check',
      )
      await expectConstraint(
        () =>
          insertSite({ environment: 'production', parentSiteId: ctx.site.id }),
        'site_environment_parent_check',
      )
    })
  })

  it('accepts one demo development site per production site', async () => {
    await withTestSite(async (ctx) => {
      const base = {
        organizationId: ctx.org.id,
        previewSecret: crypto.randomUUID(),
        productionUrl: 'http://localhost:3000',
        environment: 'development' as const,
        parentSiteId: ctx.site.id,
        publishingMode: 'demo' as const,
      }
      const suffix = crypto.randomUUID()
      const [dev] = await db
        .insert(site)
        .values({
          ...base,
          tokenHash: crypto.randomUUID(),
          name: `Dev ${suffix}`,
          slug: `dev-${suffix}`,
        })
        .returning()
      expect(dev.environment).toBe('development')

      await expectConstraint(
        () =>
          db.insert(site).values({
            ...base,
            tokenHash: crypto.randomUUID(),
            name: `Dev two ${suffix}`,
            slug: `dev-two-${suffix}`,
          }),
        'site_parent_site_id_unique',
      )
    })
  })
})
