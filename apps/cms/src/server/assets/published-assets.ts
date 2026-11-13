import type { DbReader } from '#/db'
import type { Snapshot, SnapshotAsset } from '#/lib/types'

import { assetUrl, loadAssetLookup } from './index'

// Storage keys are `<organization>/<uuid>.<ext>`. Matching on the path, not
// the origin, also finds URLs written while APP_URL had another value.
const ASSET_FILE_URL =
  /\/api\/assets\/file\/([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+)/g

/** Storage keys of every CMS file URL anywhere in published content. */
export function referencedStorageKeys(value: unknown): Set<string> {
  const keys = new Set<string>()
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const current = stack.pop()
    if (typeof current === 'string') {
      if (!current.includes('/api/assets/file/')) continue
      for (const match of current.matchAll(ASSET_FILE_URL)) {
        if (match[1]) keys.add(match[1])
      }
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item)
    } else if (current && typeof current === 'object') {
      for (const item of Object.values(current)) stack.push(item)
    }
  }
  return keys
}

/**
 * The organization's assets that published collections reference: image
 * fields, SEO images, JSON-LD, rich-text images and links to uploaded files.
 * URLs that do not resolve to an asset of this organization are left out.
 */
export async function snapshotAssets(
  organizationId: string,
  collections: Snapshot['collections'],
  connection?: DbReader,
): Promise<SnapshotAsset[]> {
  const keys = referencedStorageKeys(collections)
  if (keys.size === 0) return []
  const lookup = await loadAssetLookup(
    organizationId,
    { ids: [], storageKeys: keys },
    connection,
  )
  return [...lookup.byStorageKey.values()]
    .sort((a, b) => (a.storageKey < b.storageKey ? -1 : 1))
    .map((row) => ({
      id: row.id,
      storageKey: row.storageKey,
      url: assetUrl(row),
      filename: row.originalFilename,
      mimeType: row.mimeType,
      size: row.size,
    }))
}
