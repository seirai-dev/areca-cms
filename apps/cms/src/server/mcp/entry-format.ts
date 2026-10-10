import type { Asset } from '#/server/assets'
import { ValidationError } from '#/server/content/errors'
import { SEO_KEY } from '#/lib/seo'
import { isEditedSinceReady } from '#/features/golive/entry-live-state'
import type { EntryData, EntryStatus, Field } from '#/lib/types'

import type { ReleaseFlags } from './release-flags'
import {
  markdownToRichText,
  richTextToMarkdown,
} from '#/server/richtext/from-markdown'

/**
 * Conversion between the shapes agents read and write and the shapes the CMS
 * stores. Pure functions (no database access): callers load the assets and
 * pass them in, so these stay unit-testable.
 */

export const ASSET_FILE_PREFIX = '/api/assets/file/'

type AssetRow = Pick<Asset, 'id' | 'storageKey' | 'altText'>

/** Assets an entry write or read touches, by id and by storage key. */
export type AssetLookup = {
  byId: Map<string, AssetRow>
  byStorageKey: Map<string, AssetRow>
}

/** Asset ids a write mentions (image fields, the SEO OG image, Markdown images). */
export function collectAssetIds(
  fields: Field[],
  input: Record<string, unknown>,
  seo: Record<string, unknown> | null | undefined,
): string[] {
  const ids = new Set<string>()
  for (const field of fields) {
    const value = input[field.key]
    if (field.type === 'image') {
      const id = imageAssetId(value)
      if (id) ids.add(id)
    }
    if (field.type === 'richtext' && typeof value === 'string') {
      for (const id of markdownAssetIds(value)) ids.add(id)
    }
  }
  if (typeof seo?.ogImage === 'string' && seo.ogImage) ids.add(seo.ogImage)
  return [...ids]
}

export function markdownAssetIds(markdown: string): string[] {
  const ids = new Set<string>()
  // Use the converter's parsed image nodes, including titles and references,
  // while excluding examples inside fenced/inline code.
  markdownToRichText(markdown, {
    resolveAssetSrc: (id) => {
      ids.add(id)
      return null
    },
  })
  return [...ids]
}

function imageAssetId(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (value && typeof value === 'object' && 'assetId' in value) {
    const id: unknown = value.assetId
    return typeof id === 'string' && id ? id : null
  }
  return null
}

/**
 * Converts agent input (Markdown rich text, asset and entry shorthands) into
 * the stored data shape. Unknown keys are rejected here with the list of valid
 * fields. Remaining rules (required, formats, references) are left to the
 * shared validator that the services run.
 */
export function toStoredFields(
  fields: Field[],
  input: Record<string, unknown>,
  assets: AssetLookup,
): EntryData {
  const declared = new Map(fields.map((field) => [field.key, field]))
  const unknown = Object.keys(input).filter((key) => !declared.has(key))
  if (unknown.length > 0) {
    const valid = fields.map((field) => field.key).join(', ')
    throw new ValidationError(
      unknown.map((key) => ({
        path: `fields.${key}`,
        message:
          key === SEO_KEY
            ? 'use the seo object instead of fields.$seo'
            : `unknown field. Valid fields: ${valid}`,
      })),
    )
  }

  const out: EntryData = {}
  for (const [key, value] of Object.entries(input)) {
    const field = declared.get(key)
    if (!field) continue
    out[key] = convertValue(field, value, assets)
  }
  return out
}

/** Text-like fields keep an empty string; every other type treats "" as "no value". */
const KEEPS_EMPTY_STRING = new Set<Field['type']>([
  'text',
  'textarea',
  'richtext',
])

function convertValue(
  field: Field,
  value: unknown,
  assets: AssetLookup,
): unknown {
  if (value === null || value === undefined) return null
  if (value === '' && !KEEPS_EMPTY_STRING.has(field.type)) return null
  if (field.type === 'richtext' && typeof value === 'string') {
    const missing = markdownAssetIds(value).filter((id) => !assets.byId.has(id))
    if (missing.length > 0) {
      throw new ValidationError([
        {
          path: `fields.${field.key}`,
          message: `image asset ${missing[0]} was not found in this organization. Upload it with upload_asset_from_url or list_assets first.`,
        },
      ])
    }
    return markdownToRichText(value, {
      resolveAssetSrc: (id) => {
        const row = assets.byId.get(id)
        return row ? ASSET_FILE_PREFIX + row.storageKey : null
      },
    })
  }
  if (field.type === 'image') {
    return imageAssetId(value) ?? value
  }
  if (
    field.type === 'reference' &&
    typeof value === 'object' &&
    'entryId' in value
  ) {
    return value.entryId
  }
  return value
}

/**
 * The input schema has no nullable keys, so clearing is spelled per type: an
 * empty string clears a string key, false clears a boolean, and an empty array
 * clears a list. This turns those spellings into the `null` that mergeSeo removes.
 */
export function seoPatchFromInput(
  seo: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (seo === undefined) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(seo)) {
    const cleared =
      value === '' ||
      value === false ||
      (Array.isArray(value) && value.length === 0)
    out[key] = cleared ? null : value
  }
  return out
}

/**
 * Applies an SEO patch to the stored block. A key set to null is removed.
 * Returns undefined when nothing is left, so no empty `$seo` is stored.
 */
export function mergeSeo(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...(current ?? {}) }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null || value === undefined) delete next[key]
    else next[key] = value
  }
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * Stored image links (/api/assets/file/<storageKey>) become `asset:<id>` so an
 * agent can reuse the reference when it writes the entry back.
 */
export function linkAssetRefs(markdown: string, assets: AssetLookup): string {
  return markdown.replace(
    /(!\[[^\]]*\])\((?:[^)\s]*?)\/api\/assets\/file\/([^)\s]+)\)/g,
    (whole, label: string, storageKey: string) => {
      const row = assets.byStorageKey.get(storageKey)
      return row ? `${label}(asset:${row.id})` : whole
    },
  )
}

export type AgentFieldValue =
  | string
  | number
  | boolean
  | null
  | { assetId: string; url: string | null; alt: string | null }
  | { entryId: string }
  | Record<string, unknown>
  | unknown[]

type FormatContext = {
  assets: AssetLookup
  assetUrl: (storageKey: string) => string
}

function formatValue(
  field: Field,
  value: unknown,
  ctx: FormatContext,
): AgentFieldValue | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  switch (field.type) {
    case 'richtext':
      return typeof value === 'object'
        ? linkAssetRefs(richTextToMarkdown(value), ctx.assets)
        : null
    case 'image': {
      if (typeof value !== 'string' || !value) return null
      const row = ctx.assets.byId.get(value)
      if (!row) return null
      return {
        assetId: row.id,
        url: ctx.assetUrl(row.storageKey),
        alt: row.altText ?? '',
      }
    }
    case 'reference':
      return typeof value === 'string' && value ? { entryId: value } : null
    default:
      return value as AgentFieldValue
  }
}

/** Entry status as agents see it. The stored 'published' is the UI's 'ready'. */
export const AGENT_STATUSES = [
  'draft',
  'ready',
  'scheduled',
  'archived',
] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

export function agentStatus(status: EntryStatus): AgentStatus {
  return status === 'published' ? 'ready' : status
}

/** Inverse of agentStatus, for filters. */
export function storedStatus(status: AgentStatus): EntryStatus {
  return status === 'ready' ? 'published' : status
}

export type EntryForFormat = {
  id: string
  slug: string
  status: EntryStatus
  draftVersion: number
  draftData: EntryData
  publishedData: EntryData | null
  publishedAt: Date | null
  scheduledAt: Date | null
  scheduleTimezone: string | null
  updatedAt: Date
  collectionKey: string
}

/**
 * Collection data goes under `fields` and system metadata sits at the top
 * level, so a collection field named like a system key (say `approvedAt`)
 * never collides with one.
 */
export function formatFields(
  fields: Field[],
  data: EntryData,
  ctx: FormatContext,
): Record<string, AgentFieldValue> {
  const out: Record<string, AgentFieldValue> = {}
  for (const field of fields) {
    const value = formatValue(field, data[field.key], ctx)
    if (value !== undefined) out[field.key] = value
  }
  return out
}

/** Full entry as an agent reads it. `liveFields` only when asked for. */
export function formatEntry(input: {
  entry: EntryForFormat
  fields: Field[]
  ctx: FormatContext
  release: ReleaseFlags
  previewAvailable: boolean
  includePublished: boolean
  liveFields?: Record<string, unknown> | null
}) {
  const { entry, fields, ctx } = input
  const seo = readSeo(entry.draftData)
  const editedSinceReady = isEditedSinceReady(entry)
  return {
    id: entry.id,
    collection: entry.collectionKey,
    status: agentStatus(entry.status),
    live: input.release.live,
    pendingRelease: input.release.pendingRelease,
    slug: entry.slug,
    version: entry.draftVersion,
    updatedAt: entry.updatedAt.toISOString(),
    approvedAt: entry.publishedAt?.toISOString() ?? null,
    scheduledAt: entry.scheduledAt?.toISOString() ?? null,
    scheduleTimezone: entry.scheduleTimezone,
    previewAvailable: input.previewAvailable,
    editedSinceReady,
    fields: formatFields(fields, entry.draftData, ctx),
    seo,
    ...(input.includePublished
      ? {
          liveFields: input.liveFields ?? null,
          approvedFields: formatFields(fields, entry.publishedData ?? {}, ctx),
        }
      : {}),
  }
}

/** Short row for list_entries. Title is the `title` field, else the first text field. */
export function summarizeEntry(
  entry: Pick<
    EntryForFormat,
    'id' | 'slug' | 'status' | 'draftVersion' | 'draftData' | 'updatedAt'
  >,
  fields: Field[],
  release: ReleaseFlags,
) {
  const titleField =
    fields.find((field) => field.key === 'title') ??
    fields.find((field) => field.type === 'text')
  const title = titleField ? entry.draftData[titleField.key] : undefined
  return {
    id: entry.id,
    slug: entry.slug,
    status: agentStatus(entry.status),
    live: release.live,
    pendingRelease: release.pendingRelease,
    title: typeof title === 'string' ? title : null,
    version: entry.draftVersion,
    updatedAt: entry.updatedAt.toISOString(),
  }
}

function readSeo(data: EntryData): Record<string, unknown> {
  const value = data[SEO_KEY]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Snapshot values retain the live schema and frozen asset metadata. */
export function formatSnapshotFields(
  data: Record<string, unknown>,
  assets: AssetLookup,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const item = value as Record<string, unknown>
        if (typeof item.markdown === 'string' && 'json' in item) {
          return [key, linkAssetRefs(item.markdown, assets)]
        }
        if (
          typeof item.id === 'string' &&
          'collection' in item &&
          'slug' in item
        ) {
          return [key, { entryId: item.id }]
        }
        if (typeof item.url === 'string' && 'mimeType' in item) {
          const path = new URL(item.url, 'https://asset.local').pathname
          const row = assets.byStorageKey.get(
            decodeURIComponent(path.slice(ASSET_FILE_PREFIX.length)),
          )
          return [
            key,
            { assetId: row?.id ?? null, url: item.url, alt: item.alt ?? '' },
          ]
        }
      }
      return [key, value]
    }),
  )
}
