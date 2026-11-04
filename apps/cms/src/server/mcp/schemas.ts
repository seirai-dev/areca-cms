import { z } from '#/lib/zod'

import { ID_MAX_LENGTH, URL_MAX_LENGTH } from '#/lib/content-limits'
import { SEO_LIMITS, SEO_SCHEMA_TYPES, TWITTER_CARDS } from '#/lib/seo'

/**
 * Shared tool input pieces. Descriptions here are what the model reads.
 *
 * Input schemas deliberately avoid nullable and union-with-null types: some
 * MCP clients reject `type: ["string", "null"]`. Instead, "clearing" a value
 * is spelled per type (see CLEARING_NOTE and entry-format's seoPatchFromInput).
 */

export const idSchema = (what: string) =>
  z
    .string()
    .min(1)
    .max(ID_MAX_LENGTH)
    .describe(`The ${what} id, exactly as returned by an earlier tool call.`)

/** Appended to descriptions of inputs that can be cleared on update. */
export const CLEARING_NOTE =
  'To clear it on update, send an empty string (text and enum keys), false (booleans), an empty array (lists), or an empty author name.'

/**
 * SEO/GEO block. Every key is optional. Omitted keys keep their stored value on
 * update; the clearing spellings above remove a key. The merged result is
 * checked by the stored `$seo` schema in lib/seo.ts.
 */
export const seoInputSchema = z
  .object({
    title: z
      .string()
      .max(SEO_LIMITS.title)
      .optional()
      .describe(
        `Search result title, about 50-60 characters, no site name suffix. Falls back to the entry title. Max ${SEO_LIMITS.title}.`,
      ),
    description: z
      .string()
      .max(SEO_LIMITS.description)
      .optional()
      .describe(
        `Meta description, 140-160 characters of plain text that tells a searcher what the page gives them. Falls back to the summary. Max ${SEO_LIMITS.description}.`,
      ),
    focusKeyphrase: z
      .string()
      .max(SEO_LIMITS.keyphrase)
      .optional()
      .describe(
        'The main search phrase this entry targets, e.g. "sourdough starter for beginners". Not shown to visitors.',
      ),
    canonicalUrl: z
      .string()
      .max(URL_MAX_LENGTH)
      .optional()
      .describe(
        'Absolute http(s) URL, only when this page is a copy of another URL. Normally leave unset; the production URL is used.',
      ),
    noindex: z
      .boolean()
      .optional()
      .describe(
        'true keeps the page out of search results. Leave unset for normal content.',
      ),
    nofollow: z
      .boolean()
      .optional()
      .describe('true tells crawlers not to follow links on the page.'),
    ogTitle: z
      .string()
      .max(SEO_LIMITS.title)
      .optional()
      .describe(
        'Title shown when the page is shared on social media. Falls back to the SEO title.',
      ),
    ogDescription: z
      .string()
      .max(SEO_LIMITS.description)
      .optional()
      .describe(
        'Description shown when the page is shared. Falls back to the meta description.',
      ),
    ogImage: z
      .string()
      .max(ID_MAX_LENGTH)
      .optional()
      .describe(
        'Asset id of the social share image, ideally 1200x630. Get it from list_assets, upload_asset_from_url or get_asset_upload.',
      ),
    twitterCard: z
      .enum([...TWITTER_CARDS, ''])
      .optional()
      .describe(
        'summary_large_image (default when an image exists) or summary.',
      ),
    schemaType: z
      .enum([...SEO_SCHEMA_TYPES, ''])
      .optional()
      .describe(
        'Schema.org type. Use BlogPosting for blog posts, NewsArticle for news, Article as the default, WebPage for static pages.',
      ),
    summary: z
      .string()
      .max(SEO_LIMITS.summary)
      .optional()
      .describe(
        'A 2-3 sentence TL;DR that answers the main question of the entry. Shown visibly on the page for answer engines.',
      ),
    keyTakeaways: z
      .array(z.string().max(SEO_LIMITS.takeaway))
      .max(SEO_LIMITS.takeaways)
      .optional()
      .describe(
        `3-5 short, self-contained statements of the key points (max ${SEO_LIMITS.takeaways}). Each one readable without the rest of the post.`,
      ),
    faq: z
      .array(
        z.object({
          question: z.string().max(SEO_LIMITS.faqQuestion),
          answer: z.string().max(SEO_LIMITS.faqAnswer),
        }),
      )
      .max(SEO_LIMITS.faq)
      .optional()
      .describe(
        `Question and answer pairs answered by the body text (max ${SEO_LIMITS.faq}). Only real questions the entry answers.`,
      ),
    about: z
      .array(
        z.object({
          name: z.string().max(SEO_LIMITS.aboutName),
          sameAs: z
            .string()
            .max(URL_MAX_LENGTH)
            .optional()
            .describe('Optional http(s) URL.'),
        }),
      )
      .max(SEO_LIMITS.about)
      .optional()
      .describe(
        'Entities the entry is about, e.g. [{"name":"Sourdough","sameAs":"https://en.wikipedia.org/wiki/Sourdough"}]. sameAs is optional.',
      ),
    author: z
      .object({
        name: z.string().max(SEO_LIMITS.authorName).optional(),
        url: z
          .string()
          .max(URL_MAX_LENGTH)
          .optional()
          .describe('Optional http(s) URL.'),
        bio: z.string().max(SEO_LIMITS.authorBio).optional(),
      })
      .strict()
      .optional()
      .describe(
        'Author of the entry: {"name":"Jane Doe","url":"https://...","bio":"..."}. Send name as an empty string to remove the author.',
      ),
    jsonLd: z
      .string()
      .max(SEO_LIMITS.jsonLd)
      .optional()
      .describe(
        'Extra schema.org structured data as a JSON string: one object, or an array of objects. Usually leave unset; the CMS writes the main node from the fields above.',
      ),
  })
  .strict()
  .describe(
    `SEO and GEO metadata for search engines and answer engines. Write it for every entry. ${CLEARING_NOTE}`,
  )

export type SeoInput = z.output<typeof seoInputSchema>

/** `fields`: values keyed by field key. Formats are described per field by get_collection_schema. */
export const fieldsInputSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Field values keyed by field key, as listed by get_collection_schema. Rich text (richtext) takes a Markdown string, with `inline code` in backticks and code in fenced blocks with a language; image takes an asset id; reference takes an entry id; date takes YYYY-MM-DD; datetime takes ISO 8601 with an offset. To clear a field on update, send an empty string.',
  )
