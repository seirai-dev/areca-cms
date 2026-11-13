import { sql } from 'drizzle-orm'

import { db } from '#/db'
import type { DbReader } from '#/db'
import { entry } from '#/db/schema'
import type { EntryData } from '#/lib/types'
import { SLUG_PATTERN } from '#/lib/slug'
import { m } from '#/paraglide/messages'
import { assetAttachLock } from '#/server/assets/usage'

import {
  assertContentOwnership,
  entryTransaction,
  recordEntryChange,
  updateEntryRow,
} from './entry-commit.ts'
import {
  assertSlugAvailable,
  importEntryImages,
  importReport,
  loadCollectionContext,
  loadEntryContext,
  normalizeEntryData,
} from './entry-context.ts'
import type { CollectionContext, EntryContext } from './entry-context.ts'
import { prepareEntryLinks } from './entry-links.ts'
import { NotFoundError, ValidationError } from './errors.ts'
import { assertSectionSeo } from './globals.ts'
import {
  claimedSlugs,
  lockSlugClaims,
  validateLocaleSlugs,
} from './locale-validation.ts'
import { sectionChangesOf, sectionSnapshotsOf } from './section-changes.ts'
import { resolveSlug, validateEntryData } from './validation.ts'

/**
 * Entries: creating and saving drafts. The reads, the history and the
 * workflow live in their own modules and are re-exported here, so callers
 * import every entry operation from this one path. Every write goes through
 * the commit path in `entry-commit.ts`.
 */

export * from './entry-reads.ts'
export * from './entry-revisions.ts'
export * from './entry-workflow.ts'
export { normalizeEntryData, prepareReadyData } from './entry-context.ts'

/**
 * The checks and preparation of a draft write (create or save): the partial
 * validation, the language slugs, a section's SEO, the external image import
 * and the entry link save check, in that order.
 */
async function prepareDraftWrite(
  ctx: CollectionContext,
  data: EntryData,
  actorId: string,
  entryId?: string,
) {
  const validated = validateEntryData(
    ctx.collection.fields,
    normalizeEntryData(ctx, data),
    { mode: 'partial', write: true },
  )
  if (!validated.ok) {
    throw new ValidationError(validated.errors)
  }
  const slugErrors = await validateLocaleSlugs({
    collectionId: ctx.collection.id,
    entryId,
    data: validated.data,
  })
  if (slugErrors.length) throw new ValidationError(slugErrors)
  if (ctx.collection.kind === 'global') {
    assertSectionSeo(ctx.collection, validated.data)
  }
  const images = await importEntryImages(ctx, validated.data, actorId)
  return {
    data: await prepareEntryLinks(
      db,
      ctx.site.id,
      ctx.collection.fields,
      images.data,
    ),
    images,
  }
}

export async function createEntry(input: {
  siteId: string
  collectionKey: string
  data: EntryData
  actorId: string
}) {
  const ctx = await loadCollectionContext(input.siteId, input.collectionKey)
  if (!ctx.collection.enabled) {
    throw new NotFoundError(m.server_collection_not_found())
  }
  const { data, images } = await prepareDraftWrite(
    ctx,
    input.data,
    input.actorId,
  )
  const headingBaseline = sectionSnapshotsOf(
    data,
    ctx.collection.fields,
    ctx.site.languages,
  )

  const slug = resolveSlug(data, ctx.collection.fields)
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new ValidationError([
      { path: 'slug', message: m.server_valid_slug_required() },
    ])
  }

  await assertSlugAvailable(ctx.collection.id, slug)

  return entryTransaction(ctx.site.id, async (tx) => {
    await assetAttachLock(tx, ctx.site.organizationId)
    await lockSlugClaims(tx, ctx.collection.id, claimedSlugs(slug, data))
    await assertUrlsAvailable(tx, ctx.collection.id, data, slug)
    await assertContentOwnership(tx, ctx.site, ctx.collection.fields, data)
    const now = new Date()
    const created = (
      await tx
        .insert(entry)
        .values({
          siteId: input.siteId,
          collectionId: ctx.collection.id,
          slug,
          status: 'draft',
          draftData: data,
          headingBaseline,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    ).at(0)

    if (!created) {
      throw new Error(m.server_failed_to_create_entry())
    }

    await recordEntryChange(tx, ctx.site, {
      entryId: created.id,
      actorId: input.actorId,
      note: 'create',
      data,
      auditMeta: { collectionKey: input.collectionKey, slug },
    })
    return {
      ...created,
      collectionKey: ctx.collection.key,
      ...importReport(images),
    }
  })
}

export async function updateDraft(
  id: string,
  input: EntryData,
  actorId: string,
  expectedVersion: number,
  /** Rows the caller's access check already read for this entry. */
  preloaded?: EntryContext,
  /**
   * An explicit save (Save, ⌘S, Mark ready, an MCP write) rather than an
   * autosave. Only these take the heading snapshot and report section changes
   * (docs/design/rich-text-links.md, decision 21).
   */
  options: { explicit?: boolean } = {},
) {
  const ctx = preloaded ?? (await loadEntryContext(id))
  const { data, images } = await prepareDraftWrite(ctx, input, actorId, id)

  const nextSlug = resolveSlug(data, ctx.collection.fields)
  if (nextSlug && nextSlug !== ctx.entry.slug) {
    if (!SLUG_PATTERN.test(nextSlug)) {
      throw new ValidationError([
        { path: 'slug', message: m.server_invalid_slug() },
      ])
    }
    await assertSlugAvailable(ctx.collection.id, nextSlug, id)
  }

  const sections = options.explicit
    ? sectionChangesOf({
        previousData: ctx.entry.draftData,
        baseline: ctx.entry.headingBaseline ?? null,
        nextData: data,
        fields: ctx.collection.fields,
        languages: ctx.site.languages,
      })
    : null
  // The baseline is the headings at the last explicit save. An explicit save
  // stores the new headings. An entry with no baseline yet (saved before they
  // were kept) stores the headings it had before this save, so an autosave
  // that renames a heading cannot hide the rename from the next explicit save.
  const storedBaseline = sections
    ? sections.next
    : ctx.entry.headingBaseline == null
      ? sectionSnapshotsOf(
          ctx.entry.draftData,
          ctx.collection.fields,
          ctx.site.languages,
        )
      : null

  return entryTransaction(ctx.site.id, async (tx) => {
    await assetAttachLock(tx, ctx.site.organizationId)
    await lockSlugClaims(
      tx,
      ctx.collection.id,
      claimedSlugs(nextSlug ?? ctx.entry.slug, data),
    )
    await assertUrlsAvailable(
      tx,
      ctx.collection.id,
      data,
      nextSlug && nextSlug !== ctx.entry.slug ? nextSlug : null,
      id,
    )
    await assertContentOwnership(tx, ctx.site, ctx.collection.fields, data)
    const updated = await updateEntryRow(
      tx,
      id,
      {
        draftVersion: sql`${entry.draftVersion} + 1`,
        draftData: data,
        ...(storedBaseline ? { headingBaseline: storedBaseline } : {}),
        slug: nextSlug ?? ctx.entry.slug,
        updatedBy: actorId,
        updatedAt: new Date(),
      },
      {
        draftVersion: expectedVersion,
        conflict:
          'DRAFT_CONFLICT: This entry changed on the server. Reload or explicitly reapply your recovered draft.',
      },
    )
    await recordEntryChange(tx, ctx.site, {
      entryId: id,
      actorId,
      note: 'update',
      data,
      autosave: !options.explicit,
    })
    return {
      ...updated,
      collectionKey: ctx.collection.key,
      ...importReport(images),
      /** Headings a link may point at that this save removed or renamed. */
      sectionChanges: sections?.changes ?? [],
    }
  })
}

/**
 * The URL checks of a save, run again under the assets lock (the lock a push
 * and a copy take too). The checks before the lock read the URLs as they were
 * before a concurrent push or save committed; this one reads them after.
 */
async function assertUrlsAvailable(
  tx: DbReader,
  collectionId: string,
  data: EntryData,
  slug: string | null,
  entryId?: string,
) {
  const slugErrors = await validateLocaleSlugs(
    { collectionId, entryId, data },
    tx,
  )
  if (slugErrors.length) throw new ValidationError(slugErrors)
  if (slug) await assertSlugAvailable(collectionId, slug, entryId, tx)
}
