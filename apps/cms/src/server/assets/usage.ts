import { sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
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
 * - Deleters and reference checks (asset delete, organization delete,
 *   development-environment copy/push/refresh/delete) take
 *   `assetExclusiveLock` (EXCLUSIVE), which excludes every attacher until
 *   COMMIT. Deleting a reference-checked asset therefore never races a save
 *   that attaches it. The usage count shown to an AI (`assetUsage`) is a
 *   plain read: no lock keeps a displayed number true after it returns.
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

const SAFE_TOKEN = /^[A-Za-z0-9._-]+$/

/** One character as written, or percent-encoded in either hex case. */
function encodedChar(char: string): string {
  const hex = char
    .charCodeAt(0)
    .toString(16)
    .padStart(2, '0')
    .replace(/[a-f]/g, (digit) => `[${digit}${digit.toUpperCase()}]`)
  return `(?:${char === '.' ? '\\.' : char}|%${hex})`
}

/**
 * PostgreSQL regex over `jsonb::text` that keeps every document which could
 * reference one of these assets, by `referencesAsset` or as a rich-text image
 * `src`. Exact ids appear verbatim. A URL that resolves to a storage key keeps
 * the key's final segment in order: each character literal or percent-encoded,
 * possibly split by a tab or newline that URL parsing strips (`\t`, `\n`, `\r`
 * in JSON text). Null when an id or key segment has other characters: the
 * caller must then keep every row.
 */
export function assetReferencePattern(
  assets: readonly { id: string; storageKey: string }[],
): string | null {
  const alternatives: string[] = []
  for (const item of assets) {
    const tail = item.storageKey.slice(item.storageKey.lastIndexOf('/') + 1)
    if (!SAFE_TOKEN.test(tail) || !SAFE_TOKEN.test(item.id)) return null
    alternatives.push(item.id.replace(/[.]/g, '\\.'))
    alternatives.push([...tail].map(encodedChar).join('(?:\\\\[tnr])*'))
  }
  return alternatives.length ? alternatives.join('|') : null
}

/** SQL filter from `assetReferencePattern`, over any of the given jsonb columns. */
export function mayReferenceAssets(
  assets: readonly { id: string; storageKey: string }[],
  columns: (AnyColumn | SQL)[],
): SQL {
  const pattern = assetReferencePattern(assets)
  if (pattern === null) return sql`true`
  // One regex per column: the jsonb -> text conversion is the expensive part.
  const tests = columns.map((column) => sql`(${column})::text ~ ${pattern}`)
  return sql`(${sql.join(tests, sql` or `)})`
}
