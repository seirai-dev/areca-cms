import { z } from 'zod'

import { assetUrl, loadAssetLookup } from '#/server/assets'
import { siteAssetLookup } from '#/server/assets/site-scope'
import {
  richTextAssetsAuthorizedFrom,
  richTextAssetRefs,
} from '#/server/assets/richtext-ownership'
import { SEO_KEY } from '#/lib/seo'
import { ID_MAX_LENGTH, SEARCH_MAX_LENGTH } from '#/lib/content-limits'
import type { EntryData, Field } from '#/lib/types'
import {
  createEntry,
  getEntry,
  listEntries,
  listRevisions,
  updateDraft,
} from '#/server/content/entries'
import { pickDeclaredFields } from '#/server/content/validation'
import { ValidationError } from '#/server/content/errors'
import { McpNotFoundError } from '../errors'
import {
  signPreviewToken,
  buildPreviewUrl,
} from '#/server/content/preview-token'

import type { AssetLookup } from '../entry-format'
import {
  AGENT_STATUSES,
  collectAssetIds,
  formatEntry,
  formatSnapshotFields,
  ASSET_FILE_PREFIX,
  mergeSeo,
  seoPatchFromInput,
  storedStatus,
  summarizeEntry,
  toStoredFields,
} from '../entry-format'
import type { McpActor } from '../keys'
import { loadCollectionInSite, loadEntryInSite, loadSiteRow } from '../scope'
import { releaseFlags } from '../release-flags'
import { loadReleaseState } from '../release-state'
import { seoInputSchema, fieldsInputSchema, idSchema } from '../schemas'
import type { ToolRegistry } from '../tool-kit'

const collectionKey = z
  .string()
  .min(1)
  .max(ID_MAX_LENGTH)
  .describe('Collection key from get_site_info, e.g. "posts".')

const expectedVersion = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    'The "version" you last read with get_entry. If the entry changed since, the write is refused so you do not overwrite someone else. Omit to write against the current version.',
  )

/** Stored `$seo` from agent input: clearing spellings become nulls, which mergeSeo removes. */
function seoPatch(
  seo: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return seoPatchFromInput(seo)
}

async function assetLookupFor(
  actor: McpActor,
  fields: Field[],
  inputs: Record<string, unknown>,
  seo: Record<string, unknown> | null | undefined,
): Promise<AssetLookup> {
  const ids = collectAssetIds(fields, inputs, seo ?? undefined)
  const lookup = await siteAssetLookup(actor.organizationId, actor.siteId)
  const missing = ids.find((id) => !lookup.byId.has(id))
  if (missing)
    throw new ValidationError([
      {
        path: 'fields',
        message: `Asset ${missing} is not available to this site. Use list_assets or upload_asset_from_url.`,
      },
    ])
  return lookup
}

/** Lookup for read paths: every image id stored on the given entry data. */
async function assetLookupForData(
  actor: McpActor,
  fields: Field[],
  datas: EntryData[],
): Promise<AssetLookup> {
  const ids = new Set<string>()
  const storageKeys = new Set<string>()
  for (const data of datas) {
    for (const field of fields) {
      const value = data[field.key]
      if (field.type === 'image' && typeof value === 'string' && value)
        ids.add(value)
      if (field.type === 'richtext') {
        for (const key of richTextAssetRefs(value).storageKeys)
          storageKeys.add(key)
      }
    }
  }
  if (ids.size === 0 && storageKeys.size === 0)
    return { byId: new Map(), byStorageKey: new Map() }
  return loadAssetLookup(actor.organizationId, {
    ids: [...ids],
    storageKeys: [...storageKeys],
  })
}

async function previewUrlFor(
  actor: McpActor,
  collection: string,
  slug: string,
): Promise<string | null> {
  const siteRow = await loadSiteRow(actor)
  if (!siteRow.productionUrl) return null
  const token = signPreviewToken({
    siteId: siteRow.id,
    collection,
    slug,
    secret: siteRow.previewSecret,
  })
  return buildPreviewUrl(siteRow.productionUrl, collection, slug, token)
}

export async function formatStoredEntry(
  actor: McpActor,
  id: string,
  options: { includePublished?: boolean; withPreview?: boolean } = {},
) {
  const row = await getEntry(id)
  if (!row) throw new McpNotFoundError('This entry no longer exists.')
  const col = await loadCollectionInSite(actor, row.collectionKey)
  const assets = await assetLookupForData(actor, col.fields, [
    row.draftData,
    row.publishedData ?? {},
  ])
  const siteRow = await loadSiteRow(actor)
  const release = await loadReleaseState(actor.siteId)
  const liveEntry = options.includePublished
    ? release.liveSnapshot?.collections[row.collectionKey]?.find(
        (item) => item.id === row.id,
      )
    : undefined
  if (liveEntry) {
    const keys = new Set<string>()
    for (const value of Object.values(liveEntry.data)) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      for (const key of richTextAssetRefs(item.json).storageKeys) keys.add(key)
      if (typeof item.url === 'string') {
        const path = new URL(item.url, 'https://asset.local').pathname
        if (path.startsWith(ASSET_FILE_PREFIX))
          keys.add(decodeURIComponent(path.slice(ASSET_FILE_PREFIX.length)))
      }
    }
    const liveAssets = await loadAssetLookup(actor.organizationId, {
      ids: [],
      storageKeys: [...keys],
    })
    for (const [key, value] of liveAssets.byStorageKey)
      assets.byStorageKey.set(key, value)
  }
  const formatted = formatEntry({
    entry: row,
    fields: col.fields,
    ctx: { assets, assetUrl: (storageKey) => assetUrl({ storageKey }) },
    release: releaseFlags(release, row.id),
    previewAvailable: Boolean(siteRow.productionUrl),
    includePublished: options.includePublished ?? false,
    liveFields: liveEntry ? formatSnapshotFields(liveEntry.data, assets) : null,
  })
  if (!options.withPreview) return formatted
  return {
    ...formatted,
    previewUrl: await previewUrlFor(actor, row.collectionKey, row.slug),
  }
}

export function registerEntryTools(registry: ToolRegistry): void {
  registry.add({
    name: 'list_entries',
    title: 'List entries',
    description:
      'Lists entries in one collection, newest first. Each row has id, slug, status (draft, ready, scheduled or archived), live (on the production site now; demo previews do not count), pendingRelease (approved changes waiting for the next go live), title and version, plus total. "ready" means approved, not live: check live. Use search to find text in the slug or content, and status to filter. Page with limit and offset.',
    inputSchema: z.object({
      collection: collectionKey,
      status: z
        .enum(AGENT_STATUSES)
        .optional()
        .describe(
          'Only entries in this status: draft, ready (approved), scheduled or archived.',
        ),
      search: z
        .string()
        .max(SEARCH_MAX_LENGTH)
        .optional()
        .describe('Case-insensitive text to match in the slug or content.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Page size, 1-100. Default 20.'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Number of entries to skip. Default 0.'),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const col = await loadCollectionInSite(actor, input.collection)
      const limit = input.limit ?? 20
      const offset = input.offset ?? 0
      const [result, release] = await Promise.all([
        listEntries(actor.siteId, col.key, {
          status: input.status ? storedStatus(input.status) : undefined,
          search: input.search,
          limit,
          offset,
        }),
        loadReleaseState(actor.siteId),
      ])
      return {
        items: result.items.map((item) =>
          summarizeEntry(item, col.fields, releaseFlags(release, item.id)),
        ),
        total: result.total,
        nextOffset: offset + limit < result.total ? offset + limit : null,
      }
    },
  })

  registry.add({
    name: 'get_entry',
    title: 'Get entry',
    description:
      'Returns one entry: status (draft, ready, scheduled or archived), live (on the production site now; demo previews do not count), pendingRelease (approved changes waiting for the next go live), approvedAt, fields (rich text as Markdown, images as {assetId,url,alt}, references as {entryId}), seo, and version (pass it to update_entry as expectedVersion). Set includePublished to also get liveFields, the version visitors see now. Read-only.',
    inputSchema: z.object({
      id: idSchema('entry'),
      includePublished: z
        .boolean()
        .optional()
        .describe('Also return liveFields, the version visitors see now.'),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      return formatStoredEntry(actor, entry.id, {
        includePublished: input.includePublished,
      })
    },
  })

  registry.add({
    name: 'create_entry',
    title: 'Create entry',
    description:
      'Creates a draft entry in a collection. Call get_collection_schema first for the field formats. The slug is a field of the collection: the one with type "slug" (usually key "slug"). Put it in fields as lowercase letters, numbers and dashes, unique within the collection, e.g. fields.slug "my-first-post". Rich text takes Markdown, images take an asset id, and seo takes the SEO object. The new draft is not live: an owner marks it ready, and it goes live with the next release. Returns the saved entry and a preview URL.',
    inputSchema: z.object({
      collection: collectionKey,
      fields: fieldsInputSchema.optional(),
      seo: seoInputSchema.optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      const col = await loadCollectionInSite(actor, input.collection)
      const inputs = input.fields ?? {}
      const seo = seoPatch(input.seo)
      const assets = await assetLookupFor(actor, col.fields, inputs, seo)
      const data = toStoredFields(col.fields, inputs, assets)
      assertSiteImages(col.fields, data, assets)
      const merged = mergeSeo(undefined, seo)
      if (merged) data[SEO_KEY] = merged
      const created = await createEntry({
        siteId: actor.siteId,
        collectionKey: col.key,
        data,
        actorId: actor.userId,
      })
      return formatStoredEntry(actor, created.id, { withPreview: true })
    },
  })

  registry.add({
    name: 'update_entry',
    title: 'Update entry',
    description:
      'Changes a draft. Only the fields and seo keys you send change; others stay as they are. Clear a field by sending an empty string or null; clear an seo key with an empty string (text), false (boolean) or an empty array (list). Pass expectedVersion from get_entry to avoid overwriting newer changes. Changing the slug changes the entry URL. Editing a ready entry does not change the live site: mark it ready again to approve the new version. Returns the saved entry.',
    inputSchema: z.object({
      id: idSchema('entry'),
      fields: fieldsInputSchema.optional(),
      seo: seoInputSchema.optional(),
      expectedVersion,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      if (input.fields === undefined && input.seo === undefined) {
        throw new ValidationError([
          { path: '', message: 'Nothing to update. Pass fields and/or seo' },
        ])
      }
      const entry = await loadEntryInSite(actor, input.id)
      const col = await loadCollectionInSite(actor, entry.collectionKey)
      const inputs = input.fields ?? {}
      const patch = seoPatch(input.seo)
      const assets = await assetLookupFor(actor, col.fields, inputs, patch)
      const converted = toStoredFields(col.fields, inputs, assets)
      assertSiteImages(col.fields, converted, assets)
      const data = pickDeclaredFields(col.fields, entry.draftData)
      Object.assign(data, converted)
      const seo = mergeSeo(
        (data[SEO_KEY] as Record<string, unknown> | undefined) ?? undefined,
        patch,
      )
      if (seo) data[SEO_KEY] = seo
      else delete data[SEO_KEY]
      await updateDraft(
        entry.id,
        data,
        actor.userId,
        input.expectedVersion ?? entry.draftVersion,
      )
      return formatStoredEntry(actor, entry.id, { withPreview: true })
    },
  })

  registry.add({
    name: 'list_revisions',
    title: 'List revisions',
    description:
      'Lists the saved history of an entry, newest first: revision id, what happened (create, update, publish, restore, ...), who, and when. Use a revision id with restore_revision (owners).',
    inputSchema: z.object({ id: idSchema('entry') }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      const revisions = await listRevisions(entry.id)
      return revisions.map((rev) => ({
        id: rev.id,
        note: rev.note,
        createdAt: rev.createdAt.toISOString(),
        createdBy: rev.createdBy,
      }))
    },
  })

  registry.add({
    name: 'get_preview_url',
    title: 'Get preview URL',
    description:
      'Returns a preview link for an entry, including drafts, so you or the user can see it on the site design before it goes live. The link is signed and expires after about an hour; call again for a fresh one.',
    inputSchema: z.object({ id: idSchema('entry') }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      const url = await previewUrlFor(actor, entry.collectionKey, entry.slug)
      if (!url) {
        throw new ValidationError([
          {
            path: '',
            message:
              'This site has no production URL set, so previews are not available',
          },
        ])
      }
      return { url }
    },
  })
}

function assertSiteImages(
  fields: Field[],
  data: EntryData,
  lookup: AssetLookup,
) {
  for (const field of fields) {
    if (
      field.type === 'richtext' &&
      !richTextAssetsAuthorizedFrom(data[field.key], lookup)
    ) {
      throw new ValidationError([
        {
          path: field.key,
          message:
            'This image is not available to this site. Use list_assets or upload_asset_from_url.',
        },
      ])
    }
  }
}
