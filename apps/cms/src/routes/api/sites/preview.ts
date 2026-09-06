import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { site } from '#/db/schema'
import { buildPreviewEntry } from '#/server/content/snapshot'
import {
  decodePreviewToken,
  verifyPreviewToken,
} from '#/server/content/preview-token'

export async function getSitesPreview(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  if (!token) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const decoded = decodePreviewToken(token)
  if (!decoded) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [found] = await db
    .select()
    .from(site)
    .where(eq(site.id, decoded.siteId))
    .limit(1)
  if (!found) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = verifyPreviewToken(token, found.previewSecret)
  if (!payload) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const entry = await buildPreviewEntry(
    payload.siteId,
    payload.collection,
    payload.slug,
  )
  if (!entry) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  return Response.json(
    { collection: payload.collection, slug: payload.slug, entry },
    { headers: { 'X-Robots-Tag': 'noindex' } },
  )
}

export const Route = createFileRoute('/api/sites/preview')({
  server: {
    handlers: {
      GET: ({ request }) => getSitesPreview(request),
    },
  },
})
