import { z } from 'zod'

import { ID_MAX_LENGTH, URL_MAX_LENGTH } from '#/lib/content-limits'
import type { ImageValue, SeoMeta } from '#/lib/types'

/**
 * Per-entry SEO/GEO block. It is stored inside entry data under this reserved
 * key so drafts, revisions, scheduling and publishing carry it for free. The
 * `$` prefix fails `isSafeIdentifier`, so no content-model field can collide.
 * Snapshots move it out of `data` into a resolved top-level `entry.seo`.
 */
export const SEO_KEY = '$seo'

export const SEO_SCHEMA_TYPES = [
  'Article',
  'BlogPosting',
  'NewsArticle',
  'WebPage',
] as const
export type SeoSchemaType = (typeof SEO_SCHEMA_TYPES)[number]

export const TWITTER_CARDS = ['summary_large_image', 'summary'] as const
export type TwitterCard = (typeof TWITTER_CARDS)[number]

/** Soft targets shown as counters in the editor (not enforced). */
export const SEO_TITLE_TARGET = 60
export const SEO_DESCRIPTION_TARGET = 160

/** Hard limits, enforced on write. */
export const SEO_LIMITS = {
  title: 300,
  description: 1_000,
  keyphrase: 200,
  summary: 2_000,
  takeaway: 500,
  takeaways: 12,
  faqQuestion: 500,
  faqAnswer: 3_000,
  faq: 20,
  aboutName: 200,
  about: 12,
  authorName: 200,
  authorBio: 1_000,
  jsonLd: 20_000,
} as const

const httpUrl = z
  .string()
  .max(URL_MAX_LENGTH)
  .refine(
    (value) => {
      try {
        const parsed = new URL(value)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'Must be an http(s) URL' },
  )

/** Optional URL: empty string means "unset". */
const optionalUrl = z.union([z.literal(''), httpUrl]).optional()
const optionalText = (max: number) => z.string().max(max).optional()

const rawJsonLd = z
  .string()
  .max(SEO_LIMITS.jsonLd)
  .refine(
    (value) => {
      if (!value.trim()) return true
      try {
        const parsed: unknown = JSON.parse(value)
        return (
          parsed !== null &&
          typeof parsed === 'object' &&
          (!Array.isArray(parsed) ||
            parsed.every((item) => item && typeof item === 'object'))
        )
      } catch {
        return false
      }
    },
    { message: 'Must be a JSON object or an array of objects' },
  )
  .optional()

export const entrySeoSchema = z
  .object({
    title: optionalText(SEO_LIMITS.title),
    description: optionalText(SEO_LIMITS.description),
    focusKeyphrase: optionalText(SEO_LIMITS.keyphrase),
    canonicalUrl: optionalUrl,
    noindex: z.boolean().optional(),
    nofollow: z.boolean().optional(),
    ogTitle: optionalText(SEO_LIMITS.title),
    ogDescription: optionalText(SEO_LIMITS.description),
    ogImage: z.string().max(ID_MAX_LENGTH).optional(),
    twitterCard: z.enum(TWITTER_CARDS).optional(),
    schemaType: z.enum(SEO_SCHEMA_TYPES).optional(),
    about: z
      .array(
        z.object({
          name: z.string().max(SEO_LIMITS.aboutName),
          sameAs: optionalUrl,
        }),
      )
      .max(SEO_LIMITS.about)
      .optional(),
    summary: optionalText(SEO_LIMITS.summary),
    keyTakeaways: z
      .array(z.string().max(SEO_LIMITS.takeaway))
      .max(SEO_LIMITS.takeaways)
      .optional(),
    faq: z
      .array(
        z.object({
          question: z.string().max(SEO_LIMITS.faqQuestion),
          answer: z.string().max(SEO_LIMITS.faqAnswer),
        }),
      )
      .max(SEO_LIMITS.faq)
      .optional(),
    author: z
      .object({
        name: optionalText(SEO_LIMITS.authorName),
        url: optionalUrl,
        bio: optionalText(SEO_LIMITS.authorBio),
      })
      .optional(),
    jsonLd: rawJsonLd,
  })
  .strict()

/** What editors store under `$seo`. Every key is optional. */
export type EntrySeo = z.infer<typeof entrySeoSchema>

export function readEntrySeo(data: Record<string, unknown>): EntrySeo {
  const value = data[SEO_KEY]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
}

/** `data` without the reserved SEO key. */
export function withoutSeo<T extends Record<string, unknown>>(data: T): T {
  if (!Object.prototype.hasOwnProperty.call(data, SEO_KEY)) return data
  const { [SEO_KEY]: _seo, ...rest } = data
  return rest as T
}

const clean = (value: string | undefined | null) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Collapse whitespace and cut at a word boundary, adding an ellipsis. */
export function truncateText(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Public URL for an entry: production origin + collection route. */
export function entryPublicUrl(
  productionUrl: string,
  routePattern: string,
  slug: string,
): string | null {
  try {
    const origin = new URL(productionUrl)
    const path = routePattern.includes('$slug')
      ? routePattern.replaceAll('$slug', slug)
      : `${routePattern.replace(/\/$/, '')}/${slug}`
    return new URL(path, origin).toString()
  } catch {
    return null
  }
}

export type ResolveSeoInput = {
  seo: EntrySeo
  /** The entry's own title (first text field), else its slug. */
  title: string
  /** Plain-text fallback for the description (excerpt or body). */
  fallbackDescription: string | null
  /** Default canonical URL (production URL + route), if derivable. */
  url: string | null
  site: { name: string; url: string }
  /** Resolved `seo.ogImage`, if set and found. */
  ogImage: ImageValue | null
  /** First image field of the entry, used when no OG image is set. */
  heroImage: ImageValue | null
  datePublished: string | null
  dateModified: string | null
}

/**
 * Turn the stored block into everything a page head needs: fallbacks
 * applied, absolute URLs, and ready-to-embed JSON-LD. Pure, so the snapshot,
 * the preview endpoint and tests all share it.
 */
export function resolveEntrySeo(input: ResolveSeoInput): SeoMeta {
  const { seo } = input
  const title = clean(seo.title) ?? input.title
  const description =
    clean(seo.description) ??
    (clean(seo.summary)
      ? truncateText(seo.summary!, SEO_DESCRIPTION_TARGET)
      : null) ??
    (input.fallbackDescription
      ? truncateText(input.fallbackDescription, SEO_DESCRIPTION_TARGET) || null
      : null)
  const canonicalUrl = clean(seo.canonicalUrl) ?? input.url
  const index = seo.noindex !== true
  const follow = seo.nofollow !== true
  const image = input.ogImage ?? input.heroImage
  const schemaType: SeoSchemaType = seo.schemaType ?? 'Article'
  const isArticle = schemaType !== 'WebPage'
  const ogTitle = clean(seo.ogTitle) ?? title
  const ogDescription = clean(seo.ogDescription) ?? description
  const authorName = clean(seo.author?.name)
  const author = authorName
    ? {
        name: authorName,
        url: clean(seo.author?.url),
        bio: clean(seo.author?.bio),
      }
    : null
  const about = (seo.about ?? [])
    .map((item) => ({ name: item.name.trim(), sameAs: clean(item.sameAs) }))
    .filter((item) => item.name)
  const keyTakeaways = (seo.keyTakeaways ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
  const faq = (seo.faq ?? [])
    .map((item) => ({
      question: item.question.trim(),
      answer: item.answer.trim(),
    }))
    .filter((item) => item.question && item.answer)
  const summary = clean(seo.summary)

  const main: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    [isArticle ? 'headline' : 'name']: truncateText(title, 110),
    ...(description ? { description } : {}),
    ...(image ? { image: [image.url] } : {}),
    ...(canonicalUrl
      ? { url: canonicalUrl, mainEntityOfPage: canonicalUrl }
      : {}),
    ...(input.datePublished ? { datePublished: input.datePublished } : {}),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    ...(author
      ? {
          author: [
            {
              '@type': 'Person',
              name: author.name,
              ...(author.url ? { url: author.url } : {}),
              ...(author.bio ? { description: author.bio } : {}),
            },
          ],
        }
      : {}),
    publisher: {
      '@type': 'Organization',
      name: input.site.name,
      url: input.site.url,
    },
    ...(summary ? { abstract: summary } : {}),
    ...(clean(seo.focusKeyphrase)
      ? { keywords: clean(seo.focusKeyphrase) }
      : {}),
    ...(about.length
      ? {
          about: about.map((item) => ({
            '@type': 'Thing',
            name: item.name,
            ...(item.sameAs ? { sameAs: item.sameAs } : {}),
          })),
        }
      : {}),
  }
  const jsonLd: Record<string, unknown>[] = [main]
  if (faq.length > 0) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    })
  }
  if (seo.jsonLd?.trim()) {
    try {
      const extra: unknown = JSON.parse(seo.jsonLd)
      for (const item of Array.isArray(extra) ? extra : [extra]) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          jsonLd.push(item as Record<string, unknown>)
        }
      }
    } catch {
      // validated on write; stale invalid JSON is skipped
    }
  }

  return {
    title,
    description,
    canonicalUrl,
    robots: {
      index,
      follow,
      content: [
        index ? 'index' : 'noindex',
        follow ? 'follow' : 'nofollow',
        ...(index ? ['max-image-preview:large'] : []),
      ].join(', '),
    },
    focusKeyphrase: clean(seo.focusKeyphrase),
    openGraph: {
      type: isArticle ? 'article' : 'website',
      title: ogTitle,
      description: ogDescription,
      url: canonicalUrl,
      siteName: input.site.name,
      image,
      publishedTime: isArticle ? input.datePublished : null,
      modifiedTime: isArticle ? input.dateModified : null,
    },
    twitter: {
      card: seo.twitterCard ?? (image ? 'summary_large_image' : 'summary'),
      title: ogTitle,
      description: ogDescription,
      image,
    },
    author,
    summary,
    keyTakeaways,
    faq,
    about,
    jsonLd,
  }
}
