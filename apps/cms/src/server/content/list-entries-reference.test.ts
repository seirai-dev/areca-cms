import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import type { EntryData, EntryStatus } from '#/lib/types'
import { listEntries } from './entries.ts'
import { createTestCollection, withTestSite } from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

function data(slug: string, title: string): EntryData {
  return { title, slug, excerpt: '', body: { type: 'doc', content: [] } }
}

async function insertEntry(input: {
  siteId: string
  collectionId: string
  slug: string
  status: EntryStatus
  draftData: EntryData
  publishedData?: EntryData | null
  publishedSlug?: string | null
  scheduledAt?: Date | null
  scheduledData?: EntryData | null
}) {
  const [row] = await db
    .insert(entry)
    .values({
      siteId: input.siteId,
      collectionId: input.collectionId,
      slug: input.slug,
      status: input.status,
      draftData: input.draftData,
      publishedData: input.publishedData ?? null,
      publishedSlug: input.publishedSlug ?? null,
      scheduledAt: input.scheduledAt ?? null,
      scheduledData: input.scheduledData ?? null,
    })
    .returning()
  if (!row) throw new Error('Failed to insert entry')
  return row
}

describe.skipIf(!hasDb)('listEntries referenceTargets', () => {
  it('includes approved targets and excludes scheduled targets without an approved version', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      const due = new Date(Date.now() - 60_000)
      const future = new Date(Date.now() + 86_400_000)

      const draft = await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: `draft-${ctx.suffix}`,
        status: 'draft',
        draftData: data(`draft-${ctx.suffix}`, 'Draft'),
      })
      const archived = await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: `archived-${ctx.suffix}`,
        status: 'archived',
        draftData: data(`archived-${ctx.suffix}`, 'Archived'),
      })
      const published = await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: `published-${ctx.suffix}`,
        status: 'published',
        draftData: data(`published-${ctx.suffix}`, 'Published'),
        publishedData: data(`published-${ctx.suffix}`, 'Published'),
        publishedSlug: `published-${ctx.suffix}`,
      })
      const scheduledLive = await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: `sched-live-${ctx.suffix}`,
        status: 'scheduled',
        draftData: data(`sched-live-${ctx.suffix}`, 'Scheduled live'),
        publishedData: data(`sched-live-${ctx.suffix}`, 'Scheduled live'),
        publishedSlug: `sched-live-${ctx.suffix}`,
        scheduledAt: future,
        scheduledData: data(`sched-live-${ctx.suffix}`, 'Scheduled live later'),
      })
      const scheduledFuture = await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: `sched-future-${ctx.suffix}`,
        status: 'scheduled',
        draftData: data(`sched-future-${ctx.suffix}`, 'Scheduled future'),
        scheduledAt: future,
        scheduledData: data(`sched-future-${ctx.suffix}`, 'Scheduled future'),
      })
      const scheduledDue = await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: `sched-due-${ctx.suffix}`,
        status: 'scheduled',
        draftData: data(`sched-due-${ctx.suffix}`, 'Scheduled due'),
        scheduledAt: due,
        scheduledData: data(`sched-due-${ctx.suffix}`, 'Scheduled due'),
      })

      const result = await listEntries(ctx.site.id, 'articles', {
        referenceTargets: true,
        limit: 50,
        offset: 0,
      })
      const ids = result.items.map((item) => item.id)

      expect(ids).toContain(published.id)
      expect(ids).toContain(scheduledLive.id)
      expect(ids).not.toContain(scheduledDue.id)
      expect(ids).not.toContain(draft.id)
      expect(ids).not.toContain(archived.id)
      expect(ids).not.toContain(scheduledFuture.id)
      expect(
        result.items.every(
          (item) => item.status === 'published' || item.status === 'scheduled',
        ),
      ).toBe(true)
      expect(result.total).toBe(2)
    })
  })

  it('pages reference targets: first 50 then the rest at offset 50', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      const rows = Array.from({ length: 51 }, (_, i) => {
        const slug = `pub-${String(i).padStart(2, '0')}-${ctx.suffix}`
        return {
          siteId: ctx.site.id,
          collectionId: col.id,
          slug,
          status: 'published' as const,
          draftData: data(slug, `Pub ${i}`),
          publishedData: data(slug, `Pub ${i}`),
          publishedSlug: slug,
        }
      })
      await db.insert(entry).values(rows)

      const first = await listEntries(ctx.site.id, 'articles', {
        referenceTargets: true,
        limit: 50,
        offset: 0,
      })
      expect(first.items).toHaveLength(50)
      expect(first.total).toBe(51)

      const second = await listEntries(ctx.site.id, 'articles', {
        referenceTargets: true,
        limit: 50,
        offset: 50,
      })
      expect(second.items).toHaveLength(1)
      expect(second.total).toBe(51)

      const allIds = new Set([
        ...first.items.map((item) => item.id),
        ...second.items.map((item) => item.id),
      ])
      expect(allIds.size).toBe(51)
    })
  })

  it('keeps status filters when referenceTargets is not set', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: `draft-only-${ctx.suffix}`,
        status: 'draft',
        draftData: data(`draft-only-${ctx.suffix}`, 'Draft only'),
      })
      await insertEntry({
        siteId: ctx.site.id,
        collectionId: col.id,
        slug: `pub-only-${ctx.suffix}`,
        status: 'published',
        draftData: data(`pub-only-${ctx.suffix}`, 'Pub only'),
        publishedData: data(`pub-only-${ctx.suffix}`, 'Pub only'),
        publishedSlug: `pub-only-${ctx.suffix}`,
      })

      const drafts = await listEntries(ctx.site.id, 'articles', {
        status: 'draft',
      })
      expect(drafts.items.map((item) => item.status)).toEqual(['draft'])
      expect(drafts.total).toBe(1)
    })
  })
})
