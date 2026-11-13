import { and, eq, ne, or, sql } from 'drizzle-orm'

import { db } from '#/db'
import type { DbExecutor, DbReader } from '#/db'
import { collection, entry, site } from '#/db/schema'
import {
  I18N_KEY,
  SLUG_KEY,
  canonicalLocale,
  localeStatus,
} from '#/lib/content-locale'
import type { LocaleCtx } from '#/lib/content-locale'
import { SLUG_PATTERN } from '#/lib/slug'
import { SLUG_MAX_LENGTH } from '#/lib/content-limits'
import type { EntryData, Field, SiteLanguages } from '#/lib/types'
import { m } from '#/paraglide/messages'

import type { LanguageBlockerDetail } from './errors.ts'
import type { FieldError } from './validation.ts'

/**
 * Required-language codes as stored: canonical tags, without duplicates. Codes
 * the site does not have are kept and ignored when blockers are computed.
 */
export function normalizeRequiredLanguages(codes: readonly string[]): string[] {
  return [...new Set(codes.map((code) => canonicalLocale(code) ?? code))]
}

/** Languages of a site, or null when it is single-language. */
export async function loadSiteLanguages(
  siteId: string,
  connection: DbReader = db,
): Promise<SiteLanguages | null> {
  const row = (
    await connection
      .select({ languages: site.languages })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  return row?.languages ?? null
}

/** Language context for one collection or section. */
export function localeCtxFor(
  languages: SiteLanguages,
  fields: Field[],
): LocaleCtx {
  return { main: languages.main, all: languages.all, fields }
}

export type LanguageBlocker = { locale: string; missing: Field[] }

/**
 * Languages that block going live: the main language plus every required
 * language that the site still has. A language blocks when a required
 * translatable field is empty in it. Empty when the site is single-language.
 */
export function languageBlockers(input: {
  data: EntryData
  fields: Field[]
  languages: SiteLanguages | null | undefined
  requiredLanguages?: readonly string[]
}): LanguageBlocker[] {
  const { data, fields, languages } = input
  if (!languages) return []
  const ctx = localeCtxFor(languages, fields)
  const required = (input.requiredLanguages ?? []).filter((locale) =>
    languages.all.includes(locale),
  )
  const locales = [...new Set([languages.main, ...required])]
  return locales.flatMap((locale) => {
    const status = localeStatus(data, locale, ctx)
    if (status.complete) return []
    const missing = fields.filter((field) => status.missing.includes(field.key))
    return [{ locale, missing }]
  })
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })

/** English name of a language tag, e.g. `nl-BE` to "Dutch (Belgium)". */
export function languageName(
  locale: string,
  names: Record<string, string> = {},
): string {
  if (names[locale]) return names[locale]
  try {
    return displayNames.of(locale) ?? locale
  } catch {
    return locale
  }
}

/** `English is missing: Title, Body`, one clause per language. */
export function formatLanguageBlockers(
  blockers: LanguageBlocker[],
  names?: Record<string, string>,
): string {
  return blockers
    .map(
      (blocker) =>
        `${languageName(blocker.locale, names)} is missing: ${blocker.missing
          .map((field) => field.label)
          .join(', ')}`,
    )
    .join('; ')
}

export function toLanguageBlockerDetail(
  blockers: LanguageBlocker[],
): LanguageBlockerDetail[] {
  return blockers.map((blocker) => ({
    locale: blocker.locale,
    missing: blocker.missing.map((field) => field.key),
  }))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Per-language slugs in `$i18n[locale].$slug` as `[locale, slug]` pairs. */
function localeSlugs(data: EntryData): [string, string][] {
  const translations = data[I18N_KEY]
  if (!isPlainObject(translations)) return []
  return Object.entries(translations).flatMap(([locale, slot]) => {
    if (!isPlainObject(slot)) return []
    const slug = slot[SLUG_KEY]
    return typeof slug === 'string' && slug !== '' ? [[locale, slug]] : []
  })
}

/** Every slug value a save stores in its collection: the main slug and each language slug. */
export function claimedSlugs(
  mainSlug: string | null | undefined,
  data: EntryData,
): string[] {
  return [
    ...(mainSlug ? [mainSlug] : []),
    ...localeSlugs(data).map(([, slug]) => slug),
  ]
}

/**
 * Slug uniqueness is a check-then-write among saves, so a save takes an
 * exclusive per-value lock on each slug it stores before checking. Two saves
 * serialize only when they claim the same value; the uniqueness check that
 * follows sees the other's commit. Keys are taken in sorted order, so
 * concurrent claimers cannot wait on each other in a cycle. Callers hold the
 * shared asset attach lock first (server/assets/usage.ts).
 */
export async function lockSlugClaims(
  tx: DbExecutor,
  collectionId: string,
  slugs: readonly string[],
) {
  const keys = [...new Set(slugs.map((slug) => `slug:${collectionId}:${slug}`))]
  keys.sort()
  for (const key of keys) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    )
  }
}

/**
 * Per-language slug rules. The format is the main slug's format. A value must
 * be unique in its collection for its language: no other entry may use it as
 * its main slug or as its `$i18n.<locale>.$slug`.
 */
export async function validateLocaleSlugs(
  input: { collectionId: string; entryId?: string; data: EntryData },
  connection: DbReader = db,
): Promise<FieldError[]> {
  const errors: FieldError[] = []
  const slugs = localeSlugs(input.data)
  const candidates: [string, string][] = []
  for (const [locale, slug] of slugs) {
    const path = `${I18N_KEY}.${locale}.${SLUG_KEY}`
    if (slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) {
      errors.push({ path, message: m.server_invalid_slug() })
      continue
    }
    candidates.push([locale, slug])
  }
  if (candidates.length === 0) return errors

  const conflictTerms = candidates.flatMap(([locale, slug]) => [
    eq(entry.slug, slug),
    sql`${entry.draftData} #>> ARRAY[${I18N_KEY}::text, ${locale}::text, ${SLUG_KEY}::text] = ${slug}`,
  ])
  const filters = [
    eq(entry.collectionId, input.collectionId),
    or(...conflictTerms)!,
  ]
  if (input.entryId) filters.push(ne(entry.id, input.entryId))
  const others = await connection
    .select({
      slug: entry.slug,
      draftData: entry.draftData,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(and(...filters))

  for (const [locale, slug] of candidates) {
    const taken = others.some((other) => {
      if (other.slug === slug) return true
      const slot = other.draftData[I18N_KEY]
      const own = isPlainObject(slot) ? slot[locale] : undefined
      return isPlainObject(own) && own[SLUG_KEY] === slug
    })
    if (taken) {
      errors.push({
        path: `${I18N_KEY}.${locale}.${SLUG_KEY}`,
        message: m.server_slug_already_exists(),
      })
    }
  }
  return errors
}

/** The site's languages, read from the database. Used by lifecycle code. */
export async function siteLocaleCtx(
  siteId: string,
  fields: Field[],
  connection: DbReader = db,
): Promise<LocaleCtx | null> {
  const languages = await loadSiteLanguages(siteId, connection)
  return languages ? localeCtxFor(languages, fields) : null
}
