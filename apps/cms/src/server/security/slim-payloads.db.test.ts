import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { buildJob } from '#/db/schema'
import { publishEntry } from '#/server/content/entries'
import {
  getEntryFn,
  getGlobalFn,
  updateDraftFn,
  updateGlobalDraftFn,
} from '#/server/fn/content'
import { getSitesOverviewFn } from '#/server/fn/overview'
import {
  getBuildJobFn,
  getSiteReleaseStatusFn,
  listBuildJobsFn,
  listPublicationsFn,
} from '#/server/fn/publishing'
import { callServerFn, seedWorld } from '#/server/security/authz-harness'
import type { World } from '#/server/security/authz-harness'
import type { TestSession } from '#/server/security/authz-state'
import { sampleRichText } from '#/server/content/test-utils'

vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})
vi.mock('#/lib/auth', async () =>
  (await import('#/server/security/authz-state')).fakeAuth(),
)
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))
vi.mock('@tanstack/react-start', async (importOriginal) =>
  (await import('#/server/security/authz-start-patch')).patchStart(
    await importOriginal(),
  ),
)

const hasDb = Boolean(process.env.DATABASE_URL)

async function call<T>(fn: unknown, data: unknown, session: TestSession) {
  const outcome = await callServerFn(
    fn as Parameters<typeof callServerFn>[0],
    data,
    session,
  )
  if (outcome.error) throw outcome.error
  return outcome.result as T
}

type Row = Record<string, unknown>

describe.skipIf(!hasDb)('polled and autosave payloads stay small', () => {
  let w: World

  beforeAll(async () => {
    w = await seedWorld()
    await db
      .update(buildJob)
      .set({ logs: 'BUILD LOG LINE', status: 'failed', error: 'boom' })
      .where(eq(buildJob.id, w.X.job.id))
  })

  afterAll(async () => {
    await w.destroy()
  })

  it('lists publications without the snapshot, with the newest job and no logs', async () => {
    const older = await w.fresh.job(w.X.site.id, w.X.publication.id, 'queued')
    await db
      .update(buildJob)
      .set({ createdAt: new Date(Date.now() - 60_000), status: 'cancelled' })
      .where(eq(buildJob.id, older.id))

    const rows = await call<Row[]>(
      listPublicationsFn,
      { siteId: w.X.site.id },
      w.sessions.editorX,
    )
    const row = rows.find((item) => item.id === w.X.publication.id)!
    expect(row).toBeDefined()
    expect(row).not.toHaveProperty('snapshot')
    expect(row).not.toHaveProperty('entryVersions')
    expect(row).toMatchObject({
      status: 'live',
      wasLive: true,
      snapshotHash: w.X.publication.snapshotHash,
      publishingMode: 'production',
      origin: 'manual',
    })
    const job = row.job as Row
    expect(job.id).toBe(w.X.job.id)
    expect(job).toMatchObject({ status: 'failed', error: 'boom' })
    expect(job).not.toHaveProperty('logs')
    expect(JSON.stringify(rows)).not.toContain('"siteKey"')
  })

  it('lists build jobs without logs; the job read still has them', async () => {
    const jobs = await call<Row[]>(
      listBuildJobsFn,
      { siteId: w.X.site.id, limit: 5 },
      w.sessions.editorX,
    )
    const listed = jobs.find((job) => job.id === w.X.job.id)!
    expect(listed).toMatchObject({
      publicationId: w.X.publication.id,
      status: 'failed',
      error: 'boom',
      attempts: 0,
      dispatchUncertain: false,
    })
    expect(listed).not.toHaveProperty('logs')

    const single = await call<Row>(
      getBuildJobFn,
      { id: w.X.job.id },
      w.sessions.editorX,
    )
    expect(single.logs).toBe('BUILD LOG LINE')
  })

  it('keeps the job log read to members of the site', async () => {
    await expect(
      call(getBuildJobFn, { id: w.X.job.id }, w.sessions.ownerY),
    ).rejects.toBeTruthy()
  })

  it('reports release status without publication snapshots or job logs', async () => {
    const queued = await w.fresh.job(w.X.site.id, w.X.publication.id, 'queued')
    await db
      .update(buildJob)
      .set({ logs: 'QUEUED LOG' })
      .where(eq(buildJob.id, queued.id))
    try {
      const status = await call<Row>(
        getSiteReleaseStatusFn,
        { siteId: w.X.site.id },
        w.sessions.editorX,
      )
      expect(status.live).toMatchObject({ id: w.X.publication.id })
      expect(status.live).not.toHaveProperty('snapshot')
      expect(status.activeJob).toMatchObject({
        id: queued.id,
        status: 'queued',
      })
      expect(status.activeJob).not.toHaveProperty('logs')
      expect(JSON.stringify(status)).not.toContain('"siteKey"')
    } finally {
      await db.delete(buildJob).where(eq(buildJob.id, queued.id))
    }
  })

  it('answers an autosave with the saved draft but not the other copies', async () => {
    const created = await w.fresh.entry('X')
    const published = await publishEntry(created.id, w.users.ownerX.id)
    const saved = await call<Row>(
      updateDraftFn,
      {
        id: created.id,
        data: {
          title: 'Edited title',
          slug: published.slug,
          body: sampleRichText,
        },
        expectedVersion: published.draftVersion,
      },
      w.sessions.editorX,
    )
    expect(saved).toMatchObject({
      id: created.id,
      draftVersion: published.draftVersion + 1,
      status: 'published',
      slug: published.slug,
      sectionChanges: [],
      importedImages: 0,
    })
    expect((saved.draftData as Row).title).toBe('Edited title')
    for (const key of [
      'publishedData',
      'scheduledData',
      'originBaseline',
      'headingBaseline',
    ]) {
      expect(saved).not.toHaveProperty(key)
    }

    const loaded = await call<Row>(
      getEntryFn,
      { id: created.id },
      w.sessions.editorX,
    )
    expect((loaded.publishedData as Row).title).toBe(`Entry ${created.slug}`)
    expect(loaded).toHaveProperty('scheduledData')
    expect(loaded).not.toHaveProperty('originBaseline')
    expect(loaded).not.toHaveProperty('headingBaseline')

    // The version check still refuses a stale save.
    await expect(
      call(
        updateDraftFn,
        {
          id: created.id,
          data: { title: 'Stale', slug: published.slug, body: sampleRichText },
          expectedVersion: published.draftVersion,
        },
        w.sessions.editorX,
      ),
    ).rejects.toThrow(/DRAFT_CONFLICT/)
  })

  it('answers a site content save without the other copies', async () => {
    const g = await w.fresh.global('X')
    const saved = await call<Row>(
      updateGlobalDraftFn,
      {
        siteId: w.X.site.id,
        key: g.collection.key,
        data: { email: 'hi@x.test' },
        expectedVersion: g.entry.draftVersion,
      },
      w.sessions.editorX,
    )
    expect(saved.draftVersion).toBe(g.entry.draftVersion + 1)
    expect(saved).not.toHaveProperty('publishedData')
    expect(saved).not.toHaveProperty('headingBaseline')

    const loaded = await call<{ entry: Row }>(
      getGlobalFn,
      { siteId: w.X.site.id, key: g.collection.key },
      w.sessions.editorX,
    )
    expect(loaded.entry).toHaveProperty('publishedData')
    expect(loaded.entry).not.toHaveProperty('headingBaseline')
    expect(loaded.entry).not.toHaveProperty('originBaseline')
  })

  it('flags sites whose newest build failed in the sites overview', async () => {
    const overview = await call<{ sites: Row[] }>(
      getSitesOverviewFn,
      undefined,
      w.sessions.ownerX,
    )
    const x = overview.sites.find((site) => site.id === w.X.site.id)
    expect(x?.lastBuildFailed).toBe(true)
    // Same scope as before: another client's site is not listed.
    expect(overview.sites.some((site) => site.id === w.Y.site.id)).toBe(false)

    const admin = await call<{ sites: Row[] }>(
      getSitesOverviewFn,
      undefined,
      w.sessions.adminMfa,
    )
    expect(
      admin.sites.find((site) => site.id === w.Y.site.id)?.lastBuildFailed,
    ).toBe(false)
  })

  it('ignores a cancelled build newer than the failed one', async () => {
    const cancelled = await w.fresh.job(
      w.X.site.id,
      w.X.publication.id,
      'queued',
    )
    await db
      .update(buildJob)
      .set({ status: 'cancelled' })
      .where(eq(buildJob.id, cancelled.id))
    try {
      const overview = await call<{ sites: Row[] }>(
        getSitesOverviewFn,
        undefined,
        w.sessions.ownerX,
      )
      expect(
        overview.sites.find((site) => site.id === w.X.site.id)?.lastBuildFailed,
      ).toBe(true)
    } finally {
      await db.delete(buildJob).where(eq(buildJob.id, cancelled.id))
    }
  })
})
