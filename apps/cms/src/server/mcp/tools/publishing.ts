import { randomUUID } from 'node:crypto'

import { and, eq, or } from 'drizzle-orm'

import { db } from '#/db'
import { publication } from '#/db/schema'
import { z } from '#/lib/zod'

import { updateSite } from '#/server/admin/sites'
import { m } from '#/paraglide/messages'
import { ConflictError } from '#/server/content/errors'
import { isDevSite } from '#/server/security/site-visibility'
import {
  cancelJob,
  getSiteReleaseStatus,
  listPublications,
  requestPublication,
  requestRollback,
} from '#/server/publishing/publications'
import { listPendingRelease } from '#/server/publishing/release-diff'

import type { McpActor } from '../keys'
import {
  loadBuildJobInSite,
  loadPublicationInSite,
  loadSiteRow,
} from '../scope'
import { idSchema } from '../schemas'
import { GO_LIVE_KEY_NOTE, PRODUCTION_ONLY } from '../tool-kit'
import type { ToolCollector } from '../tool-kit'
import { isDeploymentConfigured } from './site'

/** True when the site has ever gone live in production (a publication was live). */
async function everWentLive(siteId: string): Promise<boolean> {
  const row = (
    await db
      .select({ id: publication.id })
      .from(publication)
      .where(
        and(
          eq(publication.siteId, siteId),
          or(eq(publication.wasLive, true), eq(publication.status, 'live')),
        ),
      )
      .limit(1)
  ).at(0)
  return row !== undefined
}

type JobLike = {
  id: string
  status: string
  attempts: number
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  error: string | null
}

function describeOptional(pub: PublicationLike | null | undefined) {
  return pub ? describePublication(pub) : null
}

function describeJob(job: JobLike | null) {
  if (!job) return null
  return {
    jobId: job.id,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error ?? null,
  }
}

type PublicationLike = {
  id: string
  status: string
  publishingMode: string
  createdAt: Date
  deployedAt: Date | null
  job?: JobLike | null
}

function describePublication(pub: PublicationLike) {
  return {
    publicationId: pub.id,
    status: pub.status,
    publishingMode: pub.publishingMode,
    createdAt: pub.createdAt.toISOString(),
    deployedAt: pub.deployedAt?.toISOString() ?? null,
    job: describeJob(pub.job ?? null),
  }
}

export function registerPublishingTools(registry: ToolCollector): void {
  registry.add({
    name: 'set_publishing_mode',
    title: 'Set publishing mode',
    description:
      'Agency admin only. Sets how this site publishes. "demo": go_live builds a release that `areca pull` can fetch without a deployment; demo releases never reach visitors. "production": go_live builds and deploys to the live site, which needs a deployment target with an application ID and a health check URL (set in Settings › Deployment). A site that has ever gone live in production cannot switch to demo; change it in Settings › Deployment instead. Setting the mode the site already has changes nothing. Returns publishingMode and deploymentConfigured.',
    inputSchema: z.object({
      mode: z
        .enum(['demo', 'production'])
        .describe(
          '"demo" for previews fetched with areca pull, "production" for the live site.',
        ),
    }),
    access: 'agency',
    deniedMessage:
      'Only agency admins can change the publishing mode. Ask an agency admin.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor: McpActor) => {
      const current = await loadSiteRow(actor)
      if (current.publishingMode === input.mode) {
        return {
          publishingMode: current.publishingMode,
          deploymentConfigured: isDeploymentConfigured(current),
        }
      }
      if (isDevSite(current) && input.mode === 'production') {
        throw new ConflictError(m.server_dev_env_stays_demo())
      }
      if (input.mode === 'demo' && (await everWentLive(actor.siteId))) {
        throw new ConflictError(
          'This site has gone live in production, so it cannot switch to demo mode. Change the publishing mode in Settings › Deployment instead.',
        )
      }
      if (input.mode === 'production' && !isDeploymentConfigured(current)) {
        throw new ConflictError(
          'Production publishing needs a deployment target with an application ID and a health check URL. Set them in Settings › Deployment first, or keep demo mode.',
        )
      }
      await updateSite(
        actor.siteId,
        { publishingMode: input.mode },
        actor.userId,
      )
      // This tool does not touch the deployment target, so the loaded row still holds it.
      return {
        publishingMode: input.mode,
        deploymentConfigured: isDeploymentConfigured(current),
      }
    },
  })

  registry.add({
    name: 'get_release_status',
    title: 'Get release status',
    environments: PRODUCTION_ONLY,
    description:
      'Shows what is live now, what is ready (approved) but not yet live (pendingChanges: entries marked ready, scheduled entries, and entries withdrawn since the last go live; languageChange: languages added, removed, or a new main language, or null), whether a build is running, and the publishing mode. Call this to answer "what is live" and "what is pending". Read-only.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (_input, actor) => {
      const status = await getSiteReleaseStatus(actor.siteId)
      const pending = await listPendingRelease(actor.siteId)
      return {
        publishingMode: status.publishingMode,
        live: describeOptional(status.live),
        demo: describeOptional(status.demo),
        activeJob: describeJob(status.activeJob),
        pendingCount: status.pendingEntries,
        languageChange: pending.languages,
        pendingChanges: pending.changes.map((change) => ({
          id: change.id,
          title: change.title,
          slug: change.slug,
          collection: change.collectionKey,
          kind: change.kind,
          scheduledAt: change.scheduledAt
            ? new Date(change.scheduledAt).toISOString()
            : null,
        })),
      }
    },
  })

  registry.add({
    name: 'list_publications',
    title: 'List publications',
    environments: PRODUCTION_ONLY,
    description:
      'Lists recent go lives of the site, newest first: publicationId, status (pending, building, live, failed, superseded, rolled_back), who requested it, and its build job. Use publicationId with rollback. Read-only.',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('How many to return, 1-50. Default 10.'),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const rows = await listPublications(actor.siteId, {
        limit: input.limit ?? 10,
      })
      return rows.map((row) => ({
        ...describePublication(row),
        requestedBy: row.requestedByName,
      }))
    },
  })

  registry.add({
    name: 'get_build_job',
    title: 'Get build job',
    environments: PRODUCTION_ONLY,
    description:
      'Returns one go-live build job: status (queued, building, validating, deploying, succeeded, failed, cancelled), attempts, timing and error text. Read-only.',
    inputSchema: z.object({ jobId: idSchema('build job') }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const job = await loadBuildJobInSite(actor, input.jobId)
      return describeJob(job)
    },
  })

  registry.add({
    name: 'go_live',
    title: 'Go live',
    environments: PRODUCTION_ONLY,
    description: `Goes live: builds every ready change and deploys it, so the live site shows what is approved. Only call this when the user asks to go live. It queues a build; follow it with get_build_job or get_release_status. ${GO_LIVE_KEY_NOTE}`,
    inputSchema: z.object({
      note: z
        .string()
        .max(500)
        .optional()
        .describe(
          'Short note saved with the publication, e.g. "Spring menu update".',
        ),
    }),
    access: 'go-live',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor: McpActor) => {
      const result = await requestPublication({
        siteId: actor.siteId,
        actorId: actor.userId,
        requestKey: randomUUID(),
        note: input.note,
      })
      if (!result.ok) {
        throw new ConflictError(result.errors.join(' '))
      }
      return {
        queued: true,
        publicationId: result.publication.id,
        jobId: result.job?.id ?? null,
        note: 'The build is queued. Use get_build_job with this jobId to follow it.',
      }
    },
  })

  registry.add({
    name: 'rollback',
    title: 'Roll back to a publication',
    environments: PRODUCTION_ONLY,
    description: `Goes live again with an earlier publication, which reverts the live site to it. Only call this when the user asks to roll back. Get publicationId from list_publications. ${GO_LIVE_KEY_NOTE}`,
    inputSchema: z.object({ publicationId: idSchema('publication') }),
    access: 'go-live',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      await loadPublicationInSite(actor, input.publicationId)
      await requestRollback({
        siteId: actor.siteId,
        publicationId: input.publicationId,
        actorId: actor.userId,
        requestKey: randomUUID(),
      })
      return {
        queued: true,
        note: 'The rollback is queued. Use get_release_status to follow it.',
      }
    },
  })

  registry.add({
    name: 'cancel_build',
    title: 'Cancel queued build',
    environments: PRODUCTION_ONLY,
    description: `Cancels a build job that is still queued (not started). Running builds cannot be cancelled. Get jobId from get_release_status. ${GO_LIVE_KEY_NOTE}`,
    inputSchema: z.object({ jobId: idSchema('build job') }),
    access: 'go-live',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      await loadBuildJobInSite(actor, input.jobId)
      const job = await cancelJob(input.jobId, actor.userId)
      return describeJob(job)
    },
  })
}
