import type { MarkdownDocument } from '@tanstack/markdown'

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'image'
  | 'date'
  | 'datetime'
  | 'select'
  | 'reference'
  | 'slug'
  | 'boolean'
  | 'number'
  | 'url'

export type Field = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  collection?: string
  description?: string
  /** Other date/datetime field key that this value must be on or after. */
  after?: string
}

export type CollectionConfig = {
  route: string
  label?: string
  fields: Field[]
}

export type SiteContentConfig = {
  siteKey: string
  collections: Record<string, CollectionConfig>
}

/** POST /api/sites/manifest body */
export type SiteManifest = {
  collections: Record<string, CollectionConfig>
}

/**
 * Published rich text. `markdown` is the canonical serialization, `document`
 * is the TanStack Markdown AST parsed from it (render with
 * `@tanstack/markdown/react` or `renderHtml`), and `html` is a static
 * fallback rendered from the same AST.
 */
export type RichTextValue = {
  json: unknown
  markdown: string
  document: MarkdownDocument
  html: string
}

export type ImageValue = {
  url: string
  width: number | null
  height: number | null
  alt: string
  mimeType: string
}

export type ReferenceValue = {
  collection: string
  slug: string
  id: string
}

export type SnapshotEntry = {
  id: string
  slug: string
  publishedAt: string | null
  data: Record<string, unknown>
  /**
   * Resolved SEO/GEO head data. CMS versions with SEO support always send it;
   * snapshots from older CMS versions do not have it.
   */
  seo?: SeoMeta
}

/** Wire contract: matches the CMS `SeoMeta`. */
export type SeoMeta = {
  /** Page title without any site suffix. */
  title: string
  description: string | null
  canonicalUrl: string | null
  robots: { index: boolean; follow: boolean; content: string }
  focusKeyphrase: string | null
  openGraph: {
    type: 'article' | 'website'
    title: string
    description: string | null
    url: string | null
    siteName: string
    image: ImageValue | null
    publishedTime: string | null
    modifiedTime: string | null
  }
  twitter: {
    card: 'summary' | 'summary_large_image'
    title: string
    description: string | null
    image: ImageValue | null
  }
  author: { name: string; url: string | null; bio: string | null } | null
  /** TL;DR for answer engines; render it visibly on the page. */
  summary: string | null
  keyTakeaways: string[]
  faq: { question: string; answer: string }[]
  about: { name: string; sameAs: string | null }[]
  /** Ready-to-embed JSON-LD objects (main type, FAQPage, extras). */
  jsonLd: Record<string, unknown>[]
}

export type Snapshot = {
  publicationId: string
  siteKey: string
  createdAt: string
  hash: string
  collections: Record<string, SnapshotEntry[]>
}

export type PreviewResult = {
  collection: string
  slug: string
  entry: SnapshotEntry
}

export type PulledContentManifest = {
  publicationId: string
  hash: string
  createdAt: string
  collections: Record<string, number>
}
