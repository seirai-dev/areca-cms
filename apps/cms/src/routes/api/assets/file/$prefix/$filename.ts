import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { storageKeyFromRequest, streamAssetFile } from '#/server/assets'

type FileParams = {
  prefix?: string
  filename?: string
  _splat?: string
}

function storageKeyFromParams(params: FileParams): string | undefined {
  if (params.prefix && params.filename) {
    return `${params.prefix}/${params.filename}`
  }
  return params._splat || undefined
}

export async function GET({
  request,
  params,
}: {
  request: Request
  params: FileParams
}) {
  const storageKey =
    storageKeyFromRequest(request) ?? storageKeyFromParams(params)
  if (!storageKey) {
    return new Response('Not found', { status: 404 })
  }
  return streamAssetFile(storageKey)
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  })
}

export const Route = createFileRoute('/api/assets/file/$prefix/$filename')({
  server: {
    handlers: {
      GET,
      OPTIONS,
    },
  },
})
