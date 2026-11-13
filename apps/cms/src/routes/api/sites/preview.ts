import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import {
  buildPreviewEntry,
  buildPreviewGlobal,
} from '#/server/content/snapshot-preview'
import {
  decodePreviewToken,
  verifyPreviewToken,
} from '#/server/content/preview-token'
import { findSite } from '#/server/content/site-core'

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

  const found = await findSite(decoded.siteId)
  if (!found) {
    return previewJson({ error: 'Unauthorized' }, 401)
  }

  const payload = verifyPreviewToken(token, found.previewSecret)
  if (!payload) {
    return previewJson({ error: 'Unauthorized' }, 401)
  }

  // `?locale=` wins over the locale in the token.
  const locale =
    new URL(request.url).searchParams.get('locale') || payload.locale || null

  if (payload.global !== undefined) {
    const section = await buildPreviewGlobal(
      payload.siteId,
      payload.global,
      locale,
    )
    if (!section) {
      return previewJson({ error: 'Not found' }, 404)
    }
    return previewJson({
      kind: 'global' as const,
      global: payload.global,
      entry: section,
    })
  }

  const entry = await buildPreviewEntry(
    payload.siteId,
    payload.collection,
    payload.slug,
    locale,
  )
  if (!entry) {
    return previewJson({ error: 'Not found' }, 404)
  }

  return previewJson({
    kind: 'entry' as const,
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
