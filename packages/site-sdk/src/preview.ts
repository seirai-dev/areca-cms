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
  /** Language to preview in. Omit for the CMS default. */
  locale?: string
}): Promise<PreviewResult> {
  const client = options.client ?? createArecaClient()
  return options.locale === undefined
    ? client.fetchPreview(options.token)
    : client.fetchPreview(options.token, { locale: options.locale })
}
