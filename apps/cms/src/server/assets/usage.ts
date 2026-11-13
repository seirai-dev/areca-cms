import { sql } from 'drizzle-orm'
import type { Tx } from '#/db'

/*
 * Asset reference invariant (per organization): a committed reference to an
 * asset is only written by a transaction that validated the asset as present
 * under the lock, and an asset is only deleted when no committed content
 * references it. Both sides use the same advisory key, `assets:<orgId>`:
 *
 * - Attachers write references (entry saves, publish, schedule, restore,
 *   archiving deleted content, uploads). They take `assetAttachLock` (SHARED),
 *   so they run concurrently with each other and only wait for deleters.
 * - Deleters and reference checks (asset delete, asset usage, organization
 *   delete, development-environment copy/push/refresh/delete) take
 *   `assetExclusiveLock` (EXCLUSIVE), which excludes every attacher until
 *   COMMIT. Deleting a reference-checked asset therefore never races a save
 *   that attaches it.
 *
 * Attachers do not need to exclude each other: they only add references and
 * validate existence, and nothing derives state from the set of references.
 * Take the lock before validating asset existence or writing references; take
 * it before any entry row write, so lock order matches the dev-environment
 * ordering comments. A transaction that writes link-index rows takes the site's
 * link-index lock before this one (`lockSiteLinkIndex`, entry-link-index.ts).
 */
const assetLockKey = (organizationId: string) =>
  sql`hashtextextended(${`assets:${organizationId}`}, 0)`

/** Shared: taken by every transaction that attaches asset references. */
export async function assetAttachLock(tx: Tx, organizationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(${assetLockKey(organizationId)})`,
  )
}

/** Exclusive: taken by asset deletion, reference checks and bulk dev-env writes. */
export async function assetExclusiveLock(tx: Tx, organizationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${assetLockKey(organizationId)})`,
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
