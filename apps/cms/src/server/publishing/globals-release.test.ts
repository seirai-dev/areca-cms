// Assumed API: diffApprovedRelease(siteId).pendingCount and listPendingRelease(siteId).changes
// include site-content sections (kind 'ready' or 'scheduled'), with collectionKey = the
// section's raw key and collectionLabel = the section label.
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection } from '#/db/schema'
import { buildSnapshot } from '#/server/content/snapshot'
import {
  createEntry,
  publishEntry,
  scheduleEntry,
  updateDraft,
} from '#/server/content/entries'
import {
  createTestCollection,
  createTestGlobal,
  sampleRichText,
  withTestSite,
} from '#/server/content/test-utils'

import { getSiteReleaseStatus, requestPublication } from './publications.ts'
import { diffApprovedRelease, listPendingRelease } from './release-diff.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('release changes for site content', () => {
  it('lists a section marked ready as a pending change labelled with its section label', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })
      await updateDraft(
        section.entry.id,
        { email: 'ready@x.test' },
        ctx.actor.id,
        section.entry.draftVersion,
      )
      await publishEntry(section.entry.id, ctx.actor.id)

      const changes = (await listPendingRelease(ctx.site.id)).changes
      expect(changes).toContainEqual(
        expect.objectContaining({
          id: section.entry.id,
          kind: 'ready',
          collectionKey: 'companyInfo',
          collectionLabel: 'Company info',
        }),
      )

      const diff = await diffApprovedRelease(ctx.site.id)
      expect(diff.pendingCount).toBe(1)
      expect(diff.adds.map((item) => item.id)).toEqual([section.entry.id])
    })
  })

  it('lists a section scheduled for later as a scheduled change', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })
      await updateDraft(
        section.entry.id,
        { email: 'later@x.test' },
        ctx.actor.id,
        section.entry.draftVersion,
      )
      await scheduleEntry(
        section.entry.id,
        new Date(Date.now() + 86_400_000).toISOString(),
        'UTC',
        ctx.actor.id,
      )

      const changes = (await listPendingRelease(ctx.site.id)).changes
      expect(changes).toContainEqual(
        expect.objectContaining({
          id: section.entry.id,
          kind: 'scheduled',
          collectionLabel: 'Company info',
        }),
      )
    })
  })

  it('leaves a disabled section out of scheduled and pending changes for everyone', async () => {
    await withTestSite(async (ctx) => {
      const scheduled = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })
      await updateDraft(
        scheduled.entry.id,
        { email: 'later@x.test' },
        ctx.actor.id,
        scheduled.entry.draftVersion,
      )
      await scheduleEntry(
        scheduled.entry.id,
        new Date(Date.now() + 86_400_000).toISOString(),
        'UTC',
        ctx.actor.id,
      )
      const ready = await createTestGlobal(ctx.site.id, {
        key: 'homePage',
        label: 'Home page',
      })
      await updateDraft(
        ready.entry.id,
        { email: 'ready@x.test' },
        ctx.actor.id,
        ready.entry.draftVersion,
      )
      await publishEntry(ready.entry.id, ctx.actor.id)

      // Disable both sections after they were queued: they never ship.
      await db
        .update(collection)
        .set({ enabled: false })
        .where(
          and(
            eq(collection.siteId, ctx.site.id),
            eq(collection.kind, 'global'),
          ),
        )

      const diff = await diffApprovedRelease(ctx.site.id)
      expect(diff.scheduledUpcoming.map((item) => item.id)).not.toContain(
        scheduled.entry.id,
      )
      const changes = (await listPendingRelease(ctx.site.id)).changes
      expect(changes.map((change) => change.id)).not.toContain(
        scheduled.entry.id,
      )
      expect(changes.map((change) => change.id)).not.toContain(ready.entry.id)
    })
  })

  it('does not list a section that was never marked ready', async () => {
    await withTestSite(async (ctx) => {
      const section = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })
      await updateDraft(
        section.entry.id,
        { email: 'draft@x.test' },
        ctx.actor.id,
        section.entry.draftVersion,
      )

      const changes = (await listPendingRelease(ctx.site.id)).changes
      expect(changes.map((change) => change.id)).not.toContain(section.entry.id)
    })
  })

  it('still lists ready changes while another section blocks go live', async () => {
    await withTestSite(async (ctx) => {
      await createTestCollection(ctx.site.id)
      const company = await createTestGlobal(ctx.site.id, {
        key: 'companyInfo',
        label: 'Company info',
      })
      // Required fields, never marked ready: this is the go-live blocker.
      await createTestGlobal(ctx.site.id, {
        key: 'opening',
        label: 'Opening hours',
        fields: [
          { key: 'weekdays', label: 'Weekdays', type: 'text', required: true },
        ],
      })
      await updateDraft(
        company.entry.id,
        { email: 'blocked@x.test' },
        ctx.actor.id,
        company.entry.draftVersion,
      )
      await publishEntry(company.entry.id, ctx.actor.id)
      const article = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Ready article',
          slug: `ready-${ctx.suffix}`,
          body: sampleRichText,
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(article.id, ctx.actor.id)

      expect((await buildSnapshot(ctx.site.id)).ok).toBe(false)

      const status = await getSiteReleaseStatus(ctx.site.id)
      // The section, plus the test site's missing deployment target.
      expect(status.blockers).toHaveLength(2)
      expect(status.pendingEntries).toBe(2)

      const changes = (await listPendingRelease(ctx.site.id)).changes
      expect(changes).toContainEqual(
        expect.objectContaining({
          id: company.entry.id,
          kind: 'ready',
          global: true,
          collectionLabel: 'Company info',
          title: 'Company info',
        }),
      )
      expect(changes).toContainEqual(
        expect.objectContaining({
          id: article.id,
          kind: 'ready',
          global: false,
        }),
      )

      const diff = await diffApprovedRelease(ctx.site.id)
      expect(diff.pendingCount).toBe(2)

      // The server still refuses to request a release while blocked.
      const requested = await requestPublication({
        siteId: ctx.site.id,
        actorId: ctx.actor.id,
      })
      expect(requested.ok).toBe(false)
    })
  })
})
