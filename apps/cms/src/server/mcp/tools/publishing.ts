import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { ConflictError } from '#/server/content/errors'
import {
  cancelJob,
  getSiteReleaseStatus,
  listPublications,
  requestPublication,
  requestRollback,
} from '#/server/publishing/publications'
import { listPendingReleaseChanges } from '#/server/publishing/release-diff'

import type { McpActor } from '../keys'
import { loadBuildJobInSite, loadPublicationInSite } from '../scope'
import { idSchema } from '../schemas'
import type { ToolRegistry } from '../tool-kit'

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

export function registerPublishingTools(registry: ToolRegistry): void {
  registry.add({
    name: 'get_release_status',
    title: 'Get release status',
    description:
      'Shows what is live now, what is ready (approved) but not yet live (pendingChanges: entries marked ready, scheduled entries, and entries withdrawn since the last go live), whether a build is running, and the publishing mode. Call this to answer "what is live" and "what is pending". Read-only.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (_input, actor) => {
      const status = await getSiteReleaseStatus(actor.siteId)
      const pending = await listPendingReleaseChanges(actor.siteId)
      return {
        publishingMode: status.publishingMode,
        live: describeOptional(status.live),
        demo: describeOptional(status.demo),
        activeJob: describeJob(status.activeJob),
        pendingCount: status.pendingEntries,
        pendingChanges: pending.map((change) => ({
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
    description:
      'Goes live: builds every ready change and deploys it, so the live site shows what is approved. Only call this when the user asks to go live. It queues a build; follow it with get_build_job or get_release_status. Requires a key with the "Allow going live" option.',
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
    description:
      'Goes live again with an earlier publication, which reverts the live site to it. Only call this when the user asks to roll back. Get publicationId from list_publications. Requires a key with the "Allow going live" option.',
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
    description:
      'Cancels a build job that is still queued (not started). Running builds cannot be cancelled. Get jobId from get_release_status. Requires a key with the "Allow going live" option.',
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
