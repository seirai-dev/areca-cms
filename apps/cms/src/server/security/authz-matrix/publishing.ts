import type * as publishingFns from '#/server/fn/publishing'
import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import { buildJob, publication } from '#/db/schema'

import { absent, exists, uniq } from './shared'
import type { MatrixFor } from './shared'

export const publishingRows = {
  requestPublicationFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      return {
        data: { siteId: s.id, requestKey: crypto.randomUUID() },
        untouched: absent(publication, eq(publication.siteId, s.id)),
      }
    },
  },
  requestRollbackFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      const p = await w.fresh.publication(s.id, `rb-${uniq()}`, 'superseded')
      return {
        data: {
          siteId: s.id,
          publicationId: p.id,
          requestKey: crypto.randomUUID(),
        },
        untouched: absent(buildJob, eq(buildJob.siteId, s.id)),
      }
    },
  },
  listPublicationsFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  listBuildJobsFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  getBuildJobFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.job.id } }),
  },
  cancelJobFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      const p = await w.fresh.publication(s.id, `cj-${uniq()}`, 'superseded')
      const j = await w.fresh.job(s.id, p.id, 'queued')
      return {
        data: { id: j.id },
        untouched: exists(
          buildJob,
          and(eq(buildJob.id, j.id), eq(buildJob.status, 'queued')),
        ),
      }
    },
  },
  reconcileDeploymentJobFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      const p = await w.fresh.publication(
        s.id,
        `reconcile-${uniq()}`,
        'superseded',
      )
      const j = await w.fresh.job(s.id, p.id, 'succeeded')
      await db
        .update(buildJob)
        .set({ status: 'failed', dispatchUncertain: true })
        .where(eq(buildJob.id, j.id))
      return {
        data: { id: j.id },
        untouched: exists(
          buildJob,
          and(eq(buildJob.id, j.id), eq(buildJob.attempts, 0)),
        ),
      }
    },
  },
  resolveUncertainDeploymentJobFn: {
    policy: 'agency',
    doc: 'agency admin (MFA); reason and upstream-stop confirmation required',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      const p = await w.fresh.publication(
        s.id,
        `resolve-${uniq()}`,
        'superseded',
      )
      const j = await w.fresh.job(s.id, p.id, 'succeeded')
      await db
        .update(buildJob)
        .set({ status: 'failed', dispatchUncertain: true })
        .where(eq(buildJob.id, j.id))
      return {
        data: {
          id: j.id,
          reason: 'Verified upstream stopped and queue drained',
          upstreamStopped: true,
        },
        untouched: exists(
          buildJob,
          and(eq(buildJob.id, j.id), eq(buildJob.dispatchUncertain, true)),
        ),
      }
    },
  },
  getSiteReleaseStatusFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  listPendingReleaseChangesFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
} satisfies MatrixFor<typeof publishingFns>
