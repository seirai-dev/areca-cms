import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createMockDeploymentAdapter } from '#/adapters/deployment/mock'
import {
  DeploymentNotDispatchedError,
  DeploymentUncertainError,
} from '#/adapters/deployment/types'
import type { DeploymentAdapter } from '#/adapters/deployment/types'
import { db } from '#/db'
import { auditLog, buildJob, publication, site, user } from '#/db/schema'
import type { Snapshot } from '#/lib/types'
import { withTestSite } from '#/server/content/test-utils'
import { getSitesSnapshotCurrent } from '#/routes/api/sites/snapshot/current'
import {
  processJob,
  reconcileDeploymentJob,
  recoverStaleJobs,
  resolveUncertainDeploymentJob,
} from './worker'

const target = {
  provider: 'dokploy' as const,
  applicationId: 'original-app',
  healthCheckUrl: 'http://localhost:3999',
}
async function queue(siteId: string) {
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

describe.skipIf(!process.env.DATABASE_URL)(
  'section 7 deployment delivery',
  () => {
    it('persists intent before dispatch and passes publication identity', async () =>
      withTestSite(async ({ site: s }) => {
        const { job, pub } = await queue(s.id)
        const adapter: DeploymentAdapter = {
          ...createMockDeploymentAdapter(),
          deploy: async (receivedTarget, _log, context) => {
            expect(receivedTarget).toEqual(target)
            expect(context).toEqual({
              jobId: job.id,
              publicationId: pub.id,
              snapshotHash: 'hash',
            })
            const persisted = await state(job.id)
            expect(persisted.dispatchStartedAt).toBeInstanceOf(Date)
            expect(persisted.dispatchUncertain).toBe(true)
            expect(persisted.dispatchTarget).toEqual(target)
            return { deploymentId: 'upstream-1' }
          },
        }
        await processJob(job, { adapter, audit: noAudit })
        expect(await state(job.id)).toMatchObject({
          status: 'succeeded',
          upstreamDeploymentId: 'upstream-1',
          dispatchUncertain: false,
        })
      }))

    it('quarantines unknown acceptance, preserves snapshot pin and prevents queued redispatch', async () =>
      withTestSite(async ({ site: s, token }) => {
        const { job, pub } = await queue(s.id)
        await processJob(job, {
          adapter: {
            ...createMockDeploymentAdapter(),
            deploy: async () => {
              throw new DeploymentUncertainError('response lost')
            },
          },
        })
        expect(await state(job.id)).toMatchObject({
          status: 'failed',
          dispatchUncertain: true,
        })
        const response = await getSitesSnapshotCurrent(
          new Request('http://cms.test/api/sites/snapshot/current', {
            headers: { authorization: `Bearer ${token}` },
          }),
        )
        expect(response.status).toBe(200)
        expect((await response.json()).publicationId).toBe(pub.id)
        const { job: next } = await queue(s.id)
        const deploy = vi.fn(async () => ({
          deploymentId: 'must-not-dispatch',
        }))
        await processJob(next, {
          adapter: { ...createMockDeploymentAdapter(), deploy },
        })
        expect(deploy).not.toHaveBeenCalled()
        expect((await state(next.id)).status).toBe('queued')
      }))

    it('reconciles the same dispatch and original target without another POST', async () =>
      withTestSite(async ({ site: s }) => {
        const { job, pub } = await queue(s.id)
        await processJob(job, {
          adapter: {
            ...createMockDeploymentAdapter(),
            deploy: async () => {
              throw new DeploymentUncertainError('response lost')
            },
          },
        })
        await db
          .update(site)
          .set({
            deploymentTarget: { ...target, applicationId: 'changed-app' },
          })
          .where(eq(site.id, s.id))
        const deploy = vi.fn(async () => ({
          deploymentId: 'must-not-dispatch',
        }))
        const reconcile = vi.fn(async (receivedTarget, context) => {
          expect(receivedTarget).toEqual(target)
          expect(context.publicationId).toBe(pub.id)
          return { deploymentId: 'accepted' }
        })
        const resumed = await reconcileDeploymentJob(job.id, {
          adapter: { ...createMockDeploymentAdapter(), deploy, reconcile },
          audit: noAudit,
        })
        expect(resumed).toMatchObject({
          status: 'succeeded',
          dispatchUncertain: false,
          upstreamDeploymentId: 'accepted',
        })
        expect(deploy).not.toHaveBeenCalled()
        expect(reconcile).toHaveBeenCalledOnce()
      }))

    it('leaves missing reconciliation identity blocked', async () =>
      withTestSite(async ({ site: s }) => {
        const { job } = await queue(s.id)
        await processJob(job, {
          adapter: {
            ...createMockDeploymentAdapter(),
            deploy: async () => {
              throw new DeploymentUncertainError('response lost')
            },
          },
        })
        const deploy = vi.fn(async () => ({
          deploymentId: 'must-not-dispatch',
        }))
        expect(
          await reconcileDeploymentJob(job.id, {
            adapter: {
              ...createMockDeploymentAdapter(),
              deploy,
              reconcile: async () => null,
            },
          }),
        ).toMatchObject({ status: 'failed', dispatchUncertain: true })
        expect(deploy).not.toHaveBeenCalled()
      }))

    it('retains uncertainty on polling timeout but allows safe retry after confirmed non-dispatch', async () =>
      withTestSite(async ({ site: s }) => {
        const { job } = await queue(s.id)
        await processJob(job, {
          adapter: {
            ...createMockDeploymentAdapter(),
            deploy: async () => {
              throw new DeploymentNotDispatchedError('preparation failed')
            },
          },
        })
        expect(await state(job.id)).toMatchObject({
          status: 'failed',
          dispatchUncertain: false,
        })
        const next = await queue(s.id)
        await processJob(next.job, {
          adapter: {
            ...createMockDeploymentAdapter(),
            waitForCompletion: async () => 'timeout',
          },
        })
        expect(await state(next.job.id)).toMatchObject({
          status: 'failed',
          dispatchUncertain: true,
          upstreamDeploymentId: 'mock',
        })
      }))

    it('keeps recovered malformed snapshots quarantined without dispatching', async () =>
      withTestSite(async ({ site: s }) => {
        const { job, pub } = await queue(s.id)
        await processJob(job, {
          adapter: {
            ...createMockDeploymentAdapter(),
            deploy: async () => {
              throw new DeploymentUncertainError('response lost')
            },
          },
        })
        await db
          .update(publication)
          .set({
            snapshot: { hash: '', collections: {} } as unknown as Snapshot,
          })
          .where(eq(publication.id, pub.id))
        const deploy = vi.fn(async () => ({
          deploymentId: 'must-not-dispatch',
        }))
        const reconcile = vi.fn(async () => ({ deploymentId: 'accepted' }))
        expect(
          await reconcileDeploymentJob(job.id, {
            adapter: { ...createMockDeploymentAdapter(), deploy, reconcile },
          }),
        ).toMatchObject({ status: 'failed', dispatchUncertain: true })
        expect(
          (
            await db
              .select()
              .from(publication)
              .where(eq(publication.id, pub.id))
          )[0].status,
        ).toBe('building')
        expect(deploy).not.toHaveBeenCalled()
        expect(reconcile).not.toHaveBeenCalled()
      }))

    it('does not let an expired worker clear its persisted dispatch pin', async () =>
      withTestSite(async ({ site: s }) => {
        const { job } = await queue(s.id)
        await processJob(job, {
          adapter: {
            ...createMockDeploymentAdapter(),
            deploy: async () => {
              await db
                .update(buildJob)
                .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
                .where(eq(buildJob.id, job.id))
              throw new DeploymentNotDispatchedError('late preparation failure')
            },
          },
        })
        expect(await state(job.id)).toMatchObject({
          status: 'deploying',
          dispatchUncertain: true,
        })
        await recoverStaleJobs()
        expect(await state(job.id)).toMatchObject({
          status: 'failed',
          dispatchUncertain: true,
        })
      }))

    it('quarantines lease expiry after dispatch intent', async () =>
      withTestSite(async ({ site: s }) => {
        const { job } = await queue(s.id)
        await db
          .update(buildJob)
          .set({
            status: 'deploying',
            dispatchStartedAt: new Date(),
            dispatchTarget: target,
            leaseExpiresAt: new Date(Date.now() - 1000),
          })
          .where(eq(buildJob.id, job.id))
        await recoverStaleJobs()
        expect(await state(job.id)).toMatchObject({
          status: 'failed',
          dispatchUncertain: true,
        })
      }))

    it('requires admin confirmation and records manual terminal resolution', async () =>
      withTestSite(async ({ site: s, actor }) => {
        const { job } = await queue(s.id)
        await processJob(job, {
          adapter: {
            ...createMockDeploymentAdapter(),
            deploy: async () => {
              throw new DeploymentUncertainError('response lost')
            },
          },
        })
        const input = {
          jobId: job.id,
          actorId: actor.id,
          reason: 'Verified upstream stopped and queue drained',
          upstreamStopped: true as const,
        }
        await expect(resolveUncertainDeploymentJob(input)).rejects.toThrow(
          /Only agency admins/,
        )
        await db
          .update(user)
          .set({ isAgencyAdmin: true })
          .where(eq(user.id, actor.id))
        await expect(
          resolveUncertainDeploymentJob({
            ...input,
            upstreamStopped: false as unknown as true,
          }),
        ).rejects.toThrow(/Confirm upstream/)
        expect(await resolveUncertainDeploymentJob(input)).toMatchObject({
          status: 'failed',
          dispatchUncertain: false,
        })
        expect(
          (
            await db
              .select()
              .from(auditLog)
              .where(eq(auditLog.action, 'publication.dispatch_resolved'))
          ).some((row) => row.meta?.jobId === job.id),
        ).toBe(true)
      }))
  },
)
