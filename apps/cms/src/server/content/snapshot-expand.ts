import {
  richTextAssetRefs,
  richTextAssetsAuthorizedFrom,
} from '#/server/assets/richtext-ownership'

import { GLOBAL_ENTRY_SLUG, globalPublicUrl } from '#/lib/globals'
import { SLUG_KEY, readLocale, resolveChain } from '#/lib/content-locale'
import { readEntrySeo, withoutSeo } from '#/lib/seo'
import type {
  EntryData,
  Field,
  ReferenceValue,
  SeoMeta,
  SiteLanguages,
} from '#/lib/types'
import { resolveAssetFromLookup } from '#/server/assets'
import type { AssetLookup } from '#/server/assets'
import { convertRichText, validateRichText } from '#/server/richtext'
import { resolveEntryLinks } from '#/server/richtext/entry-links'
import type {
  EntryLinkIssue,
  EntryLinkResolution,
  EntryLinkTarget,
} from '#/server/richtext/entry-links'
import { entryTitle } from '#/lib/content/utils'

import { ValidationError } from './errors.ts'
import { localeCtxFor } from './locale-validation.ts'
import { shippedLocales } from './entry-links.ts'
import { buildEntrySeo } from './seo.ts'
import type { SiteCore } from './site-core.ts'
import { pickDeclaredFields } from './validation.ts'

/**
 * Turns one language view of an entry or section into its published shape.
 * Go live (snapshot.ts) and draft previews (snapshot-preview.ts) both expand
 * through here; they differ only in the context they pass.
 */

/** Resolves the entry links of one rich text view, and collects their problems. */
export type LinkResolver = {
  resolve: (
    target: EntryLinkTarget,
    locale: string | null,
  ) => EntryLinkResolution
  report: (
    field: string,
    locale: string | null,
    issues: EntryLinkIssue[],
  ) => void
}

/** The entry or section whose text is being expanded, for link warnings. */
export type LinkSource = {
  id: string
  title: string
  collectionKey: string
  global: boolean
}

export type ExpandContext = {
  site: SiteCore
  languages: SiteLanguages | null
  assets: AssetLookup
  /** Go live: a missing asset throws. Previews: it becomes null. */
  strict: boolean
  /** The reference a reference field's value shows, or null. */
  reference: (id: string, field: Field) => ReferenceValue | null
  links: (source: LinkSource) => LinkResolver
}

/** A collection entry as the expander needs it. */
export type ExpandEntry = {
  id: string
  collectionKey: string
  fields: Field[]
  /** The main-language slug. */
  slug: string
  routePattern: string
  localizedRoutes?: Record<string, string> | null
  publishedAt: Date | null
}

/** A site content section as the expander needs it. */
export type ExpandSection = {
  key: string
  label: string
  fields: Field[]
  seoEnabled: boolean
  previewPath: string | null
}

/** Every language view of `data` (each site language), or the base alone. */
export function languageViews(
  languages: SiteLanguages | null,
  fields: Field[],
  data: EntryData,
): EntryData[] {
  return languages
    ? languages.all.map((locale) =>
        readLocale(data, locale, localeCtxFor(languages, fields)),
      )
    : [data]
}

export type AssetRefs = { ids: Set<string>; storageKeys: Set<string> }

/** Adds the asset ids and storage keys `views` (language views of one item) use. */
export function collectAssetRefs(
  fields: Field[],
  views: EntryData[],
  refs: AssetRefs,
) {
  for (const view of views) {
    const ogImage = readEntrySeo(view).ogImage
    if (ogImage) refs.ids.add(ogImage)
    for (const field of fields) {
      const value = view[field.key]
      if (field.type === 'richtext') {
        for (const key of richTextAssetRefs(value).storageKeys)
          refs.storageKeys.add(key)
      } else if (
        field.type === 'image' &&
        typeof value === 'string' &&
        value !== ''
      ) {
        refs.ids.add(value)
      }
    }
  }
}

/** One collection entry in one language (`locale` null on single-language sites). */
export function expandEntryView(
  ctx: ExpandContext,
  item: ExpandEntry,
  view: EntryData,
  locale: string | null,
): { slug: string; data: Record<string, unknown>; seo: SeoMeta } {
  const { languages } = ctx
  const isTranslation = Boolean(
    languages && locale && locale !== languages.main,
  )
  const localSlug = isTranslation ? view[SLUG_KEY] : undefined
  const slug =
    typeof localSlug === 'string' && localSlug !== '' ? localSlug : item.slug
  const shown: EntryData = { ...view }
  const slugField = item.fields.find((field) => field.type === 'slug')
  if (isTranslation && slugField) shown[slugField.key] = slug
  const data = convertFields(
    ctx,
    item.fields,
    shown,
    locale,
    ctx.links({
      id: item.id,
      title: entryTitle(shown, item.fields, slug),
      collectionKey: item.collectionKey,
      global: false,
    }),
  )
  const ogImageId = readEntrySeo(shown).ogImage
  const routePattern =
    (isTranslation ? item.localizedRoutes?.[locale!] : undefined) ??
    item.routePattern
  return {
    slug,
    data,
    seo: buildEntrySeo({
      fields: item.fields,
      data: shown,
      converted: data,
      slug,
      routePattern,
      site: ctx.site,
      // A missing OG image falls back to the hero image rather than
      // blocking the whole publication.
      ogImage: ogImageId
        ? resolveAssetFromLookup(ctx.assets, ogImageId, locale)
        : null,
      publishedAt: item.publishedAt,
    }),
  }
}

/**
 * One site content section in one language. `entry` is null for a section
 * with no ready data: it ships `{}`.
 */
export function expandSectionView(
  ctx: ExpandContext,
  section: ExpandSection,
  entry: { id: string; publishedAt: Date | null } | null,
  view: EntryData,
  locale: string | null,
): { data: Record<string, unknown>; seo?: SeoMeta } {
  const data = entry
    ? convertFields(
        ctx,
        section.fields,
        view,
        locale,
        ctx.links({
          id: entry.id,
          title: section.label,
          collectionKey: section.key,
          global: true,
        }),
      )
    : {}
  const ogImageId = entry ? readEntrySeo(view).ogImage : undefined
  const seo = section.seoEnabled
    ? buildEntrySeo({
        fields: section.fields,
        data: view,
        converted: data,
        slug: GLOBAL_ENTRY_SLUG,
        routePattern: '',
        url: globalPublicUrl(ctx.site.productionUrl, section.previewPath),
        title: section.label,
        site: ctx.site,
        ogImage: ogImageId
          ? resolveAssetFromLookup(ctx.assets, ogImageId)
          : null,
        publishedAt: entry?.publishedAt ?? null,
      })
    : undefined
  return { data, ...(seo ? { seo } : {}) }
}

/**
 * Runs `expand` once per shipped language and picks the top-level value: the
 * main language when it ships, else the first shipped language in site order
 * (the fallback chain). Single-language sites expand the base only.
 */
export function expandAcrossLanguages<T>(
  languages: SiteLanguages | null,
  fields: Field[],
  data: EntryData,
  expand: (view: EntryData, locale: string | null) => T,
  requested: string | null = null,
): {
  top: T
  locale?: string
  locales?: Record<string, T>
  isFallback?: boolean
} {
  if (!languages) return { top: expand(data, null) }
  const ctx = localeCtxFor(languages, fields)
  const shipped = shippedLocales(data, ctx)
  const resolved = resolveChain(requested, shipped, ctx)
  const top = resolved?.locale ?? ctx.main
  const locales: Record<string, T> = {}
  for (const locale of shipped) {
    locales[locale] = expand(readLocale(data, locale, ctx), locale)
  }
  const topValue = locales[top] ?? expand(readLocale(data, top, ctx), top)
  const isFallback =
    resolved?.isFallback ?? (requested != null && requested !== ctx.main)
  return { top: topValue, locale: top, locales, isFallback }
}

/** `locale` and `locales` for a language site; nothing on a single-language one. */
export function localeFields<T>(expanded: {
  locale?: string
  locales?: Record<string, T>
}): { locale?: string; locales?: Record<string, T> } {
  return expanded.locale === undefined
    ? {}
    : { locale: expanded.locale, locales: expanded.locales }
}

function convertFields(
  ctx: ExpandContext,
  fields: Field[],
  data: EntryData,
  /** Language of the view: image alt text follows it. */
  locale: string | null,
  /** Entry links in rich text resolve through this. */
  links: LinkResolver,
): Record<string, unknown> {
  const out: Record<string, unknown> = withoutSeo(
    pickDeclaredFields(fields, data),
  )

  for (const field of fields) {
    const value = data[field.key]
    if (field.type === 'richtext') {
      if (!richTextAssetsAuthorizedFrom(value, ctx.assets)) {
        if (ctx.strict)
          throw new ValidationError([
            {
              path: field.key,
              message: 'Embedded asset not found in this organization',
            },
          ])
        out[field.key] = null
        continue
      }
      if (value == null || value === '') {
        out[field.key] = value
        continue
      }
      // Entry links take the path of their target in this language. A link
      // that cannot work becomes plain text (see resolveEntryLinks).
      const linked = resolveEntryLinks(value, (target) =>
        links.resolve(target, locale),
      )
      links.report(field.key, locale, linked.issues)
      try {
        if (ctx.strict || validateRichText(linked.json).length === 0) {
          out[field.key] = convertRichText(linked.json)
        }
      } catch {
        // best-effort preview keeps the original value
      }
      continue
    }

    if (field.type === 'image') {
      if (typeof value !== 'string' || value.length === 0) {
        out[field.key] = value ?? null
        continue
      }
      const resolved = resolveAssetFromLookup(ctx.assets, value, locale)
      if (resolved) {
        out[field.key] = resolved
      } else if (ctx.strict) {
        throw new ValidationError([
          { path: field.key, message: `asset not found: ${value}` },
        ])
      } else {
        out[field.key] = null
      }
      continue
    }

    if (field.type === 'reference') {
      out[field.key] =
        typeof value !== 'string' || value.length === 0
          ? (value ?? null)
          : ctx.reference(value, field)
    }
  }

  return out
}
