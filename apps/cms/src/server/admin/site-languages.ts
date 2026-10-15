import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { db } from '#/db'
import { collection, entry, entryRevision, site } from '#/db/schema'
import { MAX_SITE_LANGUAGES } from '#/lib/content-limits'
import { LOCALE_KEY, canonicalLocale, localeStatus } from '#/lib/content-locale'
import type { EntryData, SiteLanguages } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { NotFoundError, ValidationError } from '#/server/content/errors'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Validates and canonicalises the languages a site is set to. `main` must be
 * one of `all`, and `all` lists each language once.
 */
export function normalizeSiteLanguages(input: {
  main: string
  all: string[]
}): SiteLanguages {
  if (input.all.length === 0) {
    throw new ValidationError([
      { path: 'all', message: 'Add at least one language.' },
    ])
  }
  if (input.all.length > MAX_SITE_LANGUAGES) {
    throw new ValidationError([
      {
        path: 'all',
        message: `A site can have at most ${MAX_SITE_LANGUAGES} languages.`,
      },
    ])
  }
  const all: string[] = []
  for (const [index, tag] of input.all.entries()) {
    const canonical = canonicalLocale(tag)
    if (!canonical) {
      throw new ValidationError([
        {
          path: `all.${index}`,
          message: `"${tag}" is not a valid language code.`,
        },
      ])
    }
    if (all.includes(canonical)) {
      throw new ValidationError([
        { path: `all.${index}`, message: `"${canonical}" is listed twice.` },
      ])
    }
    all.push(canonical)
  }
  const main = canonicalLocale(input.main)
  if (!main) {
    throw new ValidationError([
      {
        path: 'main',
        message: `"${input.main}" is not a valid language code.`,
      },
    ])
  }
  if (!all.includes(main)) {
    throw new ValidationError([
      {
        path: 'main',
        message: 'The main language must be one of the languages.',
      },
    ])
  }
  return { main, all }
}

/**
 * Entries and sections that are not complete in `newMain`, counted on the
 * draft. Data without `$locale` is in `previousMain` (or in `newMain` when the
 * site had no languages), so the count matches what the stamp will produce.
 */
export async function countMainLanguageGaps(
  siteId: string,
  newMain: string,
  previousMain: string | null,
  connection: Pick<typeof db, 'select'> = db,
): Promise<number> {
  const rows = await connection
    .select({ draftData: entry.draftData, fields: collection.fields })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(and(eq(entry.siteId, siteId), ne(entry.status, 'archived')))
  return rows.filter((row) => {
    const hasLocale = row.draftData[LOCALE_KEY] != null
    const data: EntryData =
      previousMain && !hasLocale
        ? { ...row.draftData, [LOCALE_KEY]: previousMain }
        : row.draftData
    const status = localeStatus(data, newMain, {
      main: newMain,
      all: [newMain],
      fields: row.fields,
    })
    return !status.complete
  }).length
}

/**
 * Stamps `$locale: oldMain` onto data that does not say what language it is
 * in. Runs as one UPDATE per table. Draft versions move so open editors
 * conflict instead of saving unstamped data back.
 */
async function stampPreviousMain(tx: Tx, siteId: string, oldMain: string) {
  const stamp = (column: AnyPgColumn) =>
    sql`jsonb_set(${column}, '{$locale}', to_jsonb(${oldMain}::text), true)`
  const siteEntryIds = tx
    .select({ id: entry.id })
    .from(entry)
    .where(eq(entry.siteId, siteId))

  await tx
    .update(entry)
    .set({
      draftData: stamp(entry.draftData),
      draftVersion: sql`${entry.draftVersion} + 1`,
    })
    .where(
      and(
        eq(entry.siteId, siteId),
        sql`${entry.draftData} -> '$locale' IS NULL`,
      ),
    )
  await tx
    .update(entry)
    .set({ publishedData: stamp(entry.publishedData) })
    .where(
      and(
        eq(entry.siteId, siteId),
        isNotNull(entry.publishedData),
        sql`${entry.publishedData} -> '$locale' IS NULL`,
      ),
    )
  await tx
    .update(entry)
    .set({ scheduledData: stamp(entry.scheduledData) })
    .where(
      and(
        eq(entry.siteId, siteId),
        isNotNull(entry.scheduledData),
        sql`${entry.scheduledData} -> '$locale' IS NULL`,
      ),
    )
  await tx
    .update(entryRevision)
    .set({ data: stamp(entryRevision.data) })
    .where(
      and(
        sql`${entryRevision.data} -> '$locale' IS NULL`,
        inArray(entryRevision.entryId, siteEntryIds),
      ),
    )
}

/**
 * Applies a site's languages inside an open transaction. Used by the settings
 * form and by manifest pushes. Caller holds the site row lock.
 */
export async function applySiteLanguages(
  tx: Tx,
  siteId: string,
  input: { main: string; all: string[] },
  actorId?: string | null,
): Promise<{ languages: SiteLanguages; gaps: number }> {
  const next = normalizeSiteLanguages(input)
  const current = (
    await tx
      .select({
        organizationId: site.organizationId,
        languages: site.languages,
      })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!current) throw new NotFoundError(m.server_site_not_found())

  const previous = current.languages ?? null
  const gaps = await countMainLanguageGaps(
    siteId,
    next.main,
    previous?.main ?? null,
    tx,
  )
  if (previous && previous.main !== next.main) {
    await stampPreviousMain(tx, siteId, previous.main)
  }
  await tx
    .update(site)
    .set({ languages: next, updatedAt: new Date() })
    .where(eq(site.id, siteId))
  await audit(
    {
      organizationId: current.organizationId,
      siteId,
      actorId,
      action: 'site.languages_update',
      targetType: 'site',
      targetId: siteId,
      meta: {
        main: next.main,
        all: next.all,
        previousMain: previous?.main ?? null,
        previousAll: previous?.all ?? null,
        gaps,
      },
    },
    tx,
  )
  return { languages: next, gaps }
}

/**
 * Sets a site's languages. Changing the main language stamps the old one onto
 * existing data and returns how many entries and sections lack the new main.
 * A site's languages cannot be cleared once set.
 */
export async function setSiteLanguages(
  siteId: string,
  input: { main: string; all: string[] },
  actorId?: string | null,
): Promise<{ languages: SiteLanguages; gaps: number }> {
  normalizeSiteLanguages(input)
  return db.transaction(async (tx) => {
    await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, siteId))
      .for('update')
    return applySiteLanguages(tx, siteId, input, actorId)
  })
}

/** Entries and sections that would lack `newMain`, for the confirm dialog. */
export async function previewMainChange(
  siteId: string,
  newMain: string,
): Promise<number> {
  const canonical = canonicalLocale(newMain)
  if (!canonical) {
    throw new ValidationError([
      { path: 'main', message: `"${newMain}" is not a valid language code.` },
    ])
  }
  const current = (
    await db
      .select({ languages: site.languages })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!current) throw new NotFoundError(m.server_site_not_found())
  return countMainLanguageGaps(
    siteId,
    canonical,
    current.languages?.main ?? null,
  )
}
