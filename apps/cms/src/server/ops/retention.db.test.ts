/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  buildJob,
  entry,
  entryRevision,
  invitation,
  organization,
  publication,
  publicationRequest,
  session,
  verification,
} from '#/db/schema'
import { createTestCollection } from '#/server/content/test-utils'
import {
  createTestSite,
  insertPublication,
  makeUser,
  removeUsers,
} from '#/server/notifications/test-utils'

import { RETENTION, runRetention } from './retention.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date()
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function finishedJob(
  siteId: string,
  publicationId: string,
  input: {
    finishedDaysAgo: number
    createdDaysAgo: number
    status?: 'succeeded' | 'failed'
    dispatchUncertain?: boolean
  },
) {
  const [row] = await db
    .insert(buildJob)
    .values({
      siteId,
      publicationId,
      status: input.status ?? 'succeeded',
      dispatchUncertain: input.dispatchUncertain ?? false,
      finishedAt: daysAgo(input.finishedDaysAgo),
      createdAt: daysAgo(input.createdDaysAgo),
    })
    .returning()
  if (!row) throw new Error('fixture failed')
  return row
}

describe.skipIf(!hasDb)('retention', () => {
  it("prunes old autosaves, but keeps milestones and each entry's newest revision", async () => {
    const ctx = await createTestSite()
    cleanups.push(async () => {
      await db.delete(organization).where(eq(organization.id, ctx.org.id))
      await removeUsers([ctx.actor.id])
    })
    const col = await createTestCollection(ctx.site.id)
    const addEntry = async (slug: string) =>
      (
        await db
          .insert(entry)
          .values({ siteId: ctx.site.id, collectionId: col.id, slug })
          .returning()
      ).at(0)
    const addRevision = async (
      entryId: string,
      input: { daysOld: number; note: string; kind: 'autosave' | 'milestone' },
    ) =>
      (
        await db
          .insert(entryRevision)
          .values({
            entryId,
            data: {},
            createdBy: ctx.actor.id,
            note: input.note,
            kind: input.kind,
            createdAt: daysAgo(input.daysOld),
          })
          .returning()
      ).at(0)

    // Old autosave with a newer one: the old one goes.
    const first = await addEntry(`retention-a-${ctx.suffix}`)
    const oldAutosave = await addRevision(first!.id, {
      daysOld: 100,
      note: 'update',
      kind: 'autosave',
    })
    const recentAutosave = await addRevision(first!.id, {
      daysOld: 2,
      note: 'update',
      kind: 'autosave',
    })
    // An old autosave that is the entry's only revision: it stays.
    const second = await addEntry(`retention-b-${ctx.suffix}`)
    const onlyAutosave = await addRevision(second!.id, {
      daysOld: 100,
      note: 'update',
      kind: 'autosave',
    })
    // Old milestones stay, even with an old autosave between them.
    const third = await addEntry(`retention-c-${ctx.suffix}`)
    const oldPublish = await addRevision(third!.id, {
      daysOld: 100,
      note: 'publish',
      kind: 'milestone',
    })
    const middleAutosave = await addRevision(third!.id, {
      daysOld: 99,
      note: 'update',
      kind: 'autosave',
    })
    const newerPublish = await addRevision(third!.id, {
      daysOld: 98,
      note: 'publish',
      kind: 'milestone',
    })

    const result = await runRetention(NOW)

    expect(result.autosaves).toBeGreaterThanOrEqual(2)
    const kept = await db
      .select({ id: entryRevision.id })
      .from(entryRevision)
      .where(
        inArray(entryRevision.id, [
          oldAutosave!.id,
          recentAutosave!.id,
          onlyAutosave!.id,
          oldPublish!.id,
          middleAutosave!.id,
          newerPublish!.id,
        ]),
      )
    expect(kept.map((row) => row.id).sort()).toEqual(
      [
        recentAutosave!.id,
        onlyAutosave!.id,
        oldPublish!.id,
        newerPublish!.id,
      ].sort(),
    )
    expect(RETENTION.autosaveDays).toBe(90)
  })

  it('removes expired sessions, verification tokens and unaccepted invitations past their windows only', async () => {
    const person = await makeUser({ name: 'Retention Person' })
    const sessionOld = crypto.randomUUID()
    const sessionRecent = crypto.randomUUID()
    const tokenOld = crypto.randomUUID()
    const tokenRecent = crypto.randomUUID()
    await db.insert(session).values([
      {
        id: sessionOld,
        userId: person.id,
        token: `t-${sessionOld}`,
        expiresAt: daysAgo(8),
      },
      {
        id: sessionRecent,
        userId: person.id,
        token: `t-${sessionRecent}`,
        expiresAt: daysAgo(6),
      },
    ])
    await db.insert(verification).values([
      {
        id: tokenOld,
        identifier: `v-${tokenOld}`,
        value: 'x',
        expiresAt: daysAgo(8),
      },
      {
        id: tokenRecent,
        identifier: `v-${tokenRecent}`,
        value: 'x',
        expiresAt: daysAgo(6),
      },
    ])
    const ctx = await createTestSite()
    const inviteOld = crypto.randomUUID()
    const inviteRecent = crypto.randomUUID()
    await db.insert(invitation).values([
      {
        id: inviteOld,
        email: `old-${inviteOld}@areca.local`,
        organizationId: ctx.org.id,
        role: 'editor',
        tokenHash: `h-${inviteOld}`,
        expiresAt: daysAgo(31),
      },
      {
        id: inviteRecent,
        email: `new-${inviteRecent}@areca.local`,
        organizationId: ctx.org.id,
        role: 'editor',
        tokenHash: `h-${inviteRecent}`,
        expiresAt: daysAgo(29),
      },
    ])
    cleanups.push(async () => {
      await db.delete(organization).where(eq(organization.id, ctx.org.id))
      await removeUsers([person.id, ctx.actor.id])
    })

    await runRetention(NOW)

    const sessions = await db
      .select({ id: session.id })
      .from(session)
      .where(inArray(session.id, [sessionOld, sessionRecent]))
    expect(sessions.map((row) => row.id)).toEqual([sessionRecent])
    const tokens = await db
      .select({ id: verification.id })
      .from(verification)
      .where(inArray(verification.id, [tokenOld, tokenRecent]))
    expect(tokens.map((row) => row.id)).toEqual([tokenRecent])
    const invites = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(inArray(invitation.id, [inviteOld, inviteRecent]))
    expect(invites.map((row) => row.id)).toEqual([inviteRecent])
    expect(RETENTION.sessionDays).toBe(7)
  })

  it('keeps the newest build jobs per site and jobs that need reconciling; prunes old jobs a request points at', async () => {
    const ctx = await createTestSite()
    cleanups.push(async () => {
      await db.delete(organization).where(eq(organization.id, ctx.org.id))
      await removeUsers([ctx.actor.id])
    })
    const pub = await insertPublication({ siteId: ctx.site.id })
    // 22 old finished jobs. The newest 20 (by creation) survive.
    const jobs = []
    for (let i = 0; i < 22; i++) {
      jobs.push(
        await finishedJob(ctx.site.id, pub.id, {
          finishedDaysAgo: 100,
          createdDaysAgo: 100 + i,
        }),
      )
    }
    // Old but needs reconciling: never removed.
    const uncertain = await finishedJob(ctx.site.id, pub.id, {
      finishedDaysAgo: 200,
      createdDaysAgo: 300,
      status: 'failed',
      dispatchUncertain: true,
    })
    // Old and referenced by a publication request: pruned, and the request
    // keeps its record with the job cleared.
    const referenced = await finishedJob(ctx.site.id, pub.id, {
      finishedDaysAgo: 200,
      createdDaysAgo: 301,
    })
    const requestId = crypto.randomUUID()
    await db.insert(publicationRequest).values({
      id: requestId,
      siteId: ctx.site.id,
      actorId: 'test',
      operation: 'publish',
      payload: '{}',
      publicationId: pub.id,
      jobId: referenced.id,
    })

    await runRetention(NOW)

    const kept = await db
      .select({ id: buildJob.id })
      .from(buildJob)
      .where(
        inArray(buildJob.id, [
          ...jobs.map((j) => j.id),
          uncertain.id,
          referenced.id,
        ]),
      )
    const keptIds = new Set(kept.map((row) => row.id))
    // jobs are ordered by createdDaysAgo ascending = newest first: index 0..19 kept.
    for (const job of jobs.slice(0, 20)) expect(keptIds.has(job.id)).toBe(true)
    for (const job of jobs.slice(20)) expect(keptIds.has(job.id)).toBe(false)
    expect(keptIds.has(uncertain.id)).toBe(true)
    expect(keptIds.has(referenced.id)).toBe(false)
    const [request] = await db
      .select({
        jobId: publicationRequest.jobId,
        publicationId: publicationRequest.publicationId,
      })
      .from(publicationRequest)
      .where(eq(publicationRequest.id, requestId))
    expect(request).toEqual({ jobId: null, publicationId: pub.id })
  })

  it('never removes publications', async () => {
    const ctx = await createTestSite()
    cleanups.push(async () => {
      await db.delete(organization).where(eq(organization.id, ctx.org.id))
      await removeUsers([ctx.actor.id])
    })
    const pub = await insertPublication({
      siteId: ctx.site.id,
      createdAt: daysAgo(900),
    })

    await runRetention(NOW)

    const [still] = await db
      .select({ id: publication.id })
      .from(publication)
      .where(eq(publication.id, pub.id))
    expect(still?.id).toBe(pub.id)
  })
})
