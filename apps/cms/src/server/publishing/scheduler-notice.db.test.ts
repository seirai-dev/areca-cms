import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  entry,
  notificationEvent,
  organization,
  schedulerBackoff,
} from '#/db/schema'
import {
  createTestCollection,
  createTestSite,
} from '#/server/content/test-utils'
import { makeUser, removeUsers } from '#/server/notifications/test-utils'
import { scheduleFailedSubject } from '#/server/notifications/triggers'

import { runSchedulerTick } from './scheduler.ts'
import type * as PublicationsModule from './publications.ts'

// Only the site under test fails; every other due site in the shared database
// succeeds, so this tick cannot change their scheduler state.
const outcome = vi.hoisted(() => ({
  siteId: '',
  result: null as null | { ok: false; errors: string[] } | 'throw',
}))

vi.mock('./publications.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof PublicationsModule>()),
  requestPublication: async (input: { siteId: string }) => {
    if (input.siteId !== outcome.siteId || outcome.result === null) {
      return { ok: true as const }
    }
    if (outcome.result === 'throw') throw new Error('database hiccup')
    return outcome.result
  },
}))

const hasDb = Boolean(process.env.DATABASE_URL)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  outcome.siteId = ''
  outcome.result = null
  while (cleanups.length > 0) await cleanups.pop()?.()
})

/** A site with one scheduled entry that is already due, scheduled by `userId`. */
async function dueSite(userId: string) {
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
    scheduledBy: userId,
  })
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, ctx.org.id))
    await removeUsers([ctx.actor.id])
  })
  return ctx.site.id
}

async function scheduleNotices(siteId: string) {
  return db
    .select()
    .from(notificationEvent)
    .where(
      and(
        eq(notificationEvent.kind, 'schedule.failed'),
        eq(notificationEvent.siteId, siteId),
      ),
    )
}

describe.skipIf(!hasDb)(
  'a failed scheduled publish leaves a durable notice',
  () => {
    it('queues one notice in the same transaction that records the failure', async () => {
      const scheduler = await makeUser({ name: 'Scheduling Editor' })
      cleanups.push(() => removeUsers([scheduler.id]))
      const siteId = await dueSite(scheduler.id)
      outcome.siteId = siteId
      outcome.result = { ok: false, errors: ['Snapshot is invalid'] }

      await runSchedulerTick({ maxSites: 10_000 })
      // A repeat tick is held back by the retry cooldown and queues nothing new.
      await runSchedulerTick({ maxSites: 10_000 })

      const [backoff] = await db
        .select()
        .from(schedulerBackoff)
        .where(eq(schedulerBackoff.siteId, siteId))
      expect(backoff).toMatchObject({
        failureCount: 1,
        lastError: 'Snapshot is invalid',
      })
      const notices = await scheduleNotices(siteId)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({
        dedupeKey: scheduleFailedSubject(
          siteId,
          backoff.approvalFingerprint ?? '',
        ),
        publicationId: null,
        status: 'pending',
        payload: {
          scheduledBy: [scheduler.id],
          fingerprint: backoff.approvalFingerprint,
        },
      })
    })

    it('records a thrown error without a notice, as before', async () => {
      const scheduler = await makeUser({ name: 'Crashing Editor' })
      cleanups.push(() => removeUsers([scheduler.id]))
      const siteId = await dueSite(scheduler.id)
      outcome.siteId = siteId
      outcome.result = 'throw'

      await runSchedulerTick({ maxSites: 10_000 })

      const [backoff] = await db
        .select()
        .from(schedulerBackoff)
        .where(eq(schedulerBackoff.siteId, siteId))
      expect(backoff).toMatchObject({
        failureCount: 1,
        lastError: 'database hiccup',
      })
      expect(await scheduleNotices(siteId)).toHaveLength(0)
    })
  },
)
