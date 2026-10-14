// Assumed API (apps/cms/src/server/content/snapshot.ts):
//   buildSnapshot(siteId) -> { ok: true, snapshot, hash, entryVersions } | { ok: false, errors }
//     snapshot.globals?: Record<rawKey, { id, publishedAt, data, seo? }>  // enabled sections only
//     snapshot.globalSchema?: Record<rawKey, { label, fields, seo?, previewPath? }>
//     hash: with no sections, sha256 of the collections alone (unchanged);
//           with sections, sha256 over { collections, globals }.
//   buildPreviewGlobal(siteId, key) -> { id, publishedAt, data, seo? } | null   (draft data)
//   Blocking error text: `Site content "<label>" has required fields and has never been marked ready.`
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import type { SnapshotEntry } from '#/lib/types'

import {
  createEntry,
  publishEntry,
  scheduleEntry,
  updateDraft,
} from './entries.ts'
import { buildPreviewGlobal, buildSnapshot } from './snapshot.ts'
import {
  createTestCollection,
  createTestGlobal,
  dueScheduleIso,
  globalFields,
  sampleRichText,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((key) => [key, sortedJson(obj[key])]),
    )
  }
  return value
}

function collectionsHash(collections: Record<string, SnapshotEntry[]>) {
  return createHash('sha256')
    .update(JSON.stringify(sortedJson(collections)))
    .digest('hex')
}

async function sectionEntry(globalId: string) {
  const [row] = await db
    .select()
    .from(entry)
    .where(eq(entry.collectionId, globalId))
  if (!row) throw new Error('section entry missing')
  return row
}

describe.skipIf(!hasDb)('buildSnapshot site content', () => {
  it('includes every enabled section keyed by raw key with its published data', async () => {
    await withTestSite(async (ctx) => {
      const { entry: created } = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })
      await updateDraft(
        created.id,
        { email: 'hello@x.test', phone: '+31 20 000' },
        ctx.actor.id,
        created.draftVersion,
      )
      await publishEntry(created.id, ctx.actor.id)

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(Object.keys(result.snapshot.globals ?? {})).toEqual([
        'companyInfo',
      ])
      const section = result.snapshot.globals?.companyInfo
      expect(section).toMatchObject({
        id: created.id,
        publishedAt: expect.any(String),
        data: { email: 'hello@x.test', phone: '+31 20 000' },
      })
      expect(section).not.toHaveProperty('seo')
      expect(section?.data).not.toHaveProperty('$seo')
    })
  })

  it('includes resolved seo only for sections with SEO on', async () => {
    await withTestSite(async (ctx) => {
      const home = await createTestGlobal(ctx.site.id, {
        key: 'homePage',
        label: 'Home page',
        seoEnabled: true,
        previewPath: '/',
        fields: [
          { key: 'headline', label: 'Headline', type: 'text', required: true },
        ],
      })
      await updateDraft(
        home.entry.id,
        { headline: 'Welcome', $seo: { description: 'Home description' } },
        ctx.actor.id,
        home.entry.draftVersion,
      )
      await publishEntry(home.entry.id, ctx.actor.id)

      const info = await createTestGlobal(ctx.site.id, { key: 'companyInfo' })
      await updateDraft(
        info.entry.id,
        { email: 'hello@x.test' },
        ctx.actor.id,
        info.entry.draftVersion,
      )
      await publishEntry(info.entry.id, ctx.actor.id)

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.snapshot.globals?.homePage?.seo).toMatchObject({
        description: 'Home description',
      })
      expect(result.snapshot.globals?.homePage?.data).not.toHaveProperty('$seo')
      expect(result.snapshot.globals?.companyInfo).not.toHaveProperty('seo')
    })
  })

  it('embeds the schema of every enabled section and leaves disabled ones out', async () => {
    await withTestSite(async (ctx) => {
      // Required fields block go live until the section is ready, so mark it ready first.
      const info = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })
      await updateDraft(
        info.entry.id,
        { email: 'hello@x.test' },
        ctx.actor.id,
        info.entry.draftVersion,
      )
      await publishEntry(info.entry.id, ctx.actor.id)
      await createTestGlobal(ctx.site.id, {
        key: 'retired',
        label: 'Retired',
        enabled: false,
        fields: [{ key: 'note', label: 'Note', type: 'text', required: true }],
      })

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(Object.keys(result.snapshot.globalSchema ?? {})).toEqual([
        'companyInfo',
      ])
      expect(result.snapshot.globalSchema?.companyInfo).toMatchObject({
        label: 'Company info',
        fields: globalFields(),
      })
      expect(result.snapshot.globals).not.toHaveProperty('retired')
    })
  })

  it('keeps the hash of a site without sections identical to the collections hash', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Stable',
          slug: `stable-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.snapshot.globals ?? {}).toEqual({})
      expect(result.hash).toBe(collectionsHash(result.snapshot.collections))
    })
  })

  it('changes the hash when section data changes, and differs from the collections-only hash', async () => {
    await withTestSite(async (ctx) => {
      const site = await createTestGlobal(ctx.site.id, { key: 'companyInfo' })
      await updateDraft(
        site.entry.id,
        { email: 'first@x.test' },
        ctx.actor.id,
        site.entry.draftVersion,
      )
      await publishEntry(site.entry.id, ctx.actor.id)

      const first = await buildSnapshot(ctx.site.id)
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.hash).not.toBe(collectionsHash(first.snapshot.collections))

      const current = await sectionEntry(site.collection.id)
      await updateDraft(
        site.entry.id,
        { email: 'second@x.test' },
        ctx.actor.id,
        current.draftVersion,
      )
      await publishEntry(site.entry.id, ctx.actor.id)

      const second = await buildSnapshot(ctx.site.id)
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.hash).not.toBe(first.hash)
      expect(second.snapshot.globals?.companyInfo?.data).toMatchObject({
        email: 'second@x.test',
      })
    })
  })

  it('blocks go live while a section with required fields was never marked ready', async () => {
    await withTestSite(async (ctx) => {
      await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors.join('\n')).toContain(
        'Site content "Company info" has required fields and has never been marked ready.',
      )
    })
  })

  it('ships empty data for a section without required fields until its first ready', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'aboutText',
        label: 'About text',
        fields: [{ key: 'tagline', label: 'Tagline', type: 'text' }],
      })

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.snapshot.globals?.aboutText).toMatchObject({
        id: section.entry.id,
        publishedAt: null,
        data: {},
      })
    })
  })

  it('ships scheduled data once the schedule is due, and published data until then', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
      })
      await updateDraft(
        section.entry.id,
        { email: 'old@x.test' },
        ctx.actor.id,
        1,
      )
      await publishEntry(section.entry.id, ctx.actor.id)
      const readyRow = await sectionEntry(section.collection.id)
      await updateDraft(
        section.entry.id,
        { email: 'new@x.test' },
        ctx.actor.id,
        readyRow.draftVersion,
      )
      await scheduleEntry(
        section.entry.id,
        dueScheduleIso(),
        'UTC',
        ctx.actor.id,
      )

      const due = await buildSnapshot(ctx.site.id)
      expect(due.ok).toBe(true)
      if (!due.ok) return
      expect(due.snapshot.globals?.companyInfo?.data).toMatchObject({
        email: 'new@x.test',
      })
    })
  })

  it('keeps published data while a section is scheduled for later', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
      })
      await updateDraft(
        section.entry.id,
        { email: 'old@x.test' },
        ctx.actor.id,
        1,
      )
      await publishEntry(section.entry.id, ctx.actor.id)
      const published = await sectionEntry(section.collection.id)
      await updateDraft(
        section.entry.id,
        { email: 'later@x.test' },
        ctx.actor.id,
        published.draftVersion,
      )
      await scheduleEntry(
        section.entry.id,
        new Date(Date.now() + 86_400_000).toISOString(),
        'UTC',
        ctx.actor.id,
      )

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.snapshot.globals?.companyInfo?.data).toMatchObject({
        email: 'old@x.test',
      })
    })
  })

  it('previews the draft of a section by key, and returns null for an unknown key', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
      })
      await updateDraft(
        section.entry.id,
        { email: 'draft@x.test' },
        ctx.actor.id,
        section.entry.draftVersion,
      )

      await expect(
        buildPreviewGlobal(ctx.site.id, 'companyInfo'),
      ).resolves.toMatchObject({
        id: section.entry.id,
        data: { email: 'draft@x.test' },
      })
      await expect(
        buildPreviewGlobal(ctx.site.id, 'missing'),
      ).resolves.toBeNull()
    })
  })

  it('refuses to preview a disabled section, even one with a draft', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        enabled: false,
      })
      await updateDraft(
        section.entry.id,
        { email: 'hidden@x.test' },
        ctx.actor.id,
        section.entry.draftVersion,
      )

      await expect(
        buildPreviewGlobal(ctx.site.id, 'companyInfo'),
      ).resolves.toBeNull()
    })
  })
})
