import { z } from 'zod'

import { assetUrl, loadAssetLookup } from '#/server/assets'
import { siteAssetLookup } from '#/server/assets/site-scope'
import {
  richTextAssetsAuthorizedFrom,
  richTextAssetRefs,
} from '#/server/assets/richtext-ownership'
import { SEO_KEY } from '#/lib/seo'
import {
  ID_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from '#/lib/content-limits'
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
import { loadSiteLanguages } from '#/server/content/locale-validation'
import { McpNotFoundError } from '../errors'
import {
  signPreviewToken,
  buildPreviewUrl,
  buildGlobalPreviewUrl,
} from '#/server/content/preview-token'
import {
  applyLocaleWrite,
  localeView,
  resolveLocale,
  slugFieldKey,
  translationStatuses,
  withSharedNote,
  withSlugInput,
} from '../locales'
import type { LocaleTarget } from '../locales'

import type { AssetLookup } from '../entry-format'
import {
  AGENT_STATUSES,
  collectAssetIds,
  formatEntry,
  formatGlobal,
  formatSnapshotFields,
  ASSET_FILE_PREFIX,
  mergeSeo,
  seoPatchFromInput,
  storedStatus,
  summarizeEntry,
  toStoredFields,
} from '../entry-format'
import type { McpActor } from '../keys'
import {
  loadCollectionInSite,
  loadContentInSite,
  loadEntryInSite,
  loadSiteRow,
} from '../scope'
import { releaseFlags } from '../release-flags'
import type { ReleaseState } from '../release-state'
import { loadReleaseState } from '../release-state'
import { seoInputSchema, fieldsInputSchema, idSchema } from '../schemas'
import type { ToolRegistry } from '../tool-kit'

const collectionKey = z
  .string()
  .min(1)
  .max(ID_MAX_LENGTH)
  .describe('Collection key from get_site_info, e.g. "posts".')

export const expectedVersion = z
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

export async function assetLookupFor(
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

/** The URL slug. With a non-main locale it is that language's own slug. */
const slugInput = z
  .string()
  .max(SLUG_MAX_LENGTH)
  .optional()
  .describe(
    "The URL slug, lowercase letters, numbers and dashes. Same as fields.<slug field>. With a locale other than main it is that language's own slug; send an empty string to fall back to the main slug.",
  )

/** Language input shared by the content tools. Optional; the main language when left out. */
export const localeInput = z
  .string()
  .min(1)
  .max(35)
  .optional()
  .describe(
    'Language to read or write, a BCP 47 code from get_site_info (e.g. "en"). Leave it out for the main language. Only on sites with languages.',
  )

/** The content a preview link opens: a collection entry, or a site content section on its page. */
type PreviewSource = {
  kind: 'collection' | 'global'
  key: string
  previewPath: string | null
}

async function previewUrlFor(
  actor: McpActor,
  source: PreviewSource,
  slug: string,
  locale?: string,
): Promise<string | null> {
  const siteRow = await loadSiteRow(actor)
  if (!siteRow.productionUrl) return null
  if (source.kind === 'global') {
    if (!source.previewPath) return null
    const token = signPreviewToken({
      siteId: siteRow.id,
      global: source.key,
      secret: siteRow.previewSecret,
      locale,
    })
    return buildGlobalPreviewUrl(
      siteRow.productionUrl,
      source.previewPath,
      token,
      locale,
    )
  }
  const token = signPreviewToken({
    siteId: siteRow.id,
    collection: source.key,
    slug,
    secret: siteRow.previewSecret,
    locale,
  })
  return buildPreviewUrl(siteRow.productionUrl, source.key, slug, token, locale)
}

/** The live version of an entry as the production site serves it now, if it is live. */
function liveEntryFor(
  release: ReleaseState,
  source: PreviewSource,
  id: string,
): { id?: string; data: Record<string, unknown> } | undefined {
  const snapshot = release.liveSnapshot
  if (!snapshot) return undefined
  if (source.kind === 'global') {
    const live = snapshot.globals?.[source.key]
    return live?.id === id ? live : undefined
  }
  // A key can be missing from a snapshot taken before the collection existed.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return snapshot.collections[source.key]?.find((item) => item.id === id)
}

/**
 * The entry as an agent reads it. On a site with languages, `locale` picks the
 * language whose values are shown (the main language when omitted), and
 * `translations` adds the completeness of every other language.
 */
export async function formatStoredEntry(
  actor: McpActor,
  id: string,
  options: {
    includePublished?: boolean
    withPreview?: boolean
    /** Language code of the view. Passed only when the caller chose one. */
    locale?: string
    /** Add `translations` (status of every non-main language). */
    translations?: boolean
  } = {},
) {
  const row = await getEntry(id)
  if (!row) throw new McpNotFoundError('This entry no longer exists.')
  const content = await loadContentInSite(actor, row.collectionKey)
  const languages = await loadSiteLanguages(actor.siteId)
  const localeCode = languages ? (options.locale ?? languages.main) : undefined
  const view =
    languages && localeCode
      ? localeView(
          row.draftData,
          languages,
          content.fields,
          localeCode,
          row.slug,
        )
      : null
  const published =
    languages && localeCode
      ? localeView(
          row.publishedData ?? {},
          languages,
          content.fields,
          localeCode,
          row.slug,
        ).data
      : row.publishedData
  const assets = await assetLookupForData(actor, content.fields, [
    row.draftData,
    row.publishedData ?? {},
  ])
  const siteRow = await loadSiteRow(actor)
  const release = await loadReleaseState(actor.siteId)
  const source: PreviewSource = {
    kind: content.kind,
    key: content.key,
    previewPath: content.previewPath,
  }
  const liveEntry = options.includePublished
    ? liveEntryFor(release, source, row.id)
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
  const input = {
    entry: view
      ? {
          ...row,
          draftData: view.data,
          publishedData: published,
          slug: view.slug,
        }
      : row,
    fields: content.fields,
    ctx: { assets, assetUrl: (storageKey: string) => assetUrl({ storageKey }) },
    release: releaseFlags(release, row.id),
    previewAvailable: Boolean(siteRow.productionUrl),
    includePublished: options.includePublished ?? false,
    liveFields: liveEntry ? formatSnapshotFields(liveEntry.data, assets) : null,
  }
  const formatted =
    content.kind === 'global'
      ? formatGlobal({ ...input, global: content })
      : formatEntry(input)
  const localized = {
    ...(localeCode ? { locale: localeCode } : {}),
    ...(languages && options.translations
      ? {
          translations: translationStatuses(
            row.draftData,
            languages,
            content.fields,
          ),
        }
      : {}),
  }
  if (!options.withPreview) return { ...formatted, ...localized }
  return {
    ...formatted,
    ...localized,
    previewUrl: await previewUrlFor(
      actor,
      source,
      view?.slug ?? row.slug,
      options.locale,
    ),
  }
}

/** External images that could not be copied into the media library stay external; say so. */
export function withImportWarnings<T extends object>(
  result: T,
  warnings: string[],
): T | (T & { warnings: string[] }) {
  return warnings.length > 0 ? { ...result, warnings } : result
}

/** Import warnings plus, for a non-main language, the shared fields it changed. */
function withWriteNotes<T extends object>(
  result: T,
  warnings: string[],
  target: LocaleTarget | null,
  shared: string[],
) {
  return withSharedNote(withImportWarnings(result, warnings), target, shared)
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
      missingLanguage: localeInput.describe(
        'Only entries whose draft is not complete in this language (a required field is empty there), e.g. "en". Only on sites with languages.',
      ),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const col = await loadCollectionInSite(actor, input.collection)
      const limit = input.limit ?? 20
      const offset = input.offset ?? 0
      const target = resolveLocale(
        await loadSiteLanguages(actor.siteId),
        input.missingLanguage,
      )
      const [result, release] = await Promise.all([
        listEntries(actor.siteId, col.key, {
          status: input.status ? storedStatus(input.status) : undefined,
          search: input.search,
          limit,
          offset,
          missingLanguage: target?.locale,
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
      "Returns one entry: status (draft, ready, scheduled or archived), live (on the production site now; demo previews do not count), pendingRelease (approved changes waiting for the next go live), approvedAt, fields (rich text as Markdown, images as {assetId,url,alt}, references as {entryId}), seo, and version (pass it to update_entry as expectedVersion). On a site with languages, locale returns that language's values (slug and seo included); without it you get the main language plus translations, the completeness of each other language and its missing fields. Set includePublished to also get liveFields, the version visitors see now. Read-only.",
    inputSchema: z.object({
      id: idSchema('entry'),
      includePublished: z
        .boolean()
        .optional()
        .describe('Also return liveFields, the version visitors see now.'),
      locale: localeInput,
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      const target = resolveLocale(
        await loadSiteLanguages(actor.siteId),
        input.locale,
      )
      return formatStoredEntry(actor, entry.id, {
        includePublished: input.includePublished,
        locale: target?.locale,
        translations: input.locale === undefined,
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
      slug: slugInput,
      locale: localeInput,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      const col = await loadCollectionInSite(actor, input.collection)
      const languages = await loadSiteLanguages(actor.siteId)
      const target = resolveLocale(languages, input.locale)
      const inputs = withSlugInput(col.fields, input.fields ?? {}, input.slug)
      const seo = seoPatch(input.seo)
      const assets = await assetLookupFor(actor, col.fields, inputs, seo)
      const converted = toStoredFields(col.fields, inputs, assets)
      assertSiteImages(col.fields, converted, assets)
      let data = converted
      let shared: string[] = []
      if (languages && target) {
        const written = applyLocaleWrite({
          fields: col.fields,
          languages,
          locale: target.locale,
          stored: {},
          converted,
          seo,
        })
        data = written.data
        shared = written.sharedFieldsUpdated
        // The entry needs a main slug to exist: a first language's slug is used for it.
        const slugKey = slugFieldKey(col.fields)
        if (
          !target.isMain &&
          slugKey &&
          typeof converted[slugKey] === 'string'
        ) {
          data[slugKey] = converted[slugKey]
        }
      } else {
        const merged = mergeSeo(undefined, seo)
        if (merged) data[SEO_KEY] = merged
      }
      const created = await createEntry({
        siteId: actor.siteId,
        collectionKey: col.key,
        data,
        actorId: actor.userId,
      })
      return withWriteNotes(
        await formatStoredEntry(actor, created.id, {
          withPreview: true,
          locale: target?.locale,
          translations: true,
        }),
        created.importWarnings,
        target,
        shared,
      )
    },
  })

  registry.add({
    name: 'update_entry',
    title: 'Update entry',
    description:
      "Changes a draft. Only the fields and seo keys you send change; others stay as they are. Clear a field by sending an empty string or null; clear an seo key with an empty string (text), false (boolean) or an empty array (list). On a site with languages, locale says which language the fields, seo and slug belong to (the main language when left out). Write one language per call: shared fields (not translatable) change in every language, and the response lists them in sharedFieldsUpdated. Pass expectedVersion from get_entry to avoid overwriting newer changes. Changing the slug changes the entry URL (in a non-main language, only that language's URL). Editing a ready entry does not change the live site: mark it ready again to approve the new version. Returns the saved entry.",
    inputSchema: z.object({
      id: idSchema('entry'),
      fields: fieldsInputSchema.optional(),
      seo: seoInputSchema.optional(),
      slug: slugInput,
      locale: localeInput,
      expectedVersion,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      if (
        input.fields === undefined &&
        input.seo === undefined &&
        input.slug === undefined
      ) {
        throw new ValidationError([
          { path: '', message: 'Nothing to update. Pass fields and/or seo' },
        ])
      }
      const entry = await loadEntryInSite(actor, input.id)
      const col = await loadCollectionInSite(actor, entry.collectionKey)
      const languages = await loadSiteLanguages(actor.siteId)
      const target = resolveLocale(languages, input.locale)
      const inputs = withSlugInput(col.fields, input.fields ?? {}, input.slug)
      const patch = seoPatch(input.seo)
      const assets = await assetLookupFor(actor, col.fields, inputs, patch)
      const converted = toStoredFields(col.fields, inputs, assets)
      assertSiteImages(col.fields, converted, assets)
      let data: EntryData
      let shared: string[] = []
      if (languages && target) {
        const written = applyLocaleWrite({
          fields: col.fields,
          languages,
          locale: target.locale,
          stored: entry.draftData,
          converted,
          seo: patch,
        })
        data = written.data
        shared = written.sharedFieldsUpdated
      } else {
        data = pickDeclaredFields(col.fields, entry.draftData)
        Object.assign(data, converted)
        const seo = mergeSeo(
          (data[SEO_KEY] as Record<string, unknown> | undefined) ?? undefined,
          patch,
        )
        if (seo) data[SEO_KEY] = seo
        else delete data[SEO_KEY]
      }
      const updated = await updateDraft(
        entry.id,
        data,
        actor.userId,
        input.expectedVersion ?? entry.draftVersion,
      )
      return withWriteNotes(
        await formatStoredEntry(actor, entry.id, {
          withPreview: true,
          locale: target?.locale,
          translations: true,
        }),
        updated.importWarnings,
        target,
        shared,
      )
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
    inputSchema: z.object({ id: idSchema('entry'), locale: localeInput }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      const content = await loadContentInSite(actor, entry.collectionKey)
      const target = resolveLocale(
        await loadSiteLanguages(actor.siteId),
        input.locale,
      )
      if (content.kind === 'global' && !content.previewPath) {
        throw new ValidationError([
          {
            path: '',
            message:
              'This site content has no preview page, so previews are not available. An agency admin can set its preview path in the CMS.',
          },
        ])
      }
      const url = await previewUrlFor(
        actor,
        {
          kind: content.kind,
          key: content.key,
          previewPath: content.previewPath,
        },
        entry.slug,
        target?.locale,
      )
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

export function assertSiteImages(
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
