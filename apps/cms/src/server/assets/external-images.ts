import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { asset } from '#/db/schema'
import { RICHTEXT_MAX_NODES } from '#/lib/content-limits'
import type { EntryData, Field } from '#/lib/types'

import { AssetValidationError } from './errors'
import type { Asset } from './index'
import { RemoteFetchError, uploadAssetFromUrl } from './remote'

const ASSET_PATH_PREFIX = '/api/assets/'
const ASSET_FILE_PREFIX = '/api/assets/file/'
const IMPORT_CONCURRENCY = 4
// Autosave runs every few seconds: a URL that just failed is not fetched again
// until this window passes, so a dead link cannot stall every save.
const FAILURE_TTL_MS = 10 * 60 * 1000
const FAILURE_CACHE_LIMIT = 1000

const recentFailures = new Map<string, { until: number; message: string }>()

export type ExternalImageImport = {
  data: EntryData
  /** Image nodes whose src now points at the asset library. */
  imported: number
  /** One message per external URL that stayed external. */
  warnings: string[]
}

type ImportInput = {
  organizationId: string
  originSiteId?: string
  actorId: string | null
  fields: Field[]
  data: EntryData
}

type ImportDeps = {
  upload?: typeof uploadAssetFromUrl
  now?: () => number
}

/**
 * Copies external `http(s)` images embedded in rich text into the
 * organization's asset library and points the image nodes at the copies, so
 * published content only references CMS assets. The same source URL maps to
 * one asset per organization. Failures keep the external URL and are reported
 * as warnings instead of blocking the save.
 */
export async function importExternalImages(
  input: ImportInput,
  deps: ImportDeps = {},
): Promise<ExternalImageImport> {
  const nodes = new Map<string, ImageNode[]>()
  let data = input.data
  for (const field of input.fields) {
    if (field.type !== 'richtext') continue
    const value = data[field.key]
    if (!value || typeof value !== 'object') continue
    const found = externalImageNodes(value)
    if (found.length === 0) continue
    // Copy on first write: callers may still hold the original object.
    if (data === input.data) data = { ...input.data }
    const clone = structuredClone(value)
    data[field.key] = clone
    for (const node of externalImageNodes(clone)) {
      const list = nodes.get(node.attrs.src) ?? []
      list.push(node)
      nodes.set(node.attrs.src, list)
    }
  }
  if (nodes.size === 0) return { data: input.data, imported: 0, warnings: [] }

  const resolved = await resolveSources(input, [...nodes.keys()], deps)
  let imported = 0
  const warnings: string[] = []
  for (const [src, list] of nodes) {
    const result = resolved.get(src)
    if (result && 'storageKey' in result) {
      for (const node of list)
        node.attrs.src = ASSET_FILE_PREFIX + result.storageKey
      imported += list.length
    } else {
      warnings.push(
        `Couldn't copy the image ${src} into the media library, so it still loads from that site. ${result?.error ?? ''}`.trim(),
      )
    }
  }
  return { data: imported > 0 ? data : input.data, imported, warnings }
}

/** True when rich text in `data` still embeds images from outside the CMS. */
export function hasExternalImages(fields: Field[], data: EntryData): boolean {
  return fields.some(
    (field) =>
      field.type === 'richtext' &&
      externalImageNodes(data[field.key]).length > 0,
  )
}

type ImageNode = { attrs: { src: string } }

function externalImageNodes(value: unknown): ImageNode[] {
  const found: ImageNode[] = []
  // Iterative and bounded: the document is untrusted and may be nested deeply.
  const stack: unknown[] = [value]
  let visited = 0
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (++visited > RICHTEXT_MAX_NODES) break
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child)
      continue
    }
    const item = node as { type?: unknown; attrs?: unknown; content?: unknown }
    if (item.type === 'image' && isExternalSrc(item.attrs)) {
      found.push(item as ImageNode)
    }
    stack.push(item.content)
  }
  return found
}

function isExternalSrc(attrs: unknown): boolean {
  if (!attrs || typeof attrs !== 'object') return false
  const src = (attrs as { src?: unknown }).src
  if (typeof src !== 'string') return false
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  // Any `/api/assets/` path is already treated as a library asset by the
  // ownership checks, whatever its host.
  return !url.pathname.startsWith(ASSET_PATH_PREFIX)
}

type Resolution = { storageKey: string } | { error: string }

async function resolveSources(
  input: ImportInput,
  sources: string[],
  deps: ImportDeps,
): Promise<Map<string, Resolution>> {
  const now = deps.now ?? Date.now
  const resolved = new Map<string, Resolution>()
  for (const row of await findBySource(input.organizationId, sources)) {
    if (row.sourceUrl) resolved.set(row.sourceUrl, row)
  }

  const pending: string[] = []
  for (const src of sources) {
    if (resolved.has(src)) continue
    const failure = recentFailures.get(failureKey(input.organizationId, src))
    if (failure && failure.until > now()) {
      resolved.set(src, { error: failure.message })
    } else {
      pending.push(src)
    }
  }

  const upload = deps.upload ?? uploadAssetFromUrl
  const work = async (src: string) => {
    try {
      const row = await upload({
        organizationId: input.organizationId,
        originSiteId: input.originSiteId,
        url: src,
        actorId: input.actorId,
        sourceUrl: src,
      })
      resolved.set(src, row)
    } catch (error) {
      // A concurrent save imported the same URL first: reuse its asset.
      const existing = isUniqueViolation(error)
        ? (await findBySource(input.organizationId, [src])).at(0)
        : undefined
      if (existing) {
        resolved.set(src, existing)
        return
      }
      const message = importErrorMessage(error)
      rememberFailure(failureKey(input.organizationId, src), {
        until: now() + FAILURE_TTL_MS,
        message,
      })
      resolved.set(src, { error: message })
    }
  }
  for (let i = 0; i < pending.length; i += IMPORT_CONCURRENCY) {
    await Promise.all(pending.slice(i, i + IMPORT_CONCURRENCY).map(work))
  }
  return resolved
}

async function findBySource(
  organizationId: string,
  sources: string[],
): Promise<Asset[]> {
  if (sources.length === 0) return []
  return db
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.organizationId, organizationId),
        inArray(asset.sourceUrl, sources),
      ),
    )
}

function failureKey(organizationId: string, src: string): string {
  return `${organizationId}\n${src}`
}

function rememberFailure(
  key: string,
  value: { until: number; message: string },
): void {
  if (recentFailures.size >= FAILURE_CACHE_LIMIT) {
    const oldest = recentFailures.keys().next().value
    if (oldest !== undefined) recentFailures.delete(oldest)
  }
  recentFailures.set(key, value)
}

function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

function importErrorMessage(error: unknown): string {
  // Remote fetch and validation errors carry messages written for editors.
  if (
    error instanceof RemoteFetchError ||
    error instanceof AssetValidationError
  )
    return error.message
  console.error('[assets] external image import failed', error)
  return 'The download failed.'
}

/** Test hook: forget remembered download failures. */
export function resetExternalImageFailures(): void {
  recentFailures.clear()
}
