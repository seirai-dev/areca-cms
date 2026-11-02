import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { createMockDeploymentAdapter } from '#/adapters/deployment/mock'
import type { DeploymentAdapter } from '#/adapters/deployment/types'
import { db } from '#/db'
import { buildJob, cloudflareCredential, publication, site } from '#/db/schema'
import type { DeploymentTarget, Snapshot } from '#/lib/types'
import { withTestSite } from '#/server/content/test-utils'
import { processJob } from './worker'

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const CONNECTION_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`
const HEALTH = 'https://site.example.test/health'

const pagesTarget: DeploymentTarget = {
  provider: 'cloudflare',
  kind: 'pages',
  projectName: 'areca-site',
  branch: 'main',
  healthCheckUrl: HEALTH,
}
const workersTarget: DeploymentTarget = {
  provider: 'cloudflare',
  kind: 'workers',
  scriptName: 'areca-worker',
  scriptTag: 'e'.repeat(32),
  triggerUuid: '11111111-2222-4333-8444-555555555555',
  branch: 'main',
  healthCheckUrl: HEALTH,
}

function keyFor(resourceId: string) {
  return createHash('sha256')
    .update(`${CONNECTION_URL}\n${resourceId}`)
    .digest('hex')
}

async function insertCredential(organizationId: string) {
  await db.insert(cloudflareCredential).values({
    organizationId,
    accountId: ACCOUNT_ID,
    // Not decrypted by these tests: the resource key only reads the account ID.
    encryptedApiToken: 'ciphertext-not-read-by-these-tests',
    tokenLast4: '1234',
  })
}

async function queue(siteId: string, target: DeploymentTarget) {
  await db
    .update(site)
    .set({ deploymentTarget: target })
    .where(eq(site.id, siteId))
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
  return { pub, job }
}

async function state(jobId: string) {
  return (await db.select().from(buildJob).where(eq(buildJob.id, jobId)))[0]
}

const noAudit = async () => {}

function adapterDoing(deploymentId: string): DeploymentAdapter {
  return {
    ...createMockDeploymentAdapter(),
    deploy: vi.fn(async () => ({ deploymentId })),
  }
}

describe.skipIf(!process.env.DATABASE_URL)('Cloudflare dispatch', () => {
  it('resolves the adapter with the whole Pages target and freezes a connection-scoped key', () =>
    withTestSite(async ({ site: s }) => {
      await insertCredential(s.organizationId)
      const { job } = await queue(s.id, pagesTarget)
      const adapter = adapterDoing('dep-1')
      const resolveAdapter = vi.fn(async () => adapter)

      await processJob(job, { resolveAdapter, audit: noAudit })

      expect(resolveAdapter).toHaveBeenCalledWith(s.organizationId, pagesTarget)
      expect(adapter.deploy).toHaveBeenCalledWith(
        pagesTarget,
        expect.any(Function),
        expect.objectContaining({ jobId: job.id }),
      )
      expect(await state(job.id)).toMatchObject({
        status: 'succeeded',
        upstreamDeploymentId: 'dep-1',
        dispatchConnectionUrl: CONNECTION_URL,
        deploymentResourceKey: keyFor('areca-site'),
        dispatchTarget: pagesTarget,
      })
    }))

  it('resolves the adapter with the whole Workers target and keys it by script tag', () =>
    withTestSite(async ({ site: s }) => {
      await insertCredential(s.organizationId)
      const { job } = await queue(s.id, workersTarget)
      const resolveAdapter = vi.fn(async () => adapterDoing('build-1'))

      await processJob(job, { resolveAdapter, audit: noAudit })

      expect(resolveAdapter).toHaveBeenCalledWith(
        s.organizationId,
        workersTarget,
      )
      expect(await state(job.id)).toMatchObject({
        status: 'succeeded',
        upstreamDeploymentId: 'build-1',
        deploymentResourceKey: keyFor('e'.repeat(32)),
      })
    }))

  it('fails the job with the credentials message and never dispatches without Cloudflare credentials', () =>
    withTestSite(async ({ site: s }) => {
      const { job } = await queue(s.id, pagesTarget)

      await processJob(job, { audit: noAudit })

      expect(await state(job.id)).toMatchObject({
        status: 'failed',
        dispatchUncertain: false,
        dispatchStartedAt: null,
      })
      expect((await state(job.id)).error).toContain(
        'Cloudflare credentials are not configured for this client',
      )
    }))
})
