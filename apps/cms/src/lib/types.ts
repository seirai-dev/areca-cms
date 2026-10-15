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
  /** Visual heading in the editor only (site content sections). Max 80 characters. */
  group?: string
  /** Stored per language when true. Absent = the type default (see `content-locale.ts`). */
  translatable?: boolean
}

/** Site languages. `main` is the fallback; `all` is ordered and includes `main`. */
export type SiteLanguages = {
  main: string
  all: string[]
}

/** `collection` = a list of entries; `global` = a single site content section. */
export type ContentKind = 'collection' | 'global'

export type MembershipRole = 'owner' | 'editor'

export type EntryStatus = 'draft' | 'published' | 'scheduled' | 'archived'

export type PublicationStatus =
  | 'pending'
  | 'building'
  | 'demo'
  | 'live'
  | 'failed'
  | 'superseded'
  | 'rolled_back'

export type BuildJobStatus =
  | 'queued'
  | 'building'
  | 'validating'
  | 'deploying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type DeploymentTarget = {
  provider: 'dokploy'
  applicationId: string
  healthCheckUrl?: string
}

export type SnapshotRichText = {
  json: unknown
  markdown: string
  /** TanStack Markdown AST preserving the validated visual editor structure. */
  document: MarkdownDocument
  html: string
}

export type SnapshotEntry = {
  id: string
  slug: string
  publishedAt: string | null
  data: Record<string, unknown>
  /**
   * Resolved SEO/GEO head data — matches `@areca-cms/site-sdk` `SeoMeta`.
   * Always set by current builds; absent in publications stored before it.
   */
  seo?: SeoMeta
  /** Language of `data`, `slug` and `seo`. Absent on single-language sites. */
  locale?: string
  /** Complete languages only, main included when complete. */
  locales?: Record<
    string,
    {
      /** Per-language slug, or the main slug. */
      slug: string
      /** Full flat view: shared + translatable fields. */
      data: Record<string, unknown>
      seo?: SeoMeta
    }
  >
}

/** Wire contract — matches `@areca-cms/site-sdk` `SeoMeta`. */
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

/** Wire contract — matches `@areca-cms/site-sdk` `Snapshot`. */
export type Snapshot = {
  publicationId: string
  siteKey: string
  createdAt: string
  hash: string
  /** Site languages. Absent on single-language sites. */
  languages?: SiteLanguages
  collections: Record<string, SnapshotEntry[]>
  /**
   * Enabled site content sections, keyed by raw key. Absent when there are
   * none. Included in `hash` together with `collections`.
   */
  globals?: Record<string, SnapshotGlobal>
  /** Schema for exactly the sections above. Absent when there are none. */
  globalSchema?: Record<string, GlobalConfig>
  /**
   * Collection schema for exactly the collections above, keyed by raw key.
   * Same shape as the manifest. Outside `hash`. Absent in publications stored
   * before it existed; consumers fall back to the live manifest.
   */
  schema?: SnapshotSchema
  /**
   * Every media file the content references, so a site can copy them into
   * its own repository. Publications stored before this field existed get it
   * computed when they are served.
   */
  assets?: SnapshotAsset[]
  /** The site's production URL, added when served (not stored). */
  siteUrl?: string | null
}

/** One site content section as a snapshot ships it (single entry, raw keys). */
export type SnapshotGlobal = {
  id: string
  publishedAt: string | null
  data: Record<string, unknown>
  /** Present only when the section has SEO turned on. */
  seo?: SeoMeta
  /** Language of `data` and `seo`. Absent on single-language sites. */
  locale?: string
  /** Complete languages only, main included when complete. */
  locales?: Record<string, { data: Record<string, unknown>; seo?: SeoMeta }>
}

/** Section schema in a manifest or snapshot. Same field rules as collections, minus slug. */
export type GlobalConfig = {
  label?: string
  fields: Field[]
  seo?: boolean
  previewPath?: string
  /** Languages besides main that must be complete before going live. */
  requiredLanguages?: string[]
}

export type SnapshotSchema = Record<
  string,
  {
    route: string
    label?: string
    fields: Field[]
    /** Per-language route patterns. Collections only. */
    routes?: Record<string, string>
    requiredLanguages?: string[]
  }
>

/** Wire contract — matches `@areca-cms/site-sdk` `SnapshotAsset`. */
export type SnapshotAsset = {
  id: string
  /** Content URLs for this file end in `/api/assets/file/<storageKey>`. */
  storageKey: string
  url: string
  filename: string
  mimeType: string
  size: number
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

export type SiteManifest = {
  /** Site languages. Omitted leaves the site's current setting alone. */
  languages?: SiteLanguages
  collections: Record<
    string,
    {
      route: string
      label?: string
      fields: Field[]
      /** Per-language route patterns, e.g. `{ nl: '/vacatures/$slug' }`. */
      routes?: Record<string, string>
      /** Languages besides main that must be complete before going live. */
      requiredLanguages?: string[]
    }
  >
  /** Site content sections. Omitted or empty when none. A push omitting them disables them. */
  globals?: Record<string, GlobalConfig>
}

export type EntryData = Record<string, unknown>

export type AuditMeta = Record<string, unknown>
