import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { buildJob, publication } from '#/db/schema'
import type { Snapshot } from '#/lib/types'
import { authenticateSite } from '#/server/content/site-auth'

const ACTIVE_JOB_STATUSES = ['building', 'validating', 'deploying'] as const

export async function getSitesSnapshotCurrent(request: Request) {
  const site = await authenticateSite(request)
  if (!site) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [activeJob] = await db
    .select({ publicationId: buildJob.publicationId })
    .from(buildJob)
    .where(
      and(
        eq(buildJob.siteId, site.id),
        inArray(buildJob.status, [...ACTIVE_JOB_STATUSES]),
      ),
    )
    .orderBy(desc(buildJob.startedAt), desc(buildJob.createdAt))
    .limit(1)

  let pub: typeof publication.$inferSelect | undefined
  if (activeJob) {
    const [found] = await db
      .select()
      .from(publication)
      .where(
        and(
          eq(publication.id, activeJob.publicationId),
          eq(publication.siteId, site.id),
        ),
      )
      .limit(1)
    pub = found
  }

  if (!pub) {
    const [live] = await db
      .select()
      .from(publication)
      .where(
        and(eq(publication.siteId, site.id), eq(publication.status, 'live')),
      )
      .orderBy(desc(publication.createdAt))
      .limit(1)
    pub = live
  }

  if (!pub) {
    return Response.json({ error: 'No publication exists' }, { status: 404 })
  }

  const snapshot: Snapshot = {
    ...pub.snapshot,
    publicationId: pub.id,
  }

  return Response.json(snapshot)
}

export const Route = createFileRoute('/api/sites/snapshot/current')({
  server: {
    handlers: {
      GET: ({ request }) => getSitesSnapshotCurrent(request),
    },
  },
})
