import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'
import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { publication } from '#/db/schema'
import { globalsAsEntryLists } from '#/lib/globals'
import type { Snapshot } from '#/lib/types'
import { snapshotAssets } from '#/server/assets/published-assets'
import { buildSnapshot } from '#/server/content/snapshot'
import { authenticateSite } from '#/server/content/site-auth'
import { isDevSite } from '#/lib/site-environment'

const NO_STORE = { 'Cache-Control': 'no-store' }
// A stored publication may be kept by the puller and revalidated with its ETag.
const REVALIDATE = { 'Cache-Control': 'private, no-cache' }

export async function getSitesSnapshotCurrent(request: Request) {
  const site = await authenticateSite(request)
  if (!site) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE },
    )
  }

  const requestedId = new URL(request.url).searchParams.get('publicationId')
  if (isDevSite(site)) {
    // Dev envs have no releases (docs/design/dev-environments.md, Decision 7).
    // The live pull builds the snapshot from the dev env's ready content.
    if (requestedId !== null) {
      return Response.json(
        {
          error:
            'Development environments have no releases. Pull without a publication id.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    return devSnapshot(site)
  }
  if (requestedId !== null && !requestedId.trim()) {
    return Response.json(
      { error: 'publicationId must not be empty' },
      { status: 400, headers: NO_STORE },
    )
  }
  // Build pulls select their frozen publication explicitly. Ordinary pulls
  // read only successful releases, even while a new deployment is in flight.
  const found = (
    await db
      .select({
        id: publication.id,
        snapshotHash: publication.snapshotHash,
        hasAssets: sql<boolean>`${publication.snapshot} ? 'assets'`,
      })
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

  if (!found) {
    return Response.json(
      { error: 'No publication exists' },
      { status: 404, headers: NO_STORE },
    )
  }

  const siteUrl = siteOrigin(site.productionUrl)
  // A stored snapshot never changes, so its response is fixed by the
  // publication and the site URL. Older publications without a stored asset
  // list get one computed from current assets, so they get no ETag.
  const etag = found.hasAssets
    ? snapshotEtag(found.id, found.snapshotHash, siteUrl)
    : null
  if (etag && etagMatches(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, {
      status: 304,
      headers: { ...REVALIDATE, ETag: etag },
    })
  }
  const pub = (
    await db
      .select({ id: publication.id, snapshot: publication.snapshot })
      .from(publication)
      .where(and(eq(publication.siteId, site.id), eq(publication.id, found.id)))
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
    siteUrl,
  }

  return Response.json(snapshot, {
    headers: etag ? { ...REVALIDATE, ETag: etag } : NO_STORE,
  })
}

/** Strong validator for a stored publication served with this site URL. */
function snapshotEtag(
  publicationId: string,
  snapshotHash: string,
  siteUrl: string | null,
): string {
  const digest = createHash('sha256')
    .update(`${publicationId}\n${snapshotHash}\n${siteUrl ?? ''}`)
    .digest('hex')
  return `"${digest.slice(0, 40)}"`
}

/** `If-None-Match` per RFC 9110: a list of tags, `*`, weak tags compared weakly. */
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false
  if (header.trim() === '*') return true
  return header
    .split(',')
    .some((tag) => tag.trim().replace(/^W\//, '') === etag)
}

/**
 * Live pull for a development environment: the same builder that freezes a
 * publication, run in memory and never stored. `publicationId` is null.
 */
async function devSnapshot(site: { id: string; productionUrl: string }) {
  const built = await buildSnapshot(site.id)
  if (!built.ok) {
    return Response.json(
      {
        error: 'The development environment has content that cannot be pulled.',
        errors: built.errors,
      },
      { status: 422, headers: NO_STORE },
    )
  }
  return Response.json(
    {
      ...built.snapshot,
      publicationId: null,
      siteUrl: siteOrigin(site.productionUrl),
    },
    { headers: NO_STORE },
  )
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
