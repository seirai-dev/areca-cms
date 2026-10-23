import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection, publication, site } from '#/db/schema'
import {
  entryUiStatus,
  isEditedSinceReady,
} from '#/features/golive/entry-live-state'
import {
  archiveEntry,
  createEntry,
  deleteEntry,
  publishEntry,
  scheduleEntry,
  unpublishEntry,
  updateDraft,
} from '#/server/content/entries'
import { buildSnapshot } from '#/server/content/snapshot'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
  sampleRichText,
  withTestSite,
} from '#/server/content/test-utils'

import { getSiteReleaseStatus } from './publications.ts'
import {
  diffApprovedRelease,
  listPendingRelease,
  listPendingReleaseChanges,
} from './release-diff.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function seedPublished(
  siteId: string,
  actorId: string,
  suffix: string,
  slugPrefix = 'pub',
) {
  const created = await createEntry({
    siteId,
    collectionKey: 'articles',
    data: {
      title: 'Published',
      slug: `${slugPrefix}-${suffix}`,
      body: sampleRichText,
    },
    actorId,
  })
  return publishEntry(created.id, actorId)
}

async function insertSnapshotPublication(
  siteId: string,
  status: 'live' | 'demo',
) {
  const built = await buildSnapshot(siteId)
  if (!built.ok) throw new Error(built.errors.join('\n'))
  const id = crypto.randomUUID()
  const row = (
    await db
      .insert(publication)
      .values({
        id,
        siteId,
        snapshot: { ...built.snapshot, publicationId: id },
        snapshotHash: built.hash,
        status,
        wasLive: status === 'live',
      })
      .returning()
  ).at(0)
  if (!row) throw new Error('Failed to insert publication')
  return row
}

function membership(status: Awaited<ReturnType<typeof getSiteReleaseStatus>>) {
  const hasBaseline = Boolean(
    status.live || (status.publishingMode === 'demo' && status.demo),
  )
  if (!hasBaseline) return null
  return {
    liveEntryIds: status.liveEntryIds,
    liveSlugsByEntryId: status.liveSlugsByEntryId,
    pendingEntryIds: status.pendingEntryIds,
  }
}

describe.skipIf(!hasDb)('release status from approved snapshot diff', () => {
  it('does not count a draft edit on a live entry as pending; UI stays Live', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const published = await seedPublished(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
      )
      await insertSnapshotPublication(ctx.site.id, 'live')

      const edited = await updateDraft(
        published.id,
        { ...published.draftData, title: 'Only a draft' },
        ctx.actor.id,
        published.draftVersion,
      )

      const status = await getSiteReleaseStatus(ctx.site.id)
      expect(status.pendingEntries).toBe(0)
      expect(
        isEditedSinceReady({
          status: edited.status,
          updatedAt: edited.updatedAt,
          draftData: edited.draftData,
          publishedData: edited.publishedData,
        }),
      ).toBe(true)
      expect(
        entryUiStatus(
          {
            id: edited.id,
            status: edited.status,
            publishedSlug: edited.publishedSlug,
            updatedAt: edited.updatedAt,
          },
          membership(status),
        ),
      ).toBe('live')
    })
  })

  it('counts a mark-ready after live as a pending update and Ready', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const published = await seedPublished(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
      )
      await insertSnapshotPublication(ctx.site.id, 'live')
      const drafted = await updateDraft(
        published.id,
        { ...published.draftData, title: 'Ready now' },
        ctx.actor.id,
        published.draftVersion,
      )
      const ready = await publishEntry(drafted.id, ctx.actor.id)

      const status = await getSiteReleaseStatus(ctx.site.id)
      const diff = await diffApprovedRelease(ctx.site.id)
      expect(status.pendingEntries).toBe(1)
      expect(diff.updates.map((item) => item.id)).toEqual([ready.id])
      expect(
        entryUiStatus(
          {
            id: ready.id,
            status: ready.status,
            publishedSlug: ready.publishedSlug,
            updatedAt: ready.updatedAt,
          },
          membership(status),
        ),
      ).toBe('ready')
    })
  })

  it('includes unpublish of a live entry as a pending removal', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const published = await seedPublished(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
        'unpub',
      )
      await insertSnapshotPublication(ctx.site.id, 'live')
      await unpublishEntry(published.id, ctx.actor.id)

      const status = await getSiteReleaseStatus(ctx.site.id)
      expect(status.pendingEntries).toBe(1)
      expect(
        (await listPendingReleaseChanges(ctx.site.id)).map((item) => item.kind),
      ).toEqual(['removal'])
    })
  })

  it('includes archive of a live entry as a pending removal', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const published = await seedPublished(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
        'arch',
      )
      await insertSnapshotPublication(ctx.site.id, 'live')
      await archiveEntry(published.id, ctx.actor.id)

      expect((await getSiteReleaseStatus(ctx.site.id)).pendingEntries).toBe(1)
    })
  })

  it('includes delete of a live entry as a pending removal', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const published = await seedPublished(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
        'del',
      )
      await insertSnapshotPublication(ctx.site.id, 'live')
      await deleteEntry(published.id, ctx.actor.id)

      const status = await getSiteReleaseStatus(ctx.site.id)
      expect(status.pendingEntries).toBe(1)
      const changes = await listPendingReleaseChanges(ctx.site.id)
      expect(changes).toHaveLength(1)
      expect(changes[0]?.kind).toBe('removal')
      expect(changes[0]?.exists).toBe(false)
    })
  })

  it('treats a disabled collection that was live as a pending removal', async () => {
    await withTestSite(async (ctx) => {
      const col = await createTestCollection(ctx.site.id)
      await seedPublished(ctx.site.id, ctx.actor.id, ctx.suffix)
      await insertSnapshotPublication(ctx.site.id, 'live')

      await db
        .update(collection)
        .set({ enabled: false })
        .where(eq(collection.id, col.id))

      const status = await getSiteReleaseStatus(ctx.site.id)
      const diff = await diffApprovedRelease(ctx.site.id)
      expect(status.pendingEntries).toBe(1)
      expect(diff.removals).toHaveLength(1)
      expect(
        (await listPendingReleaseChanges(ctx.site.id)).map((item) => item.kind),
      ).toEqual(['removal'])
    })
  })

  it('diffs against a rolled-back snapshot rather than createdAt', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await seedPublished(ctx.site.id, ctx.actor.id, ctx.suffix, 'first')
      const firstLive = await insertSnapshotPublication(ctx.site.id, 'live')

      await seedPublished(ctx.site.id, ctx.actor.id, ctx.suffix, 'second')
      const afterSecond = await getSiteReleaseStatus(ctx.site.id)
      expect(afterSecond.pendingEntries).toBe(1)

      await db
        .update(publication)
        .set({ status: 'superseded' })
        .where(eq(publication.id, firstLive.id))
      const rolledBackId = crypto.randomUUID()
      await db.insert(publication).values({
        id: rolledBackId,
        siteId: ctx.site.id,
        snapshot: {
          ...firstLive.snapshot,
          publicationId: rolledBackId,
        },
        snapshotHash: firstLive.snapshotHash,
        status: 'live',
        wasLive: true,
      })

      const afterRollback = await getSiteReleaseStatus(ctx.site.id)
      expect(afterRollback.pendingEntries).toBe(1)
      const diff = await diffApprovedRelease(ctx.site.id)
      expect(diff.adds).toHaveLength(1)
      expect(diff.adds[0]?.slug).toBe(`second-${ctx.suffix}`)
    })
  })

  it('keeps a not-due scheduled live entry in the candidate and not as a removal', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const published = await seedPublished(
        ctx.site.id,
        ctx.actor.id,
        ctx.suffix,
      )
      await insertSnapshotPublication(ctx.site.id, 'live')

      await scheduleEntry(
        published.id,
        '2099-01-01T00:00:00.000Z',
        'UTC',
        ctx.actor.id,
      )

      const status = await getSiteReleaseStatus(ctx.site.id)
      const diff = await diffApprovedRelease(ctx.site.id)
      expect(status.pendingEntries).toBe(0)
      expect(diff.removals).toEqual([])
      expect(diff.scheduledUpcoming.map((item) => item.id)).toEqual([
        published.id,
      ])
      const changes = await listPendingReleaseChanges(ctx.site.id)
      expect(changes).toHaveLength(1)
      expect(changes[0]?.kind).toBe('scheduled')
    })
  })

  it('compares demo sites to the current demo publication when nothing is live', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      await seedPublished(ctx.site.id, ctx.actor.id, ctx.suffix)
      await db
        .update(site)
        .set({ publishingMode: 'demo' })
        .where(eq(site.id, ctx.site.id))
      await insertSnapshotPublication(ctx.site.id, 'demo')

      expect((await getSiteReleaseStatus(ctx.site.id)).pendingEntries).toBe(0)

      await seedPublished(ctx.site.id, ctx.actor.id, ctx.suffix, 'extra')
      expect((await getSiteReleaseStatus(ctx.site.id)).pendingEntries).toBe(1)
    })
  })
})

describe.skipIf(!hasDb)('language changes in the pending release', () => {
  it('lists an added language as one pending change, with no entries', async () => {
    const ctx = await createTestSite({
      languages: { main: 'en', all: ['en', 'nl'] },
    })
    try {
      await createTestCollection(ctx.site.id)
      await insertSnapshotPublication(ctx.site.id, 'live')
      await db
        .update(site)
        .set({ languages: { main: 'en', all: ['en', 'nl', 'de'] } })
        .where(eq(site.id, ctx.site.id))

      const release = await listPendingRelease(ctx.site.id)
      expect(release.changes).toEqual([])
      expect(release.languages).toEqual({
        added: ['de'],
        removed: [],
        mainChanged: null,
      })
      expect((await getSiteReleaseStatus(ctx.site.id)).pendingEntries).toBe(1)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('does not list a schema-only change', async () => {
    const ctx = await createTestSite({
      languages: { main: 'en', all: ['en', 'nl'] },
    })
    try {
      await createTestCollection(ctx.site.id)
      await insertSnapshotPublication(ctx.site.id, 'live')
      await db
        .update(collection)
        .set({ label: 'Renamed for editors' })
        .where(eq(collection.siteId, ctx.site.id))

      const release = await listPendingRelease(ctx.site.id)
      expect(release.languages).toBeNull()
      expect(release.changes).toEqual([])
      expect((await getSiteReleaseStatus(ctx.site.id)).pendingEntries).toBe(0)
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
