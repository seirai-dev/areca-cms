import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import { asset } from '#/db/schema'
import { RICHTEXT_MAX_NODES } from '#/lib/content-limits'

/** Legacy editor images store a URL; keep the same tenant boundary as image IDs. */
export async function richTextAssetsAuthorized(
  value: unknown,
  organizationId: string,
  connection: Pick<typeof db, 'select'> = db,
): Promise<boolean> {
  // Iterative and bounded: the document is untrusted and may be nested deeply.
  const stack: unknown[] = [value]
  let visited = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || typeof current !== 'object') continue
    if (++visited > RICHTEXT_MAX_NODES) return false
    if (Array.isArray(current)) {
      for (const child of current) stack.push(child)
      continue
    }
    const node = current as {
      type?: string
      attrs?: { src?: unknown }
      content?: unknown
    }
    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      let path: string
      try {
        path = decodeURIComponent(
          new URL(node.attrs.src, 'http://asset.local').pathname,
        )
      } catch {
        return false
      }
      const prefix = '/api/assets/file/'
      if (path.startsWith(prefix)) {
        const [row] = await connection
          .select({ id: asset.id })
          .from(asset)
          .where(
            and(
              eq(asset.organizationId, organizationId),
              eq(asset.storageKey, path.slice(prefix.length)),
            ),
          )
          .limit(1)
        if (!row) return false
      }
    }
    stack.push(node.content)
  }
  return true
}

const ASSET_PATH_PREFIX = '/api/assets/file/'

/**
 * Synchronous counterpart of the traversal above: the storage keys of embedded
 * organization assets, and whether any image `src` is malformed (which makes
 * the document unauthorized, exactly as `richTextAssetsAuthorized` decides).
 */
export function richTextAssetRefs(value: unknown): {
  storageKeys: string[]
  malformed: boolean
} {
  const storageKeys: string[] = []
  let malformed = false
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    const item = node as {
      type?: string
      attrs?: { src?: unknown }
      content?: unknown
    }
    if (item.type === 'image' && typeof item.attrs?.src === 'string') {
      try {
        const path = decodeURIComponent(
          new URL(item.attrs.src, 'http://asset.local').pathname,
        )
        if (path.startsWith(ASSET_PATH_PREFIX))
          storageKeys.push(path.slice(ASSET_PATH_PREFIX.length))
      } catch {
        malformed = true
      }
    }
    visit(item.content)
  }
  visit(value)
  return { storageKeys, malformed }
}

/** Same decision as `richTextAssetsAuthorized`, answered from a preloaded lookup. */
export function richTextAssetsAuthorizedFrom(
  value: unknown,
  lookup: { byStorageKey: Map<string, unknown> },
): boolean {
  const refs = richTextAssetRefs(value)
  return (
    !refs.malformed && refs.storageKeys.every((k) => lookup.byStorageKey.has(k))
  )
}
