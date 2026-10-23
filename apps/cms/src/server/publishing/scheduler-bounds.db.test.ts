/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import type * as PublicationsModule from './publications.ts'

import { eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { buildJob, entry, organization } from '#/db/schema'
import {
  createTestCollection,
  createTestSite,
} from '#/server/content/test-utils'
import {
  insertPublication,
  removeUsers,
} from '#/server/notifications/test-utils'

import { recoverStaleJobs } from './worker.ts'
import { runSchedulerTick } from './scheduler.ts'

const requested = vi.hoisted(() => ({ siteIds: [] as string[] }))

vi.mock('./publications.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof PublicationsModule>()
  return {
    ...actual,
    requestPublication: async (input: { siteId: string }) => {
      requested.siteIds.push(input.siteId)
      return { ok: true as const }
    },
  }
})

const hasDb = Boolean(process.env.DATABASE_URL)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  requested.siteIds = []
  while (cleanups.length > 0) await cleanups.pop()?.()
})

/** A site with one scheduled entry that is already due. */
async function dueSite() {
  const ctx = await createTestSite()
  const collection = await createTestCollection(ctx.site.id)
  await db.insert(entry).values({
    siteId: ctx.site.id,
    collectionId: collection.id,
    slug: `due-${crypto.randomUUID()}`,
    status: 'scheduled',
    draftData: {},
    scheduledData: {},
    scheduledVersion: crypto.randomUUID(),
    scheduledAt: new Date(Date.now() - 60 * 60_000),
  })
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, ctx.org.id))
    await removeUsers([ctx.actor.id])
  })
  return ctx.site.id
}

describe.skipIf(!hasDb)(
  'scheduler and recovery work in bounded batches',
  () => {
    it('handles at most maxSites due sites per tick, and the rest on a later tick', async () => {
      const mine = [await dueSite(), await dueSite(), await dueSite()]

      await runSchedulerTick({ maxSites: 2 })
      const firstTick = requested.siteIds.filter((id) => mine.includes(id))
      expect(firstTick.length).toBeLessThanOrEqual(2)

      requested.siteIds = []
      await runSchedulerTick({ maxSites: 50 })
      expect(
        new Set(requested.siteIds.filter((id) => mine.includes(id))),
      ).toEqual(new Set(mine))
    })

    it('recovers stale jobs batch by batch and fails every one of them', async () => {
      const stale: string[] = []
      for (let i = 0; i < 5; i++) {
        const ctx = await createTestSite()
        const pub = await insertPublication({
          siteId: ctx.site.id,
          status: 'building',
        })
        const [job] = await db
          .insert(buildJob)
          .values({
            siteId: ctx.site.id,
            publicationId: pub.id,
            status: 'building',
            attempts: 1,
            startedAt: new Date(Date.now() - 2 * 60 * 60_000),
            leaseExpiresAt: new Date(Date.now() - 60_000),
          })
          .returning()
        if (!job) throw new Error('fixture failed')
        stale.push(job.id)
        cleanups.push(async () => {
          await db.delete(organization).where(eq(organization.id, ctx.org.id))
          await removeUsers([ctx.actor.id])
        })
      }

      // Batches of two: five jobs need three transactions.
      await recoverStaleJobs(undefined, new Date(), 2)

      const rows = await db
        .select({ status: buildJob.status })
        .from(buildJob)
        .where(inArray(buildJob.id, stale))
      expect(rows.map((row) => row.status)).toEqual(Array(5).fill('failed'))
    })
  },
)
