import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import type { DbReader } from '#/db'
import { collection, entry, site } from '#/db/schema'
import { normalizeBase, readLocale } from '#/lib/content-locale'
import type { ContentKind, EntryData, Field, SiteLanguages } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { importExternalImages } from '#/server/assets/external-images'

import { ConflictError, NotFoundError, ValidationError } from './errors.ts'
import {
  formatLanguageBlockers,
  languageBlockers,
  localeCtxFor,
  toLanguageBlockerDetail,
} from './locale-validation.ts'
import type { SiteCore } from './site-core.ts'
import { validateEntryData } from './validation.ts'

/**
 * What the entry writers load and check before they write: the entry with its
 * collection and site, the stored shape of its data, and the checks shared by
 * the save and workflow paths.
 */

export type EntryContext = {
  entry: typeof entry.$inferSelect
  collection: typeof collection.$inferSelect
  site: SiteCore
}

export type CollectionContext = Omit<EntryContext, 'entry'>

export async function loadEntryContext(
  id: string,
  connection: DbReader = db,
): Promise<EntryContext> {
  const row = (
    await connection
      .select({ entry, collection, site })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .innerJoin(site, eq(entry.siteId, site.id))
      .where(eq(entry.id, id))
      .limit(1)
  ).at(0)
  if (!row) {
    throw new NotFoundError(m.server_entry_not_found())
  }
  return row
}

export async function loadCollectionContext(
  siteId: string,
  collectionKey: string,
) {
  const row = (
    await db
      .select({ collection, site })
      .from(collection)
      .innerJoin(site, eq(collection.siteId, site.id))
      .where(
        and(
          eq(collection.siteId, siteId),
          eq(collection.key, collectionKey),
          eq(collection.kind, 'collection'),
        ),
      )
      .limit(1)
  ).at(0)
  if (!row) {
    throw new NotFoundError(m.server_collection_not_found())
  }
  return row
}

/**
 * Stored data in the shape a site with languages expects: the base holds the
 * main language. Single-language sites are returned unchanged.
 */
export function normalizeEntryData(
  ctx: {
    site: { languages: SiteLanguages | null }
    collection: { fields: Field[] }
  },
  data: EntryData,
): EntryData {
  const languages = ctx.site.languages
  if (!languages) return data
  return normalizeBase(data, localeCtxFor(languages, ctx.collection.fields))
}

/**
 * Checks that an entry can go live and returns what to store. Single-language
 * sites keep the strict validation of the whole entry. On a site with
 * languages, the shared fields and the main language are strictly valid, and
 * every required language is complete. `referenceData` is the flat view that
 * reference targets are checked against.
 */
export function prepareReadyData(
  ctx: {
    site: { languages: SiteLanguages | null }
    collection: { fields: Field[]; requiredLanguages: string[] }
  },
  data: EntryData,
): { stored: EntryData; referenceData: EntryData } {
  const languages = ctx.site.languages
  if (!languages) {
    const parsed = validateEntryData(ctx.collection.fields, data)
    if (!parsed.ok) throw new ValidationError(parsed.errors)
    return { stored: parsed.data, referenceData: data }
  }
  const mainView = readLocale(
    data,
    languages.main,
    localeCtxFor(languages, ctx.collection.fields),
  )
  const strict = validateEntryData(ctx.collection.fields, mainView)
  if (!strict.ok) throw new ValidationError(strict.errors)
  const blockers = languageBlockers({
    data,
    fields: ctx.collection.fields,
    languages,
    requiredLanguages: ctx.collection.requiredLanguages,
  })
  if (blockers.length > 0) {
    throw new ValidationError(
      [{ path: '', message: formatLanguageBlockers(blockers) }],
      { blockers: toLanguageBlockerDetail(blockers) },
    )
  }
  return { stored: data, referenceData: mainView }
}

export function importEntryImages(
  ctx: CollectionContext,
  data: EntryData,
  actorId: string,
) {
  return importExternalImages({
    organizationId: ctx.site.organizationId,
    originSiteId: ctx.site.id,
    actorId,
    fields: ctx.collection.fields,
    data,
  })
}

/** The import result a writer returns with the entry. */
export function importReport(images: {
  imported: number
  warnings: Awaited<ReturnType<typeof importExternalImages>>['warnings']
}) {
  return { importedImages: images.imported, importWarnings: images.warnings }
}

/**
 * A section's single entry is never unpublished, archived or deleted: the
 * section is disabled or deleted as a whole (`globals.ts`).
 */
export function assertCollectionEntry(target: { kind: ContentKind }) {
  if (target.kind === 'global') {
    throw new ValidationError([
      {
        path: '',
        message:
          'Site content cannot be unpublished, archived or deleted as an entry. Disable or delete the section instead.',
      },
    ])
  }
}

export async function assertSlugAvailable(
  collectionId: string,
  slug: string,
  excludeId?: string,
  connection: DbReader = db,
) {
  const existing = (
    await connection
      .select({ id: entry.id })
      .from(entry)
      .where(and(eq(entry.collectionId, collectionId), eq(entry.slug, slug)))
      .limit(1)
  ).at(0)
  if (existing && existing.id !== excludeId) {
    throw new ConflictError(m.server_slug_already_exists())
  }
}
