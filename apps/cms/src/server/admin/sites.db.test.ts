import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { buildJob, publication, site } from '#/db/schema'
import type { DeploymentTarget, Snapshot } from '#/lib/types'
import { ConflictError } from '#/server/content/errors'
import { withTestSite } from '#/server/content/test-utils'
import { getSiteReleaseStatus } from '#/server/publishing/publications'

import { updateSite } from './sites'

const HEALTH = 'https://site.example.test/health'
const pagesTarget: DeploymentTarget = {
  provider: 'cloudflare',
  kind: 'pages',
  projectName: 'areca-site',
  branch: 'main',
  healthCheckUrl: HEALTH,
}
const dokployTarget: DeploymentTarget = {
  provider: 'dokploy',
  applicationId: 'app-1',
  healthCheckUrl: HEALTH,
}

/** Leaves a release queued for the site, as a go live would. */
async function queueRelease(siteId: string) {
  const [pub] = await db
    .insert(publication)
    .values({
      siteId,
      snapshot: { hash: 'hash', collections: {} } as unknown as Snapshot,
      snapshotHash: 'hash',
      status: 'pending',
    })
    .returning()
  const [job] = await db
    .insert(buildJob)
    .values({ siteId, publicationId: pub.id })
    .returning()
  return job
}

async function storedSite(siteId: string) {
  return (await db.select().from(site).where(eq(site.id, siteId)))[0]
}

describe.skipIf(!process.env.DATABASE_URL)(
  'updating a site while a release is pending',
  () => {
    it('refuses a deployment target change while a job is queued', () =>
      withTestSite(async ({ site: s, actor }) => {
        await queueRelease(s.id)
        await expect(
          updateSite(s.id, { deploymentTarget: pagesTarget }, actor.id),
        ).rejects.toThrow(ConflictError)
        await expect(
          updateSite(s.id, { deploymentTarget: pagesTarget }, actor.id),
        ).rejects.toThrow(
          'before changing the deployment settings of this site',
        )
        expect((await storedSite(s.id)).deploymentTarget).toBeNull()
      }))

    it('refuses a publishing mode change while a job is queued', () =>
      withTestSite(async ({ site: s, actor }) => {
        await queueRelease(s.id)
        const next = s.publishingMode === 'demo' ? 'production' : 'demo'
        await expect(
          updateSite(s.id, { publishingMode: next }, actor.id),
        ).rejects.toThrow(ConflictError)
        expect((await storedSite(s.id)).publishingMode).toBe(s.publishingMode)
      }))

    it('still changes the name while a job is queued', () =>
      withTestSite(async ({ site: s, actor }) => {
        await queueRelease(s.id)
        const updated = await updateSite(
          s.id,
          { name: 'Renamed Site' },
          actor.id,
        )
        expect(updated.name).toBe('Renamed Site')
      }))

    it('changes the deployment target when nothing is pending', () =>
      withTestSite(async ({ site: s, actor }) => {
        const updated = await updateSite(
          s.id,
          { deploymentTarget: dokployTarget },
          actor.id,
        )
        expect(updated.deploymentTarget).toEqual(dokployTarget)
      }))

    it('accepts saving the same target and mode unchanged while a job is queued', () =>
      withTestSite(async ({ site: s, actor }) => {
        await updateSite(s.id, { deploymentTarget: pagesTarget }, actor.id)
        const current = await storedSite(s.id)
        await queueRelease(s.id)
        const updated = await updateSite(
          s.id,
          {
            publishingMode: current.publishingMode,
            deploymentTarget: { ...pagesTarget },
          },
          actor.id,
        )
        expect(updated.deploymentTarget).toEqual(pagesTarget)
      }))

    it('reports the pending release in the site release status', () =>
      withTestSite(async ({ site: s }) => {
        expect((await getSiteReleaseStatus(s.id)).deploymentPending).toBe(false)
        await queueRelease(s.id)
        expect((await getSiteReleaseStatus(s.id)).deploymentPending).toBe(true)
      }))
  },
)
