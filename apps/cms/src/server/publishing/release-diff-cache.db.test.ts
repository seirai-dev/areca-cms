import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { asset, collection, publication, site } from '#/db/schema'
import { updateAsset } from '#/server/assets'
import {
  createEntry,
  publishEntry,
  scheduleEntry,
  updateDraft,
} from '#/server/content/entries'
import { buildSnapshot } from '#/server/content/snapshot'
import {
  createTestCollection,
  createTestSite,
  cleanupTestSite,
  sampleRichText,
} from '#/server/content/test-utils'

import {
  approvedReleaseDiffs,
  computeApprovedReleaseDiff,
  diffApprovedRelease,
} from './release-diff.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function goLive(siteId: string) {
  const built = await buildSnapshot(siteId)
  if (!built.ok) throw new Error(built.errors.join('\n'))
  const id = crypto.randomUUID()
  await db
    .update(publication)
    .set({ status: 'superseded' })
    .where(and(eq(publication.siteId, siteId), eq(publication.status, 'live')))
  await db.insert(publication).values({
    id,
    siteId,
    snapshot: { ...built.snapshot, publicationId: id },
    snapshotHash: built.hash,
    status: 'live',
    wasLive: true,
  })
  return id
}

/** The cached diff must equal one built from scratch, whatever changed. */
async function expectFresh(siteId: string) {
  const cached = await diffApprovedRelease(siteId)
  expect(cached).toEqual(await computeApprovedReleaseDiff(siteId))
  return cached
}

afterEach(() => {
  vi.useRealTimers()
})

describe.skipIf(!hasDb)('release diff cache', () => {
  it('reuses the diff while nothing changes', async () => {
    const ctx = await createTestSite()
    try {
      await createTestCollection(ctx.site.id)
      const first = await diffApprovedRelease(ctx.site.id)
      expect(await diffApprovedRelease(ctx.site.id)).toBe(first)
      const [a, b] = await Promise.all([
        diffApprovedRelease(ctx.site.id),
        diffApprovedRelease(ctx.site.id),
      ])
      expect(a).toBe(b)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('matches a fresh diff after every kind of change', async () => {
    const ctx = await createTestSite()
    try {
      const siteId = ctx.site.id
      const actor = ctx.actor.id
      const articles = await createTestCollection(siteId)
      const [image] = await db
        .insert(asset)
        .values({
          organizationId: ctx.org.id,
          storageKey: `${ctx.org.id}/hero.png`,
          originalFilename: 'hero.png',
          mimeType: 'image/png',
          size: 4,
          width: 10,
          height: 20,
          altText: 'Before',
        })
        .returning()

      // Draft only: nothing pending, nothing live.
      const created = await createEntry({
        siteId,
        collectionKey: 'articles',
        data: {
          title: 'One',
          slug: 'one',
          body: sampleRichText,
          heroImage: image.id,
        },
        actorId: actor,
      })
      expect((await expectFresh(siteId)).pendingCount).toBe(0)

      // Mark ready.
      const ready = await publishEntry(created.id, actor)
      expect((await expectFresh(siteId)).pendingCount).toBe(1)

      // Go live.
      const firstLive = await goLive(siteId)
      let diff = await expectFresh(siteId)
      expect(diff.pendingCount).toBe(0)
      expect(diff.livePublication?.entryIds).toEqual([created.id])

      // Entry edit, then mark ready again.
      const edited = await updateDraft(
        created.id,
        { ...ready.draftData, title: 'One edited' },
        actor,
        ready.draftVersion,
      )
      expect((await expectFresh(siteId)).pendingCount).toBe(0)
      await publishEntry(created.id, actor, edited.draftVersion)
      expect((await expectFresh(siteId)).updates.map((u) => u.id)).toEqual([
        created.id,
      ])
      await goLive(siteId)
      expect((await expectFresh(siteId)).pendingCount).toBe(0)

      // Asset alt text change.
      await updateAsset(image.id, { altText: 'After' }, ctx.org.id)
      expect((await expectFresh(siteId)).pendingCount).toBe(1)
      await goLive(siteId)
      expect((await expectFresh(siteId)).pendingCount).toBe(0)

      // Collection change: a new route moves the entry's URL.
      await db
        .update(collection)
        .set({ routePattern: '/news/$slug' })
        .where(eq(collection.id, articles.id))
      expect((await expectFresh(siteId)).pendingCount).toBe(1)
      await goLive(siteId)
      expect((await expectFresh(siteId)).pendingCount).toBe(0)

      // Site setting: the production URL is part of the SEO output.
      await db
        .update(site)
        .set({ productionUrl: 'https://moved.example' })
        .where(eq(site.id, siteId))
      expect((await expectFresh(siteId)).pendingCount).toBe(1)

      // Rollback: the first release becomes the live baseline again.
      await db
        .update(publication)
        .set({ status: 'rolled_back' })
        .where(
          and(eq(publication.siteId, siteId), eq(publication.status, 'live')),
        )
      await db
        .update(publication)
        .set({ status: 'live' })
        .where(eq(publication.id, firstLive))
      diff = await expectFresh(siteId)
      expect(diff.updates.map((u) => u.id)).toEqual([created.id])
      await goLive(siteId)
      expect((await expectFresh(siteId)).pendingCount).toBe(0)

      // A schedule falls due with no write at all.
      const later = await createEntry({
        siteId,
        collectionKey: 'articles',
        data: { title: 'Later', slug: 'later', body: sampleRichText },
        actorId: actor,
      })
      const dueAt = new Date(Date.now() + 60_000)
      await scheduleEntry(later.id, dueAt.toISOString(), 'UTC', actor)
      diff = await expectFresh(siteId)
      expect(diff.pendingCount).toBe(0)
      expect(diff.scheduledUpcoming.map((s) => s.id)).toEqual([later.id])
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(dueAt.getTime() + 1_000)
      diff = await expectFresh(siteId)
      expect(diff.adds.map((a) => a.id)).toEqual([later.id])
      expect(diff.scheduledUpcoming).toEqual([])
    } finally {
      vi.useRealTimers()
      await cleanupTestSite(ctx)
    }
  })

  it('follows a draft-only edit of a link target that is not live', async () => {
    const ctx = await createTestSite()
    try {
      const siteId = ctx.site.id
      const actor = ctx.actor.id
      await createTestCollection(siteId)
      const target = await createEntry({
        siteId,
        collectionKey: 'articles',
        data: { title: 'Target', slug: 'target', body: sampleRichText },
        actorId: actor,
      })
      const source = await createEntry({
        siteId,
        collectionKey: 'articles',
        data: {
          title: 'Source',
          slug: 'source',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'See',
                    marks: [
                      {
                        type: 'link',
                        attrs: {
                          href: '/blog/target',
                          entryId: target.id,
                          collection: 'articles',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        actorId: actor,
      })
      await publishEntry(source.id, actor)
      let diff = await expectFresh(siteId)
      expect(diff.linkWarnings.map((w) => w.targetTitle)).toEqual(['Target'])
      await updateDraft(
        target.id,
        { ...target.draftData, title: 'Renamed' },
        actor,
        target.draftVersion,
      )
      diff = await expectFresh(siteId)
      expect(diff.linkWarnings.map((w) => w.targetTitle)).toEqual(['Renamed'])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('leaves out sites that do not exist', async () => {
    const ctx = await createTestSite()
    try {
      const diffs = await approvedReleaseDiffs([ctx.site.id, 'no-such-site'])
      expect([...diffs.keys()]).toEqual([ctx.site.id])
      await expect(diffApprovedRelease('no-such-site')).rejects.toThrow()
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
