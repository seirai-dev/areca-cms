import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { publication } from '#/db/schema'
import { globalsAsEntryLists } from '#/lib/globals'
import type { Snapshot } from '#/lib/types'
import { snapshotAssets } from '#/server/assets/published-assets'
import { authenticateSite } from '#/server/content/site-auth'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function getSitesSnapshotCurrent(request: Request) {
  const site = await authenticateSite(request)
  if (!site) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE },
    )
  }

  const requestedId = new URL(request.url).searchParams.get('publicationId')
  if (requestedId !== null && !requestedId.trim()) {
    return Response.json(
      { error: 'publicationId must not be empty' },
      { status: 400, headers: NO_STORE },
    )
  }
  // Build pulls select their frozen publication explicitly. Ordinary pulls
  // read only successful releases, even while a new deployment is in flight.
  const pub = (
    await db
      .select()
      .from(publication)
      .where(
        and(
          eq(publication.siteId, site.id),
          requestedId
            ? eq(publication.id, requestedId)
            : eq(
                publication.status,
                site.publishingMode === 'demo' ? 'demo' : 'live',
              ),
        ),
      )
      .orderBy(desc(publication.createdAt))
      .limit(1)
  ).at(0)

  if (!pub) {
    return Response.json(
      { error: 'No publication exists' },
      { status: 404, headers: NO_STORE },
    )
  }

  const snapshot: Snapshot = {
    ...pub.snapshot,
    publicationId: pub.id,
    // Publications stored before the asset list existed get it computed.
    assets:
      pub.snapshot.assets ??
      (await snapshotAssets(site.organizationId, {
        ...pub.snapshot.collections,
        ...globalsAsEntryLists(pub.snapshot.globals),
      })),
    siteUrl: siteOrigin(site.productionUrl),
  }

  return Response.json(snapshot, { headers: NO_STORE })
}

/** Lets sites build absolute URLs (og:image) for files they host themselves. */
function siteOrigin(productionUrl: string): string | null {
  try {
    const url = new URL(productionUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export const Route = createFileRoute('/api/sites/snapshot/current')({
  server: {
    handlers: {
      GET: ({ request }) => getSitesSnapshotCurrent(request),
    },
  },
})
