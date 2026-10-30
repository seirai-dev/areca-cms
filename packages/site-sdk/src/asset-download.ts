/**
 * Downloading a media file from the CMS. Kept apart from assets.ts (which
 * writes files with node:fs and node:crypto) so the client, and so the SDK's
 * main entry, stays safe to load in a browser.
 */
import type { SnapshotAsset } from './types.js'

const DOWNLOAD_TIMEOUT_MS = 60_000

export type AssetDownloader = (asset: SnapshotAsset) => Promise<Uint8Array>

/** Downloads from the CMS the SDK talks to (`ARECA_CMS_URL`), not the URL in the content. */
export function cmsAssetDownloader(
  cmsUrl: string,
  fetchImpl: typeof fetch = fetch,
): AssetDownloader {
  const base = cmsUrl.replace(/\/+$/, '')
  return async (asset) => {
    const path = asset.storageKey.split('/').map(encodeURIComponent).join('/')
    let res: Response
    try {
      res = await fetchImpl(`${base}/api/assets/file/${path}`, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`could not reach ${base}: ${detail}`)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

