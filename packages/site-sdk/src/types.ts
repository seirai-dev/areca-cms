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

type FieldBase = {
  key: string
  label: string
  required?: boolean
  description?: string
}

/**
 * Wire field, discriminated on `type`. `options` only exists on `select`,
 * `collection` is required on `reference`, `after` only on `date`/`datetime`.
 */
export type Field =
  | (FieldBase & {
      type: 'text' | 'textarea' | 'richtext' | 'image' | 'slug' | 'boolean' | 'number' | 'url'
    })
  | (FieldBase & { type: 'select'; options?: readonly string[] })
  | (FieldBase & { type: 'reference'; collection: string })
  | (FieldBase & {
      type: 'date' | 'datetime'
      /** Other date/datetime field key (same collection) that this value must be on or after. */
      after?: string
    })

export type CollectionConfig = {
  route: string
  label?: string
  fields: readonly Field[]
}

export type SiteContentConfig = {
  siteKey: string
  collections: Record<string, CollectionConfig>
  /** Where `areca pull` copies media. Local only: never sent to the CMS. */
  assets?: AssetsConfig
}

/**
 * Media handling for `areca pull`. By default every file the content uses is
 * downloaded into `public/areca` and the content points at `/areca/...`, so
 * the site never requests anything from the CMS.
 */
export type AssetsConfig = {
  /** Default `true`. `false` keeps URLs pointing at the CMS. */
  download?: boolean
  /** Directory relative to the project root. Default `public/areca`. */
  dir?: string
  /**
   * URL path the site serves `dir` from. Derived for directories under
   * `public/` (`public/areca` is served from `/areca`); required otherwise.
   */
  publicPath?: string
}

/** POST /api/sites/manifest body */
export type SiteManifest = {
  collections: Record<string, CollectionConfig>
}

/**
 * Published rich text. `markdown` is an interoperable export, `document`
 * preserves the editor as a TanStack Markdown AST (render with
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

export type ReferenceValue<C extends string = string> = {
  collection: C
  slug: string
  id: string
}

export type SnapshotEntry = {
  id: string
  slug: string
  publishedAt: string | null
  data: Record<string, unknown>
  /** Camel collection key. Set by `areca pull` on every pulled entry. */
  collection?: string
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
  /** Every media file the content references. Absent from older CMS versions. */
  assets?: SnapshotAsset[]
  /** The site's production URL, used to make SEO image URLs absolute. */
  siteUrl?: string | null
  /**
   * Field schema for exactly the collections in `collections`, keyed by raw
   * CMS key. Absent from publications made before schemas were embedded.
   */
  schema?: Record<string, CollectionConfig>
}

/** A media file referenced by a publication. */
export type SnapshotAsset = {
  id: string
  /** Content URLs for this file end in `/api/assets/file/<storageKey>`. */
  storageKey: string
  url: string
  filename: string
  mimeType: string
  size: number
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
  /** Immutable directory under `.publications`; absent in legacy flat output. */
  generation?: string
  /** Present when media was copied locally. */
  assets?: {
    /** URL path the content uses for media, e.g. `/areca`. */
    publicPath: string
    count: number
  }
}
