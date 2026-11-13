/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import type * as TriggersModule from './triggers.ts'

import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  buildJob,
  notification,
  notificationEvent,
  organization,
  publication,
  site,
} from '#/db/schema'
import type { Snapshot } from '#/lib/types'
import { processJob } from '#/server/publishing/job-run'

import {
  createTestSite,
  insertPublication,
  makeUser,
  addMember,
  removeUsers,
} from './test-utils.ts'
import {
  processPublicationEvents,
  queuePublicationEvent,
} from './publication-events.ts'
import { createMockDeploymentAdapter } from '#/server/publishing/test-helpers'

// `failNext` makes the next live delivery throw, as a failing SMTP or database
// would. Everything else runs for real.
const inject = vi.hoisted(() => ({ failNext: false }))

vi.mock('./triggers.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof TriggersModule>()
  return {
    ...actual,
    deliverPublicationLive: async (
      ...args: Parameters<typeof actual.deliverPublicationLive>
    ) => {
      if (inject.failNext) {
        inject.failNext = false
        throw new Error('smtp down')
      }
      return actual.deliverPublicationLive(...args)
    },
  }
})

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
})

async function setup() {
  const ctx = await createTestSite()
  const requester = await makeUser({ name: 'Queued Requester' })
  await addMember(requester.id, ctx.org.id, 'owner')
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, ctx.org.id))
    await removeUsers([requester.id, ctx.actor.id])
  })
  return { ...ctx, requester }
}

async function eventFor(publicationId: string) {
  const [row] = await db
    .select()
    .from(notificationEvent)
    .where(
      and(
        eq(notificationEvent.publicationId, publicationId),
        eq(notificationEvent.kind, 'publication.live'),
      ),
    )
  return row
}

async function liveNoticesFor(publicationId: string, userId: string) {
  return db
    .select({ id: notification.id })
    .from(notification)
    .where(
      eq(notification.dedupeKey, `release.live:${publicationId}:${userId}`),
    )
}

describe('release notices survive a crash or a failed delivery', () => {
  it('commits the notice with the release, then delivers it once', async () => {
    const { site: s, requester } = await setup()
    const hash = `hash-${crypto.randomUUID()}`
    await db
      .update(site)
      .set({
        deploymentTarget: {
          provider: 'dokploy',
          applicationId: 'app',
          healthCheckUrl: 'http://localhost:3999',
        },
      })
      .where(eq(site.id, s.id))
    const [pub] = await db
      .insert(publication)
      .values({
        siteId: s.id,
        snapshot: { hash, collections: {} } as unknown as Snapshot,
        snapshotHash: hash,
        status: 'pending',
        requestedBy: requester.id,
      })
      .returning()
    if (!pub) throw new Error('fixture failed')
    const [job] = await db
      .insert(buildJob)
      // Already claimed: a queued job could be taken by another suite's claim.
      .values({
        siteId: s.id,
        publicationId: pub.id,
        status: 'building',
        attempts: 1,
        startedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
      })
      .returning()

    await processJob(job, {
      adapter: createMockDeploymentAdapter(),
      audit: async () => {},
    })

    // The release is live and its notice is already durable, not yet sent.
    const [live] = await db
      .select({ status: publication.status })
      .from(publication)
      .where(eq(publication.id, pub.id))
    expect(live?.status).toBe('live')
    expect(await eventFor(pub.id)).toMatchObject({ status: 'pending' })

    await processPublicationEvents({ only: { publicationIds: [pub.id] } })
    await processPublicationEvents({ only: { publicationIds: [pub.id] } })

    expect(await eventFor(pub.id)).toMatchObject({
      status: 'done',
      attempts: 1,
    })
    expect(await liveNoticesFor(pub.id, requester.id)).toHaveLength(1)
  })

  it('diffs a live notice against the release it replaced, not against nothing', async () => {
    const { site: s, requester } = await setup()
    const entry = (id: string, title: string) => ({
      id,
      slug: id,
      publishedAt: null,
      data: { title },
    })
    // The release that is live before the new one.
    await db.insert(publication).values({
      siteId: s.id,
      snapshot: {
        hash: 'before',
        collections: { blog: [entry('keep', 'Keep'), entry('gone', 'Gone')] },
      } as unknown as Snapshot,
      snapshotHash: 'before',
      status: 'live',
      requestedBy: requester.id,
      wasLive: true,
      createdAt: new Date(Date.now() - 60_000),
    })
    await db
      .update(site)
      .set({
        deploymentTarget: {
          provider: 'dokploy',
          applicationId: 'app',
          healthCheckUrl: 'http://localhost:3999',
        },
      })
      .where(eq(site.id, s.id))
    // The release being published: `gone` is removed, `new` is added.
    const [pub] = await db
      .insert(publication)
      .values({
        siteId: s.id,
        snapshot: {
          hash: 'after',
          collections: { blog: [entry('keep', 'Keep'), entry('new', 'New')] },
        } as unknown as Snapshot,
        snapshotHash: 'after',
        status: 'pending',
        requestedBy: requester.id,
      })
      .returning()
    if (!pub) throw new Error('fixture failed')
    const [job] = await db
      .insert(buildJob)
      .values({
        siteId: s.id,
        publicationId: pub.id,
        status: 'building',
        attempts: 1,
        startedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
      })
      .returning()
    if (!job) throw new Error('fixture failed')

    // The worker supersedes the old release. The notice still sees it.
    await processJob(job, {
      adapter: createMockDeploymentAdapter(),
      audit: async () => {},
    })
    await processPublicationEvents({ only: { publicationIds: [pub.id] } })

    const row = await db
      .select({ payload: notification.payload })
      .from(notification)
      .where(
        eq(notification.dedupeKey, `release.live:${pub.id}:${requester.id}`),
      )
    expect(row[0]?.payload.entries).toEqual([
      { title: 'New', collection: 'blog', change: 'added' },
      { title: 'Gone', collection: 'blog', change: 'removed' },
    ])
  })

  it('keeps a failed delivery pending and retries it without a second notice', async () => {
    const { site: s, requester } = await setup()
    const pub = await insertPublication({
      siteId: s.id,
      requestedBy: requester.id,
    })
    await queuePublicationEvent(db, {
      kind: 'publication.live',
      siteId: s.id,
      publicationId: pub.id,
    })

    inject.failNext = true
    await processPublicationEvents({ only: { publicationIds: [pub.id] } })
    expect(await eventFor(pub.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'smtp down',
    })
    // Waiting out the retry delay: not due yet, so nothing runs.
    expect(
      await processPublicationEvents({ only: { publicationIds: [pub.id] } }),
    ).toBe(0)

    await db
      .update(notificationEvent)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(notificationEvent.publicationId, pub.id))
    await processPublicationEvents({ only: { publicationIds: [pub.id] } })

    expect(await eventFor(pub.id)).toMatchObject({
      status: 'done',
      attempts: 2,
    })
    expect(await liveNoticesFor(pub.id, requester.id)).toHaveLength(1)
  })

  it('does not queue a second notice for the same release and outcome', async () => {
    const { site: s } = await setup()
    const pub = await insertPublication({ siteId: s.id })
    const input = {
      kind: 'publication.live' as const,
      siteId: s.id,
      publicationId: pub.id,
    }
    await queuePublicationEvent(db, input)
    await queuePublicationEvent(db, input)

    const rows = await db
      .select({ id: notificationEvent.id })
      .from(notificationEvent)
      .where(eq(notificationEvent.publicationId, pub.id))
    expect(rows).toHaveLength(1)
  })
})
