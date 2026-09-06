import { createArecaClient, type ArecaClient } from './client.js'
import type { PreviewResult } from './types.js'

export function previewHeaders(): {
  'X-Robots-Tag': 'noindex, nofollow'
  'Cache-Control': 'no-store'
} {
  return {
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
  }
}

export async function getPreviewEntry(options: {
  token: string
  client?: ArecaClient
}): Promise<PreviewResult> {
  const client = options.client ?? createArecaClient()
  return client.fetchPreview(options.token)
}
