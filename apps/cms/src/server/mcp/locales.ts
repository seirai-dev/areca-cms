/**
 * Content languages for the MCP tools. Pure functions: the tools load the site
 * languages and the stored draft, then call these. A site without languages
 * never reaches this module (the tools keep their single-language path).
 *
 * Partial writes follow the rule in docs/design/content-languages.md: read the
 * language's flat view, merge what the agent sent, then write the whole view
 * back with `writeLocale`. `writeLocale` replaces the language's translatable
 * set as a whole, so a merge is the only safe way to change one field.
 */
import {
  I18N_KEY,
  LOCALE_KEY,
  SLUG_KEY,
  canonicalLocale,
  isTranslatable,
  localeStatus,
  readLocale,
  writeLocale,
} from '#/lib/content-locale'
import type { LocaleCtx } from '#/lib/content-locale'
import { SEO_KEY } from '#/lib/seo'
import type { EntryData, Field, SiteLanguages } from '#/lib/types'
import { ValidationError } from '#/server/content/errors'

import { mergeSeo } from './entry-format'

function localeCtxFor(
  languages: SiteLanguages,
  fields: Field[],
): LocaleCtx {
  return { main: languages.main, all: languages.all, fields }
}

export const SINGLE_LANGUAGE_MESSAGE =
  'This site has one language, so locale does not apply. Leave it out.'

export type LocaleTarget = { locale: string; isMain: boolean }

/**
 * The language a call works in. Null on a single-language site (the caller
 * keeps the old path). A multi-language site without a requested locale
 * means the main language. Throws for a locale the site does not have.
 */
export function resolveLocale(
  languages: SiteLanguages | null,
  requested: string | undefined,
): LocaleTarget | null {
  if (!languages) {
    if (requested !== undefined) {
      throw new ValidationError([{ path: 'locale', message: SINGLE_LANGUAGE_MESSAGE }])
    }
    return null
  }
  if (requested === undefined) return { locale: languages.main, isMain: true }
  const canonical = canonicalLocale(requested)
  if (!canonical || !languages.all.includes(canonical)) {
    throw new ValidationError([
      {
        path: 'locale',
        message: `"${requested}" is not one of this site's languages (${languages.all.join(', ')}). Call get_site_info for the list`,
      },
    ])
  }
  return { locale: canonical, isMain: canonical === languages.main }
}

/** The field of type slug, if the collection has one. */
export function slugFieldKey(fields: Field[]): string | undefined {
  return fields.find((field) => field.type === 'slug')?.key
}

/** Stored data restricted to what the schema declares, plus the language keys. */
function keepKnown(fields: Field[], stored: EntryData): EntryData {
  const out: EntryData = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(stored, field.key)) {
      out[field.key] = stored[field.key]
    }
  }
  if (Object.prototype.hasOwnProperty.call(stored, SEO_KEY)) {
    out[SEO_KEY] = stored[SEO_KEY]
  }
  for (const key of [I18N_KEY, LOCALE_KEY]) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) out[key] = stored[key]
  }
  return out
}

/**
 * The flat view of one language, as an agent reads it. `slug` is that
 * language's URL slug: its own `$slug` when set, else the main slug. The slug
 * field in `data` carries the same value.
 */
export function localeView(
  stored: EntryData,
  languages: SiteLanguages,
  fields: Field[],
  locale: string,
  mainSlug: string,
): { data: EntryData; slug: string } {
  const ctx = localeCtxFor(languages, fields)
  const data = readLocale(stored, locale, ctx)
  if (locale === languages.main) {
    return { data, slug: mainSlug }
  }
  const own = data[SLUG_KEY]
  const slug = typeof own === 'string' && own !== '' ? own : mainSlug
  const slugKey = slugFieldKey(fields)
  if (slugKey) data[slugKey] = slug
  return { data, slug }
}

/** Completeness of every non-main language, for the `translations` field. */
export function translationStatuses(
  stored: EntryData,
  languages: SiteLanguages,
  fields: Field[],
): Record<string, { complete: boolean; missing: string[] }> {
  const ctx = localeCtxFor(languages, fields)
  const out: Record<string, { complete: boolean; missing: string[] }> = {}
  for (const locale of languages.all) {
    if (locale === languages.main) continue
    const status = localeStatus(stored, locale, ctx)
    out[locale] = { complete: status.complete, missing: status.missing }
  }
  return out
}

/**
 * Applies one write in one language and returns the data to store.
 *
 * - `converted` is the output of toStoredFields for the keys the agent sent.
 * - In a non-main language, a slug sets `$slug` (empty clears it), and shared
 *   fields are written to the shared value and listed in `sharedFieldsUpdated`.
 * - `seo` is a patch (see seoPatchFromInput). It merges into the language's
 *   own `$seo`. `seoEnabled: false` drops SEO altogether (sections without SEO).
 */
export function applyLocaleWrite(input: {
  fields: Field[]
  languages: SiteLanguages
  locale: string
  stored: EntryData
  converted: EntryData
  seo?: Record<string, unknown>
  seoEnabled?: boolean
}): { data: EntryData; sharedFieldsUpdated: string[] } {
  const { fields, languages, locale, converted } = input
  const ctx = localeCtxFor(languages, fields)
  const isMain = locale === languages.main
  const slugKey = slugFieldKey(fields)
  const base = keepKnown(fields, input.stored)
  const next = readLocale(base, locale, ctx)
  const sharedFieldsUpdated: string[] = []

  for (const [key, value] of Object.entries(converted)) {
    if (!isMain && key === slugKey) {
      if (value === null || value === undefined || value === '') {
        delete next[SLUG_KEY]
      } else {
        next[SLUG_KEY] = value
      }
      continue
    }
    const field = fields.find((item) => item.key === key)
    if (!isMain && field && !isTranslatable(field)) {
      sharedFieldsUpdated.push(key)
    }
    next[key] = value
  }

  if (input.seo !== undefined || input.seoEnabled === false) {
    if (input.seoEnabled === false) {
      delete next[SEO_KEY]
    } else {
      const merged = mergeSeo(
        next[SEO_KEY] as Record<string, unknown> | undefined,
        input.seo,
      )
      if (merged) next[SEO_KEY] = merged
      else delete next[SEO_KEY]
    }
  }

  return {
    data: writeLocale(base, locale, next, ctx),
    sharedFieldsUpdated,
  }
}

/**
 * `fields` with the top-level `slug` folded into the slug field, so the slug
 * can be sent either way. Sending both with different values is refused.
 */
export function withSlugInput(
  fields: Field[],
  inputs: Record<string, unknown>,
  slug: string | undefined,
): Record<string, unknown> {
  if (slug === undefined) return inputs
  const key = slugFieldKey(fields)
  if (!key) {
    throw new ValidationError([
      { path: 'slug', message: 'This collection has no slug field' },
    ])
  }
  if (inputs[key] !== undefined && inputs[key] !== slug) {
    throw new ValidationError([
      {
        path: 'slug',
        message: `slug and fields.${key} disagree. Send the slug once`,
      },
    ])
  }
  return { ...inputs, [key]: slug }
}

/**
 * Adds `sharedFieldsUpdated` to a write result made in a non-main language, so
 * the agent sees which values it changed for every language.
 */
export function withSharedNote<T extends object>(
  result: T,
  target: LocaleTarget | null,
  shared: string[],
): T | (T & { sharedFieldsUpdated: string[] }) {
  if (!target || target.isMain) return result
  return { ...result, sharedFieldsUpdated: shared }
}
