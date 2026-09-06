import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { streamAssetFile } from '#/server/assets'

export async function GET({
  params,
}: {
  request: Request
  params: { _splat?: string }
}) {
  const storageKey = params._splat
  if (!storageKey) {
    return new Response('Not found', { status: 404 })
  }
  return streamAssetFile(storageKey)
}

export const Route = createFileRoute('/api/assets/file/$')({
  server: {
    handlers: {
      GET,
    },
  },
})
