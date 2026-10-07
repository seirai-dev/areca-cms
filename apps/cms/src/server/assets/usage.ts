import { sql } from 'drizzle-orm'
import type { db } from '#/db'

export type AssetTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]

/** Serialize attaching retained content and deleting assets within an organization. */
export async function assetMutationLock(
  tx: AssetTransaction,
  organizationId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`assets:${organizationId}`}, 0))`,
  )
}

/** Exact IDs and structured asset URLs, including legacy rich-text image src values. */
export function referencesAsset(
  value: unknown,
  asset: { id: string; storageKey: string },
): boolean {
  if (typeof value === 'string') {
    if (value === asset.id || value === asset.storageKey) return true
    // Cheap rejection before URL parsing. A URL can only resolve to this key's
    // path if it still contains the key's final segment verbatim, or if URL
    // parsing/decoding rewrote it (percent-escapes, backslashes, tab/newline).
    const tail = asset.storageKey.slice(asset.storageKey.lastIndexOf('/') + 1)
    if (!value.includes(tail) && !/[%\\\t\n\r]/.test(value)) return false
    try {
      const pathname = decodeURIComponent(
        new URL(value, 'http://asset.local').pathname,
      )
      return pathname === `/api/assets/file/${asset.storageKey}`
    } catch {
      return false
    }
  }
  if (Array.isArray(value))
    return value.some((item) => referencesAsset(item, asset))
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => referencesAsset(item, asset))
  }
  return false
}
