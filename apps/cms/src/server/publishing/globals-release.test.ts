// Assumed API: diffApprovedRelease(siteId).pendingCount and listPendingReleaseChanges(siteId)
// include site-content sections (kind 'ready' or 'scheduled'), with collectionKey = the
// section's raw key and collectionLabel = the section label.
import { describe, expect, it } from 'vitest'

import {
  publishEntry,
  scheduleEntry,
  updateDraft,
} from '#/server/content/entries'
import { createTestGlobal, withTestSite } from '#/server/content/test-utils'

import {
  diffApprovedRelease,
  listPendingReleaseChanges,
} from './release-diff.ts'

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

      const changes = await listPendingReleaseChanges(ctx.site.id)
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

      const changes = await listPendingReleaseChanges(ctx.site.id)
      expect(changes).toContainEqual(
        expect.objectContaining({
          id: section.entry.id,
          kind: 'scheduled',
          collectionLabel: 'Company info',
        }),
      )
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

      const changes = await listPendingReleaseChanges(ctx.site.id)
      expect(changes.map((change) => change.id)).not.toContain(section.entry.id)
    })
  })
})
