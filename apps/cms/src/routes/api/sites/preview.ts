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

// Preview payloads are draft content behind a signed, expiring token: never let
// a browser, proxy or CDN store any response from this route (401/404 included).
const PREVIEW_HEADERS = {
  'Cache-Control': 'no-store, private',
  'X-Robots-Tag': 'noindex',
}

function previewJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: PREVIEW_HEADERS })
}

export async function getSitesPreview(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  if (!token) {
    return previewJson({ error: 'Unauthorized' }, 401)
  }

  const decoded = decodePreviewToken(token)
  if (!decoded) {
    return previewJson({ error: 'Unauthorized' }, 401)
  }

  const [found] = await db
    .select()
    .from(site)
    .where(eq(site.id, decoded.siteId))
    .limit(1)
  if (!found) {
    return previewJson({ error: 'Unauthorized' }, 401)
  }

  const payload = verifyPreviewToken(token, found.previewSecret)
  if (!payload) {
    return previewJson({ error: 'Unauthorized' }, 401)
  }

  const entry = await buildPreviewEntry(
    payload.siteId,
    payload.collection,
    payload.slug,
  )
  if (!entry) {
    return previewJson({ error: 'Not found' }, 404)
  }

  return previewJson({
    collection: payload.collection,
    slug: payload.slug,
    entry,
  })
}

export const Route = createFileRoute('/api/sites/preview')({
  server: {
    handlers: {
      GET: ({ request }) => getSitesPreview(request),
    },
  },
})
